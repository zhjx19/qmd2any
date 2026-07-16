# QMD2Any — Quarto / Markdown / Notebook 一键导出微信 & 知乎

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Install-2d7a3e?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZhangJingxin.qmd2any)
[![GitHub Release](https://img.shields.io/github/v/release/zhjx19/qmd2any?logo=github&label=Release)](https://github.com/zhjx19/qmd2any/releases/latest)

> 🔌 Forked from [markdown2anything](https://github.com/marsggbo/markdown2anything) v3.0（by [@marsggbo](https://github.com/marsggbo)）
> — 在原有 Markdown → 微信/知乎 管线的基础上，新增 **Quarto (.qmd) 和 Jupyter Notebook (.ipynb) 一键编译发布**支持。

---

将 Markdown / Quarto (.qmd) / Jupyter Notebook (.ipynb) 文章一键渲染并导出到微信公众号和知乎，支持 **LaTeX 公式**、**6 套内置主题**、**实时预览**、**一键复制微信**、**Quarto 编译集成**和 **Playwright 浏览器自动化发布知乎**。

支持两种形态：**VS Code 插件** 和 **独立桌面客户端**（Electron），互不依赖，按需选择。

---

## ⚠️ 免责声明

- 本项目是 [markdown2anything](https://github.com/marsggbo/markdown2anything) 的衍生作品，遵循 MIT 许可证。
- **知乎发布功能**使用 Playwright 浏览器自动化方案，你的 Cookie 仅存储在本地 VS Code 存储中，不会上传至任何服务器。
- 请遵守各平台（微信公众号、知乎）的使用条款，勿用于发布违规内容。
- 本项目作者对因使用本工具产生的任何后果不承担责任。

---

## 🆕 v2.2.0 更新

| 功能 | 说明 |
|------|------|
| 📓 **Jupyter Notebook 支持** | `.ipynb` 文件可像 `.qmd` 一样编译、预览、发布，自动编译通过 Quarto 完成 |
| 🔧 **Notebook 编辑器集成** | 在 VS Code notebook 编辑器中直接点击工具栏按钮即可预览/发布 |
| 📋 **动态文件类型适配** | 预览、编译、输出路径等逻辑统一适配 `.md` / `.qmd` / `.ipynb` 三种扩展名 |
| 🧹 **清理** | 移除未使用的 `zhihu_login.js` 和 `xhs_screenshot.py`；修正文档中过时的主题数量描述 |

### 使用 .ipynb 的注意事项

- 打开 `.ipynb` 后先在 notebook 编辑器中 **Run All** 运行所有单元格，然后保存——代码输出会写入 `.ipynb` 文件
- 再点击编译按钮，Quarto 会读取已保存的输出并渲染到预览面板
- `.ipynb` 支持与 `.md` / `.qmd` 完全相同的功能：预览、复制微信、发布知乎

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 🐧 **复制微信** | 一键复制带内联样式的 HTML，公式转 SVG，代码高亮保留，直接粘贴到微信公众号编辑器 |
| 🚀 **发布知乎** | 扫码登录后，自动打开浏览器 → 填标题 → 粘贴正文 → 上传图片 → 停在你面前，核对后点击「发布」 |
| 🎨 **6 套内置主题** | 微信经典 / Claude / macOS / 知乎精选 / 极简黑白 / Notion |
| 📐 **LaTeX 公式渲染** | 支持行内公式 `$...$` 和独立公式块 `$$...$$`，基于 KaTeX 渲染 |
| 👁️ **实时预览面板** | 在编辑器右侧打开独立预览窗口，文件保存时自动刷新（`.md`/`.qmd`），编译后刷新（`.ipynb`/`.qmd`） |
| 🎨 **在线样式编辑** | 通过主题下拉菜单中的「自定义样式...」打开 CSS 编辑器，实时修改，所见即所得 |
| 🔄 **Quarto 编译集成** | `.qmd` / `.ipynb` 一键编译为 Markdown，执行 R/Python 代码块，渲染图表、表格 |
| 📓 **Notebook 支持** | `.ipynb` 文件可直接在 VS Code notebook 编辑器中运行后编译预览 |

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

### Quarto (.qmd) 或 Notebook (.ipynb) 文件

1. 在 VS Code 中打开 `.qmd` 或 `.ipynb` 文件
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
│   ├── zhihu.js          # 知乎发布 HTML 构建
│   ├── social.js         # Playwright 浏览器自动化发布调度
│   └── quarto.js         # Quarto 编译集成 + 缓存管理
├── electron/             # Electron 客户端
│   ├── main.js
│   ├── preload.js
│   └── renderer/
├── scripts/
│   ├── social_worker.js  # 浏览器自动化 Worker（知乎/小红书/Twitter）
│   └── xhs_screenshot.js # 小红书截图导出（桌面客户端用）
├── templates/
│   └── wechat.html       # 默认微信模板
└── README.md
```

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
