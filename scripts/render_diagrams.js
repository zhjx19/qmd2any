#!/usr/bin/env node
'use strict';
/**
 * render_diagrams.js — 公众号复制链路的图表渲染子进程
 *
 * 用法：node render_diagrams.js <input.json> <output.json>
 *   input : { "html": "<div>...</div>" }
 *   output: { "html": "...", "rendered": N, "errors": ["..."] }
 *
 * 流程：findChromium() → headless 启动 → lib/diagram/render.renderDiagrams() → 写 output。
 * 致命错误走 stderr ERROR: 行协议 + 非 0 退出码；单个图表失败由 renderDiagrams 内部容错。
 */

const fs = require('fs');
const { hasDiagramHtml, renderDiagrams, findChromium } = require('../lib/diagram/render');

async function main() {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) {
    process.stderr.write('Usage: node render_diagrams.js <input.json> <output.json>\n');
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(inFile, 'utf8').replace(/^\uFEFF/, ''));
  const html = String(input.html || '');
  if (!hasDiagramHtml(html)) {
    fs.writeFileSync(outFile, JSON.stringify({ html, rendered: 0, errors: [] }), 'utf8');
    return;
  }

  const executablePath = findChromium();
  if (!executablePath) {
    process.stderr.write('ERROR:未找到可用的 Chrome/Chromium/Edge，无法渲染流程图\n');
    process.exit(2);
  }

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const result = await renderDiagrams(page, html, []);
    fs.writeFileSync(outFile, JSON.stringify(result), 'utf8');
    console.log('INFO:done rendered=' + result.rendered);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  process.stderr.write('ERROR:' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
