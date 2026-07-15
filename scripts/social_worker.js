#!/usr/bin/env node
'use strict';
/**
 * social_worker.js — 用 Playwright 真浏览器 + 注入 cookie 发布到 小红书 / Twitter(X)
 *
 * 安全定位：走真实浏览器 UI（模拟真人操作），比伪造签名的 HTTP 方案更不易触发风控。
 *
 * 子命令：
 *   login   <platform> <cookieOutFile>   启动可见浏览器让用户登录，抓到有效 cookie 后写文件退出
 *   publish <platform> <jobFile>         读取 job（cookie + 文案 + 图片），注入后自动填内容、传图、发布
 *
 * stdout 协议（每行一个）:
 *   INFO:<message>       进度
 *   NEED_INSTALL         未找到 Chromium
 *   COOKIES_SAVED        登录成功、cookie 已写出
 *   READY_TO_PUBLISH     已填好内容，停在发布前（mode=prepare）
 *   PUBLISHED:<url>      已自动发布完成（mode=auto）
 *   DIAG:<path>          失败现场截图/HTML 存放目录（便于定位选择器）
 *   ERROR:<message>      失败
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const argv = process.argv.slice(2);
const cmd      = argv[0];
const platform = argv[1];

function out(line) { process.stdout.write(line + '\n'); }
function info(m)   { out('INFO:' + m); }
function fail(m)   { out('ERROR:' + m); process.exit(1); }
/** 结构化进度：PROGRESS:<done>/<total>:<label> */
function step(done, total, label) { out(`PROGRESS:${done}/${total}:${label}`); }

// ─── 查找 Chromium ──────────────────────────────────────────────────────────
function findChromium() {
  const home = os.homedir();
  const cacheDir = path.join(home, '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir).filter(e => e.startsWith('chromium'))) {
      const cands = {
        darwin: path.join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        linux:  path.join(cacheDir, entry, 'chrome-linux', 'chrome'),
        win32:  path.join(cacheDir, entry, 'chrome-win', 'chrome.exe'),
      };
      const p = cands[process.platform];
      if (p && fs.existsSync(p)) return p;
    }
  }
  const system = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux:  ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'],
    win32:  ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  };
  for (const p of (system[process.platform] || [])) if (fs.existsSync(p)) return p;
  return null;
}

// ─── 平台定义 ───────────────────────────────────────────────────────────────
// 关键修复：小红书创作平台签发的是 creator 专属 cookie，不叫 web_session。
// 因此登录判定改成「候选 cookie 命中任意一个」+「已离开登录页」。
const PLATFORMS = {
  xiaohongshu: {
    name: '小红书',
    loginUrl:   'https://creator.xiaohongshu.com/login',
    // target=image 直接进「上传图文」，省掉点 tab 这一步（更稳）
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image',
    authCookies: [
      'access-token-creator.xiaohongshu.com',
      'galaxy_creator_session_id',
      'galaxy.creator.beaker.session.id',
      'customer-sso-sid',
      'customerClientId',
      'web_session',
    ],
    loginUrlPattern: /login/i,
  },
  twitter: {
    name: 'Twitter',
    loginUrl:   'https://x.com/login',
    publishUrl: 'https://x.com/compose/post',
    authCookies: ['auth_token'],
    loginUrlPattern: /\/(login|i\/flow\/login)/i,
  },
  zhihu: {
    name: '知乎',
    loginUrl:   'https://www.zhihu.com/signin',
    publishUrl: 'https://zhuanlan.zhihu.com/write',
    authCookies: ['z_c0'],
    loginUrlPattern: /\/signin|\/login/i,
  },
};

/** 每个平台一个固定调试端口，resume 时用 connectOverCDP 重连这个还开着的浏览器 */
const CDP_PORT = { xiaohongshu: 9223, twitter: 9224, zhihu: 9225 };
function cdpEndpoint() { return `http://127.0.0.1:${CDP_PORT[platform] || 9225}`; }

/**
 * 拿一个浏览器：**优先复用已经开着的那个**（同一个调试端口），没有才新开。
 * 这样反复登录/发布/续传都只会有一个窗口，不会开出一堆 Chrome。
 */
/** 当前浏览器引用：收到 SIGTERM（面板点「关闭浏览器」或重新发布）时干净地关掉，避免残留窗口 */
let _browser = null;
let _ownsBrowser = false;
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, async () => {
    try { if (_browser && _ownsBrowser) await _browser.close(); } catch (_) {}
    process.exit(0);
  });
}

