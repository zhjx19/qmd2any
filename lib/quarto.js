'use strict';

/**
 * Quarto 集成模块
 *
 * 职责：
 *   1. 调用 quarto CLI 将 .qmd 编译为中间 .md
 *   2. 提取 .qmd 文件的 YAML frontmatter（title/author）
 *   3. 编译结果缓存管理
 *
 * 仅支持单文件 .qmd，不支持 Quarto book 项目。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const matter = require('gray-matter');

// ─────────────────────────────────────────────
//  缓存
// ─────────────────────────────────────────────

/** @type {Map<string, { mdPath: string, compiledAt: number }>} */
const compileCache = new Map();

function isOutputFresh(qmdPath, mdPath, compiledAt) {
  try {
    const qmdStat = fs.statSync(qmdPath);
    const mdStat = fs.statSync(mdPath);
    return qmdStat.mtimeMs <= Math.max(compiledAt || 0, mdStat.mtimeMs);
  } catch (_) {
    return false;
  }
}

function getCached(qmdPath) {
  const entry = compileCache.get(qmdPath);
  if (entry && isOutputFresh(qmdPath, entry.mdPath, entry.compiledAt)) {
    return entry;
  }

  // 跨会话复用：如果同目录已存在较新的编译产物，直接恢复缓存。
  const mdPath = findOutputMd(qmdPath);
  if (!mdPath) return null;
  try {
    const mdStat = fs.statSync(mdPath);
    if (isOutputFresh(qmdPath, mdPath, mdStat.mtimeMs)) {
      const restored = { mdPath, compiledAt: mdStat.mtimeMs };
      compileCache.set(qmdPath, restored);
      return restored;
    }
  } catch (_) {}
  return null;
}

function setCache(qmdPath, mdPath) {
  let compiledAt = Date.now();
  try { compiledAt = fs.statSync(mdPath).mtimeMs; } catch (_) {}
  compileCache.set(qmdPath, { mdPath, compiledAt });
}

function clearCache(qmdPath) {
  if (qmdPath) {
    compileCache.delete(qmdPath);
  } else {
    compileCache.clear();
  }
}

/**
 * 检查缓存或同目录编译产物是否可用
 */
function isCacheValid(qmdPath) {
  return !!getCached(qmdPath);
}

// ─────────────────────────────────────────────
//  运行结果补 `## ` 行首前缀
// ─────────────────────────────────────────────

/**
 * 4 空格缩进块的非空内容行。
 * 注意允许第 5 个字符起继续是空格：chunk 输出里的对齐续行
 * （如 Coefficients 表右半部分的 `     37.285       -5.344`）本身就有多空格缩进，
 * 要求 \S 紧跟会让这些行漏掉前缀。
 */
const INDENTED_LINE = /^([ \t]{4})(\s*\S.*)$/;
/** 缩进块里的列表项（Quarto 会把 4 空格嵌套列表也写成缩进块，须排除） */
const INDENTED_LIST_ITEM = /^(?:[-*+]\s|\d+[.)]\s)/;
/** 已经带 knitr 注释前缀的行，幂等时跳过 */
const HAS_COMMENT_PREFIX = /^#{2,}\s?/;

/**
 * 给 Quarto 产物里的「chunk 运行结果」补回 R Markdown 的 `## ` 行首前缀。
 *
 * 背景：`## ` 是 knitr 的约定，不是 Quarto 的。
 *   - `knitr::knit()`（.Rmd）输出 ```\n## [1] 2\n```，因为 .md 中间层需要
 *     `##` 防止输出行被 Markdown 解析成标题；
 *   - Quarto 不走这层中间件，直接渲染成 AST，CodeBlock 文本就是裸的 `[1] 2`，
 *     再由 pandoc 的 commonmark writer 把无语言类的 CodeBlock 写成 4 空格缩进块。
 * 于是发 .qmd 时运行结果行首没有 `##`，与 .Rmd 观感不一致。
 *
 * 实测过的边界（Quarto 1.9.38）：
 *   - `echo: false` 的运行结果前面没有围栏块 → 不能用「跟在 ``` 之后」来判定；
 *   - 列表缩进续行被 Quarto 归一化成 2 空格 → 本来就不会命中；
 *   - 4 空格缩进的**嵌套列表项**会被命中 → 必须显式排除列表标记。
 *
 * 只在「Quarto 刚生成的 .md」上调用；用户手写的 .md 原样透传，那边的 `##`
 * 已经能完整保留（发布链路不经过这里）。
 *
 * @param {string} md Quarto 生成的 gfm 内容
 * @returns {string} 补好前缀的 gfm
 */
