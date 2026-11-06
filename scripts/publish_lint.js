#!/usr/bin/env node
'use strict';

/**
 * 知乎发布 HTML 门禁
 *
 * 把 lib/zhihu.js 的 buildPublishHtml 输出按知乎官方发布规范逐条断言，
 * 防止「代码块 lang 被写成 hljs」「公式 alt 被污染」这类问题回归。
 *
 * 用法：
 *   node scripts/publish_lint.js                # 跑 fixtures/ 下全部夹具
 *   node scripts/publish_lint.js a.md b.html    # 跑指定文件
 * 退出码：0 = 全过，1 = 有断言失败。
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const converter = require('../lib/converter');
const { renderMarkdown } = converter;
const quarto = require('../lib/quarto');
const zhihu = require('../lib/zhihu');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');
const WECHAT_TEMPLATE = path.join(__dirname, '..', 'templates', 'wechat.html');

// ─────────────────────────────────────────────
//  夹具 → 发布 HTML
// ─────────────────────────────────────────────

function loadBodyHtml(file, footnoteMode = 'zhihu') {
  if (file.endsWith('.md')) return renderMarkdown(file, { footnoteMode });
  return { bodyHtml: fs.readFileSync(file, 'utf8'), title: '' };
}

function buildPublished(file) {
  const { bodyHtml, title } = loadBodyHtml(file);
  return { bodyHtml, title, published: zhihu.buildPublishHtml(bodyHtml, { title }) };
}

// 标题编号的期望值：夹具名 → [[标签, 文本], …]（按文档顺序）。
// 编号规则见 lib/zhihu.js 的 normalizeHeadingsForZhihu：
//   基准层级 = 输出里最高级别标题；基准 → h2，往下一级 → h3，更深仍 h3（编号继续往下降）。
const HEADING_EXPECTATIONS = {
  'publish-headings.md': [
    ['h2', '1 引言'],
    ['h3', '1.1 数据'],
    ['h3', '1.1.1 清洗'],
    ['h3', '1.2 模型'],
    ['h2', '2 结论'],
  ],
  'publish-headings-plain.md': [
    ['h2', '1 数据'],
    ['h3', '1.1 清洗'],
  ],
  // 手写编号：能剥的剥（1 / 1.1 / 1.2），不能剥的保持原样。
  // 最后一条是**已知取舍**：单段数字只有当它恰好等于本次编号时才剥，
  // 所以正文里「2024 年度总结」这种以数字开头的标题不会被吃掉，代价是会叠加成「2 2024 …」。
  'publish-headings-manual.md': [
    ['h2', '1 引言'],
    ['h3', '1.1 数据'],
    ['h3', '1.2 模型'],
    ['h2', '2 2024 年度总结'],
  ],
  // 跳级 + 自带步骤标签：
  //   - 层级按「相对嵌套」算，`##` 直接跳 `####` 是「下一级」而不是 1.0.1
  //   - 以 (1)/（1）/①/一、开头的标题视为作者手动编号，不自动加号、也不消耗计数
  'publish-headings-skip.md': [
    ['h2', '1 算法步骤'],
    ['h3', '(1) 级比检验'],
    ['h3', '(2) 累加生成'],
    ['h3', '1.1 小结'],
    ['h2', '2 案例'],
    ['h3', '2.1 数据'],
  ],
};

// ─────────────────────────────────────────────
//  断言集合：每条返回 null 表示通过，返回字符串表示失败原因
// ─────────────────────────────────────────────

// 复制到知乎（buildZhihuCopyHtml）走的是另一条链路，公式规则必须和发布路径一致，
// 否则「复制」和「发布」发出去的公式形态不同，用户会以为其中一个坏了。
const COPY_FORMULA_CHECKS = [
  {
    name: '复制路径：块级公式使用 eeimg="2"',
    run({ $, bodyHtml }) {
      const expected = (bodyHtml.match(/data-display="true"/g) || []).length;
      const got = $('img[eeimg="2"]').length;
      return got === expected ? null : `块级公式 ${expected} 个，复制产物里标 eeimg="2" 的 ${got} 个`;
    },
  },
  {
    name: '复制路径：公式 alt 未被 \\\\ 污染',
    run({ $ }) {
      const bad = [];
      $('img[eeimg]').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        if (/\\\\$/.test(alt)) bad.push(`alt 以 \\\\ 结尾：${alt.slice(0, 40)}`);
      });
      return bad.length ? bad.join('; ') : null;
    },
  },
];

// 微信公众号走的是另一条链路（buildWechatCopyHtml → juice 内联 CSS → 粘贴）。
// 它不能靠 CSS 计数器编号（微信会剥 <style>），所以编号同样写进标题文本；
// 但标题层级要**保留原样**（h1 就是 h1），不像知乎只有 h2/h3 两级。
const WECHAT_HEADING_EXPECTATIONS = {
  'publish-headings.md': [
    ['h1', '1 引言'],
    ['h2', '1.1 数据'],
    ['h3', '1.1.1 清洗'],
    ['h2', '1.2 模型'],
    ['h1', '2 结论'],
  ],
  // 标题和首个 h1 是同一句 → h1 视作文章标题删掉，编号从 h2 起算
  'publish-headings-plain.md': [
    ['h2', '1 数据'],
    ['h3', '1.1 清洗'],
  ],
};

const WECHAT_CHECKS = [
  {
    name: '微信：标题按原层级编号',
    applies: (bodyHtml, file) => !!WECHAT_HEADING_EXPECTATIONS[path.basename(file)],
    run({ $w, file }) {
      const expected = WECHAT_HEADING_EXPECTATIONS[path.basename(file)];
      const norm = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const got = [];
      $w('h1, h2, h3, h4, h5, h6').each((_, el) => got.push([el.name, norm($w(el).text())]));
      const fmt = list => list.map(([tag, text]) => `${tag}: ${text}`).join('\n        ');
      if (got.length !== expected.length) {
        return `标题数量不符\n      期望 ${expected.length} 个：\n        ${fmt(expected)}\n      实际 ${got.length} 个：\n        ${fmt(got)}`;
      }
      for (let i = 0; i < expected.length; i++) {
        if (got[i][0] !== expected[i][0] || got[i][1] !== expected[i][1]) {
          return `第 ${i + 1} 个标题不符：期望 ${expected[i][0]}「${expected[i][1]}」，实际 ${got[i][0]}「${got[i][1]}」`;
        }
      }
      return null;
    },
  },
  {
    name: '微信：脚注说明在正文里看得见',
    applies: (bodyHtml, file) => {
      if (!file.endsWith('.md')) return false;
      return /^\[\^[^\]]+\]:/m.test(fs.readFileSync(file, 'utf8'));
    },
    run({ $w }) {
      // 微信没有知乎那种注释气泡，data-text 里的说明对读者不存在：
      // 必须落成正文末尾可见的注释列表，正文里的上标也只是纯文本 [1]。
      const text = $w('body').text() || $w('#zhihu-body').text() || '';
      if (/第一条脚注的说明文字/.test(text) && /第二条脚注的说明文字/.test(text)) return null;
      return '脚注说明没有出现在正文可见文本里（只存在 data-text 属性中，读者看不到）';
    },
  },
  {
    name: '微信：注释列表是小字灰（不是正文样式）',
    applies: (bodyHtml, file) => {
      if (!file.endsWith('.md')) return false;
      return /^\[\^[^\]]+\]:/m.test(fs.readFileSync(file, 'utf8'));
    },
    run({ $w }) {
      // 列表已经拆成 section.list-item，所以这里查 section 上的小字灰
      const item = $w('.footnotes .list-item').first();
      if (!item.length) return '注释列表缺少 .footnotes .list-item';
      const style = (item.attr('style') || '').replace(/\s+/g, '');
      if (!/font-size:14px/.test(style)) return `.footnotes .list-item 没拿到小字号（style="${style}"）`;
      if (!/color:#888888|color:#888/.test(style)) return `.footnotes .list-item 没拿到灰色（style="${style}"）`;
      return null;
    },
  },
  {
    name: '微信：行内公式只位移一次（基线与文字对齐）',
    applies: (bodyHtml) => /class="math-inline"/.test(bodyHtml),
    run({ $w }) {
      const bad = [];
      $w('span.inline-equation').each((_, el) => {
        const $sp = $w(el);
        const wrapStyle = ($sp.attr('style') || '').replace(/\s+/g, '');
        const svgStyle = ($sp.find('svg').attr('style') || '').replace(/\s+/g, '');
        const wrapVa = /vertical-align:(-?[\d.]+)(ex|em|px)?/.exec(wrapStyle);
        const svgVa = /vertical-align:\s*(-?[\d.]+)(ex|em|px)?/.exec(svgStyle);
        if (!wrapVa) return bad.push('外层缺 vertical-align');
        // MathJax 对无深度的公式会写 `vertical-align: 0`（无单位），所以数值判 0 即可
        if (svgVa && Math.abs(Number(svgVa[1])) > 0.001) {
          bad.push(`${($sp.attr('data-formula') || '').slice(0, 10)}：外层 ${wrapVa[1]}${wrapVa[2] || ''} + SVG ${svgVa[1]}${svgVa[2] || ''}`);
        }
      });
      return bad.length ? `位移叠加了两层：${bad.join('; ')}` : null;
    },
  },
  {
    name: '微信：行内代码用 span 而不是 <code>',
    applies: (bodyHtml) => /<code>/.test(bodyHtml),
    run({ $w }) {
      // 公众号对 <code> 的处理不可控（实测会把冒号后的正文挤到下一行），
      // 统一换成带内联样式的 span，和 mdnice 的做法一致。
      // 注意：代码块最终会被 applyCodeBlocksForWechat 包成 <section><code class="hljs">，
      // 那些不算行内代码。
      const bad = [];
      $w('code').each((_, el) => {
        const $el = $w(el);
        if ($el.closest('pre, section').length) return;
        if (/hljs|language-/.test($el.attr('class') || '')) return;
        bad.push(($el.text() || '').slice(0, 12));
      });
      return bad.length ? `正文里还有 ${bad.length} 个裸 <code>：${bad.join(', ')}` : null;
    },
  },
  {
    name: '微信：列表不用 ul/li（公众号会重排列表）',
    applies: (bodyHtml) => /<(ul|ol|li)[\s>]/.test(bodyHtml),
    run({ $w }) {
      // 公众号会把贴进去的 <ul>/<li> 重排：列表项以行内标签开头时，
      // 「冒号及其后的正文」会被挤到下一行。改成 section + 悬挂缩进就没有列表结构可重排。
      const bad = [];
      $w('ul, ol, li').each((_, el) => bad.push(el.name));
      if (bad.length) return `产物里还有 ${bad.length} 个列表标签：${[...new Set(bad)].join(', ')}`;
      const items = $w('section.list-item');
      if (!items.length) return '没有找到 section.list-item（列表转换没生效）';
      const first = items.first();
      const style = (first.attr('style') || '').replace(/\s+/g, '');
      if (!/padding-left:\d+(\.\d+)?em/.test(style)) return '悬挂缩进缺 padding-left';
      // 实测：列表项里带 text-indent 时，公众号会把其中的内联公式推走（压到前一个字上）。
      // 悬挂缩进改用项目符号的负 margin-left 实现，text-indent 一律不用。
      if (/text-indent/.test(style)) return '列表项不要用 text-indent（会把公式推走压到前一个字上）';
      const markerStyle = (first.children('span').first().attr('style') || '').replace(/\s+/g, '');
      if (!/margin-left:-\d+(\.\d+)?em/.test(markerStyle)) return `项目符号缺负 margin-left（实际 ${markerStyle}）`;
      if (!/^[•·]|^\d+\./.test((first.text() || '').trim())) {
        return `列表项没有项目符号：${(first.text() || '').slice(0, 12)}`;
      }
      return null;
    },
  },
  {
    name: '微信：SVG 属性大小写正确（viewBox 不能写成 viewbox）',
    applies: (bodyHtml) => /data-math/.test(bodyHtml),
    run({ html }) {
      // cheerio 序列化会把 viewBox 转小写，浏览器解析 HTML 时又会自动纠正回来，
      // 所以**只能查裸字符串**（用 cheerio 再解析一遍会把 bug 藏起来）。
      // 公众号不纠正：没有 viewBox 就没有视口，公式按 1:1 画进小框 → 缩小、错位、挤到前一个字上。
      if (!/<svg/i.test(html)) return '产物里没有 svg（公式转换没生效）';
      if (/viewbox=/.test(html)) return 'viewBox 被写成了小写 viewbox';
      if (!/viewBox=/.test(html)) return 'svg 缺 viewBox';
      if (/preserveaspectratio=/.test(html)) return 'preserveAspectRatio 被写成了小写';
      return null;
    },
  },
  {
    name: '微信：行内代码字号随父级缩放（不能写死 px）',
    applies: (bodyHtml) => /<code>/.test(bodyHtml),
    run({ $w }) {
      // font-size: 14px 是绝对值，放进 110% 的标题里就显小（4.1 GM(1,N)：GM1N() 那个问题）。
      // 用 em 才会跟着父级字号缩放。
      const bad = [];
      $w('span.inline-code').each((_, el) => {
        const style = ($w(el).attr('style') || '').replace(/\s+/g, '');
        if (!/font-size:[^;]*em/.test(style)) bad.push(`${($w(el).text() || '').slice(0, 10)} → ${style.slice(0, 40)}`);
      });
      return bad.length ? `行内代码字号没有随父级缩放：${bad.slice(0, 3).join('; ')}` : null;
    },
  },
  {
    name: '微信：SVG 宽高用 px（公众号不认 ex）',
    applies: (bodyHtml) => /data-math/.test(bodyHtml),
    run({ html }) {
      // MathJax 给的是 width="5.883ex" / height="1.692ex"。公众号不认 ex，
      // 会把 5.883ex 当成 5.883（≈6px）→ 公式被压成一团、挤到前一个字上、原位留空白。
      const svgs = html.match(/<svg\b[^>]*>/g) || [];
      if (!svgs.length) return '产物里没有 svg';
      const exSized = svgs.filter(tag => /\b(width|height)="[\d.]+ex"/.test(tag));
      if (exSized.length) return `${exSized.length} 个 svg 的宽高还是 ex 单位：${exSized[0].slice(0, 120)}`;
      const noSize = svgs.filter(tag => !/\bwidth="\d/.test(tag) || !/\bheight="\d/.test(tag));
      if (noSize.length) return `${noSize.length} 个 svg 缺 px 宽高`;
      return null;
    },
  },
];

const CHECKS = [
  {
    name: '块级公式使用 eeimg="2"',
    applies: bodyHtml => /data-display="true"/.test(bodyHtml),
    run({ $, bodyHtml }) {
      // 判据不能用「alt 里有没有 \frac」——行内公式同样会带 \dfrac。
      // 以源 HTML 里 data-display="true" 的个数为准，两边必须相等。
      const expected = (bodyHtml.match(/data-display="true"/g) || []).length;
      const got = $('img[eeimg="2"]').length;
      return got === expected ? null : `块级公式 ${expected} 个，实际标 eeimg="2" 的 ${got} 个`;
    },
  },

  {
    name: '公式 alt 未被 \\\\ 污染',
    run({ $ }) {
      const bad = [];
      $('img[eeimg]').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        if (/\\\\$/.test(alt)) bad.push(`alt 以 \\\\ 结尾：${alt.slice(0, 40)}`);
      });
      return bad.length ? bad.join('; ') : null;
    },
  },

  {
    name: '公式 alt 与 src 的 tex 参数一致',
    run({ $ }) {
      const bad = [];
      $('img[eeimg]').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        const src = $(el).attr('src') || '';
        const m = /equation\?tex=(.*)$/.exec(src);
        if (!m) return bad.push(`src 不是知乎公式地址：${src.slice(0, 60)}`);
        let tex;
        try { tex = decodeURIComponent(m[1]); } catch (_) { tex = m[1]; }
        if (tex !== alt) bad.push(`alt「${alt.slice(0, 30)}」≠ tex「${tex.slice(0, 30)}」`);
      });
      return bad.length ? bad.join('; ') : null;
    },
  },

  {
    name: '公式 src 走 zhihu.com/equation',
    run({ $ }) {
      const bad = [];
      $('img[eeimg]').each((_, el) => {
        const src = $(el).attr('src') || '';
        if (!/^(https?:)?\/\/www\.zhihu\.com\/equation\?tex=/.test(src)) {
          bad.push(src.slice(0, 60));
        }
      });
      return bad.length ? `公式地址不对：${bad.join('; ')}` : null;
    },
  },

  {
    name: '代码块不含 <code> 子节点',
    run({ $ }) {
      const n = $('pre code').length;
      return n ? `${n} 个 <pre> 里还嵌着 <code>（知乎只认 <pre lang="">文本</pre>）` : null;
    },
  },

  {
    name: '代码块 lang 合法',
    run({ $ }) {
      const bad = [];
      $('pre').each((_, el) => {
        const lang = $(el).attr('lang');
        if (lang == null) return;
        if (lang === 'hljs' || !/^[a-zA-Z0-9+#.-]+$/.test(lang)) bad.push(`lang="${lang}"`);
      });
      return bad.length ? `非法 lang：${bad.join(', ')}` : null;
    },
  },

  {
    name: 'R 代码块走 ada（团队刻意约定，勿「修复」）',
    applies: bodyHtml => /class="hljs r"/.test(bodyHtml),
    run({ $ }) {
      const pre = $('pre[lang="ada"]');
      if (!pre.length) {
        const langs = $('pre').map((_, el) => $(el).attr('lang') || '(空)').get();
        return `R 代码块应标 lang="ada"，实际 pre 的 lang 是 ${JSON.stringify(langs.slice(0, 8))}…`;
      }
      return null;
    },
  },

  {
    name: '表格使用知乎原生标记',
    run({ $ }) {
      const bad = [];
      $('table').each((_, el) => {
        if ($(el).attr('data-draft-type') !== 'table') bad.push('缺 data-draft-type="table"');
        if ($(el).attr('data-draft-node') !== 'block') bad.push('缺 data-draft-node="block"');
      });
      return bad.length ? bad.join('; ') : null;
    },
  },

  {
    name: '表格不保留 <thead>',
    run({ $ }) {
      const n = $('table thead').length;
      return n ? `${n} 个表格还带 <thead>（官方只允许 <tbody>）` : null;
    },
  },

  {
    name: '表格首行是 <th> 表头',
    run({ $ }) {
      const bad = [];
      $('table').each((_, el) => {
        const firstRow = $(el).find('tr').first();
        if (!firstRow.length) return;
        const cells = firstRow.children();
        const th = cells.filter('th').length;
        if (!th || th !== cells.length) bad.push(`首行 ${cells.length} 格，其中 th ${th} 个`);
      });
      return bad.length ? bad.join('; ') : null;
    },
  },

  {
    name: '表格单元格不丢公式',
    applies: (bodyHtml) => {
      if (!/data-math=/.test(bodyHtml)) return false;
      const $b = cheerio.load(`<div id="root">${bodyHtml}</div>`, { decodeEntities: false });
      return $b('#root th [data-math], #root td [data-math]').length > 0;
    },
    run({ $ }) {
      // 表格单元格只允许纯文本，公式图片不能塞进去；但**也不能整段丢掉**。
      // 期望：退化成 LaTeX 原文（img 的 alt），至少信息还在。
      const cells = $('th, td').map((_, el) => $(el).text()).get().join('|');
      return /[\\^_{]/.test(cells) ? null : `表格里的公式被整段吞掉了，实际单元格文本：${cells}`;
    },
  },

  {
    name: '标题层级不超过 h3',
    run({ $ }) {
      const n = $('h4, h5, h6').length;
      return n ? `${n} 个 h4/h5/h6（官方只支持 h2 / h3）` : null;
    },
  },

  {
    name: '不输出 h1',
    run({ $ }) {
      const n = $('h1').length;
      return n ? `${n} 个 h1（知乎没有一级标题，会被当正文段落）` : null;
    },
  },

  {
    name: '标题编号与层级',
    applies: (bodyHtml, file) => !!HEADING_EXPECTATIONS[path.basename(file)],
    run({ $, file }) {
      const expected = HEADING_EXPECTATIONS[path.basename(file)];
      const got = [];
      $('h1, h2, h3, h4, h5, h6').each((_, el) => {
        got.push([el.name, $(el).text().replace(/\s+/g, ' ').trim()]);
      });
      const fmt = list => list.map(([tag, text]) => `${tag}: ${text}`).join('\n        ');
      if (got.length !== expected.length) {
        return `标题数量不符\n      期望 ${expected.length} 个：\n        ${fmt(expected)}\n      实际 ${got.length} 个：\n        ${fmt(got)}`;
      }
      for (let i = 0; i < expected.length; i++) {
        if (got[i][0] !== expected[i][0] || got[i][1] !== expected[i][1]) {
          return `第 ${i + 1} 个标题不符：期望 ${expected[i][0]}「${expected[i][1]}」，实际 ${got[i][0]}「${got[i][1]}」`;
        }
      }
      return null;
    },
  },

  {
    name: '语义标签用 b / i',
    run({ $ }) {
      const n = $('strong, em').length;
      return n ? `${n} 个 <strong>/<em> 未换成 <b>/<i>` : null;
    },
  },

  {
    name: '引用块内不嵌套段落',
    run({ $ }) {
      const n = $('blockquote p').length;
      return n ? `${n} 个 <p> 嵌在 <blockquote> 里（官方要求用 <br> 连接多段）` : null;
    },
  },

  {
    name: '不留空段落',
    run({ $ }) {
      const bad = [];
      $('p').each((_, el) => {
        const $el = $(el);
        if ($el.find('br, img').length) return;
        if (!($el.text() || '').trim()) bad.push('空 <p>');
      });
      return bad.length ? `${bad.length} 个空 <p>（应为 <p><br></p>）` : null;
    },
  },

  {
    name: '脚注转成知乎 sup reference',
    applies: (bodyHtml, file) => {
      if (file.endsWith('.md')) {
        const src = fs.readFileSync(file, 'utf8');
        if (/\[\^[^\]]+\]/.test(src)) return true;
      }
      return /footnote-ref|class="footnotes/.test(bodyHtml);
    },
    run({ $, published }) {
      const sup = $('sup[data-draft-type="reference"]');
      if (!sup.length) return '脚注没有转成 <sup data-draft-type="reference">';
      if ($('section.footnotes').length) return '落底的 footnotes section 没有删掉';
      if ($('a[id^="fn"]').length) return '还残留脚注锚点 <a id="fn…">';
      if (/\[\^[^\]]+\]/.test(published)) return '正文里还留着 Markdown 脚注语法 [^…]';
      const dirty = [];
      sup.each((_, el) => {
        const t = $(el).attr('data-text') || '';
        if (/[$*`]/.test(t)) dirty.push(t.slice(0, 30));
      });
      if (dirty.length) return `data-text 里残留 Markdown 记号（应是纯文本）：${dirty.join(' | ')}`;
      return null;
    },
  },

  {
    name: '脚注编号按首次出现重排',
    applies: (bodyHtml, file) => {
      if (file.endsWith('.md')) {
        const src = fs.readFileSync(file, 'utf8');
        return (src.match(/\[\^[^\]]+\]:/g) || []).length > 1;
      }
      return /class="footnote-ref"/.test(bodyHtml);
    },
    run({ $, file }) {
      const got = [];
      $('sup[data-draft-type="reference"]').each((_, el) => got.push(Number($(el).attr('data-numero'))));

      if (file.endsWith('.md')) {
        // 直接从 Markdown 源算期望序号序列：不同脚注按首次出现从 1 递增，重复引用复用
        const src = fs.readFileSync(file, 'utf8');
        const defs = new Set((src.match(/^\[\^([^\]\s]+)\]:/gm) || []).map(s => s.slice(2, -2)));
        const seen = new Map();
        const order = [];
        for (const m of src.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
          const id = m[1];
          if (!defs.has(id)) continue;
          if (!seen.has(id)) seen.set(id, seen.size + 1);
          order.push(seen.get(id));
        }
        return JSON.stringify(got) === JSON.stringify(order)
          ? null
          : `脚注序号应为 ${JSON.stringify(order)}，实际 ${JSON.stringify(got)}`;
      }

      // pandoc HTML 分支：只查基本约束
      const uniq = [...new Set(got)];
      if (uniq.length !== 2) return `两个不同脚注应编成 1,2，实际 ${JSON.stringify(uniq)}`;
      if (uniq.some(n => !Number.isInteger(n) || n < 1)) return `脚注序号必须是从 1 开始的整数，实际 ${JSON.stringify(got)}`;
      if (uniq[0] !== 1) return '脚注序号没有从 1 开始';
      const counts = {};
      for (const n of got) counts[n] = (counts[n] || 0) + 1;
      if (!Object.values(counts).includes(2)) return `同一脚注重复引用应复用同一序号，实际 ${JSON.stringify(got)}`;
      return null;
    },
  },

  {
    name: '不留危险标签与事件属性',
    run({ $ }) {
      const bad = [];
      $('script, iframe, object, embed, style, form').each((_, el) => bad.push(`<${el.name}>`));
      $('#root *').each((_, el) => {
        for (const k of Object.keys(el.attribs || {})) {
          if (/^on/i.test(k)) bad.push(`${el.name} 的 ${k}`);
        }
      });
      return bad.length ? `危险标签/属性：${[...new Set(bad)].join(', ')}` : null;
    },
  },
];

// ─────────────────────────────────────────────
//  Quarto 后处理门禁（与具体夹具无关，整套跑一次）
// ─────────────────────────────────────────────

const QUARTO_CHECKS = [
  {
    name: '链路：webview 脚本语法（它是扩展里的字符串，node --check 查不到）',
    run() {
      const os = require('os');
      const { execFileSync } = require('child_process');
      const src = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
      const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (!m) return '没找到 webview <script> 块';
      // 面板脚本写在扩展的模板字符串里：\` 和 \${ 要先还原成 webview 真正收到的样子
      const js = m[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
      const tmp = path.join(os.tmpdir(), `qmd2any-webview-${process.pid}.js`);
      fs.writeFileSync(tmp, js, 'utf8');
      try {
        execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
        return null;
      } catch (e) {
        const msg = ((e.stderr || '').toString() || e.message).split('\n').slice(0, 3).join(' ');
        return `webview 脚本语法错误（面板会白屏）：${msg}`;
      } finally {
        try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
      }
    },
  },
  {
    name: '摘要：硬上限 120 字，且优先在句末截断',
    run() {
      const { clampDigest, DIGEST_MAX } = require('../lib/digest');
      const pass = [
        ['短句原样', '灰色预测专治小样本，四个数据就能建模。', '灰色预测专治小样本，四个数据就能建模。'],
        ['去掉引号外壳', '“一行代码就能搞定。”', '一行代码就能搞定。'],
      ];
      for (const [label, input, want] of pass) {
        const got = clampDigest(input);
        if (got !== want) return `${label}：期望「${want}」，实际「${got}」`;
      }
      // 超长输入必须 ≤120，且不能把句子截成半截（结尾应是句末标点或正好 120）
      const long = '这句话故意写得很长，用来验证摘要不会超过上限。'.repeat(10);
      const clamped = clampDigest(long);
      if (clamped.length > DIGEST_MAX) return `超限没压住：${clamped.length} 字`;
      if (clamped.length === 0) return '压成了空串';
      if (!/[。！？；…]$/.test(clamped) && clamped.length !== DIGEST_MAX) {
        return `截断点不对（${clamped.length} 字，结尾「${clamped.slice(-6)}」）`;
      }
      return null;
    },
  },
  {
    name: '链路：已安装的扩展是不是最新源码（改完忘了装会踩坑）',
    run() {
      // 真实踩过：改完 converter/template 直接说「已进包」，其实没跑 install-ext，
      // 用户测的还是旧版，白折腾一轮。这里直接比对已安装扩展与源码的哈希。
      const os = require('os');
      const crypto = require('crypto');
      const pkg = require('../package.json');
      const roots = [
        path.join(os.homedir(), '.positron', 'extensions'),
        path.join(os.homedir(), '.vscode', 'extensions'),
      ];
      const hit = [];
      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const d of fs.readdirSync(root)) {
          if (d.includes('qmd2any')) hit.push(path.join(root, d));
        }
      }
      if (!hit.length) return null; // 没装过就跳过（纯开发机上可能没有）
      const files = ['extension.js', 'lib/converter.js', 'lib/zhihu.js', 'lib/digest.js', 'lib/headings.js', 'templates/wechat.html'];
      const bad = [];
      for (const dir of hit) {
        for (const f of files) {
          const a = path.join(__dirname, '..', f);
          const b = path.join(dir, f);
          if (!fs.existsSync(b)) { bad.push(`${path.basename(dir)}/${f} 缺失`); continue; }
          const ha = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
          const hb = crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex');
          if (ha !== hb) bad.push(`${path.basename(dir)}/${f} 与源码不一致`);
        }
      }
      return bad.length ? `${bad.join('; ')} —— 先跑 npm run install-ext 再让用户测` : null;
    },
  },
  {
    name: 'Quarto 后处理：脚注续行不被打上 "## "',
    run() {
      // pandoc 会把长脚注折成 4 空格缩进的续行；那**不是** knitr 的 chunk 输出，
      // 补上 `## ` 会把说明文字污染成「... Control ## Letters ...」
      const md = [
        '[^1]: 这条脚注故意写长一点，灰色系统理论由邓聚龙于 1982 年在国际期刊',
        '    *Systems & Control Letters* 上发表 *Control problems of grey',
        '    systems* 一文正式提出。',
        '',
        '    [1] 2',
      ].join('\n');
      const out = quarto.addChunkOutputCommentPrefix(md).split('\n');
      const dirty = out.slice(1, 3).filter(l => /##/.test(l));
      if (dirty.length) return `脚注续行被打上了 ##：${JSON.stringify(dirty[0])}`;
      if (!/^ {4}## \[1\] 2$/.test(out[4])) {
        return `普通 chunk 输出反而没补上 ##：${JSON.stringify(out[4])}`;
      }
      return null;
    },
  },
];

// ─────────────────────────────────────────────
//  主流程
// ─────────────────────────────────────────────

function lintOne(file) {
  const { bodyHtml, title, published } = buildPublished(file);
  const $ = cheerio.load(`<div id="root">${published}</div>`, { decodeEntities: false });
  const failures = [];
  const skipped = [];
  for (const check of CHECKS) {
    if (check.applies && !check.applies(bodyHtml, file)) {
      skipped.push(check.name);
      continue;
    }
    let reason;
    try {
      reason = check.run({ $, bodyHtml, published, file });
    } catch (e) {
      reason = `断言自身抛错：${e.message}`;
    }
    if (reason) failures.push({ name: check.name, reason });
  }

  // 微信侧：同一份源换一条链路（脚注落成可见列表 + juice 内联样式）再验一遍
  const wechatFiles = ['publish-headings.md', 'publish-headings-plain.md', 'publish-footnotes.md', 'publish-gfm.md', 'publish-lists.md'];
  if (wechatFiles.includes(path.basename(file))) {
    const wechatBody = file.endsWith('.md')
      ? loadBodyHtml(file, 'visible').bodyHtml
      : bodyHtml;
    const wechatHtml = converter.buildWechatCopyHtml(wechatBody, WECHAT_TEMPLATE, null, { title });
    const $w = cheerio.load(`<body>${wechatHtml}</body>`, { decodeEntities: false });
    for (const check of WECHAT_CHECKS) {
      if (check.applies && !check.applies(wechatBody, file)) continue;
      let reason;
      try {
        reason = check.run({ $w, bodyHtml: wechatBody, file, html: wechatHtml });
      } catch (e) {
        reason = `断言自身抛错：${e.message}`;
      }
      if (reason) failures.push({ name: check.name, reason });
    }
  }

  // 复制到知乎那条链路：只对含公式的夹具交叉验证公式规则
  if (/data-math/.test(bodyHtml)) {
    const copyHtml = converter.buildZhihuCopyHtml(bodyHtml, null, null);
    const $copy = cheerio.load(`<div id="root">${copyHtml}</div>`, { decodeEntities: false });
    for (const check of COPY_FORMULA_CHECKS) {
      let reason;
      try {
        reason = check.run({ $: $copy, bodyHtml });
      } catch (e) {
        reason = `断言自身抛错：${e.message}`;
      }
      if (reason) failures.push({ name: check.name, reason });
    }
  }
  return { file, published, failures, skipped };
}

function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
  let files = args;
  if (!files.length) {
    if (!fs.existsSync(FIXTURE_DIR)) {
      console.error(`找不到夹具目录：${FIXTURE_DIR}`);
      process.exit(1);
    }
    files = fs.readdirSync(FIXTURE_DIR)
      .filter(f => f.endsWith('.md') || f.endsWith('.html'))
      .map(f => path.join(FIXTURE_DIR, f));
  }
  if (!files.length) {
    console.error('没有夹具可跑');
    process.exit(1);
  }

  let total = 0;
  const ran = new Set();
  for (const file of files) {
    const { failures, published, skipped } = lintOne(file);
    const name = path.relative(process.cwd(), file);
    const checked = CHECKS.length - skipped.length;
    for (const c of CHECKS) if (!skipped.includes(c.name)) ran.add(c.name);
    if (!failures.length) {
      console.log(`PASS  ${name}  (${published.length} 字节, ${checked} 条断言)`);
      continue;
    }
    total += failures.length;
    console.log(`FAIL  ${name}  (${checked} 条断言)`);
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.reason}`);
  }

  // 覆盖兜底：断言只有在输入含对应结构时才会跑。若某条断言从没跑过，
  // 说明夹具退化了 —— 那不是「通过」，是这一条从此没人守。
  // 只在跑整套夹具时检查；手动指定单个文件（如真实稿件）时不适用。
  const uncovered = args.length ? [] : CHECKS.map(c => c.name).filter(n => !ran.has(n));
  if (uncovered.length) {
    total += uncovered.length;
    console.log('\n未被任何夹具覆盖的断言（夹具退化）：');
    for (const n of uncovered) console.log(`  ✗ ${n}`);
  }

  // 与具体夹具无关的链路检查：整套跑一次
  if (!args.length) {
    for (const check of QUARTO_CHECKS) {
      let reason;
      try {
        reason = check.run();
      } catch (e) {
        reason = `断言自身抛错：${e.message}`;
      }
      if (reason) {
        total += 1;
        console.log(`FAIL  [链路] ${check.name}\n      ${reason}`);
      } else {
        console.log(`PASS  [链路] ${check.name}`);
      }
    }
  }

  if (total) {
    console.error(`\n共 ${total} 条失败`);
    process.exit(1);
  }
  console.log(`\n全部通过（${files.length} 个夹具，${ran.size}/${CHECKS.length} 条断言被覆盖）`);
}

main();
