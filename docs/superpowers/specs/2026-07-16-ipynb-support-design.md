# .ipynb (Jupyter Notebook) Support Design

**Date**: 2026-07-16
**Status**: Approved
**Scope**: Extend qmd2any to support `.ipynb` files with full parity to `.qmd` — preview, WeChat copy, Zhihu publish.

## Goal

Enable users who author in Jupyter Notebooks (`.ipynb`) to use qmd2any's full pipeline:
Quarto compile `.ipynb` → intermediate `.md` → render/preview → WeChat copy / Zhihu publish.

## Core Insight

`quarto render --to gfm` already supports `.ipynb` input identically to `.qmd`. The existing
`lib/quarto.js` module (`compile`, `isCacheValid`, `getCached`, `extractFrontmatter`) works
on file paths alone — no extension-specific logic. Therefore the entire downstream pipeline
(`renderMarkdown` → cheerio → juice → platform HTML) requires zero changes.

All work is in the **entry layer**: activation, file-type detection, and Notebook editor
adaptation.

## Approach: Generalize "quarto file" to "compilable file"

Replace hardcoded `.qmd` checks with a list of extensions that need Quarto compilation.
Current: `['.qmd', '.ipynb']`. Future: add `.Rmd`, `.rmd`, etc. by appending one string.

### Renames (mechanical, no behavior change)

| Before | After | Reason |
|--------|-------|--------|
| `isQuartoFile()` | `isCompilableFile()` | Checks any extension needing Quarto compile |
| `updateQuartoPreview()` | `updateCompilablePreview()` | Handles any compilable source |
| `quartoMode` / `isQuarto` (messages) | `compilableMode` / `isCompilable` | Frontend flag for status bar visibility |
| `quarto-status-bar` (DOM id) | `compilable-status-bar` | UI element ID |

### Kept as-is (these describe the *action*, not the *identity*)

- `quartoStatus`, `quartoCompile`, `quartoCompileProgress`, `quartoCompileDone`, `quartoCompileError` — message types
- `renderQuarto()` — still renders the product of a Quarto compilation
- `lib/quarto.js` — module still orchestrates `quarto render`

## Files Changed

### 1. `package.json` (3 changes)

**1a. Activation event**
```json
"activationEvents": [
  "onLanguage:markdown",
  "onLanguage:quarto",
  "onNotebook:jupyter-notebook"
]
```

**1b. Menu `when` clauses**

VS Code notebook editors use different context keys than text editors.
The `when` clause needs both text-editor and notebook paths:

| Menu location | Before | After |
|---|---|---|
| `editor/title` | `resourceLangId == markdown \|\| resourceLangId == quarto` | `resourceLangId == markdown \|\| resourceLangId == quarto \|\| notebookType == jupyter-notebook` |
| `explorer/context` (both) | `resourceExtname == .md \|\| resourceExtname == .qmd` | `resourceExtname == .md \|\| resourceExtname == .qmd \|\| resourceExtname == .ipynb` |
| `editor/context` | `resourceLangId == markdown \|\| resourceLangId == quarto` | `resourceLangId == markdown \|\| resourceLangId == quarto \|\| notebookType == jupyter-notebook` |

Note: `resourceLangId` is not set for notebook editors. Notebook editors expose
`notebookType` (e.g. `jupyter-notebook`) instead. Explorer menus use `resourceExtname`
which works uniformly for both editor types.

**1c. Keybinding `when` clause**
```
resourceLangId == markdown || resourceLangId == quarto || notebookType == jupyter-notebook
```

### 2. `extension.js` (core changes)

**2a. `isCompilableFile()` replaces `isQuartoFile()`**
```js
const COMPILABLE_EXTENSIONS = ['.qmd', '.ipynb'];

function isCompilableFile(filePath) {
  return COMPILABLE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}
```

**2b. `resolveMdFilePath()` — Notebook editor entry**

VS Code's Notebook editor uses `NotebookEditor`, not `TextEditor`. We need to extract
the `.ipynb` file path from `activeNotebookEditor`:

```js
async function resolveMdFilePath(uri) {
  // From right-click menu or command palette with explicit URI
  if (uri && uri.fsPath) {
    if (uri.fsPath.endsWith('.ipynb')) return uri.fsPath;
    if (!uri.fsPath.endsWith('.md') && !uri.fsPath.endsWith('.qmd')) {
      vscode.window.showErrorMessage('请选择 Markdown (.md)、Quarto (.qmd) 或 Notebook (.ipynb) 文件');
      return null;
    }
    return uri.fsPath;
  }

  // No URI — get from active editor (could be TextEditor or NotebookEditor)
  const activeTextEditor = vscode.window.activeTextEditor;
  if (activeTextEditor) {
    const doc = activeTextEditor.document;
    if (doc.languageId === 'markdown' || doc.languageId === 'quarto') {
      return doc.uri.fsPath;
    }
    // .ipynb opened as text file (not notebook) — languageId is 'json'/'jsonc'
    if (doc.uri.fsPath.endsWith('.ipynb')) return doc.uri.fsPath;
  }

  const notebookEditor = vscode.window.activeNotebookEditor;
  if (notebookEditor) {
    const nbUri = notebookEditor.notebook.uri;
    if (nbUri.fsPath.endsWith('.ipynb')) return nbUri.fsPath;
  }

  vscode.window.showErrorMessage('请打开 Markdown (.md)、Quarto (.qmd) 或 Notebook (.ipynb) 文件');
  return null;
}
```

