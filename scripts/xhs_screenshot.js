#!/usr/bin/env node
'use strict';
/**
 * xhs_screenshot.js — 用 Playwright (Node.js) 将 HTML 截图为多张小红书图片
 *
 * 输出协议（stdout 每行一个）:
 *   INFO:<message>      — 进度信息
 *   SAVED:<filepath>    — 已保存的图片路径
 *   DONE:<count>        — 完成，共 count 张
 *   NEED_INSTALL        — 未找到 Chromium，需要下载
 *   ERROR:<message>     — 致命错误
 *
 * 用法:
 *   node xhs_screenshot.js <html_file> <output_dir> \
 *       [--width 1080] [--height 1440] [--padding 40] [--bg '#ffffff']
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── 解析 CLI 参数 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const htmlFile  = argv[0];
const outputDir = argv[1];

function flag(name, def) {
  const i = argv.indexOf(name);
  return (i >= 0 && argv[i + 1]) ? argv[i + 1] : def;
}

const imgW    = parseInt(flag('--width',   '1080'), 10);
const imgH    = parseInt(flag('--height',  '1440'), 10);
const padding = parseInt(flag('--padding', '40'),   10);
const bg      = flag('--bg', '#ffffff');

if (!htmlFile || !outputDir) {
  process.stderr.write('Usage: node xhs_screenshot.js <html_file> <output_dir> [--width N] [--height N] [--padding N] [--bg COLOR]\n');
  process.exit(1);
}

// ── 查找 Chromium 可执行文件 ─────────────────────────────────────────────────
function findChromium() {
  const home = os.homedir();

  // 1. Playwright 管理的 Chromium（python playwright / node playwright 共用缓存）
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

// ── 解析颜色 ─────────────────────────────────────────────────────────────────
function parseColor(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

// ── 主逻辑（完全复刻 Python 版） ────────────────────────────────────────────
async function main() {
  const { PNG } = require('pngjs');

  fs.mkdirSync(outputDir, { recursive: true });

  const executablePath = findChromium();
  if (!executablePath) {
    console.log('NEED_INSTALL');
    process.exit(2);
  }

  console.log(`INFO:使用浏览器: ${path.basename(path.dirname(executablePath))}`);

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-web-security'],
  });

  try {
    // ── 1. Playwright 渲染，用滚动拼接替代 fullPage 截图 ─────────────────────
    // Chromium canvas 高度上限约 16384px，fullPage: true 会在超高页面上静默截断。
    // 改用分段滚动截图后拼接，突破该限制。
    const TILE_H = 4096; // 每段视口高度（px）
    const SCALE  = 2;    // deviceScaleFactor：输出图片为逻辑尺寸的 2 倍，提升分辨率
    const page = await browser.newPage({ viewport: { width: imgW, height: TILE_H }, deviceScaleFactor: SCALE });
    const fileUrl = 'file://' + path.resolve(htmlFile);
    await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);

    // 取页面实际总高度
    const totalPageH = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`INFO:页面总高度 ${totalPageH}px，开始分段截图…`);

    // 逐段截图
    // 关键：浏览器限制滚动位置不超过 (scrollHeight - viewportHeight)，所以最后一段
    // 的实际 scrollY 可能比期望值小，需要读取实际值再决定取哪些行。
    const tiles = [];
    let targetY = 0;
    while (targetY < totalPageH) {
      await page.evaluate(y => window.scrollTo(0, y), targetY);
      await page.waitForTimeout(80);
      const actualY = await page.evaluate(() => window.scrollY);
      const tileBuf = await page.screenshot({ type: 'png' });
      const tile = PNG.sync.read(tileBuf);
      // 本段截图对应页面 [actualY, actualY + TILE_H)，取其中属于 [targetY, totalPageH) 的行
      const rowStart = targetY - actualY;           // 本段截图中，targetY 对应的行号
      const rowEnd   = Math.min(TILE_H, totalPageH - actualY); // 本段截图中，页面末尾对应的行号
      const validH   = rowEnd - rowStart;
      // rowStart/validH 是 CSS 逻辑像素，乘以 SCALE 得到物理像素行号
      tiles.push({ png: tile, rowStart: rowStart * SCALE, validH: validH * SCALE });
      console.log(`INFO:已截 targetY=${targetY} actualY=${actualY} rowStart=${rowStart} validH=${validH}`);
      targetY += TILE_H;
    }

    // 拼接所有 tile 为一张完整图
    const W = tiles[0].png.width;
    const H = tiles.reduce((s, t) => s + t.validH, 0);
    console.log(`INFO:截图完成，拼接尺寸 ${W}x${H}，开始分割`);
    const combined = new PNG({ width: W, height: H });
    let dstY = 0;
    for (const { png, rowStart, validH } of tiles) {
      for (let row = 0; row < validH; row++) {
        const srcOff = (rowStart + row) * W * 4;
        const dstOff = (dstY + row) * W * 4;
        png.data.copy(combined.data, dstOff, srcOff, srcOff + W * 4);
      }
      dstY += validH;
    }
    const data = combined.data;

    // ── 3. 添加上下 padding（与 Python 版 Image.new + paste 一致）──────────
    // padding/imgH 是 CLI 逻辑像素，乘以 SCALE 换算为物理像素
    const physPadding = padding * SCALE;
    const physImgH    = imgH * SCALE;
    const padH = H + 2 * physPadding;
    const padded = new PNG({ width: W, height: padH });
    // 填充背景色
    const bgRgb = parseColor(bg);
    for (let y = 0; y < padH; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        padded.data[i]     = bgRgb[0];
        padded.data[i + 1] = bgRgb[1];
        padded.data[i + 2] = bgRgb[2];
        padded.data[i + 3] = 255;
      }
    }
    // 把原图贴到 (0, physPadding) 位置
    for (let y = 0; y < H; y++) {
      const srcOff = y * W * 4;
      const dstOff = (y + physPadding) * W * 4;
      data.copy(padded.data, dstOff, srcOff, srcOff + W * 4);
    }

    const totalW = W;
    const totalH = padH;
    const pixels = padded.data;

    // ── 4. 智能分片：尽量在空白行处切割（与 Python 版 is_blank_row 一致）──
    function isBlankRow(y, tolerance) {
      for (let x = 0; x < totalW; x++) {
        const i = (y * totalW + x) * 4;
        if (Math.abs(pixels[i]     - bgRgb[0]) > tolerance ||
            Math.abs(pixels[i + 1] - bgRgb[1]) > tolerance ||
            Math.abs(pixels[i + 2] - bgRgb[2]) > tolerance) {
          return false;
        }
      }
      return true;
    }

    const slices = [];  // [[startY, endY], ...]
    let startY = 0;
    while (startY < totalH) {
      let endY = Math.min(startY + physImgH, totalH);
      if (endY < totalH) {
        // 从切割点往上找最近的空白行（搜索范围：下半段的 50%）
        const minCut = startY + Math.floor(physImgH / 2);
        let cutY = endY;
        while (cutY > minCut) {
          if (isBlankRow(cutY - 1, 10)) {
            endY = cutY;
            break;
          }
          cutY--;
        }
        if (cutY <= minCut) {
          console.log(`INFO:第 ${slices.length + 1} 张未找到空白行，使用默认切割点 y=${endY}`);
        } else {
          console.log(`INFO:第 ${slices.length + 1} 张找到空白行 y=${endY}`);
        }
      }
      slices.push([startY, endY]);
      startY = endY;
    }

    console.log(`INFO:总高度 ${totalH}px → ${slices.length} 张`);

    // ── 5. 用 pngjs 切片并保存（与 Python 版 img.crop 一致） ────────────────
    const saved = [];
    for (let i = 0; i < slices.length; i++) {
      const [y0, y1] = slices[i];
      const sliceH = y1 - y0;
      const slice = new PNG({ width: totalW, height: sliceH });
      for (let y = 0; y < sliceH; y++) {
        const srcOff = (y0 + y) * totalW * 4;
        const dstOff = y * totalW * 4;
        pixels.copy(slice.data, dstOff, srcOff, srcOff + totalW * 4);
      }
      const outPath = path.join(outputDir, `xhs_${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(outPath, PNG.sync.write(slice));
      console.log(`SAVED:${outPath}`);
      saved.push(outPath);
    }

    console.log(`DONE:${saved.length}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.log(`ERROR:${err.message}`);
  process.exit(1);
});
