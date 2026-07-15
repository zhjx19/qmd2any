'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { renderMarkdown, renderQuarto, buildWechatCopyHtml } = require('./lib/converter');
const { THEMES, DEFAULT_THEME_ID, getTheme } = require('./lib/themes');
const zhihu = require('./lib/zhihu');
const social = require('./lib/social');
const quarto = require('./lib/quarto');

// ── 工具：判断是否为 Quarto 文件 ──

/** @param {string} filePath @returns {boolean} */
function isQuartoFile(filePath) {
  return filePath.endsWith('.qmd');
}

// ─────────────────────────────────────────────
//  全局状态
// ─────────────────────────────────────────────

/** @type {vscode.ExtensionContext} */
let extContext;

/** @type {vscode.OutputChannel} */
let outputChannel;

/** Map<mdFilePath, vscode.WebviewPanel> */
const previewPanels = new Map();

/** Map<mdFilePath, NodeJS.Timeout> */
const debounceTimers = new Map();

/** 当前选中的主题 ID（全局，所有预览共享） */
let currentThemeId = DEFAULT_THEME_ID;

/** Playwright 子进程引用（用于发布/登录时管理浏览器窗口） */
const lastChild = {};

// ─────────────────────────────────────────────
//  激活 / 停用
// ─────────────────────────────────────────────

function activate(context) {
  extContext = context;
  outputChannel = vscode.window.createOutputChannel('QMD2Any');
  log('QMD2Any 插件已激活');

  context.subscriptions.push(
    vscode.commands.registerCommand('qmd2any.preview', handlePreview),

    // 文档变更时更新预览（500ms 防抖）
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== 'markdown' && e.document.languageId !== 'quarto') return;
      const mdPath = e.document.uri.fsPath;
      if (!previewPanels.has(mdPath)) return;
      scheduleUpdate(mdPath);
    }),

    // 活跃编辑器切换时如有已开启的预览则刷新
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || (editor.document.languageId !== 'markdown' && editor.document.languageId !== 'quarto')) return;
      const mdPath = editor.document.uri.fsPath;
      if (previewPanels.has(mdPath)) {
        scheduleUpdate(mdPath);
      }
    }),
  );
}

function deactivate() {
  if (outputChannel) outputChannel.dispose();
}

// ─────────────────────────────────────────────
//  日志
// ─────────────────────────────────────────────

function log(msg) {
  outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

/**
 * 渲染 Markdown 或 Quarto 文件，返回 { bodyHtml, title, rawMarkdown }。
 * 对 .qmd 文件会检查编译缓存，未编译则抛错。
 *
 * @param {string} filePath  — .md 或 .qmd 路径
 * @returns {{ bodyHtml: string, title: string, rawMarkdown: string }}
 */
function renderForPlatform(filePath) {
  if (isQuartoFile(filePath)) {
    if (!quarto.isCacheValid(filePath)) {
      throw new Error('请先点击「🔄 编译」用 Quarto 编译 .qmd 文件');
    }
    const cached = quarto.getCached(filePath);
    return renderQuarto(filePath, cached.mdPath);
  }
  return renderMarkdown(filePath);
}

// ─────────────────────────────────────────────
//  获取 Markdown 文件路径
// ─────────────────────────────────────────────

/**
 * @param {vscode.Uri|undefined} uri
 * @returns {string|null}
 */
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
  if (editor.document.isDirty) {
    await editor.document.save();
  }
  return editor.document.uri.fsPath;
}

// ─────────────────────────────────────────────
//  获取模板路径
// ─────────────────────────────────────────────

