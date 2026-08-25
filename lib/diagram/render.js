'use strict';
/**
 * render.js — mermaid / DiagrammeR(grViz) 图表渲染共享模块
 *
 * 使用方：scripts/social_worker.js（知乎发布）、scripts/render_diagrams.js（公众号复制链路）。
 * 本地库 mermaid.min.js / viz.js 与本模块同目录（lib/diagram/），按需注入渲染页。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIAGRAM_DIR = __dirname;

/** 子进程 stdout 行协议进度（与 social_worker 一致） */
function info(m) { process.stdout.write('INFO:' + m + '\n'); }

// ─── 查找 Chromium（合并 social_worker / xhs_screenshot 两份实现的并集）──────
function findChromium() {
  const home = os.homedir();

  // 1. Playwright 管理的 Chromium 缓存（python/node playwright 共用）
  const cacheDir = path.join(home, '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir).filter(e => e.startsWith('chromium'))) {
      const cands = {
        darwin: path.join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        linux:  path.join(cacheDir, entry, 'chrome-linux', 'chrome'),
        win32:  path.join(cacheDir, entry, 'chrome-win', 'chrome.exe'),
      };
      const p = cands[process.platform];
      if (p && fs.existsSync(p)) return p;
    }
  }

  // 2. 系统已安装的浏览器
  const system = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    linux: [
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser', '/usr/bin/chromium',
      '/snap/bin/chromium',
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
  return null;
}

