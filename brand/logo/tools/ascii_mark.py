"""标志的终端（TUI）版本：手画的纯 ASCII、半块字符（▀▄█，可带 24 位色）和盲文点字（⣿）。

纯 ASCII 是手画的：终端字符格宽高约 1:2，自动转出来的字符画噪点多，读不出豆豆眼和书脊。
半块字符和盲文点字由标志栅格化而来：半块字符每格上下两个像素，适合像素专用版和带颜色的小图标；
盲文点字每格 2×4 个点，细节最多，但只能单色。

    python3 tools/ascii_mark.py   # 写出 05-refine/round-13/ascii/
"""
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import mark
from mark import CRIMSON, IVORY, INK

OUT = os.path.join(os.path.dirname(__file__), "..", "05-refine", "round-13", "ascii")

# ---------- 手画的纯 ASCII ----------
# 眼睛那一格留成 {e}，心情差分只换这两个字符；{h} 是头顶上方那一行（光环、省略号、z），{t} 是尾巴尖。
SMALL = r"""{h}
 /\___/\
 | {e} |  {t}
[___|_*_]/"""

MEDIUM = r"""   /\           /\
  /  \_________/  \
  |               |
  |   o       o   |   _
 _|_______________|_ ( )
|         |         || |
|         |    *    |/ /
|_________|_________|_/"""

LARGE = r"""     /\                 /\
    /  \               /  \
    |   \_____________/   |
    |                     |
    |                     |
    |     @@       @@     |       _
    |                     |      / \
  __|_____________________|__    | |
 |             |             |   | |
 |             |      .      |__/ /
 |             |   --<*>--   |___/
 |             |      '      |
 |_____________|_____________|"""

# 心情差分（小号）：(键, 名称, 眼睛, 头顶一行, 尾巴尖)
MOODS = [
    ("focus", "专注", "o o", "", ")"),
    ("think", "思考", "o o", "   . . .", ")"),
    ("write", "写作中", ". .", "", ")"),
    ("done", "完成", "^ ^", "   .---.", ")"),
    ("ask", "等你选择", "O O", "", "?"),
    ("error", "出错", "> <", "        ;", ")"),
    ("idle", "空闲", "= =", "", ")"),
    ("sleep", "睡着", "- -", "        z Z", ")"),
    ("idea", "灵感", "* *", "        !", ")"),
]


def small(eyes="o o", head="", tail=")"):
    s = SMALL.format(e=eyes, h=head, t=tail)
    return s if head else s.split("\n", 1)[1]


# ---------- 栅格化 ----------
class Pixels:
    """w×h 的 RGBA 像素，px[x, y] → (r, g, b, a)，0–255。"""

    def __init__(self, w, h, data):
        self.size, self._data = (w, h), data

    def load(self):
        return self

    def __getitem__(self, xy):
        return self._data[xy]


def raster(svg_text, w, h, crisp=False):
    """用 resvg 把 SVG 渲染成 w×h，再用 ImageMagick 的 txt: 格式读出每个像素。
    crisp 时不抗锯齿：从矢量缩到几十像素，抗锯齿的中间色吸附到色板后会变成杂点。"""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "m.svg"), os.path.join(tmp, "m.png")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(svg_text)
        subprocess.run(["resvg", "-w", str(w), "-h", str(h)] + (["--shape-rendering", "crispEdges"] if crisp else []) + [src, dst], check=True)
        txt = subprocess.run(["magick", dst, "-depth", "8", "-alpha", "on", "txt:-"], check=True, capture_output=True, text=True).stdout
    data = {}
    for line in txt.splitlines()[1:]:
        xy, rest = line.split(":", 1)
        x, y = (int(v) for v in xy.split(","))
        hexa = rest.split("#", 1)[1].split()[0]
        data[x, y] = tuple(int(hexa[i:i + 2], 16) for i in (0, 2, 4, 6))
    return Pixels(w, h, data)


def _hex(rgb):
    return "#%02X%02X%02X" % rgb


def half_blocks(img, palette=None, clear=()):
    """每格上下两个像素 → [[(字符, 前景, 背景)]]；前景、背景是 #RRGGBB 或 None（透明）。
    palette 给出时，把像素颜色吸附到最近的色板颜色，免得抗锯齿的中间色变成杂色。
    clear 里的颜色当透明：画的时候用底色挖出来的缝，在终端里应该透出终端自己的底色。"""
    w, h = img.size
    px = img.load()

    def color(x, y):
        r, g, b, a = px[x, y]
        if a < 128:
            return None
        if palette:
            c = min(palette, key=lambda c: sum((int(c[i * 2 + 1:i * 2 + 3], 16) - v) ** 2 for i, v in enumerate((r, g, b))))
            return None if c in clear else c
        return _hex((r, g, b))

    rows = []
    for y in range(0, h, 2):
        row = []
        for x in range(w):
            top, bot = color(x, y), color(x, y + 1) if y + 1 < h else None
            if top is None and bot is None:
                row.append((" ", None, None))
            elif top == bot:
                row.append(("█", top, None))
            elif bot is None:
                row.append(("▀", top, None))
            elif top is None:
                row.append(("▄", bot, None))
            else:
                row.append(("▀", top, bot))
        rows.append(row)
    return rows


def braille(img, threshold=128):
    """每格 2×4 个点；不透明且足够深的像素点亮。"""
    w, h = img.size
    px = img.load()
    bits = [(0, 0, 0x01), (0, 1, 0x02), (0, 2, 0x04), (1, 0, 0x08), (1, 1, 0x10), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80)]
    lines = []
    for y in range(0, h, 4):
        line = ""
        for x in range(0, w, 2):
            v = 0
            for dx, dy, bit in bits:
                if x + dx < w and y + dy < h:
                    r, g, b, a = px[x + dx, y + dy]
                    if a >= threshold and (r + g + b) / 3 < 160:
                        v |= bit
            line += chr(0x2800 + v)
        lines.append(line.rstrip("⠀"))
    return "\n".join(lines)


