'use strict';

/**
 * lib/social.js — 小红书 / Twitter 的 cookie 管理 + Playwright 发布调度（host 侧）
 *
 * 隐私 & 安全：
 *   - cookie 只通过 storage（VS Code globalState）存取，不落磁盘文件、不被 git 追踪。
 *   - 发布时把 cookie 写到系统临时目录的一次性 job 文件，用完即删。
 *   - 唯一网络去向是平台自己（xiaohongshu.com / x.com），无任何第三方。
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STORAGE_KEYS = {
  xiaohongshu: 'xiaohongshu.cookies',
  twitter:     'twitter.cookies',
  zhihu:       'zhihu.browserCookies',
};

// 与 scripts/social_worker.js 保持一致
// 关键：小红书创作平台签发的是 creator 专属 cookie（不叫 web_session），
// 所以登录判定用「候选 cookie 命中任意一个」而非死盯单个名字。
const META = {
  xiaohongshu: {
    name: '小红书',
    loginUrl: 'https://creator.xiaohongshu.com/login',
    cookieDomain: '.xiaohongshu.com',
    authCookies: [
      'access-token-creator.xiaohongshu.com',
      'galaxy_creator_session_id',
      'galaxy.creator.beaker.session.id',
      'customer-sso-sid',
      'customerClientId',
      'web_session',
    ],
  },
  twitter: {
    name: 'Twitter',
    loginUrl: 'https://x.com/login',
    cookieDomain: '.x.com',
    authCookies: ['auth_token'],
  },
  zhihu: {
    name: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    cookieDomain: '.zhihu.com',
    authCookies: ['z_c0'],
  },
};

// ─── cookie 存取（委托 storage） ────────────────────────────
function getCookies(platform, storage) {
  try { return JSON.parse(storage.get(STORAGE_KEYS[platform]) || '[]'); }
  catch (_) { return []; }
}
function setCookies(platform, storage, cookiesArr) {
  // VS Code Memento 是 update()，没有 set()
  storage.update(STORAGE_KEYS[platform], JSON.stringify(cookiesArr || []));
}
function clearCookies(platform, storage) {
  storage.update(STORAGE_KEYS[platform], '');
}

/**
 * 计算登录态 / 有效期
 * @returns {{ loggedIn, expiresAt:(number|null), daysLeft:(number|null), state:'valid'|'soon'|'expired'|'none' }}
 */
function cookieStatus(platform, cookies) {
  const meta = META[platform];
  const list = cookies || [];
  const auth = list.find(c => meta.authCookies.includes(c.name) && c.value);
  if (!auth) return { loggedIn: false, expiresAt: null, daysLeft: null, state: 'none' };

  const now = Date.now() / 1000;

  // 有效期：优先用 auth cookie 自己的 expires；它若是会话 cookie（无 expires，
  // 小红书 web_session 常见），退而取该平台其余 cookie 里最长的一个有效期做估算。
  let exp = (typeof auth.expires === 'number' && auth.expires > 0) ? auth.expires : null;
  if (exp == null) {
    const candidates = list
      .map(c => (typeof c.expires === 'number' ? c.expires : -1))
      .filter(e => e > now);
    if (candidates.length) exp = Math.max(...candidates);
  }

  if (exp && exp <= now) return { loggedIn: false, expiresAt: exp * 1000, daysLeft: 0, state: 'expired' };

  const daysLeft = exp ? Math.max(0, Math.floor((exp - now) / 86400)) : null;
  const state = exp == null ? 'valid' : (daysLeft <= 2 ? 'soon' : 'valid');
  return { loggedIn: true, expiresAt: exp ? exp * 1000 : null, daysLeft, state };
}

/**
 * 解析用户手动粘贴的 cookie（兜底入口）
 * 支持两种格式：
 *   1) 浏览器里复制的 "name=value; name2=value2"
 *   2) Playwright/扩展导出的 JSON 数组
 * @returns {Array} Playwright 格式 cookie 数组
 */
function parsePastedCookies(platform, raw) {
  const meta = META[platform];
  const text = String(raw || '').trim();
  if (!text) throw new Error('Cookie 不能为空');

  // JSON 数组
  if (text.startsWith('[')) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('JSON 不是 cookie 数组');
    return arr.map(c => ({
      name: c.name, value: c.value,
      domain: c.domain || meta.cookieDomain,
      path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires : -1,
      httpOnly: !!c.httpOnly, secure: c.secure !== false, sameSite: c.sameSite || 'Lax',
    })).filter(c => c.name && c.value);
  }

  // "name=value; name2=value2"
  const out = [];
  for (const pair of text.split(/;\s*/)) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!name || !value) continue;
    out.push({
      name, value,
      domain: meta.cookieDomain, path: '/',
      expires: -1, httpOnly: false, secure: true, sameSite: 'Lax',
    });
  }
  if (!out.length) throw new Error('未解析出任何 cookie');
  if (!out.some(c => meta.authCookies.includes(c.name))) {
    throw new Error(`缺少登录 cookie（需包含以下任一：${meta.authCookies.join(' / ')}），请确认复制完整`);
  }
  return out;
}

