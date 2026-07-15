#!/usr/bin/env node
'use strict';
/**
 * zhihu_login.js — 打开浏览器让用户登录知乎，登录成功后输出 cookie
 *
 * 输出协议（stdout 每行一个）：
 *   READY              — 浏览器已打开，等待用户登录
 *   COOKIE:<json>      — 登录成功，输出 cookie 对象数组（playwright 格式）
 *   ERROR:<message>    — 致命错误
 *   NEED_INSTALL       — 未找到可用浏览器
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// 优先使用系统 Chrome/Edge（比 Playwright 内置 Chromium 更难被检测）
function findBrowser() {
  const system = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  };
  for (const p of (system[process.platform] || [])) {
    if (fs.existsSync(p)) return p;
  }
  // 回退到 Playwright 内置 Chromium
  const home     = os.homedir();
  const cacheDir = path.join(home, '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    const entries = fs.readdirSync(cacheDir).filter(e => e.startsWith('chromium'));
    for (const entry of entries) {
      const candidates = {
        darwin: path.join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        linux:  path.join(cacheDir, entry, 'chrome-linux', 'chrome'),
        win32:  path.join(cacheDir, entry, 'chrome-win', 'chrome.exe'),
      };
      const p = candidates[process.platform];
      if (p && fs.existsSync(p)) return p;
    }
  }
  return null;
}

(async () => {
  const execPath = findBrowser();
  if (!execPath) {
    process.stdout.write('NEED_INSTALL\n');
    process.exit(2);
  }

  let playwright;
  try {
    playwright = require('playwright-core');
  } catch (e) {
    process.stdout.write('ERROR:playwright-core 未安装\n');
    process.exit(1);
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({
      executablePath: execPath,
      headless: false,
      // 关键：去掉 --enable-automation，避免被知乎识别为自动化浏览器
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
      // 不传 ignoreDefaultArgs，但手动排除 automation 相关 flag
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (e) {
    process.stdout.write('ERROR:启动浏览器失败：' + e.message + '\n');
    process.exit(1);
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  // 在每个页面注入脚本，覆盖 navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // 同时去掉 chrome.runtime 注入痕迹
    if (window.chrome && window.chrome.runtime) {
      delete window.chrome.runtime;
    }
  });

  const page = await context.newPage();
  await page.goto('https://www.zhihu.com/signin', { waitUntil: 'domcontentloaded' });
  process.stdout.write('READY\n');

  const TIMEOUT_MS = 5 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 1500));

    if (!browser.isConnected()) {
      process.stdout.write('ERROR:浏览器已关闭\n');
      process.exit(1);
    }

    let cookies;
    try {
      cookies = await context.cookies('https://www.zhihu.com');
    } catch (_) {
      process.stdout.write('ERROR:浏览器已关闭\n');
      process.exit(1);
    }

    const z_c0 = cookies.find(c => c.name === 'z_c0');
    if (z_c0) {
      process.stdout.write('COOKIE:' + JSON.stringify(cookies) + '\n');
      await browser.close();
      process.exit(0);
    }
  }

  process.stdout.write('ERROR:登录超时（5 分钟内未完成）\n');
  await browser.close();
  process.exit(1);
})();
