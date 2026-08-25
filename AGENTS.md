# AGENTS.md

Compact guide for OpenCode sessions. The authoritative, detailed reference is `CLAUDE.md` — read it before deep work. This file captures only facts an agent would otherwise guess wrong.

## Commands

- **No test suite, no lint, no typecheck.** Verify changes by manual F5 debugging (VS Code) or `npm run start:electron`; for packaging, `npm run package` (runs `vsce package`).
- `npm install` → then F5 in VS Code launches the extension debug host.
- `npm run install-ext` builds the `.vsix` and installs it locally.
- `npm run publish` pushes to VS Code Marketplace (requires publisher auth).
- Electron: `npm run start:electron`, `npm run build:mac`, `npm run build:mac:universal`.
- Releases are CI-driven: pushing a `v*` tag runs `.github/workflows/release.yml` (`npm ci && npx vsce package`, Node 20). No manual build step needed for release.
- **Release order (strict)**: bump version → update README → commit+push → push `v*` tag（GitHub Release）→ 确认 Release 无误后**最后**才 `npm run publish` 发市场。市场说明页取发布时的 README，先发市场会带旧说明。

## Architecture

Dual-target project: VS Code extension (`extension.js`, `main: ./extension.js`) and a standalone Electron app (`electron/main.js`). Both share the core library `lib/converter.js` — do not fork platform-specific logic into one target unless necessary.

Conversion pipeline (single pass, order matters):
`gray-matter` (frontmatter) → `marked` + KaTeX (MD→HTML + math) → `cheerio` (image→base64, code highlight, formula post-processing) → `juice` (CSS inlining, export/copy mode only) → platform-specific HTML.

## Module map (verified exports)

- `lib/converter.js` — `renderMarkdown`, `renderQuarto`, `buildFullHtml`, `buildWechatCopyHtml`, `buildZhihuCopyHtml`, `buildXhsCopyHtml`, `convertMarkdownToWeChat`, `buildXhsRenderHtml`.
- `lib/themes.js` — `THEMES` (6: wechat/claude/macos/zhihu/monochrome/notion), `DEFAULT_THEME_ID`, `getTheme`.
- `lib/social.js` — `login`, `publish`, `resume`, `loginAndPublish`, cookie helpers (`getCookies`/`setCookies`/`clearCookies`/`cookieStatus`).
- `lib/quarto.js` — `compile`, `extractFrontmatter`, `findOutputMd`, cache helpers (`getCached`/`setCache`/`clearCache`/`isCacheValid`).
- `lib/zhihu.js` — legacy HTTP API path (md5 pre-check → ali-oss upload). **Not the primary flow**; browser automation via `social.js` + `scripts/social_worker.js` is primary. Keep it working, but new 知乎 features go through the browser path.

## Gotchas

- **Child-process scripts are standalone**: `scripts/social_worker.js` and `scripts/xhs_screenshot.js` run via `child_process.spawn(process.execPath, [script, ...])` — not imported. Communicate via stdout line protocol (`INFO:`, `PROGRESS:`, `READY_TO_PUBLISH`, `PUBLISHED:`, `ERROR:`, `COOKIES_SAVED`, `NEED_INSTALL`, `DIAG:`).
- **Cookies live in VS Code `globalState`** (never on disk). `social.js` runs in the extension host where Memento is available.
- **Quarto CLI is a hard prerequisite** for `.qmd`/`.Rmd`/`.ipynb` (spawns `quarto render --to gfm`). Compile cache in lib/quarto.js skips re-compile when the source hash is unchanged — clear it if you change compile logic and see stale output.
- **`.ipynb` workflow**: user must Run All in the notebook editor and save first, then compile/preview reads saved outputs.
- **Templates**: user can override `templates/wechat.html` by placing `templates/<name>.html` in the workspace root; `qmd2any.template` config selects it, `{{body}}` is the content placeholder.
- **Config namespace** `qmd2any.*` (`appid`, `appSecret`, `author`, `digest`, `template`, `outputPath`). `appSecret` is a secret — never log it. Electron persists config to `userData/config.json` instead.
- **WeChat draft upload** uses the external FastPen API (`POST /api/draft/multi/import-markdown`).
- Run `npm run package` before claiming a `.vsix` build works; the built artifact name embeds the version from `package.json` (e.g. `qmd2any-2.3.2.vsix`).

## Doc priority

`CLAUDE.md` is kept current and detailed — treat it as the spec. If it conflicts with code, trust the code and update `CLAUDE.md`.