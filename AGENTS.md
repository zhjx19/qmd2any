# AGENTS.md

Compact guide for OpenCode sessions. The authoritative, detailed reference is `CLAUDE.md` — read it before deep work. This file captures only facts an agent would otherwise guess wrong.

## Commands

- **No test suite, no lint, no typecheck.** Verify changes by manual F5 debugging (VS Code) or `npm run start:electron`; for packaging, `npm run package` (runs `vsce package`).
- `npm install` → then F5 in VS Code launches the extension debug host.
- `npm run install-ext` builds the `.vsix` and installs it locally.
- `npm run publish` pushes to VS Code Marketplace (requires publisher auth). **日常发版不需要手动跑它** —— 推 tag 后 CI 自动发（见下）。
- Electron: `npm run start:electron`, `npm run build:mac`, `npm run build:mac:universal`.
- Releases are CI-driven: pushing a `v*` tag runs `.github/workflows/release.yml` (Node 20). No manual build step needed.
- **发布链路（自动，2026-10 起）**：`release.yml` 两个 job —— `build` 打包并建 GitHub Release，把 `.vsix` 作为 artifact 传给 `publish`；`publish` 用 `vsce publish --packagePath` 把**同一个** vsix 发到市场（只构建一次，市场与 Release 字节一致）。`needs: build` 保证打包失败就不发布。
- **一次性配置**：仓库 Settings → Secrets and variables → Actions → New repository secret，`name = VSCE_PAT`，`value = Azure DevOps 的 PAT`。没配的话 `publish` job 会以可操作的报错退出（不会抛 vsce 那种看不懂的鉴权错误）。
- **Release order（strict）**：bump version → 更新 README → commit+push → **推 `v*` tag（这一步就是人工确认闸门）** → CI 自动建 Release + 发市场 → 核对市场页。市场说明页取 tag 那一刻的 README，所以 README 必须在推 tag 之前提交。
- **版本号必须每次递增**：Marketplace 不允许覆盖已发布版本，`vsce publish` 会直接失败（`Version X is already published`）。发版前先查市场当前版本。
- **分支是 `master`，不是 `main`**。AGENTS.md 早期版本写错过，别照着写 `origin/main`。
- **重跑已失败的发布**：Actions 里 Re-run failed job 即可；Marketplace 若已存在该版本号则无法重发，只能 bump 再发。

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
- **发版前清一遍根目录**：临时脚本会被 vsce 打进包里（已踩过：排查凭证用的 `check-pat.js` 进了 2.3.5）。`.vscodeignore` 已兜底 `tmp*/ scratch/ check-*.js verify-*.js debug*.js`，但 `git status` 里出现未跟踪文件就要先删掉再发。
- **`git add` 的 pathspec 对索引大小写敏感**：Windows 文件系统不区分大小写，但索引里记的是 `README.md`，所以 `git add readme.md` 会**静默什么都不暂存** —— 不报错，`git commit` 照样成功。commit 前照索引里的原样写大小写；不确定就先 `git status` 看暂存区（`git diff --cached --stat`）确认。真实踩过：release 提交漏掉 README，发布前 `git status` 冒出 `M README.md` 才发现。
- **市场 PAT 获取**：Azure DevOps 门户（https://dev.azure.com）→ 选组织 → 头像旁的 User settings 下拉 → **Personal access tokens** → **New Token**。关键三项：**Organization 必须选 `All accessible organizations`**（选具体组织会导致 403）、Scopes 选 `Custom defined` → 点 **Show all scopes** → 找到 **Marketplace** 勾 **Manage**、Expiration 尽量调长。
- **PAT 的三种用法**（`publish.js` 的解析顺序：`--pat`/`VSCE_PAT` → `--azure-credential` → 已存 publisher 凭证）：
  1. `npx vsce login ZhangJingxin` —— 交互式输入并存到 `%APPDATA%\vsce\publishers.txt`，之后 `vsce publish` 自动读取。**推荐**：token 不进 shell 历史也不进对话。
  2. `npx vsce verify-pat ZhangJingxin` —— 预检凭证是否真有发布权限。**推 tag / 发市场前先跑这个**，别等 vsce 抛鉴权错误（`vsce login` 本身不验证，只存）。
  3. `$env:VSCE_PAT='<token>'; npm run publish` —— 一次性本地发版用。
- **⚠️ Azure DevOps 全局 PAT 将于 2026-12-01 退役**。CI 里的 `VSCE_PAT` 只是把 PAT 挪进 GitHub Secrets，**并不能绕过这个期限**。到期前需迁到 Microsoft Entra ID + workload identity federation（`vsce publish --azure-credential`，需 vsce ≥ 2.26.1），参照官方文档 "Secure automated publishing" 一节；那套需要 Azure 订阅 + 托管标识 + 在市场把该标识加为发布者 Contributor。

## Doc priority

`CLAUDE.md` is kept current and detailed — treat it as the spec. If it conflicts with code, trust the code and update `CLAUDE.md`.