async function getBrowser(headless) {
  const { chromium } = require('playwright-core');

  // ① 先试着连上已经开着的窗口
  try {
    const browser = await chromium.connectOverCDP(cdpEndpoint(), { timeout: 2500 });
    const context = browser.contexts()[0];
    if (context) {
      info('复用已打开的浏览器窗口');
      _browser = browser; _ownsBrowser = false;   // 连过去的，不归我们关
      return { browser, context, reused: true };
    }
    await browser.close().catch(() => {});
  } catch (_) { /* 没开着，往下新开 */ }

  // ② 新开一个
  const executablePath = findChromium();
  if (!executablePath) { out('NEED_INSTALL'); process.exit(2); }
  const browser = await chromium.launch({
    executablePath,
    headless: !!headless,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
      `--remote-debugging-port=${CDP_PORT[platform] || 9225}`,   // 开调试端口，供复用/续传
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  // 知乎发布要往剪贴板写 HTML 再粘进编辑器，需要剪贴板权限
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  _browser = browser; _ownsBrowser = true;   // 我们开的，退出时负责关掉
  return { browser, context, reused: false };
}

/** 复用 context 里已有的标签页，没有才新开 —— 避免开出一堆 tab */
async function getPage(context) {
  const pages = context.pages();
  return pages.length ? pages[pages.length - 1] : await context.newPage();
}

/** 失败现场存证：截图 + HTML，便于定位选择器 */
async function dumpDiag(page, tag) {
  try {
    const dir = path.join(os.tmpdir(), `m2a_diag_${platform}_${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${tag}.png`), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(dir, `${tag}.html`), await page.content().catch(() => ''), 'utf8');
    fs.writeFileSync(path.join(dir, 'url.txt'), page.url(), 'utf8');
    out('DIAG:' + dir);
  } catch (_) {}
}

// ─── login ──────────────────────────────────────────────────────────────────
async function doLogin(cookieOutFile) {
  const def = PLATFORMS[platform];
  if (!def) fail('未知平台：' + platform);

  const { browser, context } = await getBrowser(false);
  try {
    const page = await getPage(context);
    await page.goto(def.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    info(`已打开 ${def.name} 登录页，请在浏览器里完成登录（扫码 / 验证码 / 密码均可）…`);

    const deadline = Date.now() + 5 * 60 * 1000;
    let lastSeen = '';
    while (Date.now() < deadline) {
      if (page.isClosed()) { fail('登录窗口被关闭'); return; }

      const cookies = await context.cookies().catch(() => []);
      const hits = cookies.filter(c => def.authCookies.includes(c.name) && c.value && c.value.length > 5);
      let url = '';
      try { url = page.url(); } catch (_) {}
      const leftLogin = url && !def.loginUrlPattern.test(url);

      // 调试可见性：cookie 一有变化就播报，方便定位
      const seen = hits.map(c => c.name).join(',');
      if (seen && seen !== lastSeen) { info('检测到登录 cookie：' + seen); lastSeen = seen; }

      // 登录成功判定：拿到任一候选 cookie，且已经离开登录页
      if (hits.length && leftLogin) {
        await page.waitForTimeout(2500);          // 等其余 cookie 落全
        const all = await context.cookies();
        fs.writeFileSync(cookieOutFile, JSON.stringify(all), 'utf8');
        info(`登录成功，已保存 ${all.length} 条 cookie`);
        out('COOKIES_SAVED');
        return;
      }
      await page.waitForTimeout(1500);
    }
    await dumpDiag(page, 'login_timeout');
    fail('登录超时（5 分钟内未检测到登录态）');
  } finally {
    // 只关我们自己开的窗口；复用来的（用户正在用的发布窗口）不能关
    if (_ownsBrowser) await browser.close().catch(() => {});
  }
}

// ─── publish ────────────────────────────────────────────────────────────────
async function doPublish(jobFile, resume) {
  const def = PLATFORMS[platform];
  if (!def) fail('未知平台：' + platform);

  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const {
    cookies, title = '', body = '', tags = [], tweets = null,
    images = [], link = '', mode = 'auto', headless = false,
    autoNumber = true, linkPos = 'all', oneImagePerTweet = true, wsEndpoint = '',
  } = job;

  // 复用已开着的窗口（登录时开的那个也会被复用），没有才新开
  const { browser, context, reused } = await getBrowser(headless);
  // 无论新开还是复用，都注入一次存好的 cookie，保证用的是当前登录态
  await context.addCookies(normalizeCookies(cookies, def)).catch(() => {});
  if (resume && reused) info('已重连到原窗口，从断点继续…');

  let leaveOpen = false;
  let page;
  try {
    page = await getPage(context);

    if (platform === 'twitter') {
      // 单条也走串推逻辑（N=1 时不加编号）
      const list = (tweets && tweets.length) ? tweets : [{ body, tags }];
      await publishTwitter(page, def, { tweets: list, link, images, mode, autoNumber, linkPos, oneImagePerTweet });
    } else if (platform === 'xiaohongshu') {
      await publishXiaohongshu(page, def, { title, body, tags, images, mode });
    } else if (platform === 'zhihu') {
      await publishZhihu(page, def, { title, html: job.html || '', images, mode });
    }

    // 一律不自动关窗。默认 prepare 模式下也【不替用户点发布】——
    // 自动点发布在小红书上会撞到二次确认弹窗，反而导致"看着发了其实没发"。
    leaveOpen = true;
    if (mode === 'auto') {
      out('PUBLISHED:');
      info('✅ 已提交发布。浏览器保持打开，请自行确认结果后关闭窗口。');
    } else {
      out('READY_TO_PUBLISH');
      info('✅ 内容和图片都已填好。请到浏览器里核对，然后【自己点页面上的「发布」按钮】。');
    }
    await new Promise(() => {});   // 挂住进程，保持浏览器打开
  } catch (e) {
    if (page) await dumpDiag(page, 'publish_error');
    // 出错保留浏览器，用户可手动接管
    leaveOpen = !headless;
    out('ERROR:' + e.message + (leaveOpen ? '（浏览器已保留，可手动完成）' : ''));
    if (leaveOpen) { await new Promise(() => {}); }
    else process.exit(1);
  } finally {
    // 只关我们自己开的；连过去复用的窗口不能关（那是用户的窗口）
    if (!leaveOpen && !reused) await browser.close().catch(() => {});
  }
}

function normalizeCookies(cookies, def) {
  return (cookies || []).map(c => ({
    name: c.name, value: c.value,
    domain: c.domain, path: c.path || '/',
    expires: typeof c.expires === 'number' ? c.expires : -1,
    httpOnly: !!c.httpOnly, secure: c.secure !== false, sameSite: c.sameSite || 'Lax',
  })).filter(c => c.name && c.value && c.domain);
}

// ─── Twitter：自动填文 + 传图 + 发送 ────────────────────────────────────────
/**
 * Twitter：支持串推（thread）。
 * 做法：在同一个撰写弹窗里用「+」逐条加，最后一次性 Post all —— 比发完再逐条回复可靠得多。
 * 配图挂在第 1 条（此时只有一个 fileInput，不会选错）；链接挂在最后一条。
 */
/**
 * 图片分配：默认「一条一图」——第 i 条推文配第 i 张长图（正文与截图一一对应），
 * 多出来的推文（如最后的总结条）不配图；多出来的图片挂到最后一条有图的推文上（最多 4 张/条）。
 */
/**
 * 图片按【顺序切块】分给各条推文：第 i 条 = 第 [i*K, i*K+K) 张图（K = X 单条上限 4 张）。
 * 这样第 i 条带的就是文章从上到下的第 i 段，和 LLM 写这条时被告知的图片范围完全一致 → 文图对得上。
 */
const IMG_PER_TWEET = 4;
function distributeImages(images, n) {
  const per = Array.from({ length: n }, () => []);
  if (!images.length || !n) return { per, used: 0, dropped: 0 };

  let used = 0;
  for (let i = 0; i < n; i++) {
    const chunk = images.slice(i * IMG_PER_TWEET, (i + 1) * IMG_PER_TWEET);
    per[i] = chunk;
    used += chunk.length;
  }
  return { per, used, dropped: images.length - used };
}

/**
 * 给第 i 条推文传图。
 * 关键：X 不会为每条推文各渲染一个 fileInput —— 只有【当前聚焦的那条】才有一个可用的
 * （另一个是 disabled 的）。所以必须先点进第 i 条，再取那个未 disabled 的 fileInput。
 * 之前按 .nth(i) 取，i>=2 时元素根本不存在 → setInputFiles 卡 30s 超时。
 */
async function attachImagesToTweet(page, i, files) {
  const ed = page.locator(`[data-testid="tweetTextarea_${i}"]`).first();
  await ed.click();                       // 聚焦这一条，X 才会把可用的 fileInput 挂给它
  await page.waitForTimeout(400);
  const fi = page.locator('input[data-testid="fileInput"]:not([disabled])').first();
  await fi.waitFor({ state: 'attached', timeout: 20000 })
    .catch(() => { throw new Error(`第 ${i + 1} 条的图片上传控件未就绪`); });
  await fi.setInputFiles(files, { timeout: 60000 });
}

/** 等按钮真正可点再点（X 在超字数/图片上传中会禁用「+」和「发帖」） */
async function clickWhenEnabled(page, locator, label, timeoutMs = 120000) {
  await locator.waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => { throw new Error(`未找到${label}`); });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ariaDis = await locator.getAttribute('aria-disabled').catch(() => null);
    if (ariaDis !== 'true') {
      try { await locator.click({ timeout: 5000 }); return; } catch (_) { /* 重试 */ }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`${label}一直不可点击：通常是某条超出 280 字上限（中文算 2 个字符！），或图片仍在上传`);
}

async function publishTwitter(page, def, { tweets, link, images, mode, autoNumber, linkPos, oneImagePerTweet }) {
  const list = (tweets || []).filter(t => (t.body || '').trim());
  if (!list.length) throw new Error('推文内容为空');

  const N = list.length;
  const pos = linkPos || 'all';
  const texts = list.map((t, i) => {
    const num = (autoNumber !== false && N > 1) ? `${i + 1}/${N} ` : '';
    const showLink = link && (pos === 'all' || (pos === 'first' && i === 0) || (pos === 'last' && i === N - 1));
    // 关键：按 X 的加权字数（中文=2、URL=23）算，而不是 JS 的 .length
    return num + composeText(t.body, t.tags, showLink ? link : '', 280 - xLen(num), false, true);
  });

  // 发布前自检：加权字数
  texts.forEach((t, i) => {
    if (xLen(t) > 280) throw new Error(`第 ${i + 1} 条超出 X 字数上限（${xLen(t)}/280，中文按 2 个字符计），请精简`);
  });

  const { per, used, dropped } = distributeImages(images || [], N);
  const totalSteps = N + 1;   // N 条 + 最后发帖
  info(`共 ${N} 条推文，${used} 张配图按顺序均分到各条${dropped ? `，超出容量丢弃 ${dropped} 张` : ''}`);

  step(0, totalSteps, '打开撰写页');
  await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  if (def.loginUrlPattern.test(page.url())) throw new Error('Twitter cookie 已失效，请重新登录');

  await page.locator('[data-testid="tweetTextarea_0"]').first()
    .waitFor({ state: 'visible', timeout: 40000 })
    .catch(() => { throw new Error('撰写框未出现（cookie 可能已失效）'); });

  // resume：已经填好的条数（重连时从断点续填）
  const startAt = await countFilledTweets(page);
  if (startAt > 0) info(`检测到已填好 ${startAt} 条，从第 ${startAt + 1} 条继续`);

  for (let i = startAt; i < N; i++) {
    step(i, totalSteps, `写第 ${i + 1}/${N} 条`);
    if (i > 0) {
      await clickWhenEnabled(page, page.locator('[data-testid="addButton"]').first(), `串推「+」按钮（加第 ${i + 1} 条）`);
      await page.waitForTimeout(600);
    }
    const ed = page.locator(`[data-testid="tweetTextarea_${i}"]`).first();
    await ed.waitFor({ state: 'visible', timeout: 25000 })
      .catch(() => { throw new Error(`第 ${i + 1} 条的编辑框未出现`); });
    await fillEditor(page, ed, texts[i], `第 ${i + 1} 条`);

    if (per[i].length) {
      info(`第 ${i + 1} 条上传 ${per[i].length} 张图…`);
      await attachImagesToTweet(page, i, per[i]);
      await page.waitForTimeout(2000);
    }
  }
  step(N, totalSteps, '内容就绪');
  info(`串推已就绪，共 ${N} 条`);

  if (mode !== 'auto') { info('请在浏览器里核对后点「发帖」。'); return; }

  step(N, totalSteps, '发送中');
  await clickWhenEnabled(page, page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first(), '「全部发帖」按钮');
  info('已点击发帖，等待确认…');
  await page.waitForTimeout(6000);

  const still = await page.locator('[data-testid="tweetTextarea_0"]').count().catch(() => 0);
  step(totalSteps, totalSteps, still ? '需人工确认' : '已发出');
  if (still) info('提示：撰写框仍在，可能未发出，请在浏览器确认');
  else info(`串推已发出 ✅（共 ${N} 条，${used} 张图）`);
}

/** 数一下撰写弹窗里已经有内容的推文条数（用于 resume 断点续填） */
async function countFilledTweets(page) {
  let n = 0;
  for (let i = 0; i < 25; i++) {
    const loc = page.locator(`[data-testid="tweetTextarea_${i}"]`).first();
    if (!(await loc.count().catch(() => 0))) break;
    const txt = (await loc.innerText().catch(() => '')) || '';
    if (!txt.trim()) break;
    n++;
  }
  return n;
}

/** 往编辑器里填字，insertText 不生效时退回逐字输入，并校验确实进去了 */
async function fillEditor(page, locator, text, label) {
  await locator.click();
  await page.waitForTimeout(300);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(500);
  let got = (await locator.innerText().catch(() => '')) || '';
  if (!got.trim()) {
    await locator.click();
    await page.keyboard.type(text, { delay: 10 });
    await page.waitForTimeout(500);
    got = (await locator.innerText().catch(() => '')) || '';
  }
  if (!got.trim()) throw new Error(`${label} 填充失败（编辑器未接收文本）`);
  info(`已填入${label}（${got.trim().length} 字）`);
}

// ─── 小红书：自动传图 + 填文 + 发布 ─────────────────────────────────────────
async function publishXiaohongshu(page, def, { title, body, tags, images, mode }) {
  if (!images || !images.length) throw new Error('小红书发布至少需要 1 张图片，请先「一键导出全部」生成长图');

  info('打开小红书创作平台发布页（图文）…');
  await page.goto(def.publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 关键：这是个 Vue SPA，domcontentloaded 时页面还是空白的。
  // 必须「等元素真正出现」，不能死等固定秒数（之前就是等 3s 就去找，结果页面还没渲染）。
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});

  if (def.loginUrlPattern.test(page.url())) throw new Error('小红书 cookie 已失效，请重新登录');

  // 图片上传控件（排除视频框：它 accept 里是 mp4 且没有 multiple）
  const imgInputSel = 'input[type="file"]:not([accept*="mp4"])';
  let imgInput = page.locator(imgInputSel).first();

  let ready = await imgInput.waitFor({ state: 'attached', timeout: 45000 }).then(() => true).catch(() => false);

  // 兜底：万一没直接落在图文页，再去点一次「上传图文」tab
  if (!ready) {
    info('未直接进入图文页，尝试点击「上传图文」…');
    const tab = page.getByText('上传图文', { exact: true }).first();
    await tab.waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => { throw new Error('页面未渲染出「上传图文」（可能加载超时或结构已变化）'); });
    await tab.click({ timeout: 10000 });
    imgInput = page.locator(imgInputSel).first();
    ready = await imgInput.waitFor({ state: 'attached', timeout: 45000 }).then(() => true).catch(() => false);
    if (!ready) throw new Error('切到图文页后仍未出现图片上传控件');
  }
  info('已进入图文发布页');

  // 有的上传控件没有 multiple 属性，一次只能收一个文件 → 退化为逐张上传
  const multiple = await imgInput.evaluate(el => !!el.multiple).catch(() => false);
  info(`正在上传 ${images.length} 张图${multiple ? '' : '（控件不支持多选，逐张上传）'}…`);
  if (multiple) {
    await imgInput.setInputFiles(images);
  } else {
    for (const img of images) {
      await page.locator(imgInputSel).first().setInputFiles(img);
      await page.waitForTimeout(1500);
    }
  }

  // 上传完成的标志：标题输入框出现
  const titleInput = page.locator('input[placeholder*="标题"], input[placeholder*="填写标题"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 120000 })
    .catch(() => { throw new Error('图片上传后未进入编辑页（可能上传失败）'); });
  info('图片上传完成');

  // 标题（小红书限 20 字）
  await titleInput.click();
  await titleInput.fill(String(title || '').slice(0, 20));
  info('已填标题');

  // 正文 + 标签
  const bodyText = composeText(body, tags, '', 1000, true);
  const bodyBox = page.locator('div[contenteditable="true"]').first();
  await bodyBox.waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => { throw new Error('未找到正文编辑框'); });
  await bodyBox.click();
  await page.waitForTimeout(300);
  await page.keyboard.insertText(bodyText);
  await page.waitForTimeout(600);
  let filled = (await bodyBox.innerText().catch(() => '')) || '';
  if (!filled.trim()) {
    info('insertText 未生效，改用逐字输入…');
    await bodyBox.click();
    await page.keyboard.type(bodyText, { delay: 8 });
    await page.waitForTimeout(600);
    filled = (await bodyBox.innerText().catch(() => '')) || '';
  }
  if (!filled.trim()) throw new Error('正文填充失败（编辑器未接收文本）');
  info('已填正文与标签');

  if (mode !== 'auto') { info('内容已就绪，请在页面里点「发布」。'); return; }

  // 自动发布
  let pubBtn = page.getByRole('button', { name: /^\s*发布\s*$/ }).first();
  if (!await pubBtn.count().catch(() => 0)) {
    pubBtn = page.locator('button:has-text("发布"), div[class*="publish"]:has-text("发布")').first();
  }
  await pubBtn.waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => { throw new Error('未找到「发布」按钮'); });
  await pubBtn.click();
  info('已点击发布，等待平台响应…');
  await page.waitForTimeout(1500);

  // 点发布后可能弹二次确认框（用户看到"一闪而过"的多半就是它）。
  // 不确认的话笔记根本不会提交 —— 这是之前"提示成功但主页没有"的元凶之一。
  for (const label of ['确认发布', '确定发布', '确认', '确定', '继续发布']) {
    const btn = page.getByRole('button', { name: new RegExp('^\\s*' + label + '\\s*$') }).first();
    if (await btn.count().catch(() => 0) && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      info(`已确认弹窗「${label}」`);
      await page.waitForTimeout(1500);
      break;
    }
  }

  // 严格校验是否真的发出去了：只认「跳离发布页」这个强信号，
  // 不再用文案匹配（页面里藏着模板文字会误判成功）。
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (!/\/publish\/publish/i.test(url)) { ok = true; break; }   // 已离开发布页 = 提交成功
  }

  // 无论成败都留一份现场，便于复盘
  await dumpDiag(page, ok ? 'xhs_publish_ok' : 'xhs_publish_unconfirmed');

  if (ok) info('✅ 小红书发布成功（已跳离发布页）');
  else info('⚠️ 仍停在发布页，说明【没有真正提交成功】。请在浏览器里手动检查（可能有未处理的弹窗/校验失败）。窗口不会自动关闭。');
}

