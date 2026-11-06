'use strict';

/**
 * 知乎发布模块
 *
 * Cookie 安全说明：
 *   - Cookie 通过调用方传入的 storageGet/storageSet 存取（对应 VS Code globalState）
 *   - 不写入任何磁盘文件，不会被 git 追踪
 *   - storageKey 固定为 'zhihu.cookieString'
 */

const https  = require('https');
const http   = require('http');
const { URL } = require('url');
const QRCode = require('qrcode');

// ─── 常量 ───────────────────────────────────────

const STORAGE_KEY = 'zhihu.cookieString';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.zhihu.com/',
  'Origin': 'https://www.zhihu.com',
};

// ─── 请求工具 ────────────────────────────────────

/**
 * 发送 HTTP(S) 请求
 * @param {{ method, hostname, path, headers, body, timeout }} opts
 * @returns {Promise<{ status, headers, body }>}
 */
function request(opts) {
  return new Promise((resolve, reject) => {
    // _rawBody 优先（Buffer，用于 multipart）；否则用 body 字符串
    const rawBody = opts._rawBody instanceof Buffer ? opts._rawBody : null;
    const strBody = rawBody ? null : (opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null);

    const reqOpts = {
      hostname: opts.hostname,
      path:     opts.path,
      method:   opts.method || 'GET',
      headers:  Object.assign({}, BASE_HEADERS, opts.headers || {}),
    };
    // Content-Length 未由调用方指定时自动填充
    if (rawBody && !reqOpts.headers['Content-Length']) {
      reqOpts.headers['Content-Length'] = rawBody.length;
    } else if (strBody && !reqOpts.headers['Content-Length']) {
      reqOpts.headers['Content-Length'] = Buffer.byteLength(strBody, 'utf8');
    }

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status:  res.statusCode,
          headers: res.headers,
          body:    Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(opts.timeout || 30000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (rawBody) req.write(rawBody);
    else if (strBody) req.write(strBody, 'utf8');
    req.end();
  });
}

/**
 * 从 cookie 字符串里提取某个 key 的值
 */
function getCookieValue(cookieStr, key) {
  if (!cookieStr) return '';
  const m = cookieStr.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * 合并 Set-Cookie 响应头到已有 cookie 字符串
 * 已存在的 key 会被覆盖，新 key 会追加
 */
function mergeCookies(existing, setCookieHeaders) {
  const map = new Map();
  // 先加载已有 cookie
  (existing || '').split(/;\s*/).forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) map.set(k, v);
    }
  });
  // 合并新 cookie（只取 name=value 部分，忽略 path/domain/expires 等属性）
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
  headers.forEach(hdr => {
    const part = hdr.split(';')[0].trim();
    const idx  = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) map.set(k, v);
    }
  });
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── Cookie 存储（委托给调用方） ─────────────────

/**
 * @typedef {Object} CookieStorage
 * @property {() => string} get
 * @property {(v: string) => void} set
 * @property {() => void} clear
 */

// ─── 登录检测 ────────────────────────────────────

/**
 * 检查 cookie 是否包含有效的 z_c0 令牌（不发网络请求）
 */
function isLoggedIn(cookieStr) {
  return !!getCookieValue(cookieStr, 'z_c0');
}

/**
 * 通过 /api/v4/me 验证 cookie 是否仍然有效
 */
async function verifyLogin(cookieStr) {
  try {
    const res = await request({
      hostname: 'www.zhihu.com',
      path:     '/api/v4/me',
      method:   'GET',
      headers:  { Cookie: cookieStr },
    });
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      return { valid: true, name: data.name || '', headline: data.headline || '' };
    }
    return { valid: false };
  } catch (_) {
    return { valid: false };
  }
}

// ─── 扫码登录 ────────────────────────────────────

/**
 * 第一步：获取 UDID（知乎扫码需要先建立 session）
 */
async function fetchUdid() {
  const res = await request({
    hostname: 'www.zhihu.com',
    path:     '/udid',
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '0' },
  });
  // 收集 set-cookie
  return {
    cookieStr: mergeCookies('', res.headers['set-cookie']),
  };
}

/**
 * 第二步：创建扫码 session，在 Node 端用 qrcode 库生成二维码图片（base64 data URL）
 * 知乎接口现在返回 { token, link, expires_at }，link 是扫码目标 URL，无单独图片
 */
