# QMD2Any — Quarto / Markdown 一键导出微信 & 知乎

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Install-2d7a3e?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZhangJingxin.qmd2any)
[![GitHub Release](https://img.shields.io/github/v/release/zhjx19/qmd2any?logo=github&label=Release)](https://github.com/zhjx19/qmd2any/releases/latest)

> 🔌 Forked from [markdown2anything](https://github.com/marsggbo/markdown2anything) v3.0（by [@marsggbo](https://github.com/marsggbo)）
> — 在原有 Markdown → 微信/知乎/小红书 管线的基础上，新增 **Quarto (.qmd) 一键编译发布**支持。

---

将 Markdown / Quarto (.qmd) 文章一键渲染并导出到微信公众号和知乎，支持 **LaTeX 公式**、**6 套内置主题**、**实时预览**、**一键复制微信**、**Quarto 编译集成**和 **Playwright 浏览器自动化发布知乎**。

支持两种形态：**VS Code / Positron 插件** 和 **独立桌面客户端**（Electron），互不依赖，按需选择。

---

## ⚠️ 免责声明

- 本项目是 [markdown2anything](https://github.com/marsggbo/markdown2anything) 的衍生作品，遵循 MIT 许可证。
- **知乎发布功能**使用 Playwright 浏览器自动化方案，你的 Cookie 仅存储在本地 VS Code / Positron 存储中，不会上传至任何服务器。
- 请遵守各平台（微信公众号、知乎）的使用条款，勿用于发布违规内容。
- 本项目作者对因使用本工具产生的任何后果不承担责任。

---

## 🆕 QMD2Any 新增功能（v2.1.0）

| 功能 | 说明 |
|------|------|
| 🔄 **Quarto 编译** | 一键将 `.qmd` 编译为中间 Markdown，自动执行 R/Python 代码块、渲染图表 |
| 🚀 **知乎浏览器发布** | 接入 markdown2anything 3.0 方案，通过 Playwright 真实浏览器自动填内容、传图片、发布 |
| 📊 **图片自动上传** | 知乎发布时自动通过浏览器文件上传控件传图，不再依赖失效的 API / CDN URL 猜测 |
| 💾 **Quarto 编译缓存** | 编译产物跨会话复用，`.qmd` 未修改时不重复编译 |

### 与 markdown2anything 2.0 的区别

- **发布知乎**：从 API 调用方案改为 Playwright 浏览器自动化，图片通过知乎编辑器自己的上传通道传图（不再调用 `api.zhihu.com/images`）
- **Quarto**：仅支持**单文件 .qmd**（不支持 book 项目）

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 🐧 **复制微信** | 一键复制带内联样式的 HTML，公式转 SVG，代码高亮保留，直接粘贴到微信公众号编辑器 |
| 🚀 **发布知乎** | 扫码登录后，自动打开浏览器 → 填标题 → 粘贴正文 → 上传图片 → 停在你面前，核对后点击「发布」 |
| 🎨 **6 套内置主题** | 微信经典 / Claude / macOS / 知乎精选 / 极简黑白 / Notion |
| 📐 **LaTeX 公式渲染** | 支持行内公式 `$...$` 和独立公式块 `$$...$$`，基于 KaTeX 渲染 |
| 👁️ **实时预览面板** | 在编辑器右侧打开独立预览窗口，文件保存时自动刷新 |
| 🎨 **在线样式编辑** | 通过主题下拉菜单中的「自定义样式...」打开 CSS 编辑器，实时修改，所见即所得 |
| 🔄 **Quarto 编译集成** | 一键将 .qmd 编译为 Markdown，执行 R/Python 代码块，渲染图表 |

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

# 或安装到 Positron
positron --install-extension qmd2any-*.vsix
```

### 方式三：从源码安装（开发模式）

```bash
git clone https://github.com/<your-username>/qmd2any.git
cd qmd2any
npm install
code .   # 按 F5 启动调试
```

### 方式二：安装 VSIX 包

```bash
# 打包扩展
npm install -g @vscode/vsce
vsce package

# 安装到 Positron
positron --install-extension qmd2any-2.1.0.vsix

# 或安装到 VS Code
code --install-extension qmd2any-2.1.0.vsix
```

---

## 快速开始

### Markdown 文件

1. 在 VS Code / Positron 中打开任意 `.md` 文件
2. 点击编辑器右上角的预览按钮（或 `Ctrl+Shift+W`）
3. 右侧弹出实时预览面板

### Quarto (.qmd) 文件（🆕）

1. 在 Positron 中打开 `.qmd` 文件
2. 点击编辑器右上角的预览按钮（或 `Ctrl+Shift+W`）
3. 预览面板打开，点击状态栏的 **「🔄 编译」**
4. Quarto 执行代码块、渲染图表 → 预览自动刷新
5. 编译完成后，所有功能均可用
6. 再次打开时，若 `.qmd` 未修改，直接使用编译缓存，无需重复编译

> **Quarto 文件只需要最简 YAML frontmatter：**
> ```yaml
> ---
> title: "文章标题"
> format: html
> ---
> ```
> 只需要 `title` 和 `format: html` 两个字段即可。不需要配置 `_quarto.yml` 项目。

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
├── extension.js          # VS Code / Positron 扩展主入口
├── package.json          # 扩展清单 + Electron 脚本
├── lib/
│   ├── converter.js      # 核心转换逻辑（插件/客户端共用）
│   ├── themes.js         # 6 套内置主题定义
│   ├── zhihu.js          # 知乎发布模块（buildPublishHtml + API 工具）
│   ├── social.js         # Playwright 浏览器自动化发布调度
│   └── quarto.js         # Quarto 编译集成
├── electron/             # Electron 客户端
│   ├── main.js
│   ├── preload.js
│   └── renderer/
├── scripts/
│   ├── social_worker.js  # 知乎浏览器自动化 Worker
│   └── zhihu_login.js    # 知乎扫码登录
├── templates/
│   └── wechat.html       # 默认微信模板
└── README.md
```

---

## 工作原理

```
.qmd / .md 文件
    ↓
[.qmd] quarto render --to gfm（执行代码块、渲染图表）
    ↓
中间 .md 文件
    ↓
gray-matter 解析 frontmatter
    ↓
marked + KaTeX 扩展（公式渲染）
    ↓
cheerio 处理（图片 Base64、代码高亮）
    ↓
juice CSS 内联（微信）
    ↓
平台专用 HTML（微信公众号 / 知乎）

--- 知乎发布 ---

buildPublishHtml() → 干净语义化 HTML
listMarkdownLocalImages() → 本地图片路径
    ↓
social.publish() → Playwright 浏览器自动化
    ↓
浏览器填标题 → 分段粘贴正文 → 文件上传控件传图 → Escape 关闭弹窗
    ↓
停在你面前，核对后点击「发布」
```

---

## 版本历史

### v2.1.0

- **发布知乎**：接入 markdown2anything 3.0 Playwright 浏览器自动化方案
  - 图片通过知乎编辑器文件上传控件直接传图，不再调用失效的 `api.zhihu.com/images`
  - 发布流程：自动填标题 → 分段粘贴正文 → 上传图片 → 停在前端核对
- **移除**：「复制知乎」功能（图片上传必须走浏览器，复制粘贴无法自动传图）
- **新增**：Quarto 编译缓存跨会话复用，`.qmd` 未修改时不再重复编译
- **修复**：公众号代码块右对齐问题
- **修复**：知乎代码块语言识别 bug（`extractCodeLang` 正确解析 `hljs python`）
- **简化**：Quarto 仅支持单文件 `.qmd`，项目目录只保留一个编译按钮
- **精简**：移除小红书全套功能、上传公众号、导出 HTML、复制知乎；主题从 10 套精简到 6 套，不适合公众号/知乎的已移除
- **改进**：`buildPublishHtml` 自动去除正文中重复的 h1 标题；修改样式入口并入主题下拉菜单
