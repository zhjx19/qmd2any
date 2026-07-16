'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const urlMod = require('url');
const crypto = require('crypto');

const { renderMarkdown, renderQuarto, buildFullHtml, buildWechatCopyHtml, buildZhihuCopyHtml, buildXhsCopyHtml, convertMarkdownToWeChat, buildXhsRenderHtml } = require('../lib/converter');
const { THEMES, DEFAULT_THEME_ID, getTheme } = require('../lib/themes');
const quarto = require('../lib/quarto');

// ── Helpers ──────────────────────────────────────────────

const COMPILABLE_EXTENSIONS = ['.qmd', '.ipynb'];

/** @param {string} filePath @returns {boolean} */
function isCompilableFile(filePath) {
  return COMPILABLE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

/**
 * Render markdown or quarto file, returning { bodyHtml, title, rawMarkdown }.
 * For .qmd files, requires prior compilation (checks cache).
 */
function renderForPlatform(filePath) {
  if (isCompilableFile(filePath)) {
    if (!quarto.isCacheValid(filePath)) {
      throw new Error('请先在预览中点击「🔄 编译」用 Quarto 编译文件');
    }
    const cached = quarto.getCached(filePath);
    return renderQuarto(filePath, cached.mdPath);
  }
  return renderMarkdown(filePath);
}

// ── State ───────────────────────────────────────────────

let mainWindow;
let currentFilePath = null;
let currentThemeId = DEFAULT_THEME_ID;
let configStore = {};
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// ── Safe IPC sender ──────────────────────────────────────

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── Config persistence ──────────────────────────────────

function loadConfig() {
  try {
    configStore = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    configStore = { appid: '', appSecret: '', author: '', digest: '' };
  }
}

function saveConfigToDisk() {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configStore, null, 2), 'utf8');
  } catch (_) {}
}

// ── Render preview from Markdown file ───────────────────

function renderAndSendPreview(mdPath) {
  if (isCompilableFile(mdPath)) {
    renderCompilablePreview(mdPath);
    return;
  }
  try {
    const { bodyHtml, title } = renderMarkdown(mdPath);
    const theme = getTheme(currentThemeId);
    sendToRenderer('update', {
      bodyHtml,
      title,
      theme: { id: theme.id, css: theme.css, wrapperBg: theme.wrapperBg },
    });
  } catch (err) {
    sendToRenderer('error', { message: err.message });
  }
}

function renderCompilablePreview(qmdPath) {
  if (quarto.isCacheValid(qmdPath)) {
    const cached = quarto.getCached(qmdPath);
    try {
      const { bodyHtml, title } = renderQuarto(qmdPath, cached.mdPath);
      const theme = getTheme(currentThemeId);
      sendToRenderer('update', {
        bodyHtml,
        title,
        isCompilable: true,
        theme: { id: theme.id, css: theme.css, wrapperBg: theme.wrapperBg },
      });
    } catch (err) {
      sendToRenderer('error', { message: err.message });
    }
  } else {
    sendToRenderer('quartoStatus', {
      needsCompile: true,
      message: '请先点击「🔄 编译」用 Quarto 编译文件',
    });
  }
}

// ── Get template path ────────────────────────────────────