// ─── 调用 Playwright worker ─────────────────────────────────
function workerPath(extensionPath) {
  return path.join(extensionPath, 'scripts', 'social_worker.js');
}

/**
 * 登录：启动可见浏览器让用户登录，抓到 cookie 后存入 storage
 * @returns {Promise<{ cookies }>}  同时已写入 storage
 */
function login(platform, { extensionPath, storage, onProgress, onNeedInstall, onChild }) {
  return new Promise((resolve, reject) => {
    const cookieOut = path.join(os.tmpdir(), `m2a_${platform}_cookie_${Date.now()}.json`);
    const proc = spawn(process.execPath, [workerPath(extensionPath), 'login', platform, cookieOut]);
    if (onChild) onChild(proc);
    let stderr = '';
    let needInstall = false;

    proc.stdout.on('data', d => {
      for (const line of d.toString().split('\n')) {
        if (line.startsWith('INFO:')) onProgress && onProgress(line.slice(5));
        else if (line.startsWith('NEED_INSTALL')) needInstall = true;
        else if (line.startsWith('COOKIES_SAVED')) { /* handled on close */ }
        else if (line.startsWith('ERROR:')) stderr = line.slice(6);
      }
    });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (needInstall && code === 2) { const e = new Error('NEED_INSTALL'); e.needInstall = true; reject(e); return; }
      if (code !== 0) { reject(new Error(stderr || `登录进程退出码 ${code}`)); return; }
      try {
        const cookies = JSON.parse(fs.readFileSync(cookieOut, 'utf8'));
        fs.unlinkSync(cookieOut);
        setCookies(platform, storage, cookies);
        resolve({ cookies });
      } catch (e) { reject(new Error('读取登录 cookie 失败：' + e.message)); }
    });
    proc.on('error', reject);
  });
}

/**
 * 发布：注入 cookie，自动填内容并（prepare 模式）停在发布前
 * prepare 模式下浏览器保持打开、子进程常驻，resolve 后不 kill。
 * @returns {Promise<{ status:'ready'|'published', child }>}
 */
function publish(platform, { extensionPath, cookies, content, images, link, mode = 'prepare', headless = false, onProgress, onStep, onNeedInstall, onChild }) {
  return new Promise((resolve, reject) => {
    const job = {
      cookies,
      title: content.title || '', body: content.body || '', tags: content.tags || [],
      tweets: content.tweets || null,             // Twitter 串推
      autoNumber: content.autoNumber !== false,   // 自动加 1/N 编号
      linkPos: content.linkPos || 'all',          // 全文链接放哪几条
      oneImagePerTweet: content.oneImagePerTweet !== false,  // 一条一图
      html: content.html || '',                   // 知乎：干净的发布 HTML
      images: images || [], link: link || '', mode, headless,
    };
    const jobFile = path.join(os.tmpdir(), `m2a_${platform}_job_${Date.now()}.json`);
    fs.writeFileSync(jobFile, JSON.stringify(job), 'utf8');

    // 注意：job 文件【不删】—— resume 时要复用它（临时目录由系统回收）
    runWorker('publish', platform, jobFile, extensionPath, { onProgress, onStep, onNeedInstall, onChild, resolve, reject });
  });
}

/**
 * 断点续传：重连上次那个还开着的浏览器，从中断处继续
 */
function resume(platform, { extensionPath, jobFile, onProgress, onStep, onChild }) {
  return new Promise((resolve, reject) => {
    if (!jobFile || !fs.existsSync(jobFile)) { reject(new Error('没有可续传的任务（job 已失效，请重新发布）')); return; }
    runWorker('resume', platform, jobFile, extensionPath, { onProgress, onStep, onChild, resolve, reject });
  });
}