def to_ansi(rows):
    """24 位色的 ANSI 转义序列（大多数现代终端支持）；颜色变了才写转义，每行末尾复位。"""
    esc = lambda c, layer: f"\x1b[{layer};2;{int(c[1:3], 16)};{int(c[3:5], 16)};{int(c[5:7], 16)}m"
    out = []
    for row in rows:
        while row and row[-1][0] == " ":
            row = row[:-1]
        s, cur = "", (None, None)
        for ch, fg, bg in row:
            if (fg, bg) != cur:
                s += "\x1b[0m" + (esc(fg, 38) if fg else "") + (esc(bg, 48) if bg else "")
                cur = (fg, bg)
            s += ch
        out.append(s + "\x1b[0m")
    return "\n".join(out)


def to_plain(rows):
    return "\n".join("".join(ch for ch, _, _ in row).rstrip() for row in rows)


def to_svg(rows, mono=IVORY):
    """网页预览：每格宽 1、高 2，按字符画出上下两半的颜色，和终端里整格填色的样子一致。
    直接把字符放进网页，行高和字体会在行与行之间留出细缝。"""
    rects = []
    for y, row in enumerate(rows):
        halves = ([], [])
        for ch, fg, bg in row:
            fg = mono if fg == "fg" else fg
            halves[0].append({"█": fg, "▀": fg, "▄": bg}.get(ch))
            halves[1].append({"█": fg, "▀": bg, "▄": fg}.get(ch))
        for dy, line in enumerate(halves):
            x = 0
            while x < len(line):   # 同色相邻的半格合成一个矩形，文件小得多
                c, run = line[x], 1
                while x + run < len(line) and line[x + run] == c:
                    run += 1
                if c:
                    rects.append(f'<rect x="{x}" y="{y * 2 + dy}" width="{run + 0.02:g}" height="1.02" fill="{c}"/>')
                x += run
    w, h = max(len(r) for r in rows), len(rows) * 2
    return f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">{"".join(rects)}</svg>'


# ---------- 各版本 ----------
def pixel_mark_svg(size, tile):
    return mark.pixel_svg(size, tile=tile, color=IVORY if tile else INK)


def builds():
    """返回 [(键, 名称, 说明, 纯文本, ANSI 或 None, 网页预览)]；半块字符的预览是 SVG，其余是转义过的文本。"""
    from html import escape
    from produce import mark_svg, tile_svg
    out = []
    for key, name, note, text in (("small", "小号 · 3 行", "状态栏旁、提示符上方", small()),
                                  ("medium", "中号 · 8 行", "启动画面、关于页", MEDIUM),
                                  ("large", "大号 · 13 行", "欢迎页、空状态", LARGE)):
        out.append((f"ascii-{key}", name, f"纯 ASCII；{note}", text, None, escape(text)))
    pal = [CRIMSON, IVORY, mark.GOLD_DEEP, mark.PINK]
    for key, name, note, svg_text, w, h, palette, crisp in (
            ("blocks-16", "半块字符 · 16×8", "像素专用版 16px；赤红底块，24 位色", pixel_mark_svg(16, True), 16, 16, [CRIMSON, IVORY], False),
            ("blocks-24", "半块字符 · 24×12", "像素专用版 24px；赤红底块，24 位色", pixel_mark_svg(24, True), 24, 24, [CRIMSON, IVORY], False),
            ("blocks-32", "半块字符 · 32×16", "应用图标缩到 32px，带尾巴和装饰；24 位色", tile_svg(), 32, 32, pal, True),
            ("blocks-40", "半块字符 · 40×20", "象牙猫，不带底块，放在深色终端里；带尾巴和装饰，24 位色", mark_svg("ivory"), 40, 40, pal, True),
            ("blocks-mono-24", "半块字符 · 单色 24×12", "像素专用版 24px；跟随终端文字颜色", pixel_mark_svg(24, False), 24, 24, None, False)):
        rows = half_blocks(raster(svg_text, w, h, crisp), palette)
        if palette is None:
            rows = [[(ch, None if fg is None else "fg", None) for ch, fg, _ in row] for row in rows]
            out.append((key, name, note, to_plain(rows), None, to_svg(rows)))
        else:
            out.append((key, name, note, to_plain(rows), to_ansi(rows), to_svg(rows)))
    for key, cols in (("braille-40", 40), ("braille-60", 60)):
        w = cols * 2   # mark_svg 是正方形画布，宽度正好是连尾巴的外框
        text = braille(raster(mark_svg("ink"), w, w))
        text = "\n".join(l for l in text.split("\n") if l.strip("⠀ "))
        out.append((key, f"盲文点字 · {cols} 列", "标准版单色，带尾巴和赤星之节；需要终端字体有盲文字符", text, None, escape(text)))
    return out


def write_files():
    os.makedirs(OUT, exist_ok=True)
    for key, name, note, text, ansi, _ in builds():
        with open(os.path.join(OUT, f"{key}.txt"), "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        if ansi:
            with open(os.path.join(OUT, f"{key}.ans"), "w", encoding="utf-8") as fh:
                fh.write(ansi + "\n")
    with open(os.path.join(OUT, "moods-small.txt"), "w", encoding="utf-8") as fh:
        for key, name, eyes, head, tail in MOODS:
            fh.write(f"# {key} {name}\n{small(eyes, head, tail)}\n\n")
    print("wrote", OUT)


if __name__ == "__main__":
    write_files()