function getTemplatePath() {
  const appRoot = path.join(__dirname, '..');

  // 1. Check workspace-relative custom template
  if (currentFilePath) {
    const workspacePath = path.dirname(currentFilePath);
    const tplName = configStore.template || 'wechat';
    const custom = path.join(workspacePath, 'templates', `${tplName}.html`);
    if (fs.existsSync(custom)) return custom;
  }

  // 2. Built-in template
  const tplName = configStore.template || 'wechat';
  const builtin = path.join(appRoot, 'templates', `${tplName}.html`);
  if (fs.existsSync(builtin)) return builtin;

  // 3. Fallback
  const fallback = path.join(appRoot, 'templates', 'wechat.html');
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

// ── Create window ────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'QMD2Any - Quarto & Markdown Export',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ───────────────────────────────────────

app.whenReady().then(() => {
  loadConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ────────────────────────────────────────────────────────
//  IPC Handlers
// ────────────────────────────────────────────────────────

// ── File dialogs ────────────────────────────────────────

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开 Markdown / Quarto 文件',
    filters: [{ name: 'Markdown / Quarto', extensions: ['md', 'markdown', 'qmd', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    currentFilePath = filePath;
    renderAndSendPreview(filePath);
    return {
      content,
      filePath,
      fileName: path.basename(filePath),
      dirName: path.dirname(filePath),
    };
  } catch (err) {
    sendToRenderer('error', { message: '无法读取文件: ' + err.message });
    return null;
  }
});

ipcMain.handle('dialog:saveFileAs', async (_event, content) => {
  const defaultPath = currentFilePath
    ? path.basename(currentFilePath)
    : 'untitled.md';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存 Markdown 文件',
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    currentFilePath = result.filePath;
    renderAndSendPreview(result.filePath);
    return {
      filePath: result.filePath,
      fileName: path.basename(result.filePath),
    };
  } catch (err) {
    sendToRenderer('error', { message: '无法保存文件: ' + err.message });
    return null;
  }
});

ipcMain.handle('getAppPath', () => {
  return path.join(__dirname, '..');
});

// ── Save file to current path ─────────────────────────

ipcMain.on('saveFile', (_event, content) => {
  if (currentFilePath) {
    try {
      fs.writeFileSync(currentFilePath, content, 'utf8');
      renderAndSendPreview(currentFilePath);
    } catch (err) {
      sendToRenderer('error', { message: '保存失败: ' + err.message });
    }
  }
});

// ── Editor content changed (debounced by renderer) ──────

ipcMain.on('editorContentChanged', (_event, content) => {
  // For compilable files (.qmd, .ipynb), the editor preview uses the cached compiled .md
  // (not the raw compilable file content). Skip preview until compiled.
  if (currentFilePath && isCompilableFile(currentFilePath)) {
    renderAndSendPreview(currentFilePath);
    return;
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `qmd2any_edit_${crypto.randomUUID()}.md`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    renderAndSendPreview(tmpFile);
  } catch (err) {
    sendToRenderer('error', { message: '渲染失败: ' + err.message });
  }
  // Schedule cleanup
  setTimeout(() => {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }, 10000);
});

// ── Quarto compile ──────────────────────────────────────

ipcMain.on('quartoCompile', async () => {
  if (!currentFilePath || !isCompilableFile(currentFilePath)) {
    sendToRenderer('quartoCompileError', { message: '当前文件不是 .qmd 或 .ipynb 格式' });
    return;
  }
  try {
    sendToRenderer('quartoCompileProgress', { message: '正在启动 Quarto 编译...' });
    const result = await quarto.compile(currentFilePath, (line) => {
      sendToRenderer('quartoCompileProgress', { message: line });
    });
    sendToRenderer('quartoCompileDone', { mdPath: result.mdPath });
    // Auto-refresh preview after compilation
    renderAndSendPreview(currentFilePath);
  } catch (err) {
    sendToRenderer('quartoCompileError', { message: err.message });
  }
});

// ── Ready (renderer loaded) ─────────────────────────────

ipcMain.on('ready', () => {
  sendToRenderer('themeList', {
    themes: THEMES.map(t => ({ id: t.id, name: t.name })),
    currentId: currentThemeId,
  });
  sendToRenderer('config', configStore);
  if (currentFilePath && isCompilableFile(currentFilePath)) {
    sendToRenderer('compilableMode', { isCompilable: true });
  }
});

// ── Open external URL ──────────────────────────────────

ipcMain.on('openExternal', (_event, url) => {
  try {
    const parsed = new urlMod.URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  } catch (_) {}
});

// ── Theme ──────────────────────────────────────────────

ipcMain.on('setTheme', (_event, msg) => {
  currentThemeId = (msg && msg.themeId) || DEFAULT_THEME_ID;
  if (currentFilePath) {
    renderAndSendPreview(currentFilePath);
  }
});

// ── Config ─────────────────────────────────────────────

ipcMain.on('getConfig', () => {
  sendToRenderer('config', configStore);
});

ipcMain.on('saveConfig', (_event, cfg) => {
  Object.assign(configStore, cfg);
  saveConfigToDisk();
  sendToRenderer('configSaved');
});

// ── New file ───────────────────────────────────────────

ipcMain.on('newFile', () => {
  currentFilePath = null;
  sendToRenderer('update', {
    bodyHtml: '<p style="color:#999;text-align:center;">新建或打开一个 Markdown 文件开始预览</p>',
    title: '未命名',
    theme: { id: currentThemeId, css: '', wrapperBg: '#ffffff' },
  });
});

// ── Export HTML ────────────────────────────────────────

ipcMain.on('exportHtml', async () => {
  if (!currentFilePath) {
    sendToRenderer('error', { message: '请先打开或保存一个 Markdown 文件' });
    return;
  }

  try {
    const dirName = path.dirname(currentFilePath);
    const outputDir = configStore.outputPath || 'build';
    const outputPath = path.join(dirName, outputDir, 'wechat.html');
    const templatePath = getTemplatePath();

    if (!templatePath) {
      sendToRenderer('error', { message: '找不到模板文件' });
      return;
    }

    if (isCompilableFile(currentFilePath)) {
      const { bodyHtml } = renderForPlatform(currentFilePath);
      const finalHtml = buildFullHtml(bodyHtml, templatePath);
      const outDir2 = path.dirname(outputPath);
      if (!fs.existsSync(outDir2)) fs.mkdirSync(outDir2, { recursive: true });
      fs.writeFileSync(outputPath, finalHtml, 'utf8');
    } else {
      convertMarkdownToWeChat(currentFilePath, templatePath, outputPath);
    }

    const action = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '导出完成',
      message: `HTML 已导出到:\n${outputPath}`,
      buttons: ['打开文件', '打开目录', '确定'],
    });

    if (action.response === 0) {
      shell.openPath(outputPath);
    } else if (action.response === 1) {
      shell.showItemInFolder(outputPath);
    }
  } catch (err) {
    sendToRenderer('error', { message: err.message });
  }
});

