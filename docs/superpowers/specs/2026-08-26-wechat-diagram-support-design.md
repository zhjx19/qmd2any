# 公众号复制链路支持 mermaid / DiagrammeR 流程图 —— 设计文档

日期：2026-08-26
状态：已获用户批准的设计，待实现计划
前置依赖：知乎侧图表支持（工作区未提交改动，含 `lib/diagram/` 本地库、quarto `-M prefer-html:true`、worker 渲染逻辑）

## 1. 背景与目标

知乎发布链路已支持把 mermaid 代码块与 DiagrammeR（grViz htmlwidget）渲染成 PNG 图片。本设计把同等能力带到**公众号复制粘贴路径**：

- 用户在 `.md` / `.qmd` 中写 ```mermaid 代码块或 R 的 grViz chunk；
- 点击「复制公众号 HTML」后，图表被本地渲染为带白底+浅灰边框的 base64 PNG `<img>`，随正文一起进入剪贴板；
- 粘贴到微信公众号编辑器后图片与其他正文图片行为一致。

**明确不在范围内**：Electron 的草稿箱上传路径（FastPen API 收原始 markdown，服务端无法消费本地渲染产物）——留待后续单独设计。

## 2. 关键决策（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 目标链路 | 复制粘贴路径（VS Code + Electron 两端） |
| 渲染方式 | 本地 Playwright 复用：抽取共享模块 + 轻量渲染脚本；不用 mermaid.ink |
| 渲染时机 | 复制时同步渲染（带进度提示）；预览 webview 仍显示代码块 |
| 浏览器 | `findChromium()` 定位系统 Chrome/Edge（项目用 playwright-core，无捆绑 Chromium），headless 启动 |

## 3. 架构总览

```
                    ┌──────────────────────────────┐
 bodyHtml ──hasDiagramHtml?── 否 ─────────────────────────► buildWechatCopyHtml
                    │                              │              （现有管线不动）
                    是                             │
                    ▼                              │
   spawn(process.execPath,                         │
     scripts/render_diagrams.js, in.json, out.json)│  ← 与 lib/social.js:220 同款 spawn
                    │                              │
                    ▼                              │
        lib/diagram/render.js                      │
        renderDiagrams(page, html, [])             │
        （mermaid.min.js / viz.js 注入渲染页）      │
                    │                              │
                    ▼                              │
   out.json { html(含 base64 img), rendered } ─────┘