// ─── X 的加权字数 ───────────────────────────────────────────────────────────
/**
 * X(Twitter) 不是按 JS 的 .length 算字数：
 *   - 中日韩字符算 2
 *   - 任何 URL 无论多长固定算 23（t.co 缩短）
 *   - 其余算 1
 * 之前按 .length 判断导致中文推文实际超限 → 「+」和「发帖」被禁用 → 点击超时。
 */
function xLen(text) {
  let n = 0;
  const stripped = String(text || '').replace(/https?:\/\/\S+/g, () => { n += 23; return ''; });
  for (const ch of stripped) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x11FF) || (c >= 0x2E80 && c <= 0xA4CF) ||
      (c >= 0xA960 && c <= 0xA97F) || (c >= 0xAC00 && c <= 0xD7FF) ||
      (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE10 && c <= 0xFE19) ||
      (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) ||
      (c >= 0xFFE0 && c <= 0xFFE6) || (c >= 0x20000 && c <= 0x3FFFD);
    n += wide ? 2 : 1;
  }
  return n;
}

/** 按加权字数截断正文 */
function truncateByWeight(text, budget) {
  if (xLen(text) <= budget) return text;
  let out = '';
  for (const ch of String(text)) {
    if (xLen(out + ch) > budget - 1) break;
    out += ch;
  }
  return out + '…';
}