// ── Get WeChat HTML ────────────────────────────────────

ipcMain.on('getWechatHtml', () => {
  try {
    const mdPath = currentFilePath;
    if (!mdPath) {
      sendToRenderer('wechatHtmlError', { message: '请先打开或保存文件' });
      return;
    }
    const { bodyHtml } = renderForPlatform(mdPath);
    const templatePath = getTemplatePath();
    const theme = getTheme(currentThemeId);
    const html = buildWechatCopyHtml(bodyHtml, templatePath, theme);
    sendToRenderer('wechatHtml', { html });
  } catch (err) {
    sendToRenderer('wechatHtmlError', { message: err.message });
  }
});

// ── Get Zhihu HTML ─────────────────────────────────────

ipcMain.on('getZhihuHtml', () => {
  try {
    const mdPath = currentFilePath;
    if (!mdPath) {
      sendToRenderer('zhihuHtmlError', { message: '请先打开或保存文件' });
      return;
    }
    const { bodyHtml } = renderForPlatform(mdPath);
    const templatePath = getTemplatePath();
    const theme = getTheme(currentThemeId);
    const html = buildZhihuCopyHtml(bodyHtml, templatePath, theme);
    sendToRenderer('zhihuHtml', { html });
  } catch (err) {
    sendToRenderer('zhihuHtmlError', { message: err.message });
  }
});

// ── Get XHS Copy HTML ──────────────────────────────────

ipcMain.on('getXhsCopyHtml', () => {
  try {
    const mdPath = currentFilePath;
    if (!mdPath) {
      sendToRenderer('xhsCopyHtmlError', { message: '请先打开或保存文件' });
      return;
    }
    const { bodyHtml } = renderForPlatform(mdPath);
    const theme = getTheme(currentThemeId);
    const html = buildXhsCopyHtml(bodyHtml, theme);
    sendToRenderer('xhsCopyHtml', { html });
  } catch (err) {
    sendToRenderer('xhsCopyHtmlError', { message: err.message });
  }
});

// ── Todo toggle ────────────────────────────────────────

