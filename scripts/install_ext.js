#!/usr/bin/env node
'use strict';

/**
 * 把刚打好的 vsix 装进编辑器（默认 Positron）。
 *
 * 为什么不直接写在 package.json 的 script 里：
 * Windows 上 npm 用 cmd.exe 跑 script，`$(node -p ...)` 不会展开，
 * 于是路径里会留下字面量 `$(node -p require('.\package.json').version)`。
 * 所以版本号交给 Node 解析，再用 execFileSync 调编辑器 CLI。
 *
 * 用法：node scripts/install_ext.js [--cli <positron|code>]
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const pkg = require('../package.json');
const vsix = path.join(__dirname, '..', `qmd2any-${pkg.version}.vsix`);

if (!fs.existsSync(vsix)) {
  console.error(`找不到 ${path.basename(vsix)}，先跑 npm run package`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const cliFlag = argv.indexOf('--cli');
const cli = cliFlag >= 0 ? argv[cliFlag + 1] : (process.env.QMD2ANY_CLI || 'positron');

console.log(`安装 ${path.basename(vsix)} 到 ${cli}（同版本号需要 --force 覆盖）…`);
try {
  execFileSync(cli, ['--install-extension', vsix, '--force'], { stdio: 'inherit', shell: true });
  console.log('\n装好了。记得在编辑器里 Reload Window，否则跑的还是旧代码。');
} catch (err) {
  console.error(`安装失败：${err.message}`);
  process.exit(1);
}
