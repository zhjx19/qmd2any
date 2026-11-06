# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run package` | Build `.vsix` extension package |
| `npm run install-ext` | Build `.vsix` and install it locally (`scripts/install_ext.js` → `positron --install-extension --force`) |
| `npm run start:electron` | Launch Electron desktop app in dev mode（需先 `npm i -D electron electron-builder`） |
| `npm run build:mac` | Package macOS `.dmg` (x64)（同上，Electron 依赖按需安装） |
| `npm run build:mac:universal` | Package macOS `.dmg` (Intel + Apple Silicon)（同上） |
| `npm run publish` | Publish to VS Code Marketplace |
| F5 in VS Code | Launch extension debug host |
| `node scripts/publish_lint.js` | 发布 HTML 门禁：8 夹具 / 20 断言 + 4 条链路检查（含"已安装扩展是否最新源码"） |

> **Electron 构建依赖默认不装**（`electron` + `electron-builder` ≈ 134 MB，只服务桌面客户端）。VS Code / Positron 扩展这条线不需要它们；要打桌面端时再 `npm i -D electron electron-builder`。`vsce` 保留在 devDependencies，本地 `npm run package` / `install-ext` 随时可用。

There is no test suite in this repository.

### Release order (IMPORTANT — follow strictly)

Marketplace publish must come **LAST**. The required sequence for every release:

1. Bump `version` in package.json
2. Update README (new-version section + feature table + changelog)
3. Commit and push to master
4. Push a `v*` tag → CI builds and publishes the GitHub Release with the `.vsix`
5. Verify the GitHub Release looks right — **only then** run `npm run publish` (VS Code Marketplace)

Rationale: the marketplace listing snapshots the README at publish time; publishing early ships stale release notes that cannot be tied to a completed GitHub release.

## Architecture

This is a **dual-target** project: a VS Code extension and a standalone Electron desktop app. Both share the same core conversion library at [lib/converter.js](lib/converter.js).

### Core conversion pipeline

```
gray-matter (frontmatter parsing)
    → marked + KaTeX extension (Markdown → HTML with math rendering)
    → cheerio (DOM manipulation: image→base64, code highlighting, formula post-processing)
    → juice (CSS inlining, export mode only)
    → platform-specific HTML
```

### Module map