async function createQrSession(cookieStr) {
  const xsrf = getCookieValue(cookieStr, '_xsrf');
  const res = await request({
    hostname: 'www.zhihu.com',
    path:     '/api/v3/account/api/login/qrcode',
    method:   'POST',
    headers:  {
      'Content-Type':  'application/json',
      'x-xsrftoken':   xsrf,
      Cookie:           cookieStr,
      'x-requested-with': 'fetch',
    },
    body: '{}',
  });
  if (res.status !== 200) {
    throw new Error(`创建扫码 session 失败（HTTP ${res.status}）：${res.body.slice(0, 200)}`);
  }
  const newCookie = mergeCookies(cookieStr, res.headers['set-cookie']);
  const data = JSON.parse(res.body);
  const token = data.token;
  const link  = data.link;
  if (!token || !link) {
    throw new Error(`接口响应缺少 token/link 字段：${res.body.slice(0, 200)}`);
  }
  // 在 Node 端生成二维码图片（data URL），绕过 webview CSP 限制
  const imageDataUrl = await QRCode.toDataURL(link, { width: 240, margin: 2 });
  return { token, link, imageDataUrl, cookieStr: newCookie };
}

/**
 * 第三步：轮询扫码状态
 * 返回 { status: 'waiting'|'scanned'|'confirmed'|'expired'|'error', cookieStr, userId }
 */
async function pollQrStatus(token, cookieStr) {
  const xsrf = getCookieValue(cookieStr, '_xsrf');
  const res = await request({
    hostname: 'www.zhihu.com',
    path:     `/api/v3/account/api/login/qrcode/${token}/scan_info`,
    method:   'GET',
    headers:  {
      'x-xsrftoken': xsrf,
      Cookie:         cookieStr,
      'x-requested-with': 'fetch',
    },
  });
  const newCookie = mergeCookies(cookieStr, res.headers['set-cookie']);

  if (res.status !== 200) {
    return { status: 'error', cookieStr: newCookie };
  }

  const data = JSON.parse(res.body);
  // status: 0 = 等待, 1 = 已扫码/已确认
  if (data.status === 1 && data.user_id) {
    // 已确认登录，验证 z_c0
    if (getCookieValue(newCookie, 'z_c0')) {
      return { status: 'confirmed', cookieStr: newCookie, userId: data.user_id };
    }
    return { status: 'scanned', cookieStr: newCookie };
  }
  if (data.status === -1 || data.expired) {
    return { status: 'expired', cookieStr: newCookie };
  }
  return { status: 'waiting', cookieStr: newCookie };
}

// ─── 图片上传 ────────────────────────────────────

/**
 * 上传一张图片（base64 data URL）到知乎图床
 * 两步流程（与 VSCode-Zhihu 相同）：
 *   1. POST https://api.zhihu.com/images 预取上传 token（body 包含 md5 hash）
 *   2a. 若返回 upload_token → 用 ali-oss SDK 上传到阿里云 OSS
 *   2b. 若无 upload_token → 图片已存在，直接用 hash 构造 CDN URL
 * @param {string} dataUrl  data:image/png;base64,...
 * @param {string} cookieStr
 * @returns {string} 知乎 CDN 图片 URL
 */