function getTemplatePath(workspacePath, templateName) {
  // 1. 工作区自定义模板
  if (workspacePath) {
    const custom = path.join(workspacePath, 'templates', `${templateName}.html`);
    if (fs.existsSync(custom)) return custom;
  }
  // 2. 扩展内置
  const builtin = path.join(extContext.extensionUri.fsPath, 'templates', `${templateName}.html`);
  if (fs.existsSync(builtin)) return builtin;
  // 3. 默认 wechat
  const fallback = path.join(extContext.extensionUri.fsPath, 'templates', 'wechat.html');
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

// ─────────────────────────────────────────────
//  命令：预览
// ─────────────────────────────────────────────

async function handlePreview(uri) {
  const mdPath = await resolveMdFilePath(uri);
  if (!mdPath) return;

  // 已有面板则直接显示
  if (previewPanels.has(mdPath)) {
    previewPanels.get(mdPath).reveal(vscode.ViewColumn.Beside, true);
    scheduleUpdate(mdPath);
    return;
  }

  // 创建新面板
  const panel = vscode.window.createWebviewPanel(
    'qmd2anyPreview',
    `预览: ${path.basename(mdPath)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        extContext.extensionUri,
        vscode.Uri.file(path.join(extContext.extensionUri.fsPath, 'node_modules')),
      ],
    },
  );

  previewPanels.set(mdPath, panel);

  // 面板关闭时清理
  panel.onDidDispose(() => {
    previewPanels.delete(mdPath);
    const t = debounceTimers.get(mdPath);
    if (t) { clearTimeout(t); debounceTimers.delete(mdPath); }
  }, null, extContext.subscriptions);

  // 接收 webview 消息
  panel.webview.onDidReceiveMessage(
    (msg) => handleWebviewMessage(msg, panel, mdPath),
    null,
    extContext.subscriptions,
  );

  // 初始化内容
  panel.webview.html = getWebviewHtml(panel.webview, '', mdPath);
  updatePreview(panel, mdPath);
}

// ─────────────────────────────────────────────
//  防抖更新预览
// ─────────────────────────────────────────────

function scheduleUpdate(mdPath) {
  const existing = debounceTimers.get(mdPath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(mdPath);
    const panel = previewPanels.get(mdPath);
    if (panel) updatePreview(panel, mdPath);
  }, 500);
  debounceTimers.set(mdPath, timer);
}

function updatePreview(panel, mdPath) {
  if (isQuartoFile(mdPath)) {
    updateQuartoPreview(panel, mdPath);
    return;
  }
  try {
    const { bodyHtml, title } = renderMarkdown(mdPath);
    const theme = getTheme(currentThemeId);
    panel.webview.postMessage({ type: 'update', bodyHtml, title, theme: { id: theme.id, css: theme.css, wrapperBg: theme.wrapperBg } });
  } catch (err) {
    panel.webview.postMessage({ type: 'error', message: err.message });
  }
}

/**
 * QMD 预览：优先用缓存，否则提示编译
 */
function updateQuartoPreview(panel, qmdPath) {
  if (quarto.isCacheValid(qmdPath)) {
    const cached = quarto.getCached(qmdPath);
    try {
      const { bodyHtml, title } = renderQuarto(qmdPath, cached.mdPath);
      const theme = getTheme(currentThemeId);
      panel.webview.postMessage({ type: 'update', bodyHtml, title, isQuarto: true, theme: { id: theme.id, css: theme.css, wrapperBg: theme.wrapperBg } });
    } catch (err) {
      panel.webview.postMessage({ type: 'error', message: err.message });
    }
  } else {
    // 尚未编译，通知 webview 显示编译提示
    panel.webview.postMessage({
      type: 'quartoStatus',
      needsCompile: true,
      message: '请先点击「🔄 编译」用 Quarto 将 .qmd 编译为 Markdown',
    });
  }
}

// ─────────────────────────────────────────────
//  处理 webview → extension 消息
// ─────────────────────────────────────────────


async function handleWebviewMessage(msg, panel, mdPath) {
  switch (msg.type) {
    case 'ready': {
      // webview 加载完毕，发送最新内容
      updatePreview(panel, mdPath);
      // 发送主题列表
      panel.webview.postMessage({
        type: 'themeList',
        themes: THEMES.map((t) => ({ id: t.id, name: t.name })),
        currentId: currentThemeId,
      });
      // QMD 文件：告知前端当前模式
      if (isQuartoFile(mdPath)) {
        panel.webview.postMessage({ type: 'quartoMode', isQuarto: true });
      }
      break;
    }

    // ── Quarto 编译 ──
    case 'quartoCompile': {
      if (!isQuartoFile(mdPath)) {
        panel.webview.postMessage({ type: 'quartoCompileError', message: '当前文件不是 .qmd 格式' });
        break;
      }
      try {
        panel.webview.postMessage({ type: 'quartoCompileProgress', message: '正在启动 Quarto 编译...' });
        log(`开始 Quarto 编译: ${mdPath}`);
        const result = await quarto.compile(mdPath, (line) => {
          panel.webview.postMessage({ type: 'quartoCompileProgress', message: line });
        });
        log(`Quarto 编译完成 → ${result.mdPath}`);
        panel.webview.postMessage({ type: 'quartoCompileDone', mdPath: result.mdPath });
        // 编译成功后自动刷新预览
        updatePreview(panel, mdPath);
      } catch (err) {
        log(`Quarto 编译失败: ${err.message}`);
        panel.webview.postMessage({ type: 'quartoCompileError', message: err.message });
      }
      break;
    }

    case 'todoToggle': {
      // 用户在预览中切换 Todo 复选框，同步更新 MD 文件
      try {
        const content = fs.readFileSync(mdPath, 'utf8');
        let count = 0;
        const updated = content.replace(/^(\s*[-*+]\s)\[( |x|X)\]/gm, (match, prefix) => {
          if (count++ === msg.index) {
            return prefix + (msg.checked ? '[x]' : '[ ]');
          }
          return match;
        });
        if (updated !== content) {
          fs.writeFileSync(mdPath, updated, 'utf8');
        }
      } catch (e) {
        log(`todoToggle 失败: ${e.message}`);
      }
      break;
    }

    case 'getWechatHtml': {
      try {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mdPath));
        const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(mdPath);
        const cfg = vscode.workspace.getConfiguration('qmd2any');
        const templateName = cfg.get('template', 'wechat');
        const templatePath = getTemplatePath(workspacePath, templateName);
        const { bodyHtml } = renderForPlatform(mdPath);
        const theme = getTheme(currentThemeId);
        const html = buildWechatCopyHtml(bodyHtml, templatePath, theme);
        panel.webview.postMessage({ type: 'wechatHtml', html });
      } catch (err) {
        log(`buildWechatCopyHtml 失败: ${err.message}`);
        panel.webview.postMessage({ type: 'wechatHtmlError', message: err.message });
      }
      break;
    }

    case 'setTheme': {
      currentThemeId = msg.themeId || DEFAULT_THEME_ID;
      // 重新渲染预览
      updatePreview(panel, mdPath);
      break;
    }

    case 'zhihuCheckLogin': {
      const cookieStr = extContext.globalState.get(zhihu.STORAGE_KEY, '');
      if (zhihu.isLoggedIn(cookieStr)) {
        const info = await zhihu.verifyLogin(cookieStr);
        panel.webview.postMessage({ type: 'zhihuLoginStatus', loggedIn: info.valid, name: info.name });
      } else {
        panel.webview.postMessage({ type: 'zhihuLoginStatus', loggedIn: false });
      }
      break;
    }

    case 'zhihuStartQr': {
      // 用 Playwright 打开真实浏览器让用户登录
      panel.webview.postMessage({ type: 'zhihuQrProgress', message: '正在启动浏览器，请在弹出的窗口中登录...' });
      log('启动知乎登录浏览器');
      social.login('zhihu', {
        extensionPath: extContext.extensionUri.fsPath,
        storage: extContext.globalState,
        onProgress: (m) => panel.webview.postMessage({ type: 'zhihuQrProgress', message: m }),
        onNeedInstall: () => panel.webview.postMessage({ type: 'zhihuQrError', message: '未找到 Chromium，请手动安装 Playwright 浏览器后再试' }),
        onChild: (c) => { lastChild.zhihu = c; },
      }).then(async ({ cookies }) => {
        // 登录成功后也保存为旧格式（兼容 zhihu.isLoggedIn 检查）
        const oldCookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        await extContext.globalState.update(zhihu.STORAGE_KEY, oldCookieStr);
        const info = await zhihu.verifyLogin(oldCookieStr);
        panel.webview.postMessage({ type: 'zhihuPollResult', status: 'confirmed', name: (info && info.name) || '已登录' });
        log(`知乎登录成功: ${(info && info.name) || '已登录'}`);
      }).catch(err => {
        if (err.needInstall) {
          panel.webview.postMessage({ type: 'zhihuQrError', message: '未找到 Chromium，请手动安装 Playwright 浏览器后再试' });
        } else {
          panel.webview.postMessage({ type: 'zhihuQrError', message: '登录失败：' + err.message });
        }
      });
      break;
    }

    case 'zhihuPollQr':
      // 已不再使用，Playwright 方案由子进程自行轮询
      break;

    case 'zhihuLogout': {
      await extContext.globalState.update(zhihu.STORAGE_KEY, undefined);
      extContext.globalState.update('zhihu._qrToken', undefined);
      extContext.globalState.update('zhihu._qrCookie', undefined);
      panel.webview.postMessage({ type: 'zhihuLoginStatus', loggedIn: false });
      break;
    }

    case 'zhihuSaveCookie': {
      try {
        // 用户粘贴的是 z_c0 的值，包装成完整 cookie 字符串
        const raw = (msg.z_c0 || '').trim();
        if (!raw) {
          panel.webview.postMessage({ type: 'zhihuSaveCookieResult', success: false, error: 'z_c0 值不能为空' });
          break;
        }
        // 支持两种格式：纯值，或已带 "z_c0=..." 前缀
        const cookieStr = raw.startsWith('z_c0=') ? raw : `z_c0=${raw}`;
        const info = await zhihu.verifyLogin(cookieStr);
        if (!info.valid) {
          panel.webview.postMessage({ type: 'zhihuSaveCookieResult', success: false, error: 'Cookie 无效或已过期，请重新获取' });
          break;
        }
        await extContext.globalState.update(zhihu.STORAGE_KEY, cookieStr);
        panel.webview.postMessage({ type: 'zhihuSaveCookieResult', success: true, name: info.name });
        panel.webview.postMessage({ type: 'zhihuLoginStatus', loggedIn: true, name: info.name });
      } catch (err) {
        log(`知乎 Cookie 验证失败: ${err.message}`);
        panel.webview.postMessage({ type: 'zhihuSaveCookieResult', success: false, error: err.message });
      }
      break;
    }

    case 'zhihuGetArticleId': {
      const mapKey = 'zhihu.articleIdMap';
      const map = extContext.globalState.get(mapKey, {});
      const savedId = map[mdPath] || null;
      panel.webview.postMessage({ type: 'zhihuArticleId', articleId: savedId });
      break;
    }

    case 'zhihuPublish': {
      try {
        // 自动获取文章标题
        const { title: docTitle, bodyHtml } = renderForPlatform(mdPath);
        const title = (msg.title && msg.title.trim()) || docTitle || '';
        if (!title.trim()) {
          panel.webview.postMessage({ type: 'zhihuPublishResult', success: false, error: '文章标题不能为空' });
          break;
        }

        // 检查登录状态，未登录则自动登录
        let cookies = zhihuBrowserCookies();
        if (!cookies.length) {
          panel.webview.postMessage({ type: 'zhihuPublishProgress', message: '未登录，正在打开登录窗口...' });
          log('知乎发布：未登录，自动触发登录');
          try {
            const loginResult = await social.login('zhihu', {
              extensionPath: extContext.extensionUri.fsPath,
              storage: extContext.globalState,
              onProgress: (m) => panel.webview.postMessage({ type: 'zhihuPublishProgress', message: m }),
              onChild: (c) => { lastChild.zhihu = c; },
            });
            // 登录成功后保存 cookie 并重新读取
            const oldCookieStr = loginResult.cookies.map(c => `${c.name}=${c.value}`).join('; ');
            await extContext.globalState.update(zhihu.STORAGE_KEY, oldCookieStr);
            cookies = zhihuBrowserCookies();
            if (!cookies.length) {
              panel.webview.postMessage({ type: 'zhihuPublishResult', success: false, error: '登录未完成，请重试' });
              break;
            }
            panel.webview.postMessage({ type: 'zhihuPublishProgress', message: '登录成功，开始发布...' });
          } catch (loginErr) {
            if (loginErr.needInstall) {
              panel.webview.postMessage({ type: 'zhihuPublishResult', success: false, error: '未找到 Chromium，请先使用 Playwright 相关功能触发自动安装' });
            } else {
              panel.webview.postMessage({ type: 'zhihuPublishResult', success: false, error: '自动登录失败：' + loginErr.message });
            }
            break;
          }
        }

        const cfg = vscode.workspace.getConfiguration('qmd2any');
        const cleanHtml = zhihu.buildPublishHtml(bodyHtml);
        const imageMdPath = isQuartoFile(mdPath)
          ? (quarto.getCached(mdPath) ? quarto.getCached(mdPath).mdPath : mdPath)
          : mdPath;
        const localImages = listMarkdownLocalImages(imageMdPath);

        panel.webview.postMessage({ type: 'zhihuPublishStart' });
        log(`知乎发布: 正文 ${cleanHtml.length} 字节，本地图 ${localImages.length} 张（来源: ${path.basename(imageMdPath)}）`);

        killWorker('zhihu');
        const result = await social.publish('zhihu', {
          extensionPath: extContext.extensionUri.fsPath,
          cookies,
          content: { title: title.trim(), html: cleanHtml },
          images: localImages,
          mode: cfg.get('publish.mode', 'prepare'),
          headless: false,
          onChild: (c) => { lastChild.zhihu = c; },
          onProgress: (m) => panel.webview.postMessage({ type: 'zhihuPublishProgress', message: m }),
          onStep: (s) => panel.webview.postMessage({ type: 'zhihuPublishProgress', message: `[${s.done}/${s.total}] ${s.label}` }),
        });

        log(`知乎发布完成: ${result.status}`);
        panel.webview.postMessage({
          type: 'zhihuPublishResult', success: true, browser: true,
          message: result.status === 'ready'
            ? '✅ 标题、正文、图片都已填好，请在浏览器里核对后自己点「发布」'
            : '✅ 已提交发布，请在浏览器确认',
        });
      } catch (err) {
        log(`知乎发布失败: ${err.message}`);
        panel.webview.postMessage({ type: 'zhihuPublishResult', success: false, error: err.message, canResume: !!err.canResume });
      }
      break;
    }

    case 'zhihuSaveDraft': {
      try {
        const { title, articleId: existingId } = msg;
        if (!title || !title.trim()) {
          panel.webview.postMessage({ type: 'zhihuDraftResult', success: false, error: '文章标题不能为空' });
          break;
        }

        const cfg = vscode.workspace.getConfiguration('qmd2any');
        const { bodyHtml } = renderForPlatform(mdPath);
        const cleanHtml = zhihu.buildPublishHtml(bodyHtml);
        const imageMdPath = isQuartoFile(mdPath)
          ? (quarto.getCached(mdPath) ? quarto.getCached(mdPath).mdPath : mdPath)
          : mdPath;
        const localImages = listMarkdownLocalImages(imageMdPath);
        const cookies = zhihuBrowserCookies();

        if (!cookies.length) {
          panel.webview.postMessage({ type: 'zhihuDraftResult', success: false, error: '未登录，请先扫码登录' });
          break;
        }

        panel.webview.postMessage({ type: 'zhihuPublishStart' });
        log(`知乎存草稿: 正文 ${cleanHtml.length} 字节，本地图 ${localImages.length} 张（来源: ${path.basename(imageMdPath)}）`);

        killWorker('zhihu');
        const result = await social.publish('zhihu', {
          extensionPath: extContext.extensionUri.fsPath,
          cookies,
          content: { title: title.trim(), html: cleanHtml },
          images: localImages,
          mode: 'prepare',
          headless: false,
          onChild: (c) => { lastChild.zhihu = c; },
          onProgress: (m) => panel.webview.postMessage({ type: 'zhihuPublishProgress', message: m }),
          onStep: (s) => panel.webview.postMessage({ type: 'zhihuPublishProgress', message: `[${s.done}/${s.total}] ${s.label}` }),
        });

        log(`知乎草稿保存完成: ${result.status}`);
        panel.webview.postMessage({
          type: 'zhihuDraftResult', success: true, browser: true,
          message: '✅ 标题、正文、图片都已填好，请在浏览器里核对后点「发布」',
        });
      } catch (err) {
        log(`知乎草稿保存失败: ${err.message}`);
        panel.webview.postMessage({ type: 'zhihuDraftResult', success: false, error: err.message, canResume: !!err.canResume });
      }
      break;
    }

    default:
      break;
  }
}


// ─────────────────────────────────────────────
//  生成 Webview HTML
// ─────────────────────────────────────────────

function getNonce() {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function getWebviewHtml(webview, _bodyHtml, mdPath) {
  const nonce = getNonce();
  const csp = webview.cspSource;

  // KaTeX 资源 URI（从扩展的 node_modules 加载）
  const katexDistPath = path.join(extContext.extensionUri.fsPath, 'node_modules', 'katex', 'dist');
  const katexDistUri = webview.asWebviewUri(vscode.Uri.file(katexDistPath));

  // highlight.js 样式 URI
  const hlStylePath = path.join(
    extContext.extensionUri.fsPath,
    'node_modules',
    'highlight.js',
    'styles',
    'github.min.css',
  );
  const hlStyleUri = webview.asWebviewUri(vscode.Uri.file(hlStylePath));

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${csp} 'unsafe-inline';
    font-src ${csp};
    script-src 'nonce-${nonce}';
    img-src ${csp} data: https: http:;
    connect-src https: http:;
  ">
  <title>QMD2Any 预览</title>

  <!-- KaTeX CSS（从扩展本地加载，支持字体） -->
  <link rel="stylesheet" href="${katexDistUri}/katex.min.css">
  <!-- highlight.js GitHub 主题 -->
  <link rel="stylesheet" href="${hlStyleUri}">
  <style>
    /* ── 基础重置 ── */
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #e8e8e8;
      color: #333;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── 工具栏 ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #2c2c2c;
      border-bottom: 1px solid #444;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .toolbar-title {
      flex: 1;
      font-size: 13px;
      color: #ccc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .btn {
      padding: 5px 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .btn-primary   { background: #07c160; color: #fff; }
    .btn-primary:hover   { background: #06ad56; }
    .btn-secondary { background: #555; color: #eee; }
    .btn-secondary:hover { background: #666; }
    .btn-active    { background: #0078d4; color: #fff; }
    .btn-zhihu-publish  { background: #1772f6; color: #fff; }
    .btn-zhihu-publish:hover { background: #0e5cd1; }
    .zhihu-tab {
      flex: 1; padding: 7px 0; background: none; border: none;
      border-bottom: 2px solid transparent; color: #888; font-size: 13px;
      cursor: pointer; transition: all 0.15s;
    }
    .zhihu-tab:hover { color: #ccc; }
    .zhihu-tab-active { color: #4fc3f7; border-bottom-color: #4fc3f7; }
    .btn:disabled  { opacity: 0.5; cursor: not-allowed; }

    /* ── 主区域 ── */
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── 预览区域 ── */
    .preview-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0;
      display: flex;
      justify-content: center;
      background: #fff;
    }
    .article-wrapper {
      width: 100%;
      max-width: 680px;
      background: transparent;
      padding: 32px 28px;
      min-height: 200px;
    }

    /* ── 侧面板通用 ── */
    .side-panel {
      width: 0;
      overflow: hidden;
      transition: width 0.25s ease;
      background: #1e1e1e;
      border-left: 1px solid #444;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .side-panel.open { width: 340px; }
    .side-panel-header {
      padding: 12px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #ccc;
      border-bottom: 1px solid #333;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-close-btn {
      background: none;
      border: none;
      color: #888;
      font-size: 16px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      flex-shrink: 0;
    }
    .panel-close-btn:hover { color: #fff; }
    .side-panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    label {
      display: block;
      font-size: 12px;
      color: #aaa;
      margin-bottom: 4px;
      margin-top: 12px;
    }
    label:first-child { margin-top: 0; }
    input[type=text], input[type=password], textarea {
      width: 100%;
      padding: 7px 10px;
      background: #2d2d2d;
      border: 1px solid #444;
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus, textarea:focus { border-color: #0078d4; }
    textarea {
      resize: vertical;
      min-height: 80px;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 12px;
    }
    #css-textarea { min-height: 300px; }
    .panel-actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .panel-actions .btn { flex: 1; }
    .hint {
      font-size: 11px;
      color: #777;
      margin-top: 8px;
      line-height: 1.5;
    }
    .hint a { color: #4fc3f7; }
    .divider {
      height: 1px;
      background: #333;
      margin: 14px 0;
    }

    /* ── 状态消息 ── */
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(80px);
      background: #333;
      color: #fff;
      padding: 10px 20px;
      border-radius: 20px;
      font-size: 13px;
      opacity: 0;
      transition: all 0.3s;
      z-index: 9999;
      white-space: nowrap;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .toast.success { background: #07c160; }
    .toast.error   { background: #c0392b; }

    /* ── 上传结果区域 ── */
    .upload-result {
      margin-top: 12px;
      padding: 10px;
      border-radius: 4px;
      font-size: 13px;
      display: none;
    }
    .upload-result.success { background: #1a3a1a; color: #aff; border: 1px solid #2a6a2a; }
    .upload-result.error   { background: #3a1a1a; color: #faa; border: 1px solid #6a2a2a; }

    /* ── 文章内容样式（镜像 template.html 以便预览一致） ── */
    .article-wrapper p,
    .article-wrapper li,
    .article-wrapper td,
    .article-wrapper th {
      text-align: left;
      color: #3f3f3f;
      line-height: 1.75em;
      font-family: system-ui, -apple-system, BlinkMacSystemFont,
        'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB',
        'Microsoft YaHei UI', 'Microsoft YaHei', Arial, sans-serif;
      font-size: 16px;
    }
    .article-wrapper strong { font-weight: 600; color: rgb(0, 122, 170); }
    .article-wrapper img { outline: none; text-decoration: none; max-width: 100%; display: block; margin: 0 auto; }
    .article-wrapper p { margin: 1.3em 0; }
    .article-wrapper h1 { font-size: 140%; color: #de7456; text-align: center; }
    .article-wrapper h2 {
      font-size: 120%; font-weight: bold; color: #de7456;
      text-align: center; line-height: 2;
      border-bottom: 1px solid #de7456;
      margin: 1em auto; padding-bottom: 4px;
    }
    .article-wrapper h3 {
      font-size: 110%; color: rgb(0, 122, 170);
      border-left: 3px solid rgb(0, 122, 170);
      padding-left: 10px; margin: 24px 0;
    }
    .article-wrapper h4, .article-wrapper h5, .article-wrapper h6 {
      font-size: 100%; color: rgb(0, 122, 170); margin: 16px 0;
    }
    .article-wrapper a { color: orange; }
    .article-wrapper blockquote {
      border-left: 4px solid #ddd;
      margin: 1em 0;
      padding: 0.5em 1em;
      color: #666;
      background: #fafafa;
    }
    .article-wrapper table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    .article-wrapper table td,
    .article-wrapper table th {
      border: 1px solid #999;
      padding: 8px;
    }
    .article-wrapper table th { background: #f2f2f2; font-weight: bold; text-align: center; }
    .article-wrapper ul, .article-wrapper ol { padding-left: 1.5em; }
    .article-wrapper figcaption {
      display: block;
      text-align: center;
      color: #999;
      font-size: 14px;
      margin-top: 8px;
      line-height: 1.5;
    }
    /* KaTeX 公式样式 */
    .article-wrapper .math-block {
      text-align: center;
      overflow-x: auto;
      margin: 1.2em 0;
    }
    .article-wrapper .math-inline { display: inline; }
    /* 代码块 mac 风格 */
    .article-wrapper pre.mac-code {
      border-radius: 8px;
      background: #f6f8fa;
      border: 1px solid #eaedf0;
      overflow-x: auto;
      margin: 10px 0;
    }
    .article-wrapper pre.mac-code code.hljs { padding: 10px 16px; }
    .article-wrapper code:not([class]) {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 14px;
    }

    /* ── Todo 任务列表 ── */
    .article-wrapper .task-list-item {
      list-style: none;
      margin-left: -1.2em;
      padding-left: 0.2em;
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }
    .article-wrapper .task-checkbox {
      cursor: pointer;
      margin-top: 0.35em;
      flex-shrink: 0;
      width: 15px;
      height: 15px;
      accent-color: #07c160;
    }

    /* ── 缩放容器 ── */
    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .zoom-controls .btn {
      padding: 4px 9px;
      font-size: 14px;
    }
    #zoom-value {
      font-size: 12px;
      color: #ccc;
      min-width: 40px;
      text-align: center;
      user-select: none;
    }

    /* ── 目录（TOC）面板 ── */
    .toc-panel {
      width: 0;
      overflow: hidden;
      transition: width 0.25s ease;
      background: #1e1e1e;
      border-right: 1px solid #444;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .toc-panel.open { width: 240px; }
    .toc-panel .side-panel-header {
      border-bottom: 1px solid #333;
      border-right: none;
    }
    .toc-nav {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .toc-item {
      display: block;
      padding: 5px 16px;
      font-size: 12px;
      color: #ccc;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-left: 2px solid transparent;
      transition: all 0.15s;
      line-height: 1.5;
    }
    .toc-item:hover { background: #2a2a2a; color: #fff; }
    .toc-item.active { border-left-color: #07c160; color: #07c160; background: #1a2a1a; }
    .toc-item[data-level="1"] { padding-left: 16px; font-weight: 600; }
    .toc-item[data-level="2"] { padding-left: 28px; }
    .toc-item[data-level="3"] { padding-left: 40px; font-size: 11px; color: #aaa; }
    .toc-item[data-level="4"],
    .toc-item[data-level="5"],
    .toc-item[data-level="6"] { padding-left: 52px; font-size: 11px; color: #999; }
    .toc-empty {
      padding: 12px 16px;
      font-size: 12px;
      color: #666;
    }
    .btn-toc { background: #444; color: #eee; }
    .btn-toc:hover { background: #555; }
    .btn-quarto-compile { background: #6a3de8; color: #fff; }
    .btn-quarto-compile:hover { background: #5a2dd8; }
    /* ── Quarto 编译状态栏 ── */
    #quarto-status-bar {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: #1a1a2e;
      border-bottom: 1px solid #333;
      font-size: 12px;
      color: #aaa;
      flex-shrink: 0;
    }
    #quarto-status-bar.show { display: flex; }
    #quarto-status-bar .spinner {
      width: 14px; height: 14px;
      border: 2px solid #444;
      border-top: 2px solid #6a3de8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

  <!-- 工具栏 -->
  <div class="toolbar">
    <span class="toolbar-title" id="doc-title">QMD2Any 预览</span>
    <select id="theme-select" title="切换主题" style="
      padding:5px 8px; border:none; border-radius:4px; cursor:pointer;
      font-size:13px; background:#3a3a3a; color:#eee; outline:none;
    ">
      <option value="">主题...</option>
    </select>
    <button class="btn btn-toc" id="btn-toc" title="显示/隐藏文章目录（仅预览用，不影响导出）">
      📑 目录
    </button>
    <div class="zoom-controls">
      <button class="btn btn-secondary" id="btn-zoom-out" title="缩小预览">－</button>
      <span id="zoom-value">100%</span>
      <button class="btn btn-secondary" id="btn-zoom-in" title="放大预览">＋</button>
      <button class="btn btn-secondary" id="btn-zoom-reset" title="重置缩放" style="padding:4px 7px;">↺</button>
    </div>
    <button class="btn btn-primary" id="btn-copy" title="选中并复制预览区域内容，可直接粘贴到微信公众号编辑器">
      📋 复制微信
    </button>
    <button class="btn btn-zhihu-publish" id="btn-zhihu-publish" title="直接发布到知乎专栏（需扫码登录）">
      🚀 发布知乎
    </button>
  </div>

  <!-- Quarto 编译状态栏 -->
  <div id="quarto-status-bar">
    <div class="spinner" id="quarto-spinner" style="display:none;"></div>
    <span id="quarto-status-msg">请点击「🔄 编译」以渲染 Quarto 文档</span>
    <button class="btn btn-quarto-compile" id="btn-quarto-compile-inline" style="padding:3px 10px;font-size:12px;">🔄 编译</button>
  </div>

  <!-- 主内容区 -->
  <div class="main">
    <!-- 目录面板（仅预览用，不影响导出） -->
    <div class="toc-panel" id="toc-panel">
      <div class="side-panel-header">📑 目录<button class="panel-close-btn" data-close-panel="toc-panel" data-close-state="tocPanelOpen">×</button></div>
      <nav class="toc-nav" id="toc-nav">
        <p class="toc-empty">暂无标题</p>
      </nav>
    </div>

    <!-- 预览区 -->
    <div class="preview-scroll">
      <div class="article-wrapper" id="preview-content">
        <p style="color:#999;text-align:center;">正在加载预览...</p>
      </div>
    </div>

    <!-- 样式编辑面板 -->
    <div class="side-panel" id="style-panel">
      <div class="side-panel-header">🎨 自定义样式<button class="panel-close-btn" data-close-panel="style-panel" data-close-state="stylePanelOpen">×</button></div>
      <div class="side-panel-body">
        <p class="hint">在此输入 CSS，将作用于预览区域内的文章内容。<br>样式在当前会话内保持，不会影响导出文件。</p>
        <label>自定义 CSS</label>
        <textarea id="css-textarea" placeholder="/* 在这里输入自定义 CSS */
.article-wrapper h1 { color: red; }
.article-wrapper p { font-size: 18px; }
"></textarea>
        <div class="panel-actions">
          <button class="btn btn-primary" id="btn-apply-css">应用</button>
          <button class="btn btn-secondary" id="btn-reset-css">重置</button>
        </div>
      </div>
    </div>

    <!-- 知乎发布面板 -->
    <div class="side-panel" id="zhihu-publish-panel">
      <div class="side-panel-header">🚀 发布到知乎<button class="panel-close-btn" data-close-panel="zhihu-publish-panel" data-close-state="zhihuPublishPanelOpen">×</button></div>
      <div class="side-panel-body">

        <!-- 已登录视图 -->
        <div id="zhihu-logged-in" style="display:none;">
          <p class="hint" style="color:#4caf50;">✅ 已登录：<strong id="zhihu-user-name"></strong></p>
          <div class="panel-actions">
            <button class="btn btn-secondary" id="btn-zhihu-logout">退出登录</button>
          </div>
          <div class="divider"></div>
          <label>文章标题 <span style="color:#f06529">*</span></label>
          <input type="text" id="zhihu-input-title" placeholder="文章标题">
          <label>已有文章 ID（留空 = 新建，填写 = 更新）</label>
          <input type="text" id="zhihu-input-article-id" placeholder="留空新建，填写则更新已有文章">
          <p class="hint" style="margin-top:4px;">文章 ID 是知乎链接 <code style="color:#4fc3f7;">/p/</code> 后的数字，发布成功后自动填入。</p>
          <div class="hint" style="margin-top:10px;color:#e6a817;border:1px solid #555;padding:8px;border-radius:4px;">
            ⚠️ 发布后文章将直接公开到你的知乎专栏，请确认内容无误后再发布。
          </div>
          <div class="panel-actions" style="margin-top:14px;">
            <button class="btn btn-zhihu-publish" id="btn-zhihu-do-publish">发布文章</button>
            <button class="btn btn-secondary" id="btn-zhihu-save-draft" title="保存为草稿，可在知乎官网预览效果后再发布" style="display:none">保存草稿</button>
          </div>
          <p class="hint" id="zhihu-publish-progress" style="margin-top:8px;display:none;"></p>
          <div class="upload-result" id="zhihu-publish-result"></div>
        </div>

        <!-- 未登录视图：标签页切换 -->
        <div id="zhihu-logged-out">
          <!-- 标签页 -->
          <div style="display:flex;gap:0;margin-bottom:14px;border-bottom:1px solid #444;">
            <button id="zhihu-tab-qr"     class="zhihu-tab zhihu-tab-active">📱 扫码登录</button>
            <button id="zhihu-tab-cookie" class="zhihu-tab">🍪 手动 Cookie</button>
          </div>

          <!-- 浏览器登录 -->
          <div id="zhihu-pane-qr">
            <p class="hint">点击下方按钮，将弹出真实浏览器窗口。<br>在浏览器中用手机扫码（或账号密码）登录知乎，登录后插件将自动获取凭证。<br><br>登录凭证仅保存在本地 VS Code 存储中，不写入文件，不会被 git 追踪。</p>
            <div class="panel-actions">
              <button class="btn btn-zhihu-publish" id="btn-zhihu-qr">打开浏览器登录</button>
            </div>
            <p class="hint" id="zhihu-qr-hint" style="margin-top:10px;display:none;"></p>
          </div>

          <!-- 手动 Cookie -->
          <div id="zhihu-pane-cookie" style="display:none;">
            <p class="hint">
              在浏览器打开 <strong style="color:#ccc;">zhihu.com</strong>，登录后按 F12 → Application → Cookies，
              复制 <code style="color:#4fc3f7;">z_c0</code> 的值粘贴到下方。<br>
              Cookie 仅保存在本地 VS Code 存储中，不写入文件，不会被 git 追踪。
            </p>
            <label>z_c0 Cookie 值 <span style="color:#f06529">*</span></label>
            <textarea id="zhihu-input-cookie" placeholder="粘贴 z_c0 的值..." style="min-height:80px;font-size:11px;word-break:break-all;"></textarea>
            <div class="panel-actions" style="margin-top:10px;">
              <button class="btn btn-zhihu-publish" id="btn-zhihu-save-cookie">验证并保存</button>
            </div>
            <div class="upload-result" id="zhihu-cookie-result"></div>
          </div>
        </div>

      </div>
    </div>

  </div>

  <!-- Toast 提示 -->
  <div class="toast" id="toast"></div>

  <!-- 自定义样式注入点 -->
  <style id="custom-style"></style>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ─── 状态 ───
    let currentTitle = '';
    let currentBodyHtml = '';
    let currentThemeBg = '#ffffff';
    let currentThemeId = '';
    let currentZoom = 100;
    // 用对象统一管理面板开关状态，避免 let 变量与 window 属性不同步的 bug
    const panelState = { stylePanelOpen: false, tocPanelOpen: false, zhihuPublishPanelOpen: false };

    // ─── 工具函数 ───
    function showToast(msg, type = '', duration = 2500) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show' + (type ? ' ' + type : '');
      clearTimeout(el._timer);
      el._timer = setTimeout(() => { el.className = 'toast'; }, duration);
    }

    function applyTheme(theme) {
      currentThemeBg = theme.wrapperBg || '#ffffff';
      // 替换主题样式
      let styleEl = document.getElementById('theme-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'theme-style';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = '.article-wrapper { background: ' + theme.wrapperBg + '; } .article-wrapper ' +
        theme.css.replace(/([^}]+{)/g, (m) => '.article-wrapper ' + m);
      // 背景色应用到整个预览区域
      document.querySelector('.preview-scroll').style.background = theme.wrapperBg;
    }

    function closePanel(panelId, stateKey) {
      panelState[stateKey] = false;
      const el = document.getElementById(panelId);
      if (el) {
        el.classList.remove('open');
        el.style.width = ''; // 清除 resize handle 设置的内联 width，避免覆盖 CSS width:0
      }
      updateBtnActive();
    }

    function togglePanel(panelId, stateKey, closeOtherIds) {
      const panel  = document.getElementById(panelId);
      const newVal = !panelState[stateKey];
      panelState[stateKey] = newVal;
      panel.classList.toggle('open', newVal);
      if (!newVal) panel.style.width = ''; // 关闭时清除内联 width
      // 关闭其他面板
      (closeOtherIds || []).forEach(id => {
        const other = document.getElementById(id.panelId);
        panelState[id.stateKey] = false;
        if (other) { other.classList.remove('open'); other.style.width = ''; }
      });
      updateBtnActive();
    }

    function updateBtnActive() {
      document.getElementById('btn-toc').className =
        'btn ' + (panelState.tocPanelOpen ? 'btn-active' : 'btn-toc');
      document.getElementById('btn-zhihu-publish').className =
        'btn ' + (panelState.zhihuPublishPanelOpen ? 'btn-active' : 'btn-zhihu-publish');
    }

    // 面板关闭按钮（事件委托）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.panel-close-btn');
      if (!btn) return;
      const panelId  = btn.dataset.closePanel;
      const stateKey = btn.dataset.closeState;
      if (panelId && stateKey) closePanel(panelId, stateKey);
    });

    // ─── 按钮事件 ───

    // ── Quarto 编译按钮 ──
    let _quartoIsCompiling = false;

    function setQuartoCompiling(compiling) {
      _quartoIsCompiling = compiling;
      const btns = ['btn-quarto-compile', 'btn-quarto-compile-inline'];
      btns.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = compiling;
        el.textContent = compiling ? '⏳ 编译中...' : '🔄 编译';
      });
      const spinner = document.getElementById('quarto-spinner');
      if (spinner) spinner.style.display = compiling ? '' : 'none';
    }

    // 状态栏编译按钮
    document.getElementById('btn-quarto-compile-inline').addEventListener('click', () => {
      if (_quartoIsCompiling) return;
      setQuartoCompiling(true);
      document.getElementById('quarto-status-msg').textContent = '正在启动 Quarto...';
      vscode.postMessage({ type: 'quartoCompile' });
    });

    // ─── TOC 目录 ───

    function buildToc() {
      const nav = document.getElementById('toc-nav');
      if (!nav) return;
      const content = document.getElementById('preview-content');
      if (!content) return;
      const headings = content.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (!headings.length) {
        nav.innerHTML = '<p class="toc-empty">暂无标题</p>';
        return;
      }
      // 给没有 id 的标题赋予 id，供锚点跳转
      headings.forEach((h, i) => {
        if (!h.id) h.id = 'toc-heading-' + i;
      });
      nav.innerHTML = Array.from(headings).map(h => {
        const level = parseInt(h.tagName[1]);
        const text = h.innerText || h.textContent || '';
        return \`<a class="toc-item" data-level="\${level}" data-id="\${h.id}" title="\${text}">\${text}</a>\`;
      }).join('');

      // 点击跳转
      nav.querySelectorAll('.toc-item').forEach(item => {
        item.addEventListener('click', () => {
          const targetId = item.dataset.id;
          const target = document.getElementById(targetId);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // 高亮当前项
            nav.querySelectorAll('.toc-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
          }
        });
      });
    }

    // 滚动时更新 TOC 高亮
    document.querySelector('.preview-scroll').addEventListener('scroll', () => {
      if (!panelState.tocPanelOpen) return;
      const nav = document.getElementById('toc-nav');
      if (!nav) return;
      const items = nav.querySelectorAll('.toc-item');
      if (!items.length) return;
      const scrollTop = document.querySelector('.preview-scroll').scrollTop;
      let activeItem = null;
      items.forEach(item => {
        const target = document.getElementById(item.dataset.id);
        if (target && target.offsetTop - 80 <= scrollTop) activeItem = item;
      });
      items.forEach(i => i.classList.remove('active'));
      if (activeItem) activeItem.classList.add('active');
    });

    // 目录按钮
    document.getElementById('btn-toc').addEventListener('click', () => {
      togglePanel('toc-panel', 'tocPanelOpen', []);
      if (panelState.tocPanelOpen) buildToc();
    });

    // 主题切换
    document.getElementById('theme-select').addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        togglePanel('style-panel', 'stylePanelOpen',
          [{panelId:'zhihu-publish-panel',stateKey:'zhihuPublishPanelOpen'}]);
        // 恢复为当前主题的选中项
        const sel = document.getElementById('theme-select');
        sel.value = currentThemeId || '';
        return;
      }
      vscode.postMessage({ type: 'setTheme', themeId: e.target.value });
    });

    // 复制内容（向 extension 请求带内联 CSS 的 HTML，再写入剪贴板）
    document.getElementById('btn-copy').addEventListener('click', () => {
      const btn = document.getElementById('btn-copy');
      btn.disabled = true;
      btn.textContent = '⏳ 处理中...';
      vscode.postMessage({ type: 'getWechatHtml' });
    });

    document.getElementById('btn-zhihu-publish').addEventListener('click', () => {
      const btn = document.getElementById('btn-zhihu-publish');
      btn.disabled = true;
      btn.textContent = '⏳ 发布中...';
      // 直接发布，使用当前文档标题
      vscode.postMessage({ type: 'zhihuPublish', title: currentTitle || '' });
    });

    // 知乎面板内部事件

    // 标签页切换
    function switchZhihuTab(tab) {
      const isQr = tab === 'qr';
      document.getElementById('zhihu-pane-qr').style.display     = isQr ? '' : 'none';
      document.getElementById('zhihu-pane-cookie').style.display  = isQr ? 'none' : '';
      document.getElementById('zhihu-tab-qr').className     = 'zhihu-tab' + (isQr ? ' zhihu-tab-active' : '');
      document.getElementById('zhihu-tab-cookie').className  = 'zhihu-tab' + (!isQr ? ' zhihu-tab-active' : '');
      if (!isQr) stopZhihuQrPoll();
    }
    document.getElementById('zhihu-tab-qr').addEventListener('click',     () => switchZhihuTab('qr'));
    document.getElementById('zhihu-tab-cookie').addEventListener('click',  () => switchZhihuTab('cookie'));

    document.getElementById('btn-zhihu-qr').addEventListener('click', () => {
      vscode.postMessage({ type: 'zhihuStartQr' });
    });

    document.getElementById('btn-zhihu-save-cookie').addEventListener('click', () => {
      const raw = document.getElementById('zhihu-input-cookie').value.trim();
      if (!raw) { showToast('请输入 z_c0 值', 'error'); return; }
      const btn = document.getElementById('btn-zhihu-save-cookie');
      btn.disabled = true; btn.textContent = '⏳ 验证中...';
      vscode.postMessage({ type: 'zhihuSaveCookie', z_c0: raw });
    });

    document.getElementById('btn-zhihu-logout').addEventListener('click', () => {
      if (!confirm('确认退出知乎登录？')) return;
      vscode.postMessage({ type: 'zhihuLogout' });
    });

    document.getElementById('btn-zhihu-do-publish').addEventListener('click', () => {
      const title     = document.getElementById('zhihu-input-title').value.trim();
      const articleId = document.getElementById('zhihu-input-article-id').value.trim();
      if (!title) { showToast('请填写文章标题', 'error'); return; }
      vscode.postMessage({ type: 'zhihuPublish', title, articleId: articleId || null });
    });

    // 扫码轮询定时器
    let _zhihuQrTimer = null;
    function startZhihuQrPoll() {
      stopZhihuQrPoll();
      _zhihuQrTimer = setInterval(() => {
        vscode.postMessage({ type: 'zhihuPollQr' });
      }, 2000);
    }
    function stopZhihuQrPoll() {
      if (_zhihuQrTimer) { clearInterval(_zhihuQrTimer); _zhihuQrTimer = null; }
    }

    // 应用自定义 CSS
    document.getElementById('btn-apply-css').addEventListener('click', () => {
      const css = document.getElementById('css-textarea').value;
      document.getElementById('custom-style').textContent = css;
      showToast('样式已应用', 'success');
    });

    // 重置 CSS
    document.getElementById('btn-reset-css').addEventListener('click', () => {
      document.getElementById('css-textarea').value = '';
      document.getElementById('custom-style').textContent = '';
      showToast('样式已重置');
    });

    // ─── 接收 extension 消息 ───
    window.addEventListener('message', ({ data: msg }) => {
      switch (msg.type) {
        case 'update': {
          currentBodyHtml = msg.bodyHtml || '';
          currentTitle    = msg.title || '';
          document.getElementById('preview-content').innerHTML = currentBodyHtml;
          document.getElementById('doc-title').textContent = currentTitle
            ? \`预览: \${currentTitle}\`
            : 'QMD2Any 预览';
          // 应用主题
          if (msg.theme) {
            if (msg.theme.id) currentThemeId = msg.theme.id;
            applyTheme(msg.theme);
          }
          // 内容更新后同步重建目录
          if (panelState.tocPanelOpen) buildToc();
          // QMD 模式：状态栏保留唯一的编译按钮；缓存有效时不隐藏。
          if (msg.isQuarto) {
            const bar = document.getElementById('quarto-status-bar');
            if (bar) bar.classList.add('show');
            const statusMsg = document.getElementById('quarto-status-msg');
            if (statusMsg) statusMsg.textContent = '已使用编译缓存，若需重新编译，请点击：';
            setQuartoCompiling(false);
          }
          break;
        }

        // ── Quarto 消息 ──
        case 'quartoMode': {
          // 进入 QMD 模式：状态栏会显示编译按钮
          break;
        }
        case 'quartoStatus': {
          // 需要编译或已就绪
          const bar = document.getElementById('quarto-status-bar');
          if (msg.needsCompile) {
            if (bar) {
              bar.classList.add('show');
              document.getElementById('quarto-status-msg').textContent = msg.message || '请先编译 Quarto 文档';
            }
            setQuartoCompiling(false);
          } else {
            if (bar) bar.classList.remove('show');
          }
          break;
        }
        case 'quartoCompileProgress': {
          const bar = document.getElementById('quarto-status-bar');
          if (bar) bar.classList.add('show');
          document.getElementById('quarto-status-msg').textContent = msg.message || '';
          break;
        }
        case 'quartoCompileDone': {
          setQuartoCompiling(false);
          const bar = document.getElementById('quarto-status-bar');
          if (bar) bar.classList.add('show');
          const statusMsg = document.getElementById('quarto-status-msg');
          if (statusMsg) statusMsg.textContent = msg.cached
            ? '已使用编译缓存，若需重新编译，请点击：'
            : '✅ Quarto 编译完成';
          showToast(msg.cached ? '✅ 已使用编译缓存，若需重新编译，请点击：' : '✅ Quarto 编译完成', 'success');
          break;
        }
        case 'quartoCompileError': {
          setQuartoCompiling(false);
          const bar = document.getElementById('quarto-status-bar');
          if (bar) bar.classList.add('show');
          document.getElementById('quarto-status-msg').textContent = '❌ ' + (msg.message || '编译失败');
          showToast('Quarto 编译失败: ' + (msg.message || '未知错误'), 'error', 5000);
          break;
        }

        case 'themeList': {
          const sel = document.getElementById('theme-select');
          sel.innerHTML = '';
          (msg.themes || []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            if (t.id === msg.currentId) opt.selected = true;
            sel.appendChild(opt);
          });
          currentThemeId = msg.currentId || '';
          // 末尾追加「自定义样式」选项
          const customOpt = document.createElement('option');
          customOpt.value = '__custom__';
          customOpt.textContent = '🎨 自定义样式...';
          sel.appendChild(customOpt);
          break;
        }
        case 'error': {
          document.getElementById('preview-content').innerHTML =
            \`<p style="color:red;font-family:monospace;">⚠️ 渲染错误：\${msg.message}</p>\`;
          break;
        }
        case 'wechatHtml': {
          const btn = document.getElementById('btn-copy');
          btn.disabled = false;
          btn.textContent = '📋 复制微信';
          const html = msg.html || '';
          // 优先用 ClipboardItem API，保留富文本格式
          if (navigator.clipboard && window.ClipboardItem) {
            navigator.clipboard.write([
              new ClipboardItem({
                'text/html':  new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([
                  document.getElementById('preview-content').innerText || ''
                ], { type: 'text/plain' }),
              }),
            ]).then(() => {
              showToast('✅ 已复制！直接粘贴到微信公众号编辑器即可', 'success');
            }).catch(() => {
              // 降级：execCommand
              fallbackCopy();
            });
          } else {
            fallbackCopy();
          }
          function fallbackCopy() {
            const tmp = document.createElement('div');
            tmp.style.cssText = 'position:fixed;left:-9999px;top:0;';
            tmp.innerHTML = html;
            document.body.appendChild(tmp);
            const range = document.createRange();
            range.selectNodeContents(tmp);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            try { document.execCommand('copy'); showToast('✅ 已复制！直接粘贴到微信公众号编辑器即可', 'success'); }
            catch (_) { showToast('复制失败，请手动 Ctrl+A 后复制', 'error'); }
            sel.removeAllRanges();
            document.body.removeChild(tmp);
          }
          break;
        }
        case 'wechatHtmlError': {
          const btn = document.getElementById('btn-copy');
          btn.disabled = false;
          btn.textContent = '📋 复制微信';
          showToast('复制失败：' + (msg.message || '未知错误'), 'error');
          break;
        }
        // ── 知乎发布 ──
        case 'zhihuLoginStatus': {
          const loggedOut = document.getElementById('zhihu-logged-out');
          const loggedIn  = document.getElementById('zhihu-logged-in');
          if (msg.loggedIn) {
            loggedOut.style.display = 'none';
            loggedIn.style.display  = 'block';
            document.getElementById('zhihu-user-name').textContent = msg.name || '（已登录）';
            stopZhihuQrPoll();
          } else {
            loggedOut.style.display = 'block';
            loggedIn.style.display  = 'none';
            document.getElementById('zhihu-input-cookie').value = '';
            document.getElementById('zhihu-cookie-result').style.display = 'none';
            switchZhihuTab('qr');
          }
          break;
        }
        case 'zhihuSaveCookieResult': {
          const btn = document.getElementById('btn-zhihu-save-cookie');
          btn.disabled = false; btn.textContent = '验证并保存';
          const res = document.getElementById('zhihu-cookie-result');
          if (msg.success) {
            res.className = 'upload-result success';
            res.textContent = \`✅ 验证成功，已登录为：\${msg.name || '（未知用户）'}\`;
            showToast('知乎 Cookie 已保存！', 'success');
          } else {
            res.className = 'upload-result error';
            res.textContent = \`❌ \${msg.error || '验证失败'}\`;
            showToast(msg.error || '验证失败', 'error');
          }
          res.style.display = 'block';
          break;
        }
        case 'zhihuQrProgress': {
          const btn = document.getElementById('btn-zhihu-qr');
          btn.disabled = true; btn.textContent = '⏳ 启动中...';
          const hint = document.getElementById('zhihu-qr-hint');
          hint.textContent = msg.message || '正在启动浏览器...';
          hint.style.display = '';
          break;
        }
        case 'zhihuQrReady': {
          const hint = document.getElementById('zhihu-qr-hint');
          hint.textContent = '浏览器已打开，请在浏览器窗口中完成登录...';
          hint.style.display = '';
          document.getElementById('btn-zhihu-qr').disabled = true;
          document.getElementById('btn-zhihu-qr').textContent = '⏳ 等待登录...';
          break;
        }
        case 'zhihuQrError': {
          const btn = document.getElementById('btn-zhihu-qr');
          btn.disabled = false; btn.textContent = '重新打开浏览器';
          const hint = document.getElementById('zhihu-qr-hint');
          hint.textContent = '❌ ' + (msg.message || '未知错误');
          hint.style.display = '';
          break;
        }
        case 'zhihuPollResult': {
          if (msg.status === 'confirmed') {
            document.getElementById('btn-zhihu-qr').disabled = false;
            document.getElementById('btn-zhihu-qr').textContent = '重新登录';
            document.getElementById('zhihu-logged-out').style.display = 'none';
            document.getElementById('zhihu-logged-in').style.display  = 'block';
            document.getElementById('zhihu-user-name').textContent    = msg.name || '（已登录）';
            showToast('✅ 知乎登录成功！', 'success');
          } else if (msg.status === 'error') {
            const btn = document.getElementById('btn-zhihu-qr');
            btn.disabled = false; btn.textContent = '重新打开浏览器';
            showToast('登录出错：' + (msg.message || '未知错误'), 'error');
          }
          break;
        }
        case 'zhihuPublishStart': {
          const btn = document.getElementById('btn-zhihu-do-publish');
          btn.disabled = true; btn.textContent = '⏳ 发布中...';
          document.getElementById('zhihu-publish-result').style.display = 'none';
          const prog = document.getElementById('zhihu-publish-progress');
          prog.textContent = '准备中...';
          prog.style.display = '';
          break;
        }
        case 'zhihuPublishProgress': {
          const prog = document.getElementById('zhihu-publish-progress');
          prog.textContent = msg.message || '';
          prog.style.display = '';
          break;
        }
        case 'zhihuArticleId': {
          if (msg.articleId) {
            document.getElementById('zhihu-input-article-id').value = msg.articleId;
          }
          break;
        }
        case 'zhihuPublishResult': {
          const btn = document.getElementById('btn-zhihu-do-publish');
          if (btn) { btn.disabled = false; btn.textContent = '发布文章'; }
          const tbtn = document.getElementById('btn-zhihu-publish');
          if (tbtn) { tbtn.disabled = false; tbtn.textContent = '🚀 发布知乎'; }
          document.getElementById('zhihu-publish-progress').style.display = 'none';
          const res = document.getElementById('zhihu-publish-result');
          if (msg.success) {
            res.className = 'upload-result success';
            res.innerHTML = \`✅ 发布成功！<br><a href="\${msg.url}" style="color:#4fc3f7;word-break:break-all;" title="\${msg.url}">\${msg.url}</a>\`;
            showToast('知乎发布成功！', 'success');
            if (msg.articleId) {
              document.getElementById('zhihu-input-article-id').value = msg.articleId;
            }
          } else {
            res.className = 'upload-result error';
            res.textContent = \`❌ 发布失败：\${msg.error || '未知错误'}\`;
            showToast('发布失败', 'error');
          }
          res.style.display = 'block';
          break;
        }
      }
    });

    // ─── 缩放控制 ───
    function setZoom(zoom) {
      currentZoom = Math.max(30, Math.min(200, zoom));
      const el = document.getElementById('preview-content');
      if (el) el.style.zoom = currentZoom + '%';
      const zv = document.getElementById('zoom-value');
      if (zv) zv.textContent = currentZoom + '%';
    }
    document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(currentZoom - 10));
    document.getElementById('btn-zoom-in').addEventListener('click',  () => setZoom(currentZoom + 10));
    document.getElementById('btn-zoom-reset').addEventListener('click', () => setZoom(100));

    // 鼠标滚轮 + Ctrl 快捷缩放
    document.getElementById('preview-content').addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(currentZoom + (e.deltaY < 0 ? 10 : -10));
    }, { passive: false });

    // ─── Todo 任务列表交互 ───
    document.getElementById('preview-content').addEventListener('change', (e) => {
      if (!e.target.classList.contains('task-checkbox')) return;
      const all = Array.from(document.querySelectorAll('#preview-content .task-checkbox'));
      const index = all.indexOf(e.target);
      if (index >= 0) {
        vscode.postMessage({ type: 'todoToggle', index, checked: e.target.checked });
      }
    });

    // ─── 初始化 ───
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

// ── 知乎发布辅助函数 ──

function killWorker(platform) {
  const c = lastChild[platform];
  if (c && !c.killed) { try { c.kill('SIGTERM'); } catch (_) {} }
  lastChild[platform] = null;
}

function zhihuBrowserCookies() {
  const str = extContext.globalState.get(zhihu.STORAGE_KEY, '') || '';
  return str.split(/;\s*/).map(p => {
    const i = p.indexOf('=');
    if (i <= 0) return null;
    return {
      name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(),
      domain: '.zhihu.com', path: '/', expires: -1,
      httpOnly: false, secure: true, sameSite: 'Lax',
    };
  }).filter(c => c && c.name && c.value);
}

function listMarkdownLocalImages(mdPath) {
  try {
    const raw = fs.readFileSync(mdPath, 'utf8');
    const dir = path.dirname(mdPath);
    const out = [];
    const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const src = m[1];
      if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) continue;
      const abs = path.isAbsolute(src) ? src : path.resolve(dir, src);
      if (fs.existsSync(abs)) out.push(abs);
    }
    return out;
  } catch (_) { return []; }
}

module.exports = { activate, deactivate };
