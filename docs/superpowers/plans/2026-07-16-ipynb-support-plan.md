# .ipynb (Jupyter Notebook) Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend qmd2any to support `.ipynb` files with full parity to `.qmd` — preview, WeChat copy, Zhihu publish — by generalizing hardcoded `.qmd` checks to a compilable-file abstraction.

**Architecture:** Replace `isQuartoFile()` with `isCompilableFile()` (checks `['.qmd', '.ipynb']`), adapt `resolveMdFilePath()` to extract paths from VS Code NotebookEditor, update `when` clauses for notebook context keys. The Quarto compilation pipeline (`lib/quarto.js`) and render pipeline (`lib/converter.js`) need zero logic changes.

**Tech Stack:** Vanilla JS (Node.js), VS Code Extension API, Electron IPC

## Global Constraints

- `.qmd` behavior must not change at any code path
- `lib/quarto.js`, `lib/themes.js`, `lib/zhihu.js`, `lib/social.js` — zero changes
- No auto-refresh on notebook cell edits (not supported by Notebook API)
- Single-file only (no Quarto book projects)

---

### Task 1: `package.json` — activation, menus, keybindings

**Files:**
- Modify: `package.json:45-100`

**Interfaces:**
- Produces: Extension activates for `jupyter-notebook` notebooks; menu/keybinding `when` clauses include `.ipynb` and `notebookType == jupyter-notebook`

- [ ] **Step 1: Add `onNotebook:jupyter-notebook` activation event**

In `package.json` line 45-48, change:

```json
"activationEvents": [
  "onLanguage:markdown",
  "onLanguage:quarto"
],
```

To:

```json
"activationEvents": [
  "onLanguage:markdown",
  "onLanguage:quarto",
  "onNotebook:jupyter-notebook"
],
```

- [ ] **Step 2: Update `editor/title` menu `when` clause**

In `package.json` line 71, change:

```json
"when": "resourceLangId == markdown || resourceLangId == quarto",
```

To:

```json
"when": "resourceLangId == markdown || resourceLangId == quarto || notebookType == jupyter-notebook",
```

- [ ] **Step 3: Update `explorer/context` menu `when` clauses (both commands)**

In `package.json` line 78, change:

```json
"when": "resourceExtname == .md || resourceExtname == .qmd",
```

To:

```json
"when": "resourceExtname == .md || resourceExtname == .qmd || resourceExtname == .ipynb",
```

In `package.json` line 83, change:

```json
"when": "resourceExtname == .md || resourceExtname == .qmd",
```

To:

```json
"when": "resourceExtname == .md || resourceExtname == .qmd || resourceExtname == .ipynb",
```

- [ ] **Step 4: Update `editor/context` menu `when` clause**

In `package.json` line 90, change:

```json
"when": "resourceLangId == markdown || resourceLangId == quarto",
```

To:

```json
"when": "resourceLangId == markdown || resourceLangId == quarto || notebookType == jupyter-notebook",
```

- [ ] **Step 5: Update keybinding `when` clause**

In `package.json` line 100, change:

```json
"when": "resourceLangId == markdown || resourceLangId == quarto"
```

To:

```json
"when": "resourceLangId == markdown || resourceLangId == quarto || notebookType == jupyter-notebook"
```

- [ ] **Step 6: Verify package.json is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "feat: add .ipynb activation, menu, and keybinding entries"
```

---

### Task 2: `extension.js` — `isCompilableFile()` and mechanical renames

**Files:**
- Modify: `extension.js:16-18` (definition), `extension.js:93,220,242,273,274,281,443,530` (call sites)

**Interfaces:**
- Produces: `isCompilableFile(filePath)` returns `true` for `.qmd` and `.ipynb`; all internal renames done

- [ ] **Step 1: Replace `isQuartoFile()` definition with `isCompilableFile()`**

In `extension.js` lines 15-18, change:

```js
/** @param {string} filePath @returns {boolean} */
function isQuartoFile(filePath) {
  return filePath.endsWith('.qmd');
}
```

To:

```js
const COMPILABLE_EXTENSIONS = ['.qmd', '.ipynb'];

/** @param {string} filePath @returns {boolean} */
function isCompilableFile(filePath) {
  return COMPILABLE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}
