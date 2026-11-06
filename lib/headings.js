'use strict';

/**
 * 标题归一与自动编号（知乎 / 微信共用）。
 *
 * 两家都不认 CSS 计数器（知乎不渲染 <style>，微信会把 <style> 剥掉），
 * 所以编号只能写进标题文本：`1 引言`、`1.1 数据`、`1.1.1 清洗`。
 */

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

/** 作者自己已经编好号的标题样式：(1) （一） ① 一、 */
const MANUAL_STEP_LABEL =
  /^[（(]\s*[0-9０-９一二三四五六七八九十]+\s*[)）]|^[①-⑳]|^[一二三四五六七八九十]+、/;

/**
 * 删掉与文章标题重复的首个 <h1>。
 *
 * 只在「这个 h1 就是文章标题」时才删 —— 无条件删会把 qmd 正文里的第一章整段吃掉。
 * 没传 title 时保持旧行为（无条件删首个 h1），兼容老调用方。
 */
function dropTitleHeading($, $root, title) {
  const $first = $root.find('h1').first();
  if (!$first.length) return;
  const h1Text = ($first.text() || '').replace(/\s+/g, ' ').trim();
  const titleText = String(title || '').replace(/\s+/g, ' ').trim();
  if (!titleText || h1Text === titleText) $first.remove();
}

/**
 * 标题编号 + 层级归一。
 *
 * 规则：
 *   - 层级按**相对嵌套**算（不是 level 差）：`##` 直接跳 `####` 视为「下一级」，
 *     所以是 1.1 而不是 1.0.1；避免文章跳级标题时编出一串 0
 *   - 基准 = 输出里第一个标题，记为 1；下一层 1.1；再下一层 1.1.1
 *   - 作者手写的步骤标签（`(1)`、`（一）`、`①`、`一、`）视为已编号：
 *     不自动加号、也不消耗计数
 *   - 幂等：开头若是本次要生成的编号，先剥掉再补，避免「1 1 引言」
 *
 * @param {object} $     cheerio 实例
 * @param {object} $root 内容容器
 * @param {{ keepTags?: boolean, enabled?: boolean }} opts
 *        keepTags=false：第 1 层 → h2，更深都压 h3（知乎只有两级标题）
 *        keepTags=true ：保留原标签（微信 h1/h2/h3 都有各自样式）
 */
function applyHeadingNumbers($, $root, { keepTags = false, enabled = true } = {}) {
  const headings = $root.find(HEADING_SELECTOR).toArray();
  if (!headings.length) return;

  const counters = [0, 0, 0, 0, 0, 0];
  const stack = []; // [{ level, depth }]

  headings.forEach((el) => {
    const $el = $(el);
    const level = Number(el.name.slice(1));

    // 相对嵌套：弹掉同级及更深的祖先，深度 = 剩余祖先数 + 1
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const depth = stack.length + 1;
    stack.push({ level, depth });

    const tag = keepTags ? el.name : (depth === 1 ? 'h2' : 'h3');
    let inner = ($el.html() || '').trim();
    const plain = ($el.text() || '').trim();

    if (enabled && !MANUAL_STEP_LABEL.test(plain)) {
      counters[depth - 1] += 1;
      for (let d = depth; d < counters.length; d++) counters[d] = 0;
      const numero = counters.slice(0, depth).join('.');

      // 剥掉手写编号，避免「1 1.1 数据」：
      //   - 单段数字（1）只有和本次编号完全相同才剥 —— 保护「2024 年度总结」这类正文
      //   - 多段数字（1.1）只要段数与当前深度相同就剥 —— 这种形态基本不可能是正文
      const m = inner.match(/^\s*(\d+(?:\.\d+)*)[.、\s]\s*/);
      if (m) {
        const parts = m[1].split('.');
        if ((parts.length > 1 && parts.length === depth) || m[1] === numero) {
          inner = inner.slice(m[0].length).trim();
        }
      }
      inner = inner ? `${numero} ${inner}` : numero;
    }

    $el.replaceWith(`<${tag}>${inner}</${tag}>`);
  });
}

module.exports = { HEADING_SELECTOR, MANUAL_STEP_LABEL, dropTitleHeading, applyHeadingNumbers };