ipcMain.on('todoToggle', (_event, msg) => {
  if (!currentFilePath) return;
  try {
    const content = fs.readFileSync(currentFilePath, 'utf8');
    let count = 0;
    const updated = content.replace(/^(\s*[-*+]\s)\[( |x|X)\]/gm, (match, prefix) => {
      if (count++ === msg.index) {
        return prefix + (msg.checked ? '[x]' : '[ ]');
      }
      return match;
    });
    if (updated !== content) {
      fs.writeFileSync(currentFilePath, updated, 'utf8');
    }
  } catch (e) {
    console.error('todoToggle failed:', e.message);
  }
});

// ── Fetch image base64 (from webview) ──────────────────

ipcMain.on('fetchImageBase64', (_event, msg) => {
  const imgUrl = msg.url;
  const reqId = msg.reqId;
  try {
    const parsed = new urlMod.URL(imgUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const data = [];
    const req = client.get(imgUrl, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        sendToRenderer('imageBase64Result', { reqId, url: imgUrl, dataUrl: null, error: 'HTTP ' + res.statusCode });
        return;
      }
      res.on('data', c => data.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(data);
        const ext = (parsed.pathname.split('.').pop() || 'png').toLowerCase();
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
        const mime = mimeMap[ext] || 'image/png';
        sendToRenderer('imageBase64Result', { reqId, url: imgUrl, dataUrl: `data:${mime};base64,${buf.toString('base64')}` });
      });
    });
    req.on('error', (err) => {
      sendToRenderer('imageBase64Result', { reqId, url: imgUrl, dataUrl: null, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      sendToRenderer('imageBase64Result', { reqId, url: imgUrl, dataUrl: null, error: 'timeout' });
    });
  } catch (err) {
    sendToRenderer('imageBase64Result', { reqId, url: imgUrl, dataUrl: null, error: err.message });
  }
});

// ── Generate XHS via Playwright ────────────────────────

function installChromium() {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const appRoot = path.join(__dirname, '..');
    const cliPath = path.join(appRoot, 'node_modules', 'playwright-core', 'lib', 'cli', 'program.js');
    const proc = spawn(process.execPath, [cliPath, 'install', 'chromium']);
    proc.stdout.on('data', d => {
      const line = d.toString().trim();
      if (line) sendToRenderer('xhsPythonProgress', { message: '📥 ' + line });
    });
    proc.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line) sendToRenderer('xhsPythonProgress', { message: '📥 ' + line });
    });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

ipcMain.on('generateXhsViaPython', async (_event, msg) => {
  if (!currentFilePath) {
    sendToRenderer('xhsPythonError', { message: '请先打开或保存文件' });
    return;
  }

  const { spawn } = require('child_process');
  const { width = 1080, height = 1440, padding = 40, bg = '#ffffff', autoExport = false } = msg;
  const appRoot = path.join(__dirname, '..');

  // Generate standalone render HTML
  const { bodyHtml } = renderForPlatform(currentFilePath);
  const theme = getTheme(currentThemeId);
  const htmlContent = buildXhsRenderHtml(bodyHtml, path.dirname(currentFilePath), theme);

  const tmpHtml = path.join(os.tmpdir(), `qmd2any_xhs_${crypto.randomUUID()}.html`);
  const base = path.basename(currentFilePath, path.extname(currentFilePath));
  const outDir = autoExport
    ? path.join(path.dirname(currentFilePath), `${base}_xhs`)
    : path.join(os.tmpdir(), `qmd2any_xhs_preview_${crypto.randomUUID()}`);

  fs.writeFileSync(tmpHtml, htmlContent, 'utf8');

  const scriptPath = path.join(appRoot, 'scripts', 'xhs_screenshot.js');

  function runScreenshot(retryAfterInstall) {
    sendToRenderer('xhsPythonProgress', { message: '⏳ 渲染中，请稍候...' });

    const proc = spawn(process.execPath, [
      scriptPath, tmpHtml, outDir,
      '--width', String(width), '--height', String(height),
      '--padding', String(padding), '--bg', bg,
    ]);

    let stdout = '';
    proc.stdout.on('data', d => {
      stdout += d.toString();
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('INFO:')) {
          sendToRenderer('xhsPythonProgress', { message: '⏳ ' + line.slice(5).trim() });
        }
      }
    });

    proc.on('close', async (code) => {
      try { fs.unlinkSync(tmpHtml); } catch (_) {}

      if (code === 2 && !retryAfterInstall) {
        sendToRenderer('xhsPythonProgress', { message: '📥 首次使用，正在下载 Chromium（约 150MB）...' });
        await installChromium();
        const htmlContent2 = buildXhsRenderHtml(bodyHtml, path.dirname(currentFilePath), theme);
        fs.writeFileSync(tmpHtml, htmlContent2, 'utf8');
        runScreenshot(true);
        return;
      }

      if (code !== 0) {
        const errLine = stdout.split('\n').find(l => l.startsWith('ERROR:')) || '截图失败';
        sendToRenderer('xhsPythonError', { message: errLine.replace('ERROR:', '').trim() });
        return;
      }

      const savedPaths = stdout.split('\n')
        .filter(l => l.startsWith('SAVED:'))
        .map(l => l.slice(6).trim())
        .filter(Boolean);

      const dataUrls = savedPaths.map(p => {
        const buf = fs.readFileSync(p);
        return `data:image/png;base64,${buf.toString('base64')}`;
      });

      sendToRenderer('xhsPythonDone', { dataUrls, outDir, autoExport });
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpHtml); } catch (_) {}
      sendToRenderer('xhsPythonError', { message: err.message });
    });
  }

  runScreenshot(false);
});

