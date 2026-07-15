#!/usr/bin/env python3
"""
xhs_screenshot.py — 将 HTML 文件渲染为小红书多图

依赖安装：
    pip install playwright pillow
    python -m playwright install chromium

用法：
    python3 xhs_screenshot.py <html_file> <output_dir> [--width 1080] [--height 1440] [--padding 40] [--bg #ffffff]
"""

import sys
import argparse
import os
import io
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='将 HTML 渲染为小红书多图')
    parser.add_argument('html_file',   help='HTML 文件路径（绝对或相对路径）')
    parser.add_argument('output_dir',  help='图片输出目录')
    parser.add_argument('--width',   type=int, default=1080,      help='图片宽度（px），默认 1080')
    parser.add_argument('--height',  type=int, default=1440,      help='每张最大高度（px），默认 1440')
    parser.add_argument('--padding', type=int, default=40,        help='上下内边距（px），默认 40')
    parser.add_argument('--bg',      default='#ffffff',           help='背景色，默认 #ffffff')
    args = parser.parse_args()

    html_path  = Path(args.html_file).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── 依赖检查 ──────────────────────────────────────────────────────────────
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('ERROR:缺少 playwright，请运行：pip install playwright && python -m playwright install chromium', flush=True)
        sys.exit(1)

    try:
        from PIL import Image
    except ImportError:
        print('ERROR:缺少 Pillow，请运行：pip install pillow', flush=True)
        sys.exit(1)

    # ── 1. Playwright 渲染并截全页 ────────────────────────────────────────────
    print(f'INFO:渲染 {html_path}', flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': args.width, 'height': 900})
        page.goto(f'file://{html_path}', wait_until='networkidle', timeout=30000)
        # 额外等待 800ms，确保字体/图片渲染完成
        page.wait_for_timeout(800)
        screenshot_bytes = page.screenshot(full_page=True)
        browser.close()

    print(f'INFO:截图完成，开始分割', flush=True)

    # ── 2. 解析背景色 ─────────────────────────────────────────────────────────
    def parse_color(hex_color):
        c = hex_color.lstrip('#')
        if len(c) == 3:
            c = ''.join(x*2 for x in c)
        return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

    bg_rgb = parse_color(args.bg)

    # ── 3. 加上上下 padding ───────────────────────────────────────────────────
    img = Image.open(io.BytesIO(screenshot_bytes)).convert('RGB')
    W, H = img.size
    pad = args.padding
    padded = Image.new('RGB', (W, H + 2 * pad), color=bg_rgb)
    padded.paste(img, (0, pad))
    img = padded
    W, H = img.size

    # ── 4. 智能分片：尽量在空白行处切割 ──────────────────────────────────────
    max_h = args.height
    pixels = img.load()

    def is_blank_row(y, tolerance=10):
        """判断第 y 行是否接近背景色（空白行）"""
        for x in range(W):
            r, g, b = pixels[x, y]
            if (abs(r - bg_rgb[0]) > tolerance or
                abs(g - bg_rgb[1]) > tolerance or
                abs(b - bg_rgb[2]) > tolerance):
                return False
        return True

    slices = []
    start_y = 0
    while start_y < H:
        end_y = min(start_y + max_h, H)
        if end_y < H:
            # 从切割点往上找最近的空白行（搜索范围：下半段的 50%）
            min_cut = start_y + max_h // 2
            cut_y = end_y
            while cut_y > min_cut:
                if is_blank_row(cut_y - 1):
                    end_y = cut_y
                    break
                cut_y -= 1
        slices.append(img.crop((0, start_y, W, end_y)))
        start_y = end_y

    # ── 5. 保存 ──────────────────────────────────────────────────────────────
    saved = []
    for i, s in enumerate(slices, 1):
        out_path = output_dir / f'xhs_{i:02d}.png'
        s.save(str(out_path), 'PNG', optimize=False)
        saved.append(str(out_path))
        print(f'SAVED:{out_path}', flush=True)

    print(f'DONE:{len(saved)}', flush=True)


if __name__ == '__main__':
    main()