```

- [ ] **Step 2: Replace `isQuartoFile` → `isCompilableFile` at all call sites**

Run search-and-replace across `extension.js` (7 occurrences, excluding the definition):

```
isQuartoFile → isCompilableFile
```

All occurrences are at lines 93, 220, 273, 281, 443, 530.

- [ ] **Step 3: Update error message in `renderForPlatform()`**

In `extension.js` line 95, change:

```js
throw new Error('请先点击「🔄 编译」用 Quarto 编译 .qmd 文件');
```

To:

```js
throw new Error('请先点击「🔄 编译」用 Quarto 编译文件');
```

- [ ] **Step 4: Update error message in `quartoCompile` guard**

In `extension.js` line 282, change:

```js
panel.webview.postMessage({ type: 'quartoCompileError', message: '当前文件不是 .qmd 格式' });
```

To:

```js
panel.webview.postMessage({ type: 'quartoCompileError', message: '当前文件不是 .qmd 或 .ipynb 格式' });
```

- [ ] **Step 5: Rename `updateQuartoPreview` → `updateCompilablePreview`**

In `extension.js` line 221, change:

```js
updateQuartoPreview(panel, mdPath);
```

To:

```js
updateCompilablePreview(panel, mdPath);
```

In `extension.js` line 236, change:

```js
function updateQuartoPreview(panel, qmdPath) {
```

To:

```js
function updateCompilablePreview(panel, qmdPath) {
```

- [ ] **Step 6: Rename `isQuarto` → `isCompilable` in postMessage calls**

In `extension.js` line 242, change:

```js
panel.webview.postMessage({ type: 'update', bodyHtml, title, isQuarto: true, theme: ... });
```

To:

```js
panel.webview.postMessage({ type: 'update', bodyHtml, title, isCompilable: true, theme: ... });
```

- [ ] **Step 7: Rename `quartoMode` → `compilableMode` in postMessage calls**

In `extension.js` line 274, change:

```js
panel.webview.postMessage({ type: 'quartoMode', isQuarto: true });
```

To:

```js
panel.webview.postMessage({ type: 'compilableMode', isCompilable: true });
```

- [ ] **Step 8: Commit**

```bash
git add extension.js
git commit -m "refactor: generalize isQuartoFile to isCompilableFile for .ipynb support"
```

---

### Task 3: `extension.js` — `resolveMdFilePath()` Notebook editor support

**Files:**
- Modify: `extension.js:111-126`

**Interfaces:**
- Consumes: `isCompilableFile()` from Task 2
- Produces: `resolveMdFilePath()` returns `.ipynb` paths from both NotebookEditor and TextEditor

- [ ] **Step 1: Replace `resolveMdFilePath()`**

In `extension.js` lines 111-126, replace the entire function:

```js
async function resolveMdFilePath(uri) {
  if (uri && uri.fsPath) {
    if (!uri.fsPath.endsWith('.md') && !uri.fsPath.endsWith('.qmd')) {
      vscode.window.showErrorMessage('请选择 Markdown (.md) 或 Quarto (.qmd) 文件');
      return null;
    }
    return uri.fsPath;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('请先打开一个 Markdown 文件');
    return null;
  }
  if (editor.document.languageId !== 'markdown' && editor.document.languageId !== 'quarto') {
    vscode.window.showErrorMessage('当前文件不是 Markdown 或 Quarto 格式');
    return null;
  }
  return editor.document.uri.fsPath;
}
```

With:

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

- [ ] **Step 2: Update `quartoStatus` message to mention .ipynb**

In `extension.js` line 251 (inside `updateCompilablePreview()`), change:

```js
message: '请先点击「🔄 编译」用 Quarto 将 .qmd 编译为 Markdown',
```

To:

```js
message: '请先点击「🔄 编译」用 Quarto 编译文件',
```

- [ ] **Step 3: Commit**

```bash
git add extension.js
git commit -m "feat: add NotebookEditor path resolution for .ipynb files"
```

---

### Task 4: `extension.js` — webview HTML DOM IDs and JS handlers

**Files:**
- Modify: `extension.js:998-1056` (CSS and HTML), `extension.js:1259-1265` (compile button), `extension.js:1435-1489` (message handlers)

**Interfaces:**
- Consumes: `compilableMode` / `isCompilable` message names from Task 2
- Produces: Webview uses renamed DOM IDs and handles renamed messages

- [ ] **Step 1: Rename CSS IDs**

In `extension.js` lines 998-1012, rename `#quarto-status-bar` to `#compilable-status-bar`:

```css
    /* ── Quarto 编译状态栏 ── */
    #compilable-status-bar {
      display: none;
      ...
```

In `extension.js` line 1011, change:

```css
    #quarto-status-bar.show { display: flex; }
```

To:

```css
    #compilable-status-bar.show { display: flex; }
```

In `extension.js` line 1012, change:

```css
    #quarto-status-bar .spinner {
```

To:

```css
    #compilable-status-bar .spinner {
```

- [ ] **Step 2: Rename HTML DOM IDs**

In `extension.js` lines 1051-1056, change:

```html
  <!-- Quarto 编译状态栏 -->
  <div id="quarto-status-bar">
    <div class="spinner" id="quarto-spinner" style="display:none;"></div>
    <span id="quarto-status-msg">请点击「🔄 编译」以渲染 Quarto 文档</span>
    <button class="btn btn-quarto-compile" id="btn-quarto-compile-inline" style="padding:3px 10px;font-size:12px;">🔄 编译</button>
  </div>
```

To:

```html
  <!-- Quarto 编译状态栏 -->
  <div id="compilable-status-bar">
    <div class="spinner" id="quarto-spinner" style="display:none;"></div>
    <span id="compilable-status-msg">请点击「🔄 编译」以渲染文档</span>
    <button class="btn btn-quarto-compile" id="btn-quarto-compile-inline" style="padding:3px 10px;font-size:12px;">🔄 编译</button>
  </div>
```

- [ ] **Step 3: Update compile button event handler**

In `extension.js` line 1263, change:

```js
      document.getElementById('quarto-status-msg').textContent = '正在启动 Quarto...';
```

To:

```js
      document.getElementById('compilable-status-msg').textContent = '正在启动 Quarto...';
```

- [ ] **Step 4: Update message handler — `update` case (isQuarto → isCompilable)**

In `extension.js` line 1438, change:

```js
          if (msg.isQuarto) {
            const bar = document.getElementById('quarto-status-bar');
            if (bar) bar.classList.add('show');
            const statusMsg = document.getElementById('quarto-status-msg');
```

To:

```js
          if (msg.isCompilable) {
            const bar = document.getElementById('compilable-status-bar');
            if (bar) bar.classList.add('show');
            const statusMsg = document.getElementById('compilable-status-msg');
```

- [ ] **Step 5: Update message handler — `quartoMode` → `compilableMode`**

In `extension.js` line 1449, change:

```js
        case 'quartoMode': {
          // 进入 QMD 模式：状态栏会显示编译按钮
          break;
        }
```

To:

```js
        case 'compilableMode': {
          // 进入编译模式：状态栏会显示编译按钮
          break;
        }
```

- [ ] **Step 6: Update message handler — `quartoStatus` case DOM IDs**

In `extension.js` lines 1455-1459, change all `quarto-status-bar` → `compilable-status-bar` and `quarto-status-msg` → `compilable-status-msg`:

```js
        case 'quartoStatus': {
          // 需要编译或已就绪
          const bar = document.getElementById('compilable-status-bar');
          if (msg.needsCompile) {
            if (bar) {
              bar.classList.add('show');
              document.getElementById('compilable-status-msg').textContent = msg.message || '请先编译文档';
            }
            setQuartoCompiling(false);
          } else {
            if (bar) bar.classList.remove('show');
          }
          break;
        }
```

- [ ] **Step 7: Update message handler — `quartoCompileProgress` case DOM IDs**

In `extension.js` lines 1467-1470, change:

```js
        case 'quartoCompileProgress': {
          const bar = document.getElementById('quarto-status-bar');
          if (bar) bar.classList.add('show');
          document.getElementById('quarto-status-msg').textContent = msg.message || '';
```

To:

```js
        case 'quartoCompileProgress': {
          const bar = document.getElementById('compilable-status-bar');
          if (bar) bar.classList.add('show');
          document.getElementById('compilable-status-msg').textContent = msg.message || '';
```

- [ ] **Step 8: Update message handler — `quartoCompileDone` case DOM IDs**

In `extension.js` lines 1473-1482, change:

```js
        case 'quartoCompileDone': {
          setQuartoCompiling(false);
          const bar = document.getElementById('quarto-status-bar');
          if (bar) bar.classList.add('show');
          const statusMsg = document.getElementById('quarto-status-msg');
```

To:

```js
        case 'quartoCompileDone': {
          setQuartoCompiling(false);
          const bar = document.getElementById('compilable-status-bar');
          if (bar) bar.classList.add('show');
          const statusMsg = document.getElementById('compilable-status-msg');
```

- [ ] **Step 9: Update message handler — `quartoCompileError` case DOM IDs**

In `extension.js` lines 1484-1488, change:

```js
        case 'quartoCompileError': {
          setQuartoCompiling(false);
          const bar = document.getElementById('quarto-status-bar');
          if (bar) bar.classList.add('show');
          document.getElementById('quarto-status-msg').textContent = '❌ ' + (msg.message || '编译失败');
```

To:

```js
        case 'quartoCompileError': {
          setQuartoCompiling(false);
          const bar = document.getElementById('compilable-status-bar');
          if (bar) bar.classList.add('show');
          document.getElementById('compilable-status-msg').textContent = '❌ ' + (msg.message || '编译失败');
```

- [ ] **Step 10: Commit**

```bash
git add extension.js
git commit -m "refactor: rename webview DOM IDs and message handlers for compilable abstraction"
```

---

### Task 5: `lib/converter.js` — `renderQuarto()` extension-agnostic basename

**Files:**
- Modify: `lib/converter.js:878`

**Interfaces:**
- Produces: `renderQuarto()` fallback title correctly strips `.ipynb` extension

- [ ] **Step 1: Replace hardcoded `.qmd` extension with dynamic `path.extname()`**

In `lib/converter.js` line 878, change:

```js
  const title = fm.title || mdTitle || path.basename(qmdPath, '.qmd');
```

To:

```js
  const title = fm.title || mdTitle || path.basename(qmdPath, path.extname(qmdPath));
```

- [ ] **Step 2: Commit**

```bash
git add lib/converter.js
git commit -m "fix: use dynamic extname in renderQuarto fallback title for .ipynb compat"
```

---

### Task 6: `electron/main.js` — mirror all compilable-file changes

**Files:**
- Modify: `electron/main.js:18-21` (definition), `electron/main.js:28,75,92,101,110,276,277,301,302,368` (call sites)

**Interfaces:**
- Consumes: Mirror of extension.js pattern
- Produces: Electron app supports `.ipynb` identically to `.qmd`

- [ ] **Step 1: Replace `isQuartoFile()` definition**

In `electron/main.js` lines 18-21, change:

```js
/** @param {string} filePath @returns {boolean} */
function isQuartoFile(filePath) {
  return filePath.endsWith('.qmd');
}
```

To:

```js
const COMPILABLE_EXTENSIONS = ['.qmd', '.ipynb'];

/** @param {string} filePath @returns {boolean} */
function isCompilableFile(filePath) {
  return COMPILABLE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}
```

- [ ] **Step 2: Replace `isQuartoFile` → `isCompilableFile` at all call sites**

Run search-and-replace across `electron/main.js` (7 occurrences):
```
isQuartoFile → isCompilableFile
```

All occurrences are at lines 28, 75, 276, 301, 368.

- [ ] **Step 3: Rename `renderQuartoPreview` → `renderCompilablePreview`**

In `electron/main.js` line 76, change:

```js
    renderQuartoPreview(mdPath);
```

To:

```js
    renderCompilablePreview(mdPath);
```

In `electron/main.js` line 92, change:

```js
function renderQuartoPreview(qmdPath) {
```

To:

```js
function renderCompilablePreview(qmdPath) {
```

- [ ] **Step 4: Update postMessage flags — `isQuarto` → `isCompilable`**

In `electron/main.js` line 101, change:

```js
        isQuarto: true,
```

To:

```js
        isCompilable: true,
```

- [ ] **Step 5: Update `quartoMode` → `compilableMode`**

In `electron/main.js` line 302, change:

```js
    sendToRenderer('quartoMode', { isQuarto: true });
```

To:

```js
    sendToRenderer('compilableMode', { isCompilable: true });
```

- [ ] **Step 6: Update `quartoStatus` message**

In `electron/main.js` line 110, change:

```js
      message: '请先点击「🔄 编译」用 Quarto 将 .qmd 编译为 Markdown',
```

To:

```js
      message: '请先点击「🔄 编译」用 Quarto 编译文件',
```

- [ ] **Step 7: Update error messages**

In `electron/main.js` line 277, change:

```js
    sendToRenderer('quartoCompileError', { message: '当前文件不是 .qmd 格式' });
```

To:

```js
    sendToRenderer('quartoCompileError', { message: '当前文件不是 .qmd 或 .ipynb 格式' });
```

In `electron/main.js` line 30, change:

```js
      throw new Error('请先在预览中点击「🔄 编译」用 Quarto 编译 .qmd 文件');
```

To:

```js
      throw new Error('请先在预览中点击「🔄 编译」用 Quarto 编译文件');
```

- [ ] **Step 8: Commit**

```bash
git add electron/main.js
git commit -m "refactor: mirror compilable-file abstraction in Electron main process"
```

---

### Task 7: Verification — end-to-end test with `.ipynb` file

**Files:**
- Create: (temporary test file, deleted after verification)

**Interfaces:**
- Consumes: All prior tasks

- [ ] **Step 1: Create a minimal test `.ipynb` file**

```bash
cat > /tmp/test_qmd2any.ipynb << 'NBEOF'
{
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": ["# Test Notebook\\n\\nThis is a **test** paragraph with $E = mc^2$."]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "source": ["print('hello')"],
   "outputs": []
  }
 ],
 "metadata": {
  "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
  "language_info": {"name": "python", "version": "3.10.0"}
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
NBEOF
```

- [ ] **Step 2: Verify `quarto render` works on the test file**

Run: `quarto render /tmp/test_qmd2any.ipynb --to gfm`
Expected: Creates `/tmp/test_qmd2any.md` with rendered content, exit code 0

- [ ] **Step 3: Verify the compiled `.md` renders correctly**

Run: `node -e "
const { renderMarkdown } = require('./lib/converter');
const result = renderMarkdown('/tmp/test_qmd2any.md');
console.log('Title:', result.title);
console.log('Has HTML:', result.bodyHtml.length > 100);
console.log('Has KaTeX:', result.bodyHtml.includes('katex'));
"`
Expected: Title is "Test Notebook", Has HTML: true, Has KaTeX: true

- [ ] **Step 4: Verify `isCompilableFile()` logic**

Run: `node -e "
// Simulate the new check
const COMPILABLE_EXTENSIONS = ['.qmd', '.ipynb'];
const isCompilableFile = (fp) => COMPILABLE_EXTENSIONS.some(ext => fp.endsWith(ext));
console.log('.qmd:', isCompilableFile('/path/test.qmd'));
console.log('.ipynb:', isCompilableFile('/path/test.ipynb'));
console.log('.md:', isCompilableFile('/path/test.md'));
console.log('.Rmd:', isCompilableFile('/path/test.Rmd'));
"`
Expected: `.qmd: true`, `.ipynb: true`, `.md: false`, `.Rmd: false`

- [ ] **Step 5: Verify `renderQuarto()` fallback title strips `.ipynb` correctly**

Run: `node -e "
const path = require('path');
const qmdPath = '/path/test.ipynb';
const title = path.basename(qmdPath, path.extname(qmdPath));
console.log('Fallback title:', title);
"`
Expected: `Fallback title: test`

- [ ] **Step 6: Verify existing `.qmd` workflow still works**

Run: `node -e "
const { renderMarkdown } = require('./lib/converter');
// Use any existing .md file in the repo (README.md works as plain markdown)
const result = renderMarkdown('README.md');
console.log('README title:', result.title);
console.log('OK:', result.bodyHtml.length > 100);
"`
Expected: `OK: true`

- [ ] **Step 7: Clean up test file**

```bash
rm -f /tmp/test_qmd2any.ipynb /tmp/test_qmd2any.md
```

- [ ] **Step 8: Commit (empty — verification only, no code changes)**

No commit needed unless verification found issues requiring fixes.

---

## Summary

| Task | Files | Commits |
|------|-------|---------|
| 1. package.json | `package.json` | 1 |
| 2. extension.js mechanical renames | `extension.js` | 1 |
| 3. extension.js notebook entry | `extension.js` | 1 |
| 4. extension.js webview DOM/JS | `extension.js` | 1 |
| 5. lib/converter.js basename | `lib/converter.js` | 1 |
| 6. electron/main.js mirror | `electron/main.js` | 1 |
| 7. Verification | (temp files) | 0 |

**Total: 7 tasks, 6 commits, 4 files modified, 0 files created.**