// ── Save XHS images ────────────────────────────────────

ipcMain.on('saveXhsImages', (_event, msg) => {
  try {
    const dataUrls = msg.dataUrls || [];
    const base = path.basename(currentFilePath, path.extname(currentFilePath));
    const dir = path.join(path.dirname(currentFilePath), `${base}_xhs`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    dataUrls.forEach((dataUrl, i) => {
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      const fname = `xiaohongshu-${String(i + 1).padStart(2, '0')}.png`;
      fs.writeFileSync(path.join(dir, fname), buf);
    });

    sendToRenderer('saveXhsImagesDone', { count: dataUrls.length, dir });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '导出完成',
      message: `已导出 ${dataUrls.length} 张图片到:\n${dir}`,
      buttons: ['打开目录', '确定'],
    }).then(({ response }) => {
      if (response === 0) shell.openPath(dir);
    });
  } catch (err) {
    sendToRenderer('saveXhsImagesError', { message: err.message });
  }
});

// ── Upload to WeChat (via FastPen API) ─────────────────

ipcMain.on('upload', async (_event, msg) => {
  if (!currentFilePath) {
    sendToRenderer('uploadResult', { success: false, error: '请先打开或保存文件' });
    return;
  }

  const { rawMarkdown } = renderForPlatform(currentFilePath);
  const { appid, appSecret, title, author, digest } = msg;

  if (!appid || !appSecret) {
    sendToRenderer('uploadResult', { success: false, error: '请先配置 AppID 和 AppSecret' });
    return;
  }

  sendToRenderer('uploadStart');

  try {
    const result = await postToFastPen({ markdown: rawMarkdown, title, appid, appSecret, author, digest });
    if (result.success) {
      sendToRenderer('uploadResult', {
        success: true,
        mediaId: result.data && result.data.media_id,
      });
    } else {
      sendToRenderer('uploadResult', {
        success: false,
        error: result.message || '上传失败，请检查配置',
      });
    }
  } catch (err) {
    sendToRenderer('uploadResult', { success: false, error: err.message });
  }
});

function postToFastPen({ markdown, title, appid, appSecret, author, digest }) {
  return new Promise((resolve, reject) => {
    const bodyData = JSON.stringify({
      markdown,
      title,
      appid,
      app_secret: appSecret,
      author: author || '',
      digest: digest || '',
    });

    const options = {
      hostname: 'www.fastpen.online',
      path: '/api/draft/multi/import-markdown',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData, 'utf8'),
        'User-Agent': 'qmd2any-electron/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          reject(new Error(`服务器响应解析失败: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('请求超时（30s），请检查网络'));
    });
    req.write(bodyData, 'utf8');
    req.end();
  });
}