// ─── 知乎：用编辑器自己的通道传图 + 粘贴干净 HTML ────────────────────────────
/**
 * 知乎为什么必须走浏览器：
 *   知乎没有公开 API，且会主动改内部接口来搞挂第三方工具 —— 直接调 api.zhihu.com/images
 *   传图迟早（且已经）失效。用编辑器自己的上传通道，走的是它自家的正常流程，最稳。
 *
 * 流程：
 *   ① 打开 /write，填标题
 *   ② 把本地图片依次喂给编辑器的 file input，让【知乎自己】把图传上去，
 *      回读编辑器里生成的 <img> 的 CDN 地址（zhimg.com）
 *   ③ 清空编辑器，把 CDN 地址替换进我们那份干净 HTML
 *   ④ 通过剪贴板把 HTML 整体粘进编辑器（公式 eeimg / 代码 pre lang 都能被知乎识别）
 *   ⑤ 停在发布前，由用户自己点「发布」
 */
/**
 * 起一个临时本地图床（带 CORS），把本地图片变成真正的 http:// 地址。
 * 这样粘贴进知乎编辑器时，它会把这些图当成"从网页复制来的远程图"，
 * 自己抓取并上传到 zhimg 图床 —— 全程不用碰它那些弹窗和文件对话框。
 */