function addChunkOutputCommentPrefix(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let fence = '';        // 当前所处围栏的标记字符（` 或 ~），空串表示不在围栏内
  let inFootnote = false; // 正在一段脚注定义里（[^id]: 说明 的 4 空格续行）

  for (const line of lines) {
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (marker === fence) fence = '';
      out.push(line);
      continue;
    }

    // 围栏块内部（chunk 源码、用户自己写的代码块）一律不动
    if (fence) { out.push(line); continue; }

    // 脚注定义块：`[^id]: …` 起头，4 空格缩进的续行直到空行或顶格行为止。
    // 这些续行是 pandoc 折行折出来的说明文字，不是 knitr 的运行结果 ——
    // 给它们补 `## ` 会把脚注污染成「… Control ## Letters …」。
    if (!fence) {
      if (!line.trim()) inFootnote = false;
      else if (/^\[\^[^\]]+\]:/.test(line)) inFootnote = true;
      else if (inFootnote && !/^[ \t]{4}/.test(line)) inFootnote = false;
      if (inFootnote) { out.push(line); continue; }
    }

    // 空行/纯空白行原样保留：缩进代码块靠它分隔，动了会把块拆散
    const m = line.match(INDENTED_LINE);
    if (!m) {
      out.push(line);
      continue;
    }

    const [, indent, body] = m;
    const text = body.trimStart();

    // 嵌套列表项不是运行结果；已带前缀的也不再叠加（幂等）
    if (INDENTED_LIST_ITEM.test(text) || HAS_COMMENT_PREFIX.test(text)) {
      out.push(line);
      continue;
    }

    // 前缀插在「前 4 个空格之后」：多出来的对齐缩进原样留在 ## 后面
    out.push(`${indent}## ${body}`);
  }

  return out.join('\n');
}

// ─────────────────────────────────────────────
//  编译失败时的报错翻译
// ─────────────────────────────────────────────

/** Quarto 起不来 Python kernel 的特征（够specific，不会误伤其他报错） */
const PY_KERNEL_ERR = /Failed to spawn 'python3?'|Unable to locate an installed version of Python|No such kernel|could not start kernel/i;

/**
 * 把 Quarto 的「起不来 Python kernel」报错换成能照着做的中文提示。
 *
 * Quarto 原文是：
 *   ERROR: Error executing 'python': Failed to spawn 'python': entity not found
 *   Unable to locate an installed version of Python 3.
 *   Install Python 3 from https://www.python.org/downloads/
 *
 * 后两句有误导性：绝大多数情况用户早就装了 Python，只是没在 PATH 上，
 * 或者装了但没装 ipykernel / 没注册 kernelspec。照它那句去 python.org
 * 重装只是浪费时间。用户看到的就是这条，报 issue 时也只说得出「编译失败」。
 *
 * 未命中特征时返回 null，让原始 Quarto 报错照常透出。
 * @param {string} stdout Quarto 的完整输出（stdout + stderr）
 * @returns {string|null}
 */
