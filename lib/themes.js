'use strict';

const THEMES = [
  // ── 1. 微信经典（默认） ──
  {
    id: 'wechat',
    name: '🟢 微信经典',
    css: `
      p, li, td, th {
        color: #3f3f3f;
        line-height: 1.75em;
        font-family: system-ui, -apple-system, BlinkMacSystemFont,
          'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB',
          'Microsoft YaHei UI', 'Microsoft YaHei', Arial, sans-serif;
        font-size: 16px;
      }
      strong { font-weight: 600; color: rgb(0, 122, 170); }
      a { color: orange; }
      h1 { font-size: 140%; color: #de7456; text-align: center; }
      h2 {
        font-size: 120%; font-weight: bold; color: #de7456;
        text-align: center; line-height: 2;
        border-bottom: 1px solid #de7456;
        margin: 1em auto; padding-bottom: 4px;
      }
      h3 {
        font-size: 110%; color: rgb(0, 122, 170);
        border-left: 3px solid rgb(0, 122, 170);
        padding-left: 10px; margin: 24px 0;
      }
      h4, h5, h6 { font-size: 100%; color: rgb(0, 122, 170); margin: 16px 0; }
      blockquote {
        border-left: 4px solid #ddd; margin: 1.2em 0;
        padding: 0.5em 1em; color: #666; background: #fafafa;
      }
      blockquote p { margin: 0; }
      code {
        background: #f0f0f0; padding: 2px 6px; border-radius: 3px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 14px; color: #c7254e;
      }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      table td, table th { border: 1px solid #999; padding: 8px 10px; }
      table th { background: #f2f2f2; font-weight: bold; text-align: center; }
      ul, ol { padding-left: 1.5em; }
      hr { border: none; border-top: 1px solid #eee; margin: 1.5em 0; }
      figure { margin: 1.5em auto; text-align: center; }
      figcaption { display: block; text-align: center; color: #999; font-size: 14px; margin-top: 8px; }
    `,
    wrapperBg: '#ffffff',
  },

  // ── 2. Claude 风格 ──
  {
    id: 'claude',
    name: '🟠 Claude 风格',
    css: `
      p, li, td, th {
        color: #1a1a1a;
        line-height: 1.8em;
        font-family: 'Georgia', 'Palatino Linotype', 'Book Antiqua',
          'Noto Serif SC', 'Source Han Serif SC', serif;
        font-size: 16px;
        letter-spacing: 0.01em;
      }
      strong { font-weight: 700; color: #d97706; }
      a { color: #b45309; text-decoration: underline; text-underline-offset: 2px; }
      h1 {
        font-size: 1.8em; font-weight: 700; color: #92400e;
        text-align: left; border-bottom: 2px solid #fbbf24;
        padding-bottom: 8px; margin-bottom: 24px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      h2 {
        font-size: 1.3em; font-weight: 700; color: #92400e;
        text-align: left; margin-top: 2em; margin-bottom: 0.8em;
        border-left: 4px solid #f59e0b; padding-left: 12px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      h3 {
        font-size: 1.1em; font-weight: 600; color: #b45309;
        margin-top: 1.5em; margin-bottom: 0.5em;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      h4, h5, h6 {
        font-size: 1em; font-weight: 600; color: #b45309;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      blockquote {
        border-left: 3px solid #f59e0b; margin: 1.5em 0;
        padding: 0.8em 1.2em; color: #78350f;
        background: #fffbeb; border-radius: 0 6px 6px 0;
      }
      blockquote p { margin: 0; }
      code {
        background: #fef3c7; padding: 2px 6px; border-radius: 4px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 13.5px; color: #92400e;
        border: 1px solid #fde68a;
      }
      table { border-collapse: collapse; width: 100%; margin: 1.5em 0; }
      table td, table th { border: 1px solid #fde68a; padding: 10px 14px; }
      table th { background: #fef3c7; font-weight: 700; color: #92400e; text-align: left; }
      table tr:nth-child(even) td { background: #fffbeb; }
      ul, ol { padding-left: 1.6em; }
      ul li::marker { color: #f59e0b; }
      hr { border: none; border-top: 2px solid #fde68a; margin: 2em 0; }
      figure { margin: 1.5em auto; text-align: center; }
      figcaption { display: block; text-align: center; color: #a16207; font-size: 13px; margin-top: 8px; font-style: italic; }
      p { margin: 1em 0; }
    `,
    wrapperBg: '#fffdf7',
  },

  // ── 3. macOS 简约 ──
  {
    id: 'macos',
    name: '🍎 macOS 简约',
    css: `
      p, li, td, th {
        color: #1d1d1f;
        line-height: 1.7em;
        font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue',
          'PingFang SC', Arial, sans-serif;
        font-size: 16px;
        -webkit-font-smoothing: antialiased;
      }
      strong { font-weight: 600; color: #0071e3; }
      a { color: #0071e3; text-decoration: none; }
      a:hover { text-decoration: underline; }
      h1 {
        font-size: 2em; font-weight: 700; color: #1d1d1f; text-align: left;
        letter-spacing: -0.03em; margin: 0.6em 0 0.4em;
        font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;
      }
      h2 {
        font-size: 1.4em; font-weight: 700; color: #1d1d1f;
        letter-spacing: -0.02em; margin: 1.8em 0 0.6em;
        font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;
      }
      h3 {
        font-size: 1.1em; font-weight: 600; color: #1d1d1f;
        margin: 1.4em 0 0.4em;
        font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;
      }
      h4, h5, h6 { font-size: 1em; font-weight: 600; color: #6e6e73; }
      blockquote {
        border-left: none; margin: 1.5em 0; padding: 1em 1.4em;
        background: #f5f5f7; border-radius: 12px; color: #3d3d3f;
      }
      blockquote p { margin: 0; }
      code {
        background: #f5f5f7; padding: 2px 7px; border-radius: 6px;
        font-family: 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
        font-size: 13.5px; color: #1d1d1f;
      }
      table { border-collapse: collapse; width: 100%; margin: 1.5em 0; border-radius: 8px; overflow: hidden; }
      table td, table th { border: none; border-bottom: 1px solid #e5e5ea; padding: 10px 14px; }
      table th { background: #f5f5f7; font-weight: 600; color: #1d1d1f; text-align: left; }
      table tr:last-child td { border-bottom: none; }
      ul, ol { padding-left: 1.6em; }
      hr { border: none; border-top: 1px solid #e5e5ea; margin: 2em 0; }
      figure { margin: 2em auto; text-align: center; }
      figcaption { display: block; text-align: center; color: #6e6e73; font-size: 13px; margin-top: 8px; }
      p { margin: 0.9em 0; }
      img { border-radius: 8px; }
    `,
    wrapperBg: '#ffffff',
  },

  // ── 4. 知乎精选 ──
  {
    id: 'zhihu',
    name: '🔵 知乎精选',
    css: `
      p, li, td, th {
        color: #1a1a1a;
        line-height: 1.8em;
        font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue',
          'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
        font-size: 16px;
      }
      strong { font-weight: 600; color: #0f6fec; }
      a { color: #0f6fec; text-decoration: none; }
      a:hover { text-decoration: underline; }
      h1 {
        font-size: 1.7em; font-weight: 700; color: #121212;
        text-align: left; border-bottom: 2px solid #0f6fec;
        padding-bottom: 8px; margin-bottom: 20px;
      }
      h2 {
        font-size: 1.3em; font-weight: 600; color: #0f6fec;
        text-align: left; margin-top: 2em;
        padding: 4px 0 4px 14px; border-left: 4px solid #0f6fec;
      }
      h3 { font-size: 1.1em; font-weight: 600; color: #121212; margin-top: 1.5em; }
      h4, h5, h6 { font-size: 1em; font-weight: 600; color: #444; }
      blockquote {
        border-left: 3px solid #0f6fec; margin: 1.5em 0;
        padding: 0.8em 1.2em; color: #666;
        background: #f4f8ff; border-radius: 0 6px 6px 0;
      }
      blockquote p { margin: 0; }
      code {
        background: #f4f8ff; padding: 2px 6px; border-radius: 4px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 14px; color: #0f6fec; border: 1px solid #d0e4ff;
      }
      table { border-collapse: collapse; width: 100%; margin: 1.2em 0; }
      table td, table th { border: 1px solid #dde5f0; padding: 10px 14px; }
      table th { background: #f0f4ff; font-weight: 600; color: #0f6fec; text-align: left; }
      table tr:nth-child(even) td { background: #f8f9fc; }
      ul, ol { padding-left: 1.6em; }
      ul li::marker { color: #0f6fec; }
      hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
      figure { margin: 1.5em auto; text-align: center; }
      figcaption { display: block; text-align: center; color: #aaa; font-size: 13px; margin-top: 8px; }
      p { margin: 1em 0; }
    `,
    wrapperBg: '#ffffff',
  },

  // ── 5. 极简黑白 ──
  {
    id: 'monochrome',
    name: '⬛ 极简黑白',
    css: `
      p, li, td, th {
        color: #111;
        line-height: 1.85em;
        font-family: 'Georgia', 'Noto Serif SC', 'Source Han Serif', serif;
        font-size: 16px;
      }
      strong { font-weight: 700; color: #000; }
      a { color: #333; text-decoration: underline; }
      h1 {
        font-size: 2em; font-weight: 700; color: #000;
        text-align: center; letter-spacing: -0.02em;
        border-bottom: 3px solid #000; padding-bottom: 10px; margin-bottom: 24px;
        font-family: system-ui, -apple-system, sans-serif;
      }
      h2 {
        font-size: 1.4em; font-weight: 700; color: #000;
        text-align: left; margin-top: 2.5em;
        border-bottom: 1px solid #000; padding-bottom: 4px;
        font-family: system-ui, -apple-system, sans-serif;
      }
      h3 {
        font-size: 1.15em; font-weight: 700; color: #000;
        text-transform: uppercase; letter-spacing: 0.05em;
        font-family: system-ui, -apple-system, sans-serif;
      }
      h4, h5, h6 { font-size: 1em; font-weight: 700; color: #333; font-family: system-ui, sans-serif; }
      blockquote {
        border-left: 4px solid #000; margin: 2em 0;
        padding: 0.8em 1.4em; color: #444; background: #f9f9f9;
      }
      blockquote p { margin: 0; font-style: italic; }
      code {
        background: #f2f2f2; padding: 2px 6px; border-radius: 3px;
        font-family: 'Cascadia Code', Menlo, Consolas, monospace;
        font-size: 14px; color: #000; border: 1px solid #ddd;
      }
      table { border-collapse: collapse; width: 100%; margin: 1.5em 0; }
      table td, table th { border: 1px solid #000; padding: 8px 12px; }
      table th { background: #000; color: #fff; font-weight: 700; text-align: left; }
      ul, ol { padding-left: 1.6em; }
      ul li::marker { color: #000; }
      hr { border: none; border-top: 2px solid #000; margin: 2.5em 0; }
      figure { margin: 2em auto; text-align: center; }
      figcaption { display: block; text-align: center; color: #888; font-size: 13px; margin-top: 8px; }
      p { margin: 1.1em 0; }
      img { filter: grayscale(10%); }
    `,
    wrapperBg: '#ffffff',
  },

  // ── 6. Notion 简洁 ──
  {
    id: 'notion',
    name: '📋 Notion 简洁',
    css: `
      p, li, td, th {
        color: #37352f;
        line-height: 1.75em;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI',
          Helvetica, 'Apple Color Emoji', Arial, sans-serif, 'Segoe UI Emoji', 'Segoe UI Symbol';
        font-size: 16px;
      }
      strong { font-weight: 600; color: #37352f; }
      a { color: #0f7b6c; text-decoration: underline; text-underline-offset: 2px; }
      h1 {
        font-size: 1.875em; font-weight: 700; color: #37352f;
        text-align: left; margin: 1.4em 0 0.4em; letter-spacing: -0.02em;
        border: none;
      }
      h2 {
        font-size: 1.4em; font-weight: 600; color: #37352f;
        text-align: left; margin: 1.4em 0 0.4em; letter-spacing: -0.01em;
        border: none; padding: 0;
      }
      h3 {
        font-size: 1.15em; font-weight: 600; color: #37352f;
        margin: 1.2em 0 0.3em; border: none; padding: 0;
      }
      h4, h5, h6 { font-size: 1em; font-weight: 600; color: #37352f; }
      blockquote {
        border-left: 3px solid #37352f30; margin: 1em 0;
        padding: 0.4em 1em; color: #37352f99; background: transparent;
      }
      blockquote p { margin: 0; }
      code {
        background: rgba(135,131,120,.15); padding: 2px 6px; border-radius: 4px;
        font-family: 'SFMono-Regular', Menlo, Consolas, 'PT Mono', 'Liberation Mono', Courier, monospace;
        font-size: 85%; color: #eb5757;
      }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      table td, table th { border: 1px solid rgba(55,53,47,.2); padding: 8px 12px; }
      table th { background: rgba(55,53,47,.05); font-weight: 600; text-align: left; }
      table tr:hover td { background: rgba(55,53,47,.03); }
      ul, ol { padding-left: 1.7em; }
      ul li::marker { color: #37352f99; }
      hr { border: none; border-top: 1px solid rgba(55,53,47,.2); margin: 2em 0; }
      figure { margin: 1.5em auto; text-align: center; }
      figcaption { display: block; text-align: center; color: #37352f66; font-size: 13px; margin-top: 6px; }
      p { margin: 0.6em 0; }
    `,
    wrapperBg: '#ffffff',
  },
];

const DEFAULT_THEME_ID = 'wechat';

function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

module.exports = { THEMES, DEFAULT_THEME_ID, getTheme };
