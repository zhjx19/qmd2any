# QMD2Any — Quarto / Markdown / R Markdown / Notebook 一键发布公众号 & 知乎

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Install-2d7a3e?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZhangJingxin.qmd2any)
[![GitHub Release](https://img.shields.io/github/v/release/zhjx19/qmd2any?logo=github&label=Release)](https://github.com/zhjx19/qmd2any/releases/latest)

> 🔌 Forked from [markdown2anything](https://github.com/marsggbo/markdown2anything) v3.0（by [@marsggbo](https://github.com/marsggbo)）
> — 在原有 Markdown → 公众号/知乎 管线的基础上，新增 **Quarto (.qmd)、R Markdown (.Rmd) 和 Jupyter Notebook (.ipynb) 一键编译发布**支持。

---

将 Markdown / Quarto (.qmd) / R Markdown (.Rmd) / Jupyter Notebook (.ipynb) 文章一键渲染并导出到微信公众号和知乎，支持 **LaTeX 公式**、**6 套内置主题**、**实时预览**、**一键复制微信**、**Quarto 编译集成**和 **Playwright 浏览器自动化发布知乎**。

支持两种形态：**VS Code 插件** 和 **独立桌面客户端**（Electron），互不依赖，按需选择。

---

## ⚠️ 免责声明

- 本项目是 [markdown2anything](https://github.com/marsggbo/markdown2anything) 的衍生作品，遵循 MIT 许可证。
- **知乎发布功能**使用 Playwright 浏览器自动化方案，你的 Cookie 仅存储在本地 VS Code 存储中，不会上传至任何服务器。
- 请遵守各平台（微信公众号、知乎）的使用条款，勿用于发布违规内容。
- 本项目作者对因使用本工具产生的任何后果不承担责任。

---

## 🆕 v2.3.6 更新

| 功能 | 说明 |
|------|------|
| 🔢 **标题自动编号** | 发公众号/知乎时把 `#` / `##` 编号成 `1`、`1.1`、`1.1.1` 写进标题文本（两家都不认 CSS 计数器）。层级按**相对嵌套**算，跳级标题不会编出 `1.0.1`；手写的步骤标签（`(1)`、`①`、`一、`）视为已编号不重复。开关 `qmd2any.numberHeadings` |
| 📝 **AI 摘要** | 工具栏「📝 摘要」调 DeepSeek 生成**不超过 120 字**的公众号分享摘要，卡片里可改完再复制；同一篇按内容哈希缓存。`▾ → ⚙ AI 设置…` 里填 Key / 模型 / 地址，不用翻设置页 |
| 🎨 **公众号排版修复** | 列表项「冒号及其后正文被挤到下一行」（改为 `section` + 悬挂缩进）、标题里的行内代码字号偏小（`px → em`）、行内公式与环境不在一条基线且被压小（位移只保留一层、SVG 宽高 `ex → px`、`viewBox` 保住驼峰） |
| 📐 **知乎发布 HTML 对齐官方规范** | 块级公式 `eeimg="2"`、表格 `data-draft-*` 原生标记、脚注转 `sup` 注释、`<b>/<i>` 语义标签、`blockquote` 用 `<br>` 连段、空段落 `<p><br></p>`；发布前**长度预检**（标题 ≤100 字、正文 9~10 万字），超限报错而不是静默截断 |
| 🐛 **两处内容丢失修复** | 首个 `<h1>` 只在它**等于文章标题**时才删（原来会吃掉 `.qmd` 正文里的第一章）；Quarto 编译后脚注续行被误加 `## `，导致注释正文里冒出 `##` |

> 排版这几条都不是"代码写法"问题，而是公众号编辑器对 `<code>` / `<ul>` / `text-indent` / `ex` 单位的处理与浏览器不同 —— 逐条做了对照实验才定位到，细节记在 `CLAUDE.md` 的「微信侧三个坑」一节。

---

## 🆕 v2.3.5 更新

| 功能 | 说明 |
|------|------|
| 🐛 **`.qmd` 运行结果补回 `## ` 行首** | Quarto 不像 knitr 那样给代码块运行结果加 `## ` 前缀，编译后自动补回，与 `.Rmd` 观感一致 |

---

## 🆕 v2.3.4 更新

| 功能 | 说明 |
|------|------|
| ✏️ **品牌文案更正** | 市场标题与描述统一为「一键**发布**公众号/知乎」（原「一键导出微信/知乎」） |

---

## 🆕 v2.3.3 更新

| 功能 | 说明 |
|------|------|
| 📊 **流程图支持（mermaid / DiagrammeR）** | ` ```mermaid ` 代码块与 R 的 `DiagrammeR::grViz` 图自动渲染成高清图片（3x 渲染，高分屏不糊），复制微信、发布知乎均可用 |

### 使用流程图

- **mermaid**：直接写 ```` ```mermaid ```` 代码块，复制微信 HTML 或发布知乎时自动渲染为白底图片
- **DiagrammeR**：在 `.qmd` / `.Rmd` 中写 R 代码块，如 `DiagrammeR::grViz("digraph{A -> B}")`，Quarto 编译后自动渲染
- 渲染全部在本机浏览器完成，无需联网；单个图表语法出错只保留该块的源码，不影响其余内容

---

## 🆕 v2.3.2 更新

| 功能 | 说明 |
|------|------|
| 🐛 **微信代码块空格保留** | 代码块中函数参数空格（如 `param2 = None`）不再被微信编辑器吞掉，使用 `&nbsp;` 保证排版 |
| 🐛 **知乎多图发布错位修复** | 本地图片文件缺失时不再导致后续图片错位上传，增加数量校验和独立索引追踪 |
| 📐 **R Markdown 支持** | `.Rmd` 文件完整支持，与 `.qmd` 相同的编译管线，Quarto 原生兼容（v2.3.1） |
| 📓 **Jupyter Notebook 支持** | `.ipynb` 文件可编译、预览、发布微信/知乎，通过 Quarto 完成（v2.3.1） |

### 使用 .ipynb 的注意事项

- 打开 `.ipynb` 后先在 notebook 编辑器中 **Run All** 运行所有单元格，然后保存——代码输出会写入 `.ipynb` 文件
- 再点击编译按钮，Quarto 会读取已保存的输出并渲染到预览面板
- `.ipynb` 支持与 `.md` / `.qmd` / `.Rmd` 完全相同的功能：预览、复制微信、发布知乎

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 🐧 **复制微信** | 一键复制带内联样式的 HTML，公式转 SVG，代码高亮保留，直接粘贴到微信公众号编辑器 |
| 🚀 **发布知乎** | 扫码登录后，自动打开浏览器 → 填标题 → 粘贴正文 → 上传图片 → 停在你面前，核对后点击「发布」 |
| 🎨 **6 套内置主题** | 微信经典 / Claude / macOS / 知乎精选 / 极简黑白 / Notion |
| 📐 **LaTeX 公式渲染** | 支持行内公式 `$...$` 和独立公式块 `$$...$$`，基于 KaTeX 渲染 |
| 👁️ **实时预览面板** | 在编辑器右侧打开独立预览窗口，`.md`/`.qmd`/`.Rmd` 保存时自动刷新，编译文件编译后刷新 |
| 🎨 **在线样式编辑** | 通过主题下拉菜单中的「自定义样式...」打开 CSS 编辑器，实时修改，所见即所得 |
| 🔄 **Quarto 编译集成** | `.qmd` / `.Rmd` / `.ipynb` 一键编译为 Markdown，执行 R/Python 代码块，渲染图表、表格 |
| 🔢 **标题自动编号** | `#` / `##` 自动编号为 `1`、`1.1`、`1.1.1` 写进标题文本，公众号和知乎都生效（可选开关） |
| 📝 **AI 摘要** | 调 DeepSeek 生成 ≤120 字公众号摘要，卡片里可改再复制，按内容哈希缓存 |
| 📊 **流程图支持** | `mermaid` 代码块与 `DiagrammeR::grViz` 自动渲染为高清图片，嵌入微信/知乎正文 |
| 📓 **Notebook 支持** | `.ipynb` 可在 VS Code notebook 编辑器中运行后编译预览；`.Rmd` 与 `.qmd` 一致 |

### 内置主题与平台适配

| 主题 | 推荐平台 | 说明 |
|------|---------|------|
| 🟢 **微信经典** | 公众号 ✅ | 默认主题，适配公众号编辑器样式 |
| 🟠 **Claude 风格** | 公众号 ✅ | 暖色调衬线体，适合技术长文 |
| 🍎 **macOS 简约** | 公众号 ✅ | 苹果系统原生风格，简洁清爽 |
| 🔵 **知乎精选** | 知乎 ✅ | 蓝色强调色，匹配知乎 UI 风格 |
| ⬛ **极简黑白** | 通用 | 经典印刷风格，两端都可用 |
| 📋 **Notion 简洁** | 通用 | Notion 风格，两端都可用 |

> **提示**：主题下拉菜单最后一个选项「🎨 自定义样式...」可以打开 CSS 编辑器，自由调整样式。

---

## 安装

### 方式一：从 VS Code Marketplace 安装（推荐）

在 VS Code 扩展市场搜索 **QMD2Any** 安装，或点击：

[![Install](https://img.shields.io/badge/VS%20Code-Install-2d7a3e?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZhangJingxin.qmd2any)

### 方式二：下载 VSIX 包手动安装

从 [GitHub Releases](https://github.com/zhjx19/qmd2any/releases/latest) 下载最新 `.vsix` 文件：

```bash
# 安装到 VS Code
code --install-extension qmd2any-*.vsix
```

### 方式三：从源码安装（开发模式）

```bash
git clone https://github.com/zhjx19/qmd2any.git
cd qmd2any
npm install
code .   # 按 F5 启动调试
```

---

## 快速开始

### Markdown 文件

1. 在 VS Code 中打开任意 `.md` 文件
2. 点击编辑器右上角的预览按钮（或 `Ctrl+Shift+W`）
3. 右侧弹出实时预览面板，保存时自动刷新

### Quarto (.qmd)、R Markdown (.Rmd) 或 Notebook (.ipynb) 文件

1. 在 VS Code 中打开 `.qmd`、`.Rmd` 或 `.ipynb` 文件
2. **对于 `.ipynb`**：先在 notebook 编辑器中 Run All 运行所有单元格，保存
3. 点击编辑器右上角的预览按钮（或 `Ctrl+Shift+W`）
4. 预览面板打开，点击状态栏的 **「🔄 编译」**
5. Quarto 执行代码块、渲染图表 → 预览自动刷新
6. 再次打开时，若源文件未修改，直接使用编译缓存，无需重复编译

> **前置要求**：安装 [Quarto CLI](https://quarto.org/docs/get-started/)。

---

## 发布知乎

点击工具栏 **「🚀 发布知乎」**。首次使用会自动弹出浏览器窗口让用户登录。

1. 浏览器窗口打开后，用手机扫码（或账号密码）登录知乎
2. 登录成功后，插件自动保存凭证，之后每次点发布知乎都不再需要登录
3. 浏览器自动：打开知乎写文章页 → 填标题 → 粘贴正文 → 上传图片 → 停在你面前
4. 在浏览器中核对内容，自己点击「发布」

> **提示**：如果自动登录失败，可以点工具栏「🚀 发布知乎」旁的下拉（或侧栏），选择「🍪 手动 Cookie」手动粘贴 `z_c0` 的值。

> 发布过程中会看到图片上传弹窗自动闪现并关闭，这是正常的——插件自动选择图片文件并点击插入。

### 标题自动编号

发到公众号或知乎时，标题里的 `#` / `##` 会按层级编号写进文本：

```
# 引言            →  1 引言
## 数据           →  1.1 数据
### 清洗          →  1.1.1 清洗
```

- 公众号保留 `h1/h2/h3` 原层级，知乎压成两级（`h2` / `h3`），编号都在文本里，因为两家都会剥掉 `<style>`，CSS 计数器不生效
- 层级按**相对嵌套**算：`##` 直接跳到 `####` 是「下一级」而不是 `1.0.1`
- 作者手写的步骤标签（`(1)`、`（一）`、`①`、`一、`）视为已编号，不重复加号也不占号
- 不想要就在设置里关掉 `qmd2any.numberHeadings`

---

## 公众号摘要（AI 生成）

公众号分享卡片需要 ≤120 字的摘要。点工具栏 **「📝 摘要」** 右侧的 `▾`：

- **生成摘要（≤120 字）** — 读当前文章标题 + 正文，调 DeepSeek 生成
- **⚙ AI 设置…** — 弹窗里填 API Key、模型、API 地址（后两个已预填默认值）

生成后右下角浮出卡片：文本可编辑、实时显示字数（`108/120`，超限变红并拦住复制）、一键「复制摘要」。同一篇文章再次点击会走缓存（改了正文才重新生成）。

> **字数保证**：模型超 120 字会先回抛让它压缩一次，仍超则按句末标点本地截断 —— 返回结果一定不超 120 字。
>
> **Key 存放**：写进用户级 VS Code 设置（不进工作区、不被 git 跟踪）；面板只回显 `sk-****abcd` 这种掩码，完整值不回到界面。

---

## 配置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `qmd2any.template` | `wechat` | 微信模板名（见下方自定义模板） |
| `qmd2any.theme` | 微信经典 | 内置主题 |
| `qmd2any.numberHeadings` | `true` | 标题自动编号（公众号 + 知乎共用） |
| `qmd2any.publish.mode` | `prepare` | 知乎发布：`prepare` 填好内容停在编辑器让你核对；`auto` 自动点发布 |
| `qmd2any.deepseek.apiKey` | 空 | DeepSeek API Key（面板里可改） |
| `qmd2any.deepseek.model` | `deepseek-flash` | 生成摘要用的模型 |
| `qmd2any.deepseek.baseUrl` | `https://api.deepseek.com` | 走代理或兼容网关时改这里 |
| `qmd2any.author` / `digest` | 空 | 桌面客户端上传草稿时用的作者名 / 摘要 |

---

## 自定义模板

在工作区根目录创建 `templates/` 文件夹，放置自定义 HTML 模板：

```
your-project/
├── templates/
│   └── custom.html    ← 自定义模板
├── article.qmd
└── _quarto.yml
```

在设置中指定模板名称：

```json
{
  "qmd2any.template": "custom"
}
```

模板中使用 `{{body}}` 作为文章内容占位符。

---

## 独立桌面客户端（无需 VS Code）

基于 **Electron** 构建。

```bash
npm run start:electron
npm run build:mac
```

> 桌面客户端与 VS Code 插件共用同一套核心转换库（`lib/converter.js`），功能一致但彼此独立运行。

---

## 项目结构

```
qmd2any/
├── extension.js          # VS Code 扩展主入口
├── package.json          # 扩展清单 + Electron 脚本
├── lib/
│   ├── converter.js      # 核心转换逻辑（插件/客户端共用）
│   ├── themes.js         # 6 套内置主题定义
│   ├── zhihu.js          # 知乎发布 HTML 构建 + 长度预检
│   ├── headings.js       # 标题归一与自动编号（知乎/微信共用）
│   ├── digest.js         # 公众号摘要生成（DeepSeek，硬上限 120 字）
│   ├── social.js         # Playwright 浏览器自动化发布调度
│   └── quarto.js         # Quarto 编译集成 + 缓存管理
├── electron/             # Electron 客户端
│   ├── main.js
│   ├── preload.js
│   └── renderer/
├── scripts/
│   ├── social_worker.js  # 浏览器自动化 Worker（知乎/小红书/Twitter）
│   ├── xhs_screenshot.js # 小红书截图导出（桌面客户端用）
│   ├── publish_lint.js   # 发布 HTML 门禁（开发期校验，不进 vsix）
│   └── install_ext.js    # 打包 + 安装到本机编辑器
├── fixtures/             # 门禁夹具（不进 vsix）
├── templates/
│   └── wechat.html       # 默认微信模板
└── README.md
```

> **开发期门禁**：改发布相关的 HTML 生成逻辑后跑 `node scripts/publish_lint.js`。它用 8 个夹具、20 条断言检查公式/表格/脚注/标题编号/列表结构，外加 4 条链路检查（含"已安装扩展是不是最新源码"—— 改完忘了 `npm run install-ext` 会直接红）。

---

## 工作原理

```
.md / .qmd / .ipynb 文件
    ↓
[.qmd / .ipynb] quarto render --to gfm（执行代码块、渲染图表表格）
    ↓
中间 .md 文件
    ↓
gray-matter 解析 frontmatter
    ↓
marked + KaTeX 扩展（公式渲染）
    ↓
cheerio 处理（图片 Base64、代码高亮）
    ↓
juice CSS 内联（微信导出）
    ↓
平台专用 HTML（微信公众号 / 知乎）

--- 知乎发布 ---

buildPublishHtml() → 干净语义化 HTML
listMarkdownLocalImages() → 本地图片路径
    ↓
social.publish() → Playwright 浏览器自动化
    ↓
浏览器填标题 → 粘贴正文 → 上传图片 → 停在编辑页
    ↓
核对后手动点击「发布」
```

---

## 版本历史

### v2.3.6

- **新增**：标题自动编号 — `#` / `##` 编成 `1`、`1.1`、`1.1.1` 写进标题文本，公众号与知乎共用；层级按相对嵌套计算，手写步骤标签不重复；开关 `qmd2any.numberHeadings`
- **新增**：AI 摘要 — 「📝 摘要」调 DeepSeek 生成 ≤120 字公众号摘要，可编辑后复制；按内容哈希缓存；`▾ → AI 设置…` 弹窗配置 Key / 模型 / 地址
- **修复**：公众号列表项「冒号及其后正文被挤到下一行」 — 不再使用 `<ul>/<li>`，改为 `section` + 项目符号负 `margin-left` 实现悬挂缩进（实测 `text-indent` 会把列表里的行内公式推走）
- **修复**：公众号标题里的行内代码字号偏小 — `font-size: 14px` 改为 `0.92em`，跟随标题字号缩放
- **修复**：公众号公式变小、错位、压到前一个字上 — 位移去重（外层 span 与 SVG 各带一次 `vertical-align`）、SVG 宽高 `ex → px`、`viewBox` 保住驼峰（cheerio 会转小写，浏览器自动纠正但公众号不纠正）
- **修复**：Quarto 编译后脚注续行被误加 `## ` — `addChunkOutputCommentPrefix()` 现在整段跳过脚注定义块
- **修复**：`.qmd` 正文里第一个 `<h1>` 被无条件删除 — 改为仅当它等于文章标题时才删
- **改善**：知乎发布 HTML 对齐官方发布规范 — 块级公式 `eeimg="2"`、表格 `data-draft-*`、脚注 `sup` 注释、`<b>/<i>`、`blockquote` 用 `<br>`、空段落 `<p><br></p>`
- **新增**：发布前长度预检 — 标题 ≤100 字、正文 9~10 万字，超限报错而非静默截断
- **新增**：发布 HTML 门禁 `scripts/publish_lint.js`（8 夹具 / 20 断言 + 4 条链路检查）
- **改善**：`npm run install-ext` 修好 — 原来用 `$(...)` 在 Windows 的 cmd 下不展开，改走 `scripts/install_ext.js`，默认装 Positron 并带 `--force`

### v2.3.5

- **修复**：`.qmd` 代码块运行结果缺少 `## ` 行首 — `## ` 是 knitr 的约定而非 Quarto 的，Quarto 直接渲染成 AST 故无此前缀；`lib/quarto.js` 在编译产物上补回，并排除嵌套列表、保留缩进块内空行与列对齐缩进

### v2.3.4

- **修正**：市场标题与描述统一为「一键发布公众号/知乎」，不再使用「一键导出微信/知乎」

### v2.3.3

- **新增**：流程图支持 — `mermaid` 代码块与 `DiagrammeR::grViz` 自动渲染为高清 PNG（3x），复制微信与发布知乎均可用；本地渲染无需联网，失败自动保留源码块

### v2.3.2

- **修复**：微信代码块空格被编辑器吞掉 — `applyCodeBlocksForWechat` 中空格转 `&nbsp;`，保留缩进和参数间距
- **修复**：知乎多次发布图片顺序错位 — 增加 HTML 图片数与本地图片数的数量校验，上传改用独立索引追踪

### v2.3.1

- **新增**：R Markdown (.Rmd) 支持 — 编译、预览、复制微信、发布知乎全部可用
- **改善**：`resolveMdFilePath` 用 `isCompilableFile()` 统一判断，消除逐个扩展名对比
- **文档**：更新 readme 标题、描述、快速开始等关键位置，补全 Rmd 说明

### v2.2.2

- **修复**：知乎块公式居中 — `alt` 中 `\\` 移到末尾（知乎居中约定），修复 v2.2.1 修复不完整的问题

### v2.2.1

- **修复**：知乎发布块公式未居中 — 给块公式 `<p>` 容器补上 `text-align: center`

### v2.2.0

- **新增**：Jupyter Notebook (.ipynb) 支持 — 编译、预览、复制微信、发布知乎全部可用
- **新增**：Notebook 编辑器工具栏集成 — 在 notebook 视图中直接点击预览按钮
- **新增**：动态扩展名适配 — 输出路径、条件判断等统一适配 `.md` / `.qmd` / `.ipynb`
- **清理**：移除未使用的 `scripts/zhihu_login.js` 和 `scripts/xhs_screenshot.py`

### v2.1.1

- **修复**：知乎首次登录后发布失败 — 登录和发布合并为同一进程、同一浏览器，消除跨进程 cookie 注入失败
- **修复**：换文件后需要重新知乎登录 — `setCookies` 改用 VS Code Memento `update()` API
- **修复**：知乎 cookie 子域问题 — 强制 `domain: .zhihu.com`

### v2.1.0

- **发布知乎**：接入 markdown2anything 3.0 Playwright 浏览器自动化方案
  - 图片通过知乎编辑器文件上传控件直接传图，不再调用失效的 API
  - 发布流程：自动填标题 → 粘贴正文 → 上传图片 → 停在前端核对
- **新增**：Quarto 编译缓存跨会话复用，源文件未修改时不再重复编译
- **移除**：小红书全套功能（公众号/知乎之外的平台）、上传公众号、导出 HTML、复制知乎
- **精简**：主题从 10 套精简到 6 套
- **修复**：公众号代码块右对齐问题、知乎代码块语言识别 bug