async function uploadImage(dataUrl, cookieStr) {
  const md5    = require('md5');
  const OSS    = require('ali-oss');

  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('无效的图片 dataUrl');
  const mime   = m[1];
  const buffer = Buffer.from(m[2], 'base64');
  const ext    = '.' + (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const hash   = md5(buffer);

  const xsrf = getCookieValue(cookieStr, '_xsrf');

  // Step 1: 预取上传 token
  const prefetchRes = await request({
    hostname: 'api.zhihu.com',
    path:     '/images',
    method:   'POST',
    headers:  {
      'Content-Type':     'application/json',
      Cookie:              cookieStr,
      'x-xsrftoken':      xsrf,
      'Referer':          'https://zhuanlan.zhihu.com/',
      'Origin':           'https://zhuanlan.zhihu.com',
      'x-requested-with': 'fetch',
    },
    body: JSON.stringify({ image_hash: hash, source: 'article' }),
  });

  if (prefetchRes.status === 401) throw new Error('知乎未登录，请重新登录');
  if (prefetchRes.status !== 200) {
    throw new Error(`图片预取 token 失败（HTTP ${prefetchRes.status}）：${prefetchRes.body.slice(0, 200)}`);
  }

  const prefetchData = JSON.parse(prefetchRes.body);
  const upload_file  = prefetchData.upload_file;
  const upload_token = prefetchData.upload_token;

  // Step 2a: 有 upload_token，走 OSS 上传
  if (upload_token) {
    const client = new OSS({
      bucket:          'zhihu-pics',
      endpoint:        'zhihu-pics-upload.zhimg.com',
      region:          'oss-cn-hangzhou',
      accessKeyId:     upload_token.access_id,
      accessKeySecret: upload_token.access_key,
      stsToken:        upload_token.access_token,
    });
    await client.put(upload_file.object_key, buffer);
  }
  // Step 2b: 无 upload_token，图片已存在于知乎图床，直接返回 URL

  return `https://pic4.zhimg.com/80/v2-${hash}${ext}`;
}

// ─── 发布文章 ────────────────────────────────────

/**
 * 上传 HTML 中所有 base64 图片到知乎图床，替换 src 为 CDN URL
 * @param {string} htmlContent
 * @param {string} cookieStr
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {string} 替换后的 HTML
 */
async function uploadImagesInHtml(htmlContent, cookieStr, onProgress) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(`<div id="root">${htmlContent}</div>`, { decodeEntities: false });

  const imgs = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.startsWith('data:image/')) imgs.push(el);
  });

  let done = 0;
  const errors = [];
  for (const el of imgs) {
    const src = $(el).attr('src');
    try {
      const cdnUrl = await uploadImage(src, cookieStr);
      $(el).attr('src', cdnUrl);
    } catch (err) {
      errors.push(err.message);
    }
    done++;
    if (onProgress) onProgress(done, imgs.length, errors.length);
  }

  return { html: $('#root').html() || htmlContent, total: imgs.length, failed: errors.length, errors };
}

/**
 * 将图片标签规范化为知乎可识别的格式：
 * - 去掉 <figure> 包裹，改为 <p> 包裹
 * - 去掉图片 style 属性（知乎会自行处理图片样式）
 * - 保留 figcaption 作为图片后的说明文字
 */
function normalizeImagesForZhihu(htmlContent) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(`<div id="root">${htmlContent}</div>`, { decodeEntities: false });

  $('figure').each((_, fig) => {
    const $fig = $(fig);
    const $img = $fig.find('img').first();
    const $caption = $fig.find('figcaption').first();
    if (!$img.length) return;

    // 去掉图片内联 style，只保留 src 和 alt
    $img.removeAttr('style');
    $img.attr('data-size', 'normal');
    $img.attr('data-watermark', 'original');

    const parts = [];
    parts.push(`<p>${$.html($img)}</p>`);
    if ($caption.length) {
      parts.push(`<p style="text-align:center;color:#999;font-size:14px;">${$caption.text()}</p>`);
    }
    $fig.replaceWith(parts.join(''));
  });

  // 独立 img 标签（不在 figure 里）也去掉 style
  $('p > img, div > img').each((_, el) => {
    $(el).removeAttr('style');
  });

  return $('#root').html() || htmlContent;
}

/**
 * 将代码块转为知乎原生格式：<pre lang="python">纯文本</pre>
 * 知乎只识别 lang 属性，不支持 CSS class / 内联样式 / span 高亮
 */
function normalizeCodeBlocks(htmlContent) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(`<div id="root">${htmlContent}</div>`, { decodeEntities: false });

  $('pre').each((_, pre) => {
    const $pre  = $(pre);
    const $code = $pre.find('code').first();
    const cls   = $code.attr('class') || '';
    const text  = $code.text();

    // 提取语言。highlight.js 生成的 class 是 "hljs python" 这种形式，
    // 之前的正则先试 language-xxx（匹配不上），再退到 \b(\w+)\b —— 结果抓到了 "hljs"。
    // 知乎收到 lang="hljs" 这个不认识的语言，既不高亮、也可能不当代码块处理（换行因此全丢）。
    const lang = extractCodeLang(cls);

    const langAttr = lang ? ` lang="${lang}"` : '';
    $pre.replaceWith(`<pre${langAttr}>${escapeHtmlEntities(text)}</pre>`);
  });

  return $('#root').html() || htmlContent;
}

