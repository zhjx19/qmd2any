'use strict';

/**
 * 公众号摘要生成（DeepSeek）。
 *
 * 摘要显示在公众号分享卡片上，硬上限 120 字（含标点），超了后台会截断。
 * 这里负责：拼提示词、调 API、把结果压到 120 字以内。
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const DIGEST_MAX = 120;

/** 摘要缓存 key：标题 + 正文变了才重新生成 */
function digestCacheKey(title, text) {
  return crypto.createHash('sha256').update(`${title}\n${text}`).digest('hex').slice(0, 16);
}

/**
 * 把模型输出压到 120 字以内。
 * 优先在句末标点处截断（避免半句话），实在没有合适断点才硬截。
 */
function clampDigest(text, max = DIGEST_MAX) {
  let s = String(text || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 模型偶尔会自作主张加引号 / 书名号外壳
  s = s.replace(/^["'“”「」『』]+/, '').replace(/["'“”「」『』]+$/, '').trim();
  if (s.length <= max) return s;

  const cut = s.slice(0, max);
  const sentenceEnd = cut.match(/[\s\S]*[。！？；…!?;]/);
  if (sentenceEnd && sentenceEnd[0].length >= max * 0.6) {
    return sentenceEnd[0].trim();
  }
  return cut.trim();
}

/** 摘要提示词：带钩子 + 硬字数 */
function buildDigestMessages(title, text, previous) {
  const system = [
    '你是资深中文编辑，为微信公众号文章写「摘要」，它会显示在分享卡片上。',
    '要求：',
    `1. 严格不超过 ${DIGEST_MAX} 个字符（含标点），宁短勿长；`,
    '2. 带钩子：让读者知道读完这篇能拿到什么，别写成目录罗列；',
    '3. 只用中文标点，不要 markdown、不要引号或书名号包裹整句；',
    '4. 不要用「本文」「这篇文章」开头，直接给内容；',
    '5. 直接输出摘要正文，不要任何解释。',
  ].join('\n');

  const user = previous
    ? `标题：${title}\n\n正文：\n${text}\n\n上一版摘要（${previous.length} 字）超了，请压缩到 ${DIGEST_MAX} 字以内，保持信息量和钩子。`
    : `标题：${title}\n\n正文：\n${text}\n\n请写一条不超过 ${DIGEST_MAX} 字的中文摘要。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 调 DeepSeek chat/completions，返回纯文本内容 */
function callDeepSeek({ apiKey, baseUrl, model, messages, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL('/chat/completions', (baseUrl || 'https://api.deepseek.com').replace(/\/+$/, ''));
    } catch (e) {
      return reject(new Error(`baseUrl 不合法：${baseUrl}`));
    }

    const body = JSON.stringify({
      model: model || 'deepseek-flash',
      messages,
      temperature: 0.3,
      max_tokens: 400,
      stream: false,
    });

    const req = (url.protocol === 'http:' ? http : https).request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body, 'utf8'),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(raw); } catch (_) {
          return reject(new Error(`接口返回非 JSON（HTTP ${res.statusCode}）：${raw.slice(0, 160)}`));
        }
        if (res.statusCode === 401) return reject(new Error('DeepSeek API Key 无效或已过期（401）'));
        if (res.statusCode === 402) return reject(new Error('DeepSeek 账户余额不足（402）'));
        if (res.statusCode === 429) return reject(new Error('DeepSeek 请求过于频繁（429），稍后再试'));
        if (res.statusCode !== 200) {
          const msg = (data && data.error && data.error.message) || raw.slice(0, 160);
          return reject(new Error(`DeepSeek 调用失败（HTTP ${res.statusCode}）：${msg}`));
        }
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) return reject(new Error('DeepSeek 没有返回内容'));
        resolve(String(content).trim());
      });
    });

    req.on('error', (e) => reject(new Error(`网络错误：${e.message}`)));
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('DeepSeek 请求超时（30 秒）'));
    });
    req.write(body, 'utf8');
    req.end();
  });
}

/**
 * 生成摘要：超 120 字会请模型再压一次，仍超则本地截断，保证返回值一定 ≤120。
 * @returns {Promise<{digest: string, retried: boolean, rawLength: number}>}
 */
async function generateDigest({ apiKey, baseUrl, model, title, text }) {
  if (!apiKey) throw new Error('没配置 DeepSeek API Key（设置里搜 qmd2any.deepseek.apiKey）');

  const source = String(text || '').slice(0, 4000);
  const raw = (await callDeepSeek({
    apiKey, baseUrl, model,
    messages: buildDigestMessages(title, source),
  })).trim();
  const rawLen = [...raw].length;

  // 模型守规矩就收工（注意要先看**原始**长度，clamp 之后永远 ≤120，再判就白判了）
  if (rawLen <= DIGEST_MAX) {
    return { digest: clampDigest(raw), retried: false, rawLength: rawLen };
  }

  // 超了：把第一版回抛给模型请它压缩，仍超才本地截断兜底
  const second = (await callDeepSeek({
    apiKey, baseUrl, model,
    messages: buildDigestMessages(title, source, firstPreview(raw)),
  })).trim();
  return { digest: clampDigest(second), retried: true, rawLength: rawLen };
}

/** 回抛给模型做压缩时不需要整段超长文本，截个够它判断的长度即可 */
function firstPreview(text) {
  return String(text).slice(0, DIGEST_MAX * 2);
}

module.exports = {
  DIGEST_MAX,
  clampDigest,
  buildDigestMessages,
  callDeepSeek,
  generateDigest,
  digestCacheKey,
};
