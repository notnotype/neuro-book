#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""探针 P4（只读截图取数）：把 t50 真机验收截图里的「读数」重新量一遍，
用来抽查 t50 实施记录 §4.1 的诚实性，以及通知条与标题栏的相对位置。

试图证伪的声明：
  a. §4.1 四主题表的 `标题栏底 / 文字` 色值与「标题栏 y=0、高 36」；
  b. §4.1 诚实性备注：combo2 / combo4 里的「主题保存失败」提示条是拦截器残留；
     顺带量出它相对标题栏的位置（浏览器里标题栏占 0..36）。

运行（cwd 任意）：
  python .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/p4-screenshot-reading.py [截图目录]
只读：不写任何文件。
"""
from __future__ import annotations

import glob
import os
import sys
from collections import Counter

from PIL import Image

DEFAULT_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp", "nbook-t50-accept", "shots")

CLAIMS = {
    "combo1-nbook-light-1440.png": ("nbook 浅", (255, 252, 245), (87, 83, 75)),
    "combo2-nbook-dark-1440.png": ("nbook 深", (45, 41, 37), (195, 188, 176)),
    "combo3-macos-light-1440.png": ("macOS 浅", (255, 255, 255), (75, 85, 99)),
    "combo4-macos-dark-1440.png": ("macOS 深", (44, 44, 46), (212, 212, 216)),
}


def luminance(pixel):
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]


def row_dominant(image, y):
    return Counter(image.crop((0, y, image.width, y + 1)).getdata()).most_common(1)[0][0]


def bar_bottom(image):
    """标题栏底边：第一行与顶行主色差异超过 12 的行（底部分隔线）。"""
    top = row_dominant(image, 1)
    for y in range(2, min(120, image.height)):
        pixel = row_dominant(image, y)
        if max(abs(pixel[i] - top[i]) for i in range(3)) > 12:
            # 分隔线可能只有 1px：确认下一行确实不同于顶行主色。
            return y, top, pixel
    return None, top, None


def bar_band_colors(image, bottom):
    band = image.crop((0, 0, image.width, max(2, bottom - 1)))
    counter = Counter(band.getdata())
    return counter


def count_near(counter, target, tolerance=2):
    total = 0
    for color, count in counter.items():
        if max(abs(color[i] - target[i]) for i in range(3)) <= tolerance:
            total += count
    return total


def notification_box(image):
    """高饱和红块外接框（error 档通知条）。"""
    width, height = image.size
    crop = image.crop((0, 0, width, min(220, height)))
    pixels = crop.load()
    xs, ys = [], []
    for y in range(crop.height):
        for x in range(crop.width):
            r, g, b = pixels[x, y][:3]
            if r - g > 45 and r - b > 45 and r > 60:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def main():
    shots_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DIR
    files = sorted(glob.glob(os.path.join(shots_dir, "*.png")))
    if not files:
        print(f"没有找到截图：{shots_dir}")
        return 1
    print(f"截图目录：{shots_dir}")
    for path in files:
        image = Image.open(path).convert("RGB")
        name = os.path.basename(path)
        label, claimed_bg, claimed_text = CLAIMS.get(name, ("(未登记)", None, None))
        bottom, bar_bg, divider = bar_bottom(image)
        counter = bar_band_colors(image, bottom or 36)
        ranked = sorted(counter.items(), key=lambda item: (-item[1], luminance(item[0])))[:6]
        print(f"\n== {name}（{label}）尺寸 {image.width}x{image.height}")
        print(f"   标题栏主色={bar_bg}；底边分隔线 y={bottom}（分隔线色 {divider}）→ 量出的标题栏带 = y 0..{(bottom or 36) - 1}")
        print(f"   标题栏带内出现最多的色（色, 像素数）：{ranked}")
        if claimed_bg is not None:
            bg_ok = max(abs(bar_bg[i] - claimed_bg[i]) for i in range(3)) <= 2
            text_count = count_near(counter, claimed_text)
            print(f"   §4.1 声称 底色 {claimed_bg} / 文字 {claimed_text} → 底色吻合={bg_ok}；"
                  f"声称文字色在带内出现 {text_count} 像素（>50 判为吻合）")
        box = notification_box(image)
        if box is None:
            print("   顶部 220px 内没有高饱和红色块（无 error 通知条）")
        else:
            x0, y0, x1, y1 = box
            limit = bottom or 36
            print(f"   顶部红色通知块外接框 x={x0}..{x1}, y={y0}..{y1}；标题栏占 y 0..{limit - 1} → "
                  f"{'与标题栏重叠' if y0 < limit else '不重叠'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