/** 统一的 worker 调度 + stdout 协议解析 */
function runWorker(cmd, platform, jobFile, extensionPath, { onProgress, onStep, onNeedInstall, onChild, resolve, reject }) {
  const proc = spawn(process.execPath, [workerPath(extensionPath), cmd, platform, jobFile]);
  if (onChild) onChild(proc);              // 交给调用方保管，便于下次发布前先杀掉旧的
  let settled = false;
  let errMsg = '';
  let diagDir = '';

  proc.stdout.on('data', d => {
    for (const line of d.toString().split('\n')) {
      if (line.startsWith('INFO:')) onProgress && onProgress(line.slice(5));
      else if (line.startsWith('PROGRESS:')) {
        // PROGRESS:<done>/<total>:<label>
        const m = line.slice(9).match(/^(\d+)\/(\d+):(.*)$/);
        if (m && onStep) onStep({ done: +m[1], total: +m[2], label: m[3] });
      }
      else if (line.startsWith('NEED_INSTALL')) { onNeedInstall && onNeedInstall(); }
      else if (line.startsWith('DIAG:')) { diagDir = line.slice(5).trim(); }
      else if (line.startsWith('READY_TO_PUBLISH')) {
        if (!settled) { settled = true; resolve({ status: 'ready', child: proc, jobFile }); }
      } else if (line.startsWith('PUBLISHED:')) {
        if (!settled) { settled = true; resolve({ status: 'published', child: proc, jobFile, url: line.slice(10) }); }
      } else if (line.startsWith('ERROR:')) {
        errMsg = line.slice(6);
        // 出错时 worker 保留浏览器并挂住，不会 close → 这里立刻 reject
        if (!settled) {
          settled = true;
          const e = new Error(errMsg + (diagDir ? `\n现场存证：${diagDir}` : ''));
          e.diagDir = diagDir;
          e.jobFile = jobFile;      // 供 resume 使用
          e.canResume = true;
          reject(e);
        }
      }
    }
  });

  proc.on('close', (code) => {
    if (!settled) { settled = true; reject(new Error(errMsg || `进程退出码 ${code}`)); }
  });
  proc.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
}

/**
 * 登录 + 发布合并为一次调用 —— 同一进程、同一浏览器，无需 CDP 重连或 cookie 注入。
 * 登录完成后立即在浏览器新标签页里填内容发布。
 * @returns {Promise<{ status:'ready'|'published', child, jobFile }>}
 */
function loginAndPublish(platform, { extensionPath, storage, content, images, link, mode = 'prepare', headless = false, onLoginProgress, onPublishProgress, onStep, onNeedInstall, onChild }) {
  return new Promise((resolve, reject) => {
    const cookieOut = path.join(os.tmpdir(), `m2a_${platform}_cookie_${Date.now()}.json`);
    const job = {
      title: content.title || '', body: content.body || '', tags: content.tags || [],
      tweets: content.tweets || null,
      autoNumber: content.autoNumber !== false,
      linkPos: content.linkPos || 'all', oneImagePerTweet: content.oneImagePerTweet !== false,
      html: content.html || '', images: images || [], link: link || '', mode, headless,
    };
    const jobFile = path.join(os.tmpdir(), `m2a_${platform}_job_${Date.now()}.json`);
    fs.writeFileSync(jobFile, JSON.stringify(job), 'utf8');

    const proc = spawn(process.execPath, [workerPath(extensionPath), 'login-publish', platform, cookieOut, jobFile]);
    if (onChild) onChild(proc);
    let stderr = '', settled = false, diagDir = '';
    let phase = 'login';  // 'login' | 'publish'

    proc.stdout.on('data', d => {
      for (const line of d.toString().split('\n')) {
        if (line.startsWith('INFO:')) {
          const msg = line.slice(5);
          if (phase === 'publish') onPublishProgress && onPublishProgress(msg);
          else onLoginProgress && onLoginProgress(msg);
        }
        else if (line.startsWith('PROGRESS:')) {
          const m = line.slice(9).match(/^(\d+)\/(\d+):(.*)$/);
          if (m && onStep) onStep({ done: +m[1], total: +m[2], label: m[3] });
        }
        else if (line.startsWith('COOKIES_SAVED')) {
          phase = 'publish';
          try {
            const cookies = JSON.parse(fs.readFileSync(cookieOut, 'utf8'));
            setCookies(platform, storage, cookies);
          } catch (_) {}
        }
        else if (line.startsWith('NEED_INSTALL')) onNeedInstall && onNeedInstall();
        else if (line.startsWith('DIAG:')) diagDir = line.slice(5).trim();
        else if (line.startsWith('READY_TO_PUBLISH')) {
          if (!settled) { settled = true; resolve({ status: 'ready', child: proc, jobFile }); }
        } else if (line.startsWith('PUBLISHED:')) {
          if (!settled) { settled = true; resolve({ status: 'published', child: proc, jobFile, url: line.slice(10) }); }
        } else if (line.startsWith('ERROR:')) {
          const errMsg = line.slice(6);
          if (!settled) {
            settled = true;
            const e = new Error(errMsg + (diagDir ? `\n现场存证：${diagDir}` : ''));
            e.diagDir = diagDir; e.jobFile = jobFile; e.canResume = true;
            reject(e);
          }
        }
      }
    });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (!settled) { settled = true; reject(new Error(stderr || `进程退出码 ${code}`)); }
    });
    proc.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

module.exports = {
  STORAGE_KEYS, META,
  getCookies, setCookies, clearCookies, cookieStatus, parsePastedCookies,
  login, publish, resume, loginAndPublish,
};