| File | Role |
|------|------|
| [extension.js](extension.js) | VS Code extension entry point. Registers `qmd2any.preview` and `qmd2any.convert` commands. Manages Webview panels with a message-passing architecture (`postMessage`). Spawns child Node processes for Playwright screenshot/login scripts. |
| [lib/converter.js](lib/converter.js) | **Core shared library.** Exports `renderMarkdown`, `buildWechatCopyHtml`, `buildZhihuCopyHtml`, `buildXhsCopyHtml`, `buildXhsRenderHtml`, `convertMarkdownToWeChat`. Handles KaTeX font base64 inlining, `&nbsp;`/`<br>` preservation through juice, and platform-specific HTML normalization. |
| [lib/themes.js](lib/themes.js) | Exports `THEMES` array, `DEFAULT_THEME_ID`, `getTheme()`. 6 built-in themes (wechat/claude/macos/zhihu/monochrome/notion), each with a CSS string and `wrapperBg` color. |
| [lib/zhihu.js](lib/zhihu.js) | 知乎发布 HTML 生成 + 长度预检（`buildPublishHtml` / `checkPublishLimits`），以及历史遗留的 HTTP API 封装（登录验证、图片上传、草稿/发布接口）——后者已不在主链路上，`uploadImage` 依赖的 `ali-oss` 也早已从依赖里移除，别当它能用。浏览器发布主链路见 `social.js` + `social_worker.js`。 |
| [lib/headings.js](lib/headings.js) | 标题归一与自动编号（知乎 / 微信共用）：`dropTitleHeading()` 删掉与文章标题重复的 h1，`applyHeadingNumbers()` 按**相对嵌套**编号（`1` / `1.1` / `1.1.1`）。两家都不认 CSS 计数器，编号只能写进标题文本；知乎压成 h2/h3，微信用 `keepTags` 保留原层级。 |
| [lib/digest.js](lib/digest.js) | 公众号摘要生成（DeepSeek）：`generateDigest()` 拼提示词 → 调 `/chat/completions` → 超 120 字请模型压一次 → 仍超则 `clampDigest()` 本地截断，保证返回值硬不超 120。`digestCacheKey()` 供 extension 侧按「标题+正文」哈希缓存。设置项 `qmd2any.deepseek.*` 由面板里的「▾ → AI 设置…」弹窗写入（写用户级配置，Key 不回传给 webview，只回显首尾几位）。 |
| [lib/social.js](lib/social.js) | Playwright browser automation scheduler (host side). Cookie management via VS Code `globalState` (never touches disk). Spawns `social_worker.js` as a child process, parses its stdout protocol. Exports `login`, `publish`, `resume`, `loginAndPublish` for 知乎/小红书/Twitter. |
| [lib/quarto.js](lib/quarto.js) | Quarto compilation for `.qmd` and `.ipynb`. Spawns `quarto render --to gfm`, extracts YAML frontmatter, manages cross-session compile cache (skips re-compile when source hasn't changed). Single-file only — no book project support. Also post-processes the generated `.md` to restore knitr's `## ` output prefix (see below). |
| [electron/main.js](electron/main.js) | Electron main process. File open/save dialogs, IPC handlers for rendering and platform copy/export, config persistence to `userData`. |
| [electron/preload.js](electron/preload.js) | Context bridge exposing safe IPC methods to the renderer. |
| [electron/renderer/index.html](electron/renderer/index.html) | Electron renderer: split-pane Markdown editor (CodeMirror) + live preview with 500ms debounce. |
| [scripts/social_worker.js](scripts/social_worker.js) | Playwright worker for browser-based publishing to 知乎/小红书/Twitter. Runs as a standalone Node process. Handles login, image upload via each platform's editor, content filling (clipboard paste for 知乎). Stdout protocol: `INFO:`, `PROGRESS:`, `COOKIES_SAVED`, `READY_TO_PUBLISH`, `PUBLISHED:`, `DIAG:`, `ERROR:`, `NEED_INSTALL`. |
| [scripts/xhs_screenshot.js](scripts/xhs_screenshot.js) | Playwright script for Xiaohongshu image export. Opens HTML in Chromium, full-page screenshot, smart slice at clean rows. Communicates via stdout protocol (`INFO:`, `SAVED:`, `ERROR:`). |
| [scripts/publish_lint.js](scripts/publish_lint.js) | 知乎发布 HTML 门禁。跑 `node scripts/publish_lint.js`，把 `buildPublishHtml` 与 `buildZhihuCopyHtml` 的产物按知乎官方发布规范逐条断言（公式 eeimg、代码 lang、表格 data-draft-*、标题编号、脚注 sup 等）。夹具在 `fixtures/`。改 `lib/zhihu.js` 的发布格式化逻辑前先跑它。 |
| [templates/wechat.html](templates/wechat.html) | Default HTML wrapper template. Users can override by placing custom `.html` files in their workspace `templates/` directory. |

### Key patterns

- **Extension ↔ Webview**: Typed message passing via `postMessage` (e.g. `{ type: 'getWechatHtml' }`, `{ type: 'update', bodyHtml, title, theme }`). The webview requests platform-specific HTML; the extension builds it server-side and returns it for clipboard copy.
- **Child process scripts**: Playwright scripts are spawned via `child_process.spawn(process.execPath, [scriptPath, ...args])` — they run as standalone Node processes, not imported modules. Communication is via stdout line protocol.
- **Configuration**: VS Code settings under `qmd2any.*` namespace (`appid`, `appSecret`, `author`, `digest`, `template`, `outputPath`). In Electron, persisted to `userData/config.json`.
- **External service**: WeChat draft upload uses the [FastPen](https://www.fastpen.online) API (`POST /api/draft/multi/import-markdown`).
- **knitr `## ` output prefix**: `## ` on chunk output is a **knitr** convention, not a Quarto one. `knitr::knit()` writes an intermediate `.md` and prefixes output lines with `## ` so Markdown won't parse them as headings; Quarto skips that layer and renders straight to an AST, so its CodeBlock text is bare (`[1] 2`), and pandoc's commonmark writer emits classless code blocks as 4-space indented blocks. After `quarto render --to gfm`, `lib/quarto.js` calls `addChunkOutputCommentPrefix()` to put `## ` back so `.qmd` articles match the `.Rmd` look. Verified boundaries (Quarto 1.9.38): `#| echo: false` output has **no** preceding fence, so "follows a ``` fence" cannot be used as the signal; list continuations get normalized to 2 spaces and don't match, but **nested list items can be 4-space indented and must be excluded** explicitly; and **footnote definitions (`[^id]: …`) wrap their continuation lines with 4 spaces** — prefixing those corrupts the note text (`… Control ## Letters …`), so a footnote block is skipped until a blank or non-indented line. Hand-written `.md` files never pass through this function — their `##` already survives untouched.

### Extension activation

The extension activates on `onLanguage:markdown`, `onLanguage:quarto`, `onNotebook:jupyter-notebook`, and `onStartupFinished`, and registers:
- `qmd2any.preview` — opens a Webview panel (right side), 500ms debounced auto-refresh on save
- `qmd2any.convert` — exports inline-styled HTML to `build/wechat.html`

Shortcut: `Cmd+Shift+W` / `Ctrl+Shift+W` while editing a `.md`, `.qmd`, `.Rmd`, or `.ipynb` file.

### Social publishing flow

Publishing to 知乎/小红书/Twitter uses Playwright browser automation:

1. **Cookie management**: Cookies are stored in VS Code `globalState` (never on disk). `lib/social.js` provides `getCookies`/`setCookies`/`clearCookies`/`cookieStatus`.
2. **Child process**: `lib/social.js` spawns `scripts/social_worker.js` via `child_process.spawn(process.execPath, [...])`. Communication is via stdout line protocol (`INFO:`, `PROGRESS:`, `READY_TO_PUBLISH`, `PUBLISHED:`, `ERROR:`, `DIAG:`).
3. **知乎**: Uses `loginAndPublish` — login and publish in the same browser process to avoid cross-process cookie issues. Opens the Zhihu editor, fills title, pastes clean HTML via clipboard, uploads images through the editor's own file input.
4. **小红书**: Opens creator.xiaohongshu.com, uploads images, fills title/body/tags.
5. **Resume**: If publishing fails, the browser stays open and the job file is preserved in `os.tmpdir()` for `resume()` recovery.

### 知乎发布 HTML 规范

`lib/zhihu.js` 的 `buildPublishHtml(bodyHtml, { title, numberHeadings })` 是发布路径的唯一入口，输出形态按知乎官方发布规范（知乎 `zhihu-sync` skill 的 `zhihu-validate/reference/conversion.md`）对齐：

- 公式：`<img eeimg="1">` 行内 / `eeimg="2"` 块级，`alt` 必须是**原样 LaTeX**；`src` 为 `//www.zhihu.com/equation?tex=…`。不要往 alt 里塞 `\\` 之类标记——知乎以 alt 读取公式原文。`buildZhihuCopyHtml` 必须保持同样的规则。
- 代码：`<pre lang="python">纯文本</pre>`，**不能**嵌 `<code>`。`lang` 取不到就留空。`r → ada` 是**刻意的**（知乎语言表里没有 R，落 `text` 会丢代码块样式），别当 bug 修。
- 表格：`<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody><tr><th>…`，不留 `<thead>`，单元格只允许纯文本 + `<br>`。
- 标题：知乎只有 h2 / h3。`applyHeadingNumbers` 会编号（`1 引言` / `1.1 数据`），层级按**相对嵌套**算（`##` 直接跳 `####` 是「下一级」，不是 1.0.1），标签第 1 层 h2、更深都压成 h3；作者手写的步骤标签（`(1)`、`①`、`一、`）视为已编号，不自动加号也不消耗计数。开关是 `qmd2any.numberHeadings`（默认开，知乎和微信共用）。
- 首个 `<h1>` 只在**它等于文章标题**时才删——无条件删会把 qmd 正文里的第一章整段吃掉。
- 脚注：两条入口都要通，且**按平台分形态**（`renderMarkdown(md, { footnoteMode })`）。
  Quarto 用 `--to gfm` 编出来的是 **Markdown 语法 `[^id]`**（不是 pandoc 那套 `<a class="footnote-ref">` HTML），而 `marked` 不认脚注，所以由 `lib/converter.js` 的 `extractFootnoteDefs()` 在 `renderMarkdown` 里先摘出定义、`applyMarkdownFootnotes()` 按模式输出：`zhihu` 模式藏进 `sup` 的 `data-text`（编辑器读成气泡，末尾不重复列出）；`visible` 模式（默认）落成正文末尾可见的「注释」列表 —— **微信没有注释气泡，说明只放 data-text 等于没写**。`buildPublishHtml` 的 `convertFootnotesForZhihu` 兜住另一种（pandoc HTML）形态。注意 `.md` 可能是 CRLF，正则在摘定义前必须归一化行尾，否则 `.*$` 匹配不上。
- 微信侧标题/脚注：`buildWechatCopyHtml(bodyHtml, templatePath, theme, { title, numberHeadings })` 走同一套 `lib/headings.js`，但 `keepTags: true` 保留 h1/h2/h3（模板里各有样式）；公众号标题在编辑器里单填，所以正文里与标题重复的 h1 会被删掉。
- 微信侧三个坑（都踩过）：
  1. **行内代码必须换成 `<span class="inline-code">`** —— 公众号对 `<code>` 的处理不可控（实测把「冒号及其后的正文」挤到下一行）。`applyCodeBlocksForWechat` 之后代码块是 `<section><code class="hljs">`，那是另一回事，不要一起换。
  2. **行内公式的位移只能有一层** —— MathJax 的 SVG 自带 `vertical-align: -X ex`，外层 mdnice 惯用的 `<span style="display:inline-block;vertical-align:-Xex">` 若再带一次就是两层叠加，公式整体沉到基线下面一倍（`a/b` 偏下 7px）。生成时要先把 SVG 自己的 `vertical-align` 归零。
  3. **`li` 不要设左右 `margin`** —— `ul` 已有 `padding-left`，再给 `li` 加 20px 会让项目符号与文字之间空一大块、白吃行宽。
  4. **列表整体不用 `<ul>/<li>`，且不要用 `text-indent`** —— 公众号会把贴进去的列表重排：列表项以行内标签（加粗、行内代码）开头时，「冒号及其后的正文」被挤到下一行。`flattenListsForWechat()` 把列表拆成 `section.list-item` + 项目符号 + 悬挂缩进。悬挂缩进**必须用项目符号的负 `margin-left` 实现**（`padding-left:Xem` + 符号 `width:Xem;margin-left:-Xem`），**不能用 `text-indent:-Xem`**：实测（对照实验 1 坏 / 2、3 好）列表项里一旦有 `text-indent`，其中的内联公式会被推走、压到前一个字上、原位留白。脚注的 `<ol>` 也走这条路。
  5. **SVG 的 `viewBox` 必须保住驼峰** —— cheerio/parse5 序列化会把 `viewBox` 转小写，浏览器解析 HTML 时又会自动纠正，所以本地预览、截图全看不出问题；公众号不纠正，于是公式按 1:1 画进小框再被压小 → 「变小、挤到前一个字上、原位留空白」。`restoreSvgAttrCase()` 在所有 cheerio 工序之后、返回字符串前把 `<svg>` 内的属性名改回来（微信和小红书两条链路都要过）。验证时**不能再用 cheerio 解析后再断言**，那会把 bug 藏起来，必须查裸字符串。
- 其他：`<strong>`→`<b>`、`<em>`→`<i>`、`blockquote` 多段用 `<br>`、空段落 `<p><br></p>`、所有 `style`/`class` 剥掉（mermaid/grViz 除外，worker 还要靠它们渲染）。
- 长度预检：`checkPublishLimits` 在 `extension.js` 两处调用点拦标题 >100 字、正文 <9 或 >100000 字，**报错让用户改**，不静默截断。

改这块逻辑前先跑 `node scripts/publish_lint.js`——夹具 `fixtures/` 里 7 个样本、20 条断言，其中「标题编号与层级」的期望值写在 `scripts/publish_lint.js` 的 `HEADING_EXPECTATIONS` 里。也可以直接把编译后的真实稿件喂给它体检：

```bash
node scripts/publish_lint.js <任意.md>
```

传文件时不检查「夹具覆盖度」（那条只在跑整套夹具时才要求每条断言都被跑到）。