function escapeHtmlEntities(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 转义 HTML 属性值。
 * escapeHtmlEntities 不转引号，用在属性里遇到 `"` 会把标签截断，所以属性值单独走这个。
 */
function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 生成【发布用】的干净 HTML。
 *
 * 之前的 bug：发布路径直接把 buildZhihuCopyHtml() 的产物（给剪贴板用的、每个标签都带
 * 内联样式的完整文档，动辄几百 KB）丢给知乎接口。知乎的内容过滤器会把这些样式洗掉/洗坏，
 * 结果就是代码折叠、公式丢失、排版稀烂。
 *
 * 发布要的是**干净的语义化 HTML**，形态按知乎官方发布规范（zhihu-sync / zhihu-validate
 * 的 conversion.md）来：
 *   - 公式 → <img eeimg="1">（行内） / <img eeimg="2">（块级），alt 存原样 LaTeX
 *   - 代码 → <pre lang="python">纯文本</pre>（不能嵌 <code>）
 *   - 图片 → <p><img data-caption></p>（src 由 worker 通过知乎上传控件换成图床地址）
 *   - 表格 → <table data-draft-type="table"><tbody><tr><th>…（不留 thead）
 *   - 脚注 → <sup data-draft-type="reference">
 *   - 标题只保留 h2/h3，加粗斜体用 b/i，引用块多段用 <br> 连接
 *   - 去掉所有 style / class
 *
 * 逐条断言见 scripts/publish_lint.js，改这里请先跑它。
 */
function buildPublishHtml(bodyHtml, options = {}) {
  const { title = '', numberHeadings = true } = options;
  const cheerio = require('cheerio');
  const { dropTitleHeading, applyHeadingNumbers } = require('./headings');
  const $ = cheerio.load(`<div id="root">${bodyHtml}</div>`, { decodeEntities: false });

  // 0) 首个 h1：只有它就是文章标题时才删（否则会吃掉正文里的第一章）
  dropTitleHeading($, $('#root'), title);

  // 0.5) 去掉相对路径的 script/link（quarto 生成的 _files 库文件头，浏览器里没有这些静态资源）
  $('script, link').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('href') || '';
    if (src && !/^(https?:)?\/\//.test(src) && !/^data:/i.test(src)) $(el).remove();
  });

  const $root = $('#root');

  // 0.6) 脚注 → 知乎注释（必须在删 footnotes section 之前处理引用）
  convertFootnotesForZhihu($, $root);

  // 1) 公式 → 知乎 eeimg 图片
  //    块级用 eeimg="2"，alt 必须是**原样 LaTeX**（官方明确禁止往 alt 里塞标记）。
  //    ⚠️ 如果实测发现粘贴路径仍只认老写法（eeimg="1" + alt 结尾 \\ ），回滚就改这一段。
  $('[data-math]').each((_, el) => {
    const $el = $(el);
    const latex = $el.attr('data-math') || '';
    const isDisplay = $el.attr('data-display') === 'true';
    const src = `//www.zhihu.com/equation?tex=${encodeURIComponent(latex)}`;
    const alt = escapeAttr(latex);
    $el.replaceWith(isDisplay
      ? `<p><img eeimg="2" src="${src}" alt="${alt}"></p>`
      : `<img eeimg="1" src="${src}" alt="${alt}">`);
  });

  // 2) 代码块 → <pre lang="python">
  //     mermaid 图表块跳过：保留 <pre class="mermaid"> 或 <pre><code class="language-mermaid">，
  //     交给 worker 里的 renderDiagrams 渲染成图片
  $('pre').each((_, pre) => {
    const $pre = $(pre);
    if ($pre.hasClass('mermaid') || $pre.hasClass('mermaid-js')) return;
    const $code = $pre.find('code').first();
    if (($code.attr('class') || '').includes('language-mermaid')) return;
    const lang = extractCodeLang($code.attr('class') || '');
    const text = ($code.length ? $code.text() : $pre.text()).replace(/\n+$/, '');
    $pre.replaceWith(`<pre${lang ? ` lang="${lang}"` : ''}>${escapeHtmlEntities(text)}</pre>`);
  });

  // 3) figure → <p><img></p>
  //    图片说明（figcaption）**不再**生成正文段落，而是挂到 img 的 data-caption 上随图走：
  //    正文里的图片由 worker 通过知乎自己的上传控件插入，说明则由 data-caption 回填到
  //    知乎的图片标题字段（图片块下面的 figcaption.Image-caption）。
  //    老写法把说明生成 <p> 段落，结果是说明变成正文里的一段普通文字，图片标题永远为空。
  //    mermaid 图表块的 figure 保留：解开外层（其内部 pre.mermaid 交给 worker 渲染成图）
  $('figure').each((_, fig) => {
    const $fig = $(fig);
    const $img = $fig.find('img').first();
    const $cap = $fig.find('figcaption').first();
    if ($fig.find('pre.mermaid, pre.mermaid-js, code.language-mermaid').length) {
      $fig.replaceWith($fig.html());
      return;
    }
    if (!$img.length) { $fig.remove(); return; }
    const alt = $img.attr('alt') || '';
    const caption = $cap.length ? $cap.text().trim() : '';
    const captionAttr = caption ? ` data-caption="${escapeAttr(caption)}"` : '';
    $fig.replaceWith(`<p><img src="${$img.attr('src')}" alt="${escapeAttr(alt)}"${captionAttr}></p>`);
  });

  // 3.1) 表格 → 知乎原生表格（只留 tbody、首行用 th、单元格纯文本）
  normalizeTablesForZhihu($, $root);

  // 3.2) 标题：编号 + 层级归一（知乎只有 h2 / h3）
  applyHeadingNumbers($, $root, { keepTags: false, enabled: numberHeadings });

  // 3.3) 加粗 / 斜体：官方白名单是 b / i，不是 strong / em
  $root.find('strong').toArray().forEach((el) => {
    const $el = $(el);
    $el.replaceWith(`<b>${$el.html() || ''}</b>`);
  });
  $root.find('em').toArray().forEach((el) => {
    const $el = $(el);
    $el.replaceWith(`<i>${$el.html() || ''}</i>`);
  });

  // 3.4) 引用块：官方只允许 <blockquote>文本<br>文本</blockquote>，不能嵌 <p>
  flattenBlockquotesForZhihu($, $root);

  // 3.5) 空段落统一成 <p><br></p>（知乎用它表示空行）
  $root.find('p').each((_, el) => {
    const $p = $(el);
    if ($p.find('br, img').length) return;
    if (($p.text() || '').trim()) return;
    $p.html('<br>');
  });

  // 4) 洗掉所有样式/类（知乎不认，留着只会干扰它的解析）
  //    注意：只洗 root 的后代，别把 root 自己的 id 也剥了（否则下面取不到内容）
  //    grViz widget 与其 data-for script、mermaid 图表块需要保留类/id 供 worker 识别
  $root.find('*').each((_, el) => {
    const $el = $(el);
    if ($el.is('div.grViz')) return;
    if ($el.is('script') && $el.attr('data-for')) return;
    if ($el.is('pre.mermaid, pre.mermaid-js, pre code.language-mermaid, code.language-mermaid')) return;
    $el.removeAttr('style').removeAttr('class').removeAttr('id');
  });

  return $root.html() || '';
}

