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
//  编译后查找输出的 .md 文件（仅同目录）
// ─────────────────────────────────────────────

/**
 * 在 .qmd 同目录下查找编译产物
 * @param {string} qmdPath — 原始 .qmd 路径
 * @returns {string|null}
 */
function findOutputMd(qmdPath) {
  const basename = path.basename(qmdPath, '.qmd') + '.md';
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

    const proc = spawn('quarto', ['render', qmdPath, '--to', 'gfm'], {
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
        reject(new Error(
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
  // 缓存
  getCached,
  setCache,
  clearCache,
  isCacheValid,
};