// ─── 快速检测：HTML 是否含图表块（无图零开销直通）────────────────────────────
const DIAGRAM_RE = /language-mermaid|class="[^"]*\bmermaid(-js)?\b[^"]*"|<div[^>]*\bgrViz\b/i;
function hasDiagramHtml(html) {
  return typeof html === 'string' && DIAGRAM_RE.test(html);
}

// ─── SVG → 白底边框 PNG ──────────────────────────────────────────────────────
/** 把一段 SVG 渲染成带白底/边框的 PNG，返回 { pngPath, dataUri } */
async function svgToPng(renderPage, svg, name) {
  await renderPage.evaluate((s) => {
    document.getElementById('m2a-root').innerHTML =
      `<div style="display:inline-block;background:#fff;padding:12px;border:1px solid #e0e0e0;line-height:0">${s}</div>`;
  }, svg);
  const box = await renderPage.evaluate(() => {
    const r = document.querySelector('#m2a-root > div').getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  await renderPage.setViewportSize({
    width: Math.max(1400, box.width),
    height: Math.max(900, box.height),
  });
  await renderPage.waitForTimeout(100);
  const pngPath = path.join(os.tmpdir(),
    `m2a_diagram_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
  await renderPage.locator('#m2a-root > div').screenshot({ path: pngPath });
  const dataUri = 'data:image/png;base64,' + fs.readFileSync(pngPath).toString('base64');
  return { pngPath, dataUri };
}

// ─── 核心：把 html 中所有图表块替换为 base64 PNG <img> ───────────────────────
/**
 * 返回 { html, images, rendered, errors }：
 *   - html 中每个图表块被替换为 <img src="data:image/png;base64,...">
 *   - images 按出现顺序与 data:image 图片一一对应（图表 → 临时 PNG 路径，原图 → 原本地图片）
 *   - rendered 成功数；errors 各失败信息（单图失败保留原块、不中断）
 */
async function renderDiagrams(page, html, images) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const sel = 'pre.mermaid, pre.mermaid-js, code.language-mermaid, div.grViz';
  if (!$(sel).length) return { html, images: images || [], rendered: 0, errors: [] };

  const pendingImages = (images || []).slice();
  const diagramPngs = new Map();   // dataUri -> pngPath
  const errors = [];
  let renderedCount = 0;
  let renderPage = null;
  let mermaidInjected = false;
  let vizInjected = false;
  let tag = 0;

  try {
    renderPage = await page.context().newPage();
    await renderPage.setViewportSize({ width: 1400, height: 900 });
    await renderPage.setContent(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="m2a-root"></div></body></html>'
    );

    const handled = new Set();
    for (const el of $(sel).toArray()) {
      const $el = $(el);
      const isCode = $el.is('code.language-mermaid');
      const target = isCode ? $el.closest('pre') : $el;
      if (!target.length || handled.has(target[0])) continue;
      handled.add(target[0]);

      try {
        let svg;
        let kind = 'mermaid';
        if ($el.is('div.grViz')) {
          kind = 'grviz';
          const id = $el.attr('id');
          const $script = $(`script[data-for="${id}"]`).first();
          let diagram = '';
          let engine = 'dot';
          if ($script.length) {
            try {
              const data = JSON.parse($script.text());
              diagram = (data && data.x && data.x.diagram) || '';
              engine = (data && data.x && data.x.config && data.x.config.engine) || 'dot';
            } catch (_) {}
          }
          if (!diagram) throw new Error('grViz 缺少 diagram 数据');
          if (!vizInjected) {
            await renderPage.addScriptTag({ path: path.join(DIAGRAM_DIR, 'viz.js') });
            vizInjected = true;
          }
          svg = await renderPage.evaluate(
            ({ dot, eng }) => window.Viz(dot, { format: 'svg', engine: eng }),
            { dot: diagram, eng: engine }
          );
        } else {
          const code = target.text().trim();
          if (!code) throw new Error('mermaid 代码为空');
          if (!mermaidInjected) {
            await renderPage.addScriptTag({ path: path.join(DIAGRAM_DIR, 'mermaid.min.js') });
            await renderPage.evaluate(() => {
              window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
            });
            mermaidInjected = true;
          }
          svg = await renderPage.evaluate(async ({ txt, id }) => {
            const r = await window.mermaid.render(id, txt);
            return r.svg;
          }, { txt: code, id: 'm2a_diagram_' + tag });
        }

        const { pngPath, dataUri } = await svgToPng(renderPage, svg, `${kind}_${tag}`);
        tag++;
        renderedCount++;
        diagramPngs.set(dataUri, pngPath);

        const imgHtml = `<img src="${dataUri}" data-m2a-diagram="${pngPath}">`;
        if (kind === 'grviz') {
          const id = $el.attr('id');
          $(`script[data-for="${id}"]`).remove();
          $el.replaceWith(imgHtml);
        } else {
          target.replaceWith(imgHtml);
        }
        info(`图表渲染成功：${kind} #${tag}`);
      } catch (err) {
        errors.push(err.message);
        info(`⚠️ 图表渲染失败，保留原文块：${err.message}`);
      }
    }

    // 按出现顺序把 data:image 图片与本地图片文件一一对应
    const rebuilt = [];
    $('img[src^="data:image"]').each((_, img) => {
      const src = $(img).attr('src');
      if (diagramPngs.has(src)) rebuilt.push(diagramPngs.get(src));
      else if (pendingImages.length) rebuilt.push(pendingImages.shift());
    });
    // 清理残留空容器 + 摘掉内部标记属性
    $('div:empty, figure:empty').remove();
    $('[data-m2a-diagram]').removeAttr('data-m2a-diagram');

    return { html: $('#root').html() || '', images: rebuilt, rendered: renderedCount, errors };
  } finally {
    if (renderPage) await renderPage.close().catch(() => {});
  }
}

// ─── spawn 子进程封装（公众号复制链路两端共用）───────────────────────────────
/**
 * spawn scripts/render_diagrams.js 渲染图表；resolve { html, rendered, errors }，失败 reject。
 * rootPath：VS Code 端传 extContext.extensionUri.fsPath；Electron 端传 appRoot。
 */
function renderViaScript(rootPath, html) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(rootPath, 'scripts', 'render_diagrams.js');
    const stamp = Date.now();
    const inFile = path.join(os.tmpdir(), `m2a_wechat_in_${stamp}.json`);
    const outFile = path.join(os.tmpdir(), `m2a_wechat_out_${stamp}.json`);
    try {
      fs.writeFileSync(inFile, JSON.stringify({ html }), 'utf8');
    } catch (e) {
      reject(new Error('写入临时文件失败: ' + e.message));
      return;
    }

    const { spawn } = require('child_process');
    const proc = spawn(process.execPath, [scriptPath, inFile, outFile], { windowsHide: true });
    let errMsg = '';
    proc.stderr.on('data', d => { errMsg += d.toString(); });
    proc.on('error', err => reject(new Error('启动渲染进程失败: ' + err.message)));
    proc.on('close', (code) => {
      try {
        if (!fs.existsSync(outFile)) {
          reject(new Error(`渲染脚本未产出结果(exit ${code})${errMsg ? ': ' + errMsg.trim() : ''}`));
          return;
        }
        resolve(JSON.parse(fs.readFileSync(outFile, 'utf8')));
      } catch (e) {
        reject(new Error('解析渲染结果失败: ' + e.message));
      } finally {
        fs.unlink(inFile, () => {});
        fs.unlink(outFile, () => {});
      }
    });
  });
}

module.exports = { findChromium, hasDiagramHtml, renderDiagrams, svgToPng, renderViaScript };