function startImageServer(images) {
  const http = require('http');
  const map = new Map();                       // /i0.png -> 本地路径
  images.forEach((p, i) => map.set(`/i${i}${path.extname(p) || '.png'}`, p));

  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

  const server = http.createServer((req, res) => {
    const key = decodeURIComponent((req.url || '').split('?')[0]);
    const file = map.get(key);
    // 关键：让知乎页面能跨域访问本机图片。
    // Chrome 的 Private Network Access 会对公网 HTTPS → localhost 发预检，
    // 需要 Access-Control-Allow-Private-Network，否则知乎编辑器抓图会失败。
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (!file || !fs.existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server, port,
        urls: images.map((p, i) => `http://127.0.0.1:${port}/i${i}${path.extname(p) || '.png'}`),
      });
    });
  });
}

function splitHtmlByImageTags(html) {
  const segments = [];
  const re = /<p>\s*<img\b[^>]*src=["']data:image[^"']*["'][^>]*>\s*<\/p>|<img\b[^>]*src=["']data:image[^"']*["'][^>]*>/gi;
  let last = 0;
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    segments.push(html.slice(last, m.index));
    last = m.index + m[0].length;
    count++;
  }
  segments.push(html.slice(last));
  return { segments, imageCount: count };
}

async function focusEditorEnd(editor) {
  await editor.evaluate(el => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

async function pasteHtmlAtEnd(page, editor, html) {
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  await editor.click();
  await focusEditorEnd(editor);
  await editor.evaluate((el, { h, p }) => {
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    dt.setData('text/plain', p);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { h: html, p: plain }).catch(() => {});
  await page.waitForTimeout(500);
}

async function uploadZhihuImageAtEnd(page, editor, file, index) {
  if (!fs.existsSync(file)) throw new Error(`图片文件不存在: ${file}`);

  await editor.click();
  await focusEditorEnd(editor);

  // 严格限定图片上传控件：accept 里必须有 image，不碰附件/视频等其他 file input。
  const BEFORE_COUNT = await editor.evaluate(el => el.querySelectorAll('img').length).catch(() => 0);

  // 点击知乎工具栏的「图片」按钮，触发图片上传控件。
  let clicked = false;
  for (const sel of [
    'button[aria-label="图片"]',
    'button[aria-label*="图片"]',
    '[aria-label="插入图片"]',
    '[aria-label*="插入图片"]',
    'div[role="button"][aria-label*="图片"]',
    'svg[aria-label*="图片"]',
    'button:has(svg):has-text("图片")',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.count().then(c => c > 0).catch(() => false)) {
      const box = await btn.boundingBox().catch(() => null);
      if (box) { await btn.click(); clicked = true; break; }
    }
  }
  if (!clicked) {
    // 备用：用键盘快捷键 Ctrl+Shift+I（知乎可能没有）或者通过菜单
    await page.keyboard.press('Control+Shift+i').catch(() => {});
  }
  await page.waitForTimeout(1200);

  // 找到图片专用的 file input。
  const fileInput = page.locator('input[type="file"]')
    .filter({ has: page.locator('[accept*="image"]') })
    .first();
  const anyFileInput = page.locator('input[type="file"][accept*="image"]').first();

  const input = (await fileInput.count().then(c => c > 0).catch(() => false)) ? fileInput : anyFileInput;
  await input.waitFor({ state: 'attached', timeout: 15000 })
    .catch(() => { throw new Error(`未找到知乎图片上传控件（第 ${index + 1} 张），请确认工具栏图片按钮已弹出文件选择框`); });

  await input.setInputFiles(file, { timeout: 60000 });
  info(`图片 ${index + 1} 文件已选择: ${path.basename(file)}`);

  // 等待并点击「插入图片」/「确定」按钮，确保图片真正插入编辑器。
  const insertButtons = [
    'button:has-text("插入图片")',
    'button:has-text("插入")',
    'button:has-text("确定")',
    '[role="button"]:has-text("插入")',
    '.css-1g9j2hv', // 常见插入按钮 class
  ];
  let inserted = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const sel of insertButtons) {
      const btn = page.locator(sel).first();
      if (await btn.count().then(c => c > 0).catch(() => false)) {
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click().catch(() => {});
          inserted = true;
          info(`图片 ${index + 1} 已点插入按钮`);
          break;
        }
      }
    }
    if (inserted) break;
    // 也检查编辑器内 img 数量是否已增加
    const now = await editor.evaluate(el => el.querySelectorAll('img').length).catch(() => BEFORE_COUNT);
    if (now > BEFORE_COUNT) { inserted = true; break; }
    await page.waitForTimeout(800);
  }

  // 兜底等待编辑器内图片出现
  if (!inserted) {
    const dl = Date.now() + 40000;
    while (Date.now() < dl) {
      const now = await editor.evaluate(el => el.querySelectorAll('img').length).catch(() => BEFORE_COUNT);
      if (now > BEFORE_COUNT) { inserted = true; break; }
      await page.waitForTimeout(1000);
    }
  }

  if (!inserted) {
    throw new Error(
      `图片 ${index + 1} (${path.basename(file)}) 未能插入编辑器。可能原因：` +
      `1) 知乎弹出了图片选择框但未自动点「插入」按钮；` +
      `2) 编辑器页面结构变化导致选择器失效。请查看浏览器窗口确认状态。`
    );
  }

  // 插入完成后按 Escape 关闭可能残留的图片上传弹窗
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  info(`图片 ${index + 1} 上传完成，弹窗已关闭`);
}