function pythonKernelHint(stdout) {
  const src = String(stdout || '');
  if (!PY_KERNEL_ERR.test(src)) return null;

  const lines = [
    '❌ Quarto 起不来 Python kernel',
    '',
    '`.qmd` / `.ipynb` 里的 Python 代码块需要 Quarto 调 Jupyter 真正执行，',
    '所以找不到可用的 `python` 就编译失败。按这个顺序自查：',
    '',
    '1. 终端里跑 `python -V`，有输出才说明在 PATH 上。',
    '   Windows 上装了 `python3` 别名也不行 —— Quarto 找的是 `python`。',
    '2. 没装 kernel 就装：`python -m pip install ipykernel`',
    '3. `python -m jupyter kernelspec list` 里应该能看到 python3',
    '',
    '另外：编译 `.ipynb` 成功不代表 Python 正常 —— notebook 里已保存的',
    '输出会被直接透传，代码根本没执行。所以「ipynb 能编译」不能用来判断',
    'Python 环境是否正常，要用 `.qmd` 的 Python 代码块测。',
  ];

  const q = src.match(/ERROR:[^\n]*/);
  if (q) lines.push('', `Quarto 原文：${q[0].trim()}`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────
//  编译后查找输出的 .md 文件（仅同目录）
// ─────────────────────────────────────────────

/**
 * 在 .qmd 同目录下查找编译产物
 * @param {string} qmdPath — 原始 .qmd 路径
 * @returns {string|null}
 */
function findOutputMd(qmdPath) {
  const basename = path.basename(qmdPath, path.extname(qmdPath)) + '.md';
  const candidate = path.join(path.dirname(qmdPath), basename);
  try {
    fs.statSync(candidate);
    return candidate;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────
//  Quarto 编译
// ─────────────────────────────────────────────

/**
 * 调用 quarto CLI 将 .qmd 编译为中间 .md（单文件模式）
 *
 * @param {string}   qmdPath      — .qmd 文件路径
 * @param {function} [onProgress]  — (line: string) => void  进度回调
 * @returns {Promise<{ mdPath: string, stdout: string }>}
 */
function compile(qmdPath, onProgress) {
  return new Promise((resolve, reject) => {
    const cwd = path.dirname(qmdPath);

    const proc = spawn('quarto', ['render', qmdPath, '--to', 'gfm', '-M', 'prefer-html:true'], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onProgress) {
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onProgress(trimmed);
        }
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onProgress) {
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onProgress(`[stderr] ${trimmed}`);
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // Python kernel 起不来是最常见的坑，换成中文自查清单；其余原样透出
        reject(new Error(
          pythonKernelHint(stdout) ||
          `Quarto 编译失败 (exit code ${code})\n${stdout.slice(-2000)}`
        ));
        return;
      }

      const mdPath = findOutputMd(qmdPath);
      if (!mdPath) {
        reject(new Error(
          `找不到 Quarto 编译产物。请在 .qmd 同目录下确认编译后的 .md 文件是否存在。\n${stdout.slice(-1000)}`
        ));
        return;
      }

      // 给运行结果补回 `## ` 行首前缀（Quarto 不像 knitr 那样加，见函数注释）
      try {
        const src = fs.readFileSync(mdPath, 'utf8');
        const patched = addChunkOutputCommentPrefix(src);
        if (patched !== src) fs.writeFileSync(mdPath, patched, 'utf8');
      } catch (e) {
        // 补前缀失败不该让编译失败：产物原样可用，只是少了 `## `
        stdout += `\nWARN: 补 \`## \` 前缀失败（不影响发布）: ${e.message}\n`;
      }

      setCache(qmdPath, mdPath);
      resolve({ mdPath, stdout });
    });

    proc.on('error', (err) => {
      reject(new Error(
        `无法运行 quarto 命令。请确认 Quarto CLI 已安装且在 PATH 中。\n${err.message}`
      ));
    });
  });
}

// ─────────────────────────────────────────────
//  Frontmatter 提取
// ─────────────────────────────────────────────

/**
 * 从 .qmd 文件的 YAML frontmatter 中提取元数据
 * @param {string} qmdPath
 * @returns {{ title: string, author: string }}
 */
function extractFrontmatter(qmdPath) {
  try {
    const raw = fs.readFileSync(qmdPath, 'utf8');
    const { data } = matter(raw);
    return {
      title: data.title || '',
      author: data.author || '',
    };
  } catch (_) {
    return { title: '', author: '' };
  }
}

// ─────────────────────────────────────────────
//  导出
// ─────────────────────────────────────────────

module.exports = {
  compile,
  extractFrontmatter,
  findOutputMd,
  addChunkOutputCommentPrefix,
  pythonKernelHint,
  // 缓存
  getCached,
  setCache,
  clearCache,
  isCacheValid,
};