**2c. `renderForPlatform()`** — `isQuartoFile` → `isCompilableFile`. Error message updated to mention both extensions.

**2d. `updatePreview()`** — `isQuartoFile` → `isCompilableFile`, delegates to renamed `updateCompilablePreview()`.

**2e. `updateCompilablePreview()`** — renamed from `updateQuartoPreview()`. Sends `isCompilable: true` instead of `isQuarto: true`.

**2f. Webview message handling** — all `isQuartoFile(mdPath)` → `isCompilableFile(mdPath)`:
- `case 'ready'`: sends `compilableMode` instead of `quartoMode`
- `case 'quartoCompile'`: guard check updated; error message mentions both extensions
- `zhihuPublish` / `zhihuSaveDraft`: image path resolution (line 443, 530) updated

**2g. `renderQuarto()` in `lib/converter.js`** — `path.basename(qmdPath, '.qmd')` → `path.basename(qmdPath, path.extname(qmdPath))` so the fallback title strips the correct extension.

**2h. Document change listener** — no change needed. Notebook cell edits don't fire `onDidChangeTextDocument`, so `.ipynb` files won't trigger auto-refresh. Users click "Compile" to update (same UX as `.qmd`).

**2i. Webview HTML renderer** — rename DOM IDs: `quarto-status-bar` → `compilable-status-bar`, `quarto-status-msg` → `compilable-status-msg`. Update JS message handlers: `quartoMode` → `compilableMode`, `isQuarto` → `isCompilable`.

### 3. `electron/main.js` (mirror of extension.js)

Same replacements as extension.js (~6 occurrences):
- `isQuartoFile()` → `isCompilableFile()`
- `updateQuartoPreview()` → `updateCompilablePreview()`
- `quartoMode` → `compilableMode`, `isQuarto` → `isCompilable`
- `quartoCompile` guard message updated
- Image path resolution updated
- Startup mode notification updated

### 4. `lib/converter.js` (1 change)

`renderQuarto()`: `path.basename(qmdPath, '.qmd')` → `path.basename(qmdPath, path.extname(qmdPath))`.

### 5. `lib/quarto.js` — ZERO changes

`compile()`, `isCacheValid()`, `getCached()`, `extractFrontmatter()` all operate on file paths
agnostically. `quarto render file.ipynb --to gfm` works identically to `.qmd`.

### 6. `lib/themes.js`, `lib/zhihu.js`, `lib/social.js` — ZERO changes

These consume rendered `bodyHtml` and never inspect the source file type.

## .ipynb User Experience

| Action | Behavior |
|--------|----------|
| Open `.ipynb` as Notebook → right-click → Preview | Opens preview panel, shows "Please compile first" + compile button |
| Click "🔄 Compile" | `quarto render file.ipynb --to gfm`, progress streamed to status bar, auto-refresh on success |
| Edit cells after compile | Preview does NOT auto-refresh (Notebook API doesn't fire text change events). User re-clicks compile |
| `Ctrl+Shift+W` in Notebook | Triggers via toolbar button (keybinding fires if `when` includes notebook context) |
| Cache | Per-source-file, `.ipynb` and `.qmd` caches are independent, stored in same `Map` |
| Switch files | Same behavior as `.qmd` — new file gets its own preview panel and cache |
| WeChat copy | Works identically — `quarto render` produces standard `.md`, then existing pipeline runs |
| Zhihu publish | Works identically — login → browser fills title/body/images → user confirms |
| Frontmatter | Extracted from `.ipynb` metadata by `gray-matter` (Quarto writes YAML into the compiled `.md`) |

## Non-Goals

- Parsing `.ipynb` JSON (cell structure, outputs) — delegated to Quarto CLI
- Rendering notebook outputs (plots, tables) inline — Quarto handles this during compilation
- Multi-notebook / Quarto book projects — same scope limitation as `.qmd` (single file only)
- Auto-compile on cell edit — Notebook API differs from TextDocument API; manual compile is consistent with `.qmd` UX

## Backward Compatibility

All changes are pure extensions. `.qmd` behavior is unchanged at every code path.
The rename from `isQuartoFile` to `isCompilableFile` is a mechanical substitution — the
underlying logic for `.qmd` remains identical: check extension, validate cache, render.

## Future Extensibility

Adding another Quarto-compatible format (e.g., `.Rmd`):

1. Add extension to `COMPILABLE_EXTENSIONS` array in `extension.js` and `electron/main.js`
2. Add activation event if it uses a different editor type
3. Update `when` clauses in `package.json`
4. Done — no further code changes needed.
