# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run package` | Build `.vsix` extension package |
| `npm run start:electron` | Launch Electron desktop app in dev mode |
| `npm run build:mac` | Package macOS `.dmg` (x64) |
| `npm run build:mac:universal` | Package macOS `.dmg` (Intel + Apple Silicon) |
| `npm run publish` | Publish to VS Code Marketplace |
| F5 in VS Code | Launch extension debug host |

There is no test suite in this repository.

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
| [lib/themes.js](lib/themes.js) | Exports `THEMES` array, `DEFAULT_THEME_ID`, `getTheme()`. 10 built-in themes, each with a CSS string and `wrapperBg` color. |
| [lib/zhihu.js](lib/zhihu.js) | Zhihu publishing module. Login verification, two-phase image upload (md5 pre-check → ali-oss upload), article create/update/save-draft. Uses raw `https` module (no axios/fetch). |
| [electron/main.js](electron/main.js) | Electron main process. File open/save dialogs, IPC handlers for rendering and platform copy/export, config persistence to `userData`. |
| [electron/preload.js](electron/preload.js) | Context bridge exposing safe IPC methods to the renderer. |
| [electron/renderer/index.html](electron/renderer/index.html) | Electron renderer: split-pane Markdown editor (CodeMirror) + live preview with 500ms debounce. |
| [scripts/xhs_screenshot.js](scripts/xhs_screenshot.js) | Playwright script for Xiaohongshu image export. Opens HTML in Chromium, full-page screenshot, smart slice at clean rows. Communicates via stdout protocol (`INFO:`, `SAVED:`, `ERROR:`). |
| [scripts/zhihu_login.js](scripts/zhihu_login.js) | Playwright browser automation for Zhihu QR code login. Opens real browser, waits for login, extracts cookies, outputs `COOKIE:<json>`. |
| [templates/wechat.html](templates/wechat.html) | Default HTML wrapper template. Users can override by placing custom `.html` files in their workspace `templates/` directory. |

### Key patterns

- **Extension ↔ Webview**: Typed message passing via `postMessage` (e.g. `{ type: 'getWechatHtml' }`, `{ type: 'update', bodyHtml, title, theme }`). The webview requests platform-specific HTML; the extension builds it server-side and returns it for clipboard copy.
- **Child process scripts**: Playwright scripts are spawned via `child_process.spawn(process.execPath, [scriptPath, ...args])` — they run as standalone Node processes, not imported modules. Communication is via stdout line protocol.
- **Configuration**: VS Code settings under `qmd2any.*` namespace (`appid`, `appSecret`, `author`, `digest`, `template`, `outputPath`). In Electron, persisted to `userData/config.json`.
- **External service**: WeChat draft upload uses the [FastPen](https://www.fastpen.online) API (`POST /api/draft/multi/import-markdown`).

### Extension activation

The extension activates on `onLanguage:markdown` and registers:
- `qmd2any.preview` — opens a Webview panel (right side), 500ms debounced auto-refresh on save
- `qmd2any.convert` — exports inline-styled HTML to `build/wechat.html`

Shortcut: `Cmd+Shift+W` / `Ctrl+Shift+W` while editing a `.md` file.