```

数据流要点：
- 渲染发生在 `renderForPlatform()` 之后、`buildWechatCopyHtml()` 之前；
- 替换后的 `<img src="data:image/png;base64,...">` 对 juice 完全透明（现有本地图早已 base64 化，管线天然兼容）；
- grViz 原文来自 quarto 编译层（`lib/quarto.js:112` 已加 `-M prefer-html:true`），经 marked 保留为 `<div class="grViz">` + `<script data-for>` JSON。

## 4. 组件设计

### 4.1 `lib/diagram/render.js`（新建）

从 `scripts/social_worker.js` 机械性搬移以下函数，**签名不变**：

| 函数 | 现位置 | 说明 |
|---|---|---|
| `renderDiagrams(page, html, images)` | social_worker.js:745-848 | cheerio 找图 → mermaid/grViz 分支 → SVG → base64 img 替换 → 按序重建 images。无图表时直接原样返回 |
| `svgToPng(renderPage, svg, name)` | social_worker.js:851-870 | 白底 + 12px padding + #e0e0e0 边框容器 → element screenshot → `{ pngPath, dataUri }` |

新增导出：

```js
function hasDiagramHtml(html) {
  // 正则快查，避免无图文档起浏览器的开销
  // 匹配：language-mermaid / class="mermaid"（含 mermaid-js）/ div.grViz / script[data-for=
}
```

依赖仅 cheerio + node 内置模块（page 由调用方传入）。`lib/diagram/` 下的 mermaid.min.js、viz.js 本地库继续由该模块按需注入渲染页。

### 4.2 `scripts/social_worker.js`（改）

删除内联的 `renderDiagrams` / `svgToPng`，改为 `const { renderDiagrams } = require('../lib/diagram/render')`。调用处（publishZhihu 内，现 1022-1025 行附近）不变。module.exports 相应调整（保留对外导出 renderDiagrams 以兼容现有引用）。

### 4.3 `scripts/render_diagrams.js`（新建）

仿 `xhs_screenshot.js` 的独立脚本模式（child_process 子进程运行，非 import）：

```
用法：node render_diagrams.js <input.json> <output.json>
input : { "html": "<div>...</div>" }
output: { "html": "...", "rendered": 2, "errors": ["..."] }
```

- 文件传参而非 stdin/stdout 管道内容体（规避 Windows 缓冲问题）；
- 流程：读 input → `findChromium()` → `chromium.launch({ headless: true, executablePath })` → `newPage()` → `renderDiagrams(page, html, [])` → 写 output → exit 0；
- 致命错误（找不到浏览器等）：stderr 输出 `ERROR:` 行协议信息，exit 非 0；
- 浏览器定位：`findChromium()` 目前在 social_worker.js 与 xhs_screenshot.js 各有一份拷贝。本次把它**一并提取到 lib/diagram/render.js 并导出**（取两份实现的并集行为），三个脚本统一引用，不新增第四份拷贝。

### 4.4 VS Code 端接入（extension.js:335-351 改）

在 `case 'getWechatHtml'` 内、`buildWechatCopyHtml` 之前插入：

```js
let finalBody = bodyHtml;
if (diagramRender.hasDiagramHtml(bodyHtml)) {
  finalBody = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在渲染流程图为图片…' },
    () => diagramRender.renderViaScript(extensionPath, bodyHtml)   // 见 4.6
  );  // 失败时内部降级，返回原文并警告
}
const html = buildWechatCopyHtml(finalBody, templatePath, theme);
```

handler 所在的 `handleWebviewMessage`（extension.js:274）已是 `async function`，case 内直接 `await` 即可，无需改回调结构。

### 4.5 Electron 端接入（electron/main.js:399-414 改）

同样的「检测 → spawn → 替换 → buildWechatCopyHtml」逻辑插在 `renderForPlatform` 之后。ipcMain.on 回调改为内部 async（sendToRenderer 本就是事后投递，无需改 IPC 形态）。进度提示走现有的 renderer 消息机制（如无现成 toast 通道则 console/log 即可，Electron 端从简）。

### 4.6 spawn 辅助 —— `renderViaScript(rootPath, html)`

两端共用的薄封装，作为 `lib/diagram/render.js` 的导出函数（rootPath 由调用方传入：VS Code 端为 extensionPath，Electron 端为 appRoot）：

- `spawn(process.execPath, [scriptPath, inJson, outJson])` —— **与 lib/social.js:220 完全同款**（实测两端 process.execPath 均可直接跑 js 入口脚本，不需要 ELECTRON_RUN_AS_NODE）；
- scriptPath = `path.join(rootPath, 'scripts', 'render_diagrams.js')`（参照 electron/main.js:553 的 xhs_screenshot 用法）；
- 解析 output.json 返回替换后的 html；子进程非 0 退出或输出缺失 → 抛错给调用方降级。

## 5. 错误处理与降级

| 场景 | 行为 |
|---|---|
| 文档无图表 | `hasDiagramHtml` 为假，零开销直通（不起浏览器） |
| 找不到 Chromium | 脚本 exit≠0；调用方捕获 → 警告提示「未找到可用浏览器，流程图以源码块形式保留」，正文照常复制 |
| 单个图表渲染失败 | renderDiagrams 现有逻辑：保留原代码块、记录 errors，不中断整体 |
| 渲染成功的降级形态 | 失败块留在 html 中成为普通代码块，走 applyCodeBlocksForWechat 显示源码——可接受兜底 |

## 6. 明确不改动

- `lib/converter.js`：`enhanceCodeBlocks` 已跳过 language-mermaid（448-449 行，防止高亮改写结构）；juice 不管 data URI；模板/主题/公式管线均无关；
- quarto 编译层参数；
- FastPen 草稿上传路径（范围外）；
- 小红书路径。

## 7. 验证方案（手动，项目无自动化测试）

1. **功能**：构造测试 `.qmd`（含 mermaid 代码块 ×2 + DiagrammeR grViz chunk + 普通 R 图）→ F5 调试 → 复制公众号 HTML → 存为本地 html 检查：base64 img 数量正确、顺序符合文档出现顺序、白底边框样式一致；
2. **实粘**：粘贴进微信公众号编辑器后台，确认图片上传存活、无图文错位；
3. **降级**：临时改坏 findChromium 路径验证警告 + 代码块兜底；单个图表写错语法验证只丢一块；
4. **知乎回归**：同一文档走知乎发布全流程（重构后必须重测）：图文顺序正确、发布成功——这是本次唯一动到的既有路径；
5. **打包**：`npm run package` 通过，产物含 lib/diagram/ 与新脚本（检查 .vscodeignore / files 白名单是否需要补条目）。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 抽取重构引入知乎回归 | 签名不变 + 机械搬移 + 验证第 4 条强制回归 |
| VS Code 打包遗漏 lib/diagram/*.js 大文件导致装机后不可用 | 验证第 5 条显式检查 vsix 内容（此前 lib/diagram 未跟踪，需确认打包清单已含它——知乎改动若已处理则复用） |
| 公众号编辑器对大尺寸 PNG 的压缩/缩放 | 沿用知乎已验证的白底边框样式；如实测异常再调 max-width 样式（后续小改，不阻塞本期） |