async function publishZhihu(page, def, { title, html, images, mode }) {
  const totalSteps = 4;
  step(0, totalSteps, '打开知乎写文章页');
  await page.goto(def.publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  if (def.loginUrlPattern.test(page.url())) throw new Error('知乎 cookie 已失效，请重新登录');

  // ── 标题 ──
  const titleBox = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first();
  await titleBox.waitFor({ state: 'visible', timeout: 40000 })
    .catch(() => { throw new Error('未找到标题输入框（页面结构可能已变化）'); });
  await titleBox.click();
  await titleBox.fill(String(title || '').slice(0, 100));
  info('已填标题');

  // ── 正文编辑器 ──
  const editor = page.locator('.public-DraftEditor-content, div[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => { throw new Error('未找到正文编辑器'); });

  // ── ② 按图片位置拆分 HTML ──
  // 不再依赖 localhost 图床，也不再调用失效的知乎图片 API。
  // 流程：粘贴一段正文 → 通过知乎自己的文件上传控件插入对应本地图片 → 继续下一段。
  step(1, totalSteps, '准备图片和正文片段');
  const parts = splitHtmlByImageTags(html);
  const imageFiles = images || [];
  info(`正文拆成 ${parts.segments.length} 段，HTML 图片 ${parts.imageCount} 张，本地图片 ${imageFiles.length} 张`);
  if (parts.imageCount > imageFiles.length) {
    info(`⚠️ HTML 中图片数多于本地图片数，将只自动上传前 ${imageFiles.length} 张`);
  }

  // ── ③ 分段粘贴 + 文件上传 ──
  step(2, totalSteps, '分段粘贴正文并上传图片');
  let expectedPlain = '';
  for (let i = 0; i < parts.segments.length; i++) {
    const seg = parts.segments[i];
    if (seg && seg.replace(/<[^>]+>/g, '').trim()) {
      await pasteHtmlAtEnd(page, editor, seg);
      expectedPlain += seg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      await page.waitForTimeout(600);
    }

    if (i < parts.imageCount && imageFiles[i]) {
      step(2, totalSteps, `上传图片 ${i + 1}/${Math.min(parts.imageCount, imageFiles.length)}`);
      await uploadZhihuImageAtEnd(page, editor, imageFiles[i], i);
      await page.waitForTimeout(1200);
    }
  }

  await page.waitForTimeout(1500);
  const got = (await editor.innerText().catch(() => '')) || '';
  const plain = expectedPlain.replace(/\s+/g, ' ').trim();
  if (got.trim().length < Math.min(40, plain.length * 0.25)) {
    await dumpDiag(page, 'zhihu_paste_failed');
    throw new Error(`正文没能填进编辑器（只有 ${got.trim().length} 字，预期约 ${plain.length} 字）`);
  }

  const imgCount = await editor.evaluate(el => el.querySelectorAll('img').length).catch(() => 0);
  info(`正文已填入（${got.trim().length} 字），编辑器内图片 ${imgCount} 张`);
  if (imageFiles.length && imgCount < Math.min(parts.imageCount, imageFiles.length)) {
    await dumpDiag(page, 'zhihu_image_upload_incomplete');
    info(`⚠️ 图片只插入 ${imgCount}/${Math.min(parts.imageCount, imageFiles.length)} 张，请在浏览器中核对并手动补齐`);
  }

  step(4, totalSteps, '内容就绪');
  if (mode !== 'auto') { info('✅ 标题、正文、图片都已填好。请核对后【自己点页面上的「发布」】。'); return; }

  const pub = page.getByRole('button', { name: /发布/ }).first();
  await pub.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('未找到「发布」按钮'); });
  await pub.click();
  await page.waitForTimeout(5000);
  info('已点击发布，请在浏览器确认结果');
}