/**
 * 脚注：把 quarto / pandoc 生成的脚注结构转成知乎注释。
 *
 *   <a href="#fn1" class="footnote-ref"><sup>1</sup></a>
 *     → <sup data-text="…" data-url="" data-draft-node="inline"
 *            data-draft-type="reference" data-numero="1">[1]</sup>
 *
 * data-numero 按文中**不同**注释首次出现顺序从 1 递增，同一注释多处引用共用一个序号；
 * 落底的 <section class="footnotes"> 整段删掉（内容已经搬进 sup 的 data-text）。
 */
function convertFootnotesForZhihu($, $root) {
  const $refs = $root.find('a.footnote-ref');
  if (!$refs.length) return;

  const $section = $root.find('section.footnotes, section#footnotes').first();
  const notes = new Map();
  if ($section.length) {
    $section.find('li[id]').each((_, li) => {
      const $li = $(li);
      $li.find('a.footnote-back, a[role="doc-backlink"]').remove();
      notes.set($li.attr('id'), $li.text().replace(/\s+/g, ' ').trim());
    });
  }

  const numero = new Map();
  $refs.toArray().forEach((a) => {
    const $a = $(a);
    const target = ($a.attr('href') || '').replace(/^#/, '');
    if (!target) return;
    if (!numero.has(target)) numero.set(target, numero.size + 1);
    const n = numero.get(target);
    const text = notes.get(target) || $a.text().trim();
    $a.replaceWith(
      `<sup data-text="${escapeAttr(text)}" data-url="" data-draft-node="inline" ` +
      `data-draft-type="reference" data-numero="${n}">[${n}]</sup>`
    );
  });

  if ($section.length) $section.remove();
}

/**
 * 表格：知乎只认下面这套结构，认得出来它才会渲染成原生表格。
 *   <table data-draft-node="block" data-draft-type="table" data-size="normal"
 *          data-row-style="normal"><tbody><tr><th>…</th></tr></tbody></table>
 * 不留 <thead>；表头是首行的 th；单元格内只允许纯文本 + <br>。
 */
function normalizeTablesForZhihu($, $root) {
  $root.find('table').toArray().forEach((table) => {
    const $t = $(table);
    const rows = [];
    $t.find('tr').each((_, tr) => {
      const cells = [];
      $(tr).children('th, td').each((_, cell) => cells.push(cellTextForZhihu($, $(cell))));
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) { $t.remove(); return; }

    const body = rows.map((cells, rowIdx) => {
      const tag = rowIdx === 0 ? 'th' : 'td';
      return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
    }).join('');

    $t.empty().append(`<tbody>${body}</tbody>`);
    $t.attr('data-draft-node', 'block');
    $t.attr('data-draft-type', 'table');
    $t.attr('data-size', 'normal');
    $t.attr('data-row-style', 'normal');
  });
}

/** 表格单元格 → 纯文本；内部换行用 <br> 保留 */
function cellTextForZhihu($, $cell) {
  const BR = '\u0000';
  const walk = (node) => {
    if (node.type === 'text') return node.data;
    if (node.name === 'br') return BR;
    // 公式/图片在单元格里放不下（知乎表格只收纯文本），但**不能整段吞掉**：
    // 退化成 alt 里的 LaTeX 原文，至少信息还在。
    if (node.name === 'img') return $(node).attr('alt') || '';
    return $(node).contents().toArray().map(walk).join('');
  };
  const out = $cell.contents().toArray().map(walk).join('');
  const flat = out.replace(/\s+/g, ' ').trim();
  return escapeHtmlEntities(flat).replace(new RegExp(BR, 'g'), '<br>');
}

/** 引用块：内部的多个 <p> 用 <br> 连接，不再嵌段落 */
function flattenBlockquotesForZhihu($, $root) {
  $root.find('blockquote').toArray().forEach((el) => {
    const $bq = $(el);
    if (!$bq.children('p').length) return;
    const parts = [];
    $bq.contents().each((_, node) => {
      if (node.name === 'p') parts.push($(node).html() || '');
      else if (node.type === 'text') { const t = (node.data || '').trim(); if (t) parts.push(t); }
      else parts.push($.html(node));
    });
    $bq.html(parts.join('<br>'));
  });
}

// ─── 发布前长度预检 ───────────────────────────────
// 知乎文章：标题 ≤ 100 字，正文纯文本 9 ~ 100000 字。
// 超限时**报错让用户改**，不静默截断（老代码 slice(0,100) 会把标题尾巴吃掉还不说）。

const ARTICLE_TITLE_MAX = 100;
const ARTICLE_BODY_MIN = 9;
const ARTICLE_BODY_MAX = 100000;

/** 取 HTML 的纯文本（按知乎口径算正文字数：不含标签） */
function plainTextOf(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(`<div id="root">${html || ''}</div>`, { decodeEntities: false });
  return ($('#root').text() || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ title: string, html: string }} input
 * @returns {{ ok: boolean, problems: string[], titleLength: number, bodyLength: number }}
 */
function checkPublishLimits({ title, html }) {
  const problems = [];
  const t = String(title || '').trim();
  const titleLength = [...t].length;
  if (!titleLength) problems.push('文章标题不能为空');
  else if (titleLength > ARTICLE_TITLE_MAX) {
    problems.push(`标题 ${titleLength} 字，超过知乎上限 ${ARTICLE_TITLE_MAX} 字，请精简后重发`);
  }

  const bodyLength = plainTextOf(html).length;
  if (bodyLength < ARTICLE_BODY_MIN) {
    problems.push(`正文只有 ${bodyLength} 字，少于知乎下限 ${ARTICLE_BODY_MIN} 字`);
  } else if (bodyLength > ARTICLE_BODY_MAX) {
    problems.push(`正文 ${bodyLength} 字，超过知乎上限 ${ARTICLE_BODY_MAX} 字，请拆成多篇`);
  }

  return { ok: problems.length === 0, problems, titleLength, bodyLength };
}

/** 知乎代码块支持的语言（用它们的官方标识；不在表里的一律降级为 text） */
const ZHIHU_LANGS = new Set([
  'text', 'ada', 'bash', 'shell', 'c', 'cpp', 'csharp', 'css', 'go', 'haskell', 'html', 'java',
  'javascript', 'json', 'julia', 'kotlin', 'lua', 'makefile', 'markdown', 'matlab', 'nginx',
  'objectivec', 'perl', 'php', 'python', 'ruby', 'rust', 'scala', 'sql', 'swift',
  'typescript', 'verilog', 'vim', 'xml', 'yaml', 'dockerfile', 'diff', 'ini', 'toml',
]);

/** 常见别名 → 知乎标识 */
// ⚠️ `r: 'ada'` 是**刻意的**，不是笔误：知乎代码块语言表里没有 R，落到 `text` 就连
//    代码块样式都没了；借 ada 的高亮模式至少保住等宽块。别当 bug「修」回去。
const LANG_ALIAS = {
  js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', zsh: 'bash',
  'c++': 'cpp', 'c#': 'csharp', yml: 'yaml', md: 'markdown', golang: 'go',
  jsx: 'javascript', tsx: 'typescript', plaintext: 'text', txt: 'text', r: 'ada', R: 'ada',
};

/**
 * 从 code 的 class 里提取语言。
 * class 可能是 "hljs python" / "language-python" / "hljs language-py"。
 * 必须排除 "hljs" 这类非语言 token。
 */
function extractCodeLang(cls) {
  const tokens = String(cls || '').split(/\s+/).filter(Boolean);
  let raw = '';
  for (const t of tokens) {
    const m = t.match(/^language-(.+)$/);
    if (m) { raw = m[1]; break; }
  }
  if (!raw) {
    // 退而求其次：取第一个不是 hljs / mac-code 之类的 token
    raw = tokens.find(t => !['hljs', 'mac-code', 'code', 'highlight'].includes(t.toLowerCase())) || '';
  }
  raw = raw.toLowerCase();
  raw = LANG_ALIAS[raw] || raw;
  return ZHIHU_LANGS.has(raw) ? raw : (raw ? 'text' : '');
}

/**
 * 保存草稿（不发布）：新建或更新草稿，返回知乎编辑器预览链接
 * @returns {{ articleId, editUrl }}
 */
async function saveAsDraft({ articleId, title, htmlContent, cookieStr }) {
  const xsrf = getCookieValue(cookieStr, '_xsrf');
  const commonHeaders = {
    'Content-Type':     'application/json',
    'x-xsrftoken':      xsrf,
    Cookie:              cookieStr,
    'x-requested-with': 'fetch',
    'sec-fetch-mode':   'cors',
    'sec-fetch-dest':   'empty',
  };

  let id = articleId;
  if (!id) {
    const createRes = await request({
      hostname: 'zhuanlan.zhihu.com',
      path:     '/api/articles/drafts',
      method:   'POST',
      headers:  commonHeaders,
      body:     JSON.stringify({ delta_time: 0 }),
    });
    if (createRes.status !== 200 && createRes.status !== 201) {
      let msg = `创建草稿失败（HTTP ${createRes.status}）`;
      try { msg += '：' + (JSON.parse(createRes.body).message || createRes.body.slice(0, 200)); } catch (_) {}
      throw new Error(msg);
    }
    id = JSON.parse(createRes.body).id;
    if (!id) throw new Error('创建草稿失败：未返回 article id');
  }

  const patchRes = await request({
    hostname: 'zhuanlan.zhihu.com',
    path:     `/api/articles/${id}/draft`,
    method:   'PATCH',
    headers:  commonHeaders,
    body:     JSON.stringify({ title, content: htmlContent, delta_time: 0 }),
  });
  if (patchRes.status !== 200) {
    let msg = `保存草稿失败（HTTP ${patchRes.status}）`;
    try { msg += '：' + (JSON.parse(patchRes.body).message || patchRes.body.slice(0, 200)); } catch (_) {}
    throw new Error(msg);
  }

  // 草稿箱地址（编辑器 /write 会过滤 HTML，草稿箱直接渲染原始内容）
  return { articleId: id, editUrl: `https://zhuanlan.zhihu.com/drafts` };
}

/**
 * 新建文章：创建草稿 → 更新内容 → 发布
 * @returns {{ articleId, url }}
 */
async function createAndPublishArticle({ title, htmlContent, cookieStr }) {
  const xsrf = getCookieValue(cookieStr, '_xsrf');

  const commonHeaders = {
    'Content-Type':       'application/json',
    'x-xsrftoken':        xsrf,
    Cookie:                cookieStr,
    'x-requested-with':   'fetch',
    'sec-fetch-mode':     'cors',
    'sec-fetch-dest':     'empty',
  };

  const createRes = await request({
    hostname: 'zhuanlan.zhihu.com',
    path:     '/api/articles/drafts',
    method:   'POST',
    headers:  commonHeaders,
    body:     JSON.stringify({ delta_time: 0 }),
  });

  if (createRes.status !== 200 && createRes.status !== 201) {
    let msg = `创建草稿失败（HTTP ${createRes.status}）`;
    try { msg += '：' + (JSON.parse(createRes.body).message || createRes.body.slice(0, 200)); } catch (_) {}
    throw new Error(msg);
  }

  const draft     = JSON.parse(createRes.body);
  const articleId = draft.id;
  if (!articleId) throw new Error('创建草稿失败：未返回 article id');

  await _patchAndPublish({ articleId, title, htmlContent, commonHeaders, cookieStr });
  return { articleId, url: `https://zhuanlan.zhihu.com/p/${articleId}` };
}

/**
 * 更新已有文章：更新草稿内容 → 重新发布
 * @returns {{ articleId, url }}
 */
async function updateAndPublishArticle({ articleId, title, htmlContent, cookieStr }) {
  const xsrf = getCookieValue(cookieStr, '_xsrf');
  const commonHeaders = {
    'Content-Type':       'application/json',
    'x-xsrftoken':        xsrf,
    Cookie:                cookieStr,
    'x-requested-with':   'fetch',
    'sec-fetch-mode':     'cors',
    'sec-fetch-dest':     'empty',
  };
  await _patchAndPublish({ articleId, title, htmlContent, commonHeaders, cookieStr });
  return { articleId, url: `https://zhuanlan.zhihu.com/p/${articleId}` };
}

async function _patchAndPublish({ articleId, title, htmlContent, commonHeaders }) {
  const patchRes = await request({
    hostname: 'zhuanlan.zhihu.com',
    path:     `/api/articles/${articleId}/draft`,
    method:   'PATCH',
    headers:  commonHeaders,
    body:     JSON.stringify({ title, content: htmlContent, delta_time: 0 }),
  });
  if (patchRes.status !== 200) {
    let msg = `更新草稿失败（HTTP ${patchRes.status}）`;
    try { msg += '：' + (JSON.parse(patchRes.body).message || patchRes.body.slice(0, 200)); } catch (_) {}
    throw new Error(msg);
  }

  const publishRes = await request({
    hostname: 'zhuanlan.zhihu.com',
    path:     `/api/articles/${articleId}/publish`,
    method:   'PUT',
    headers:  commonHeaders,
    body:     JSON.stringify({ disclaimer_type: 'none', disclaimer_status: 'close' }),
  });
  if (publishRes.status !== 200) {
    let msg = `发布失败（HTTP ${publishRes.status}）`;
    try { msg += '：' + (JSON.parse(publishRes.body).message || publishRes.body.slice(0, 200)); } catch (_) {}
    throw new Error(msg);
  }
}

// 保留旧名兼容（内部调用）
async function publishArticle({ title, htmlContent, cookieStr }) {
  return createAndPublishArticle({ title, htmlContent, cookieStr });
}

module.exports = {
  STORAGE_KEY,
  buildPublishHtml,
  checkPublishLimits,
  plainTextOf,
  extractCodeLang,
  isLoggedIn,
  verifyLogin,
  fetchUdid,
  createQrSession,
  pollQrStatus,
  uploadImage,
  uploadImagesInHtml,
  normalizeCodeBlocks,
  normalizeImagesForZhihu,
  saveAsDraft,
  createAndPublishArticle,
  updateAndPublishArticle,
  publishArticle,
  mergeCookies,
};