// ─── 文案拼接 ───────────────────────────────────────────────────────────────
/** weighted=true 时按 X 的加权规则算字数（中文=2、URL=23） */
function composeText(body, tags, link, limit, hashInline, weighted) {
  let t = String(body || '').trim();
  const tagStr = (tags || []).map(x => '#' + String(x).replace(/^#/, '').trim()).filter(s => s.length > 1).join(' ');
  const linkPart = link ? `\n\n全文：${link}` : '';
  const len = weighted ? xLen : (s => s.length);

  let full = t + (tagStr ? `\n\n${tagStr}` : '') + linkPart;
  if (limit && len(full) > limit) {
    const reserve = (tagStr ? len(tagStr) + 2 : 0) + len(linkPart);
    const budget = Math.max(0, limit - reserve);
    t = weighted ? truncateByWeight(t, budget) : (t.slice(0, Math.max(0, budget - 1)) + '…');
    full = t + (tagStr ? `\n\n${tagStr}` : '') + linkPart;
  }
  return full;
}

// ─── 入口 ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (cmd === 'login')        await doLogin(argv[2]);
    else if (cmd === 'publish') await doPublish(argv[2], false);
    else if (cmd === 'resume')  await doPublish(argv[2], true);
    else fail('未知子命令：' + cmd);
  } catch (e) {
    fail(e.message);
  }
})();
