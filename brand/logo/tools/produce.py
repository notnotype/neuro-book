"""阶段 6：导出成品文件到 06-production/，并生成预览页 06-production/index.html。

几何只来自 mark.py（猫、书、尾巴、装饰）、halo.py（光环、应用图标的摆放和封面边框）、lockup.py（组合）
和 wordmark.json（字标轮廓），本脚本不画新形状。默认标志带光环（精修第二十一轮）。
SVG 里的缩放和平移都算进路径坐标，文件中不留 transform、mask、clip-path，换色只改 fill。
各文件的装饰按 mark.STYLES：象牙猫和赤红猫画腮红、封面角饰和赤星之节，单色和 currentColor 不画腮红、角饰，
赤星之节挖空、光环只画环；24px 及以下的像素专用版没有尾巴、装饰和光环。应用图标 64px 及以上带封面边框，
48px 及以下用不带边框、猫更大的那一版。
PNG 用 resvg 渲染；ICO 由本脚本直接写（每项 PNG 压缩）；ICNS 用 icnsutil（uv 临时环境）打包。
心情差分和终端版本来自 moods.py，动画来自 mood_anim.py（都需要 shapely）；动画录屏用 capture_moods.cjs
（仓库的 playwright、本机 Chrome）和 ffmpeg，缺了就跳过，加 --no-video 也跳过：

    uv run --no-project --with shapely python tools/produce.py [--no-video]
"""
import math
import os
import shutil
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from html import escape

sys.path.insert(0, os.path.dirname(__file__))
import halo
import mark
from mark import CRIMSON, IVORY, INK, NIGHT, GOLD, GOLD_DEEP, f
from lockup import MARK_FULL, MARK_TOP, FULL_W, FULL_H, colors_of, mark_parts, parts_h, parts_v, parts_wordmark, render

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "06-production"))
CUR = "currentColor"
TITLE = "NeuroBook"

# 应用图标的摆放、缩放和封面边框见 halo.py（带边框时猫宽占底块 68%，不带时 75%）。
TILE_RX = halo.TILE_RX
# 可遮罩图标（PWA maskable）：系统可能裁成圆形，标志（连光环和小星）要落在直径 80% 的安全圆内；满版、不带边框。
MASKABLE_SCALE = 0.64
# iOS 图标：满版方块，系统自己加圆角，所以不带边框。
TOUCH_SCALE = 0.80
# macOS 图标：1024 画布里放 824 的圆角方块，四周留 100（Apple 的图标网格）。
MAC_CANVAS, MAC_BODY = 1024, 824


# ---------- SVG 组装 ----------
def doc(body, vb):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{TITLE}">'
            f'<title>{TITLE}</title>{body}</svg>\n')


def shift(parts, dx, dy, k=1.0):
    """整体先缩放 k 再平移 (dx, dy)，结果仍是部件列表。"""
    return [(r, d, rule, s * k, tx * k + dx, ty * k + dy) for r, d, rule, s, tx, ty in parts]


def placed(parts, box):
    """把外框左上角移到原点，返回 (部件, 宽, 高)。"""
    x0, y0, x1, y1 = box
    return shift(parts, -x0, -y0), x1 - x0, y1 - y0


def full_box(geo="mono"):
    """标志连尾巴、光环的外框（单色版只有环，其余还有三颗小星）。"""
    return (MARK_FULL[0], MARK_TOP[geo], MARK_FULL[2], MARK_FULL[3])


def centered_mark(width, cx, cy, geo="mono"):
    """标志（连尾巴、光环）宽度为 width、外框中心落在 (cx, cy)。"""
    s = width / FULL_W
    x0, y0, x1, y1 = full_box(geo)
    return mark_parts(s, cx - (x0 + x1) / 2 * s, cy - (y0 + y1) / 2 * s, geo)


def mark_svg(key):
    """单独的标志：正方形画布，外框居中，不含留白。key 是 mark.STYLES 的键。"""
    geo, colors = halo.style(key)
    x0, y0, x1, y1 = full_box(geo)
    side = max(x1 - x0, y1 - y0)
    parts = centered_mark(FULL_W, side / 2, side / 2, geo)
    return doc(render(parts, colors, flat=True), f"0 0 {f(side)} {f(side)}")


def tile_svg(frame=True, full_bleed=False, scale=None):
    """应用图标：frame 带封面边框；full_bleed 满版方块（系统自己裁圆角的场合）。"""
    parts = halo.icon_parts(frame=frame, scale=scale, full_bleed=full_bleed)
    return doc(render(parts, halo.icon_colors(), flat=True), "0 0 100 100")


def mac_svg(frame=True):
    c, b = MAC_CANVAS, MAC_BODY
    o = (c - b) / 2
    return doc(render(halo.icon_parts(b, o, o, frame=frame), halo.icon_colors(), flat=True), f"0 0 {c} {c}")


def lockup_svg(kind, mark_key, wm_color):
    geo, colors = colors_of(mark_key, wm_color)
    parts, box = {"horizontal": parts_h, "stacked": parts_v}[kind](geo=geo)
    parts, w, h = placed(parts, box)
    return doc(render(parts, colors, flat=True), f"0 0 {f(w)} {f(h)}")


def badge_lockup_svg(kind):
    """应用图标 + 字标：浅色底上，白猫黑眼睛和应用图标一模一样。"""
    import lockup
    parts, box = {"horizontal": lockup.parts_h_badge, "stacked": lockup.parts_v_badge}[kind]()
    parts, w, h = placed(parts, box)
    colors = {**halo.icon_colors(), "wordmark": INK}
    return doc(render(parts, colors, flat=True), f"0 0 {f(w)} {f(h)}")


def outline_lockup_svg(kind):
    """描边白猫 + 字标：象牙色的猫加赤红描边，不用底块（需要 shapely）。"""
    import outline
    parts, box = {"horizontal": outline.parts_h, "stacked": outline.parts_v}[kind]()
    parts, w, h = placed(parts, box)
    return doc(render(parts, {**outline.colors(), "wordmark": INK}, flat=True), f"0 0 {f(w)} {f(h)}")


def wordmark_svg(color):
    parts, box = parts_wordmark()
    parts, w, h = placed(parts, box)
    return doc(render(parts, {"wordmark": color}, flat=True), f"0 0 {f(w)} {f(h)}")


def pixel_svg(size, tile, color):
    """像素专用版：沿用 mark.pixel_svg 的几何，补上标题。"""
    raw = mark.pixel_svg(size, tile=tile, color=color)
    head, rest = raw.split(">", 1)
    return head + f' role="img" aria-label="{TITLE}"><title>{TITLE}</title>' + rest + "\n"


# ---------- 文件输出 ----------
MANIFEST = []  # (分组, 相对路径, 用途, 预览底色)


def write(rel, text, group, use, bg=IVORY):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    ET.fromstring(text)  # SVG 必须是合法 XML
    MANIFEST.append((group, rel, use, bg))
    return path


def png(src_rel, dst_rel, width, height=None, group=None, use="", bg=IVORY):
    src, dst = os.path.join(ROOT, src_rel), os.path.join(ROOT, dst_rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    args = ["resvg", "-w", str(width)] + (["-h", str(height)] if height else []) + [src, dst]
    subprocess.run(args, check=True)
    if group:
        MANIFEST.append((group, dst_rel, use, bg))
    return dst


def write_ico(pngs, dst):
    """把若干 PNG 原样装进一个 ICO（每项都是 PNG 压缩）。ImageMagick 会把每个尺寸存成未压缩位图，
    256px 一项就几百 KB；PNG 项从 Windows Vista 起和所有现代浏览器都支持。"""
    blobs = []
    for path in pngs:
        data = open(path, "rb").read()
        w, h = struct.unpack(">II", data[16:24])  # PNG 的 IHDR 块
        blobs.append((w, h, data))
    offset = 6 + 16 * len(blobs)
    head = struct.pack("<HHH", 0, 1, len(blobs))
    entries, body = b"", b""
    for w, h, data in blobs:
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(data), offset + len(body))
        body += data
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as fh:
        fh.write(head + entries + body)


def measure(svg_text, px=2000):
    """渲染后裁边，量出图形的实际外框（画布单位）。"""
    tmp = os.path.join(ROOT, ".measure.svg")
    out = os.path.join(ROOT, ".measure.png")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(svg_text)
    subprocess.run(["resvg", "-w", str(px), "-h", str(px), tmp, out], check=True)
    geo = subprocess.run(["magick", out, "-trim", "-format", "%w %h %X %Y", "info:"], check=True, capture_output=True, text=True).stdout.split()
    os.remove(tmp)
    os.remove(out)
    w, h, x, y = (float(v) for v in geo)
    k = 100 / px
    return (x * k, y * k, (x + w) * k, (y + h) * k)


def build_svgs():
    g = "SVG · 标志"
    write("svg/mark/neurobook-mark.svg", mark_svg("current"), g, "跟随文字颜色（currentColor），用在界面里；不画腮红和角饰，赤星之节挖空，光环只画环")
    write("svg/mark/neurobook-mark-crimson.svg", mark_svg("crimson"), g, "象牙或浅色底上的赤红剪影：金色角饰和环，星挖空，深金光环")
    write("svg/mark/neurobook-mark-ink.svg", mark_svg("ink"), g, "单色（墨）：不画腮红和角饰，赤星之节挖空，光环只画环")
    write("svg/mark/neurobook-mark-ivory.svg", mark_svg("ivory"), g, "反白：深色或赤红底上；深金角饰和环，赤红星，金光环", NIGHT)

    g = "SVG · 应用图标"
    write("svg/app-icon/neurobook-app-icon.svg", tile_svg(), g, "赤红底块加封面边框，64px 及以上")
    write("svg/app-icon/neurobook-app-icon-plain.svg", tile_svg(frame=False), g, "不带边框、猫更大：32–48px，或版面已经很满的时候")
    write("svg/app-icon/neurobook-app-icon-24.svg", pixel_svg(24, True, IVORY), g, "24px 像素专用版：没有尾巴、装饰和光环")
    write("svg/app-icon/neurobook-app-icon-16.svg", pixel_svg(16, True, IVORY), g, "16px 像素专用版：没有尾巴、装饰和光环")
    write("svg/app-icon/neurobook-app-icon-macos.svg", mac_svg(), g, "macOS 图标网格（1024 画布、824 底块），带封面边框")
    write("svg/app-icon/neurobook-app-icon-macos-plain.svg", mac_svg(frame=False), g, "macOS 图标网格，不带边框：iconset 里 64px 以下的尺寸用")

    g = "SVG · 小尺寸单色"
    for size, use in ((24, "24px：托盘、任务栏"), (16, "16px：托盘、菜单"), (14, "14px：桌面标题栏")):
        write(f"svg/small/neurobook-mark-{size}.svg", pixel_svg(size, False, CUR), g, f"{use}；像素专用版，currentColor")

    g = "SVG · 字标"
    write("svg/wordmark/neurobook-wordmark.svg", wordmark_svg(CUR), g, "currentColor")
    write("svg/wordmark/neurobook-wordmark-ink.svg", wordmark_svg(INK), g, "浅色底")
    write("svg/wordmark/neurobook-wordmark-ivory.svg", wordmark_svg(IVORY), g, "深色底", NIGHT)

    for kind, name in (("horizontal", "横排组合"), ("stacked", "竖排组合")):
        g = f"SVG · {name}"
        base = f"svg/lockup/neurobook-lockup-{kind}"
        write(f"{base}-color.svg", lockup_svg(kind, "crimson", INK), g, "赤红剪影、墨色字标，浅色底")
        write(f"{base}-badge.svg", badge_lockup_svg(kind), g, "应用图标 + 字标：浅色底，白猫黑眼睛")
        write(f"{base}-outline.svg", outline_lockup_svg(kind), g, "描边白猫 + 字标：浅色底，版面更轻")
        write(f"{base}-reversed.svg", lockup_svg(kind, "ivory", IVORY), g, "反白：深色底", NIGHT)
        write(f"{base}-ink.svg", lockup_svg(kind, "ink", INK), g, "单色（墨）")
        write(f"{base}.svg", lockup_svg(kind, "current", CUR), g, "currentColor")


def build_rasters():
    g = "PNG · 应用图标"
    for s in (1024, 512, 256, 128, 64):
        png("svg/app-icon/neurobook-app-icon.svg", f"png/app-icon/neurobook-app-icon-{s}.png", s, s, g if s in (1024, 256, 64) else None, f"{s}px")
    for s in (48, 32):
        png("svg/app-icon/neurobook-app-icon-plain.svg", f"png/app-icon/neurobook-app-icon-{s}.png", s, s, g, f"{s}px，不带边框")
    for s in (1024, 256):
        png("svg/app-icon/neurobook-app-icon-plain.svg", f"png/app-icon/neurobook-app-icon-plain-{s}.png", s, s, g, f"{s}px，不带边框")
    for s in (24, 16):
        png(f"svg/app-icon/neurobook-app-icon-{s}.svg", f"png/app-icon/neurobook-app-icon-{s}.png", s, s, g, f"{s}px 像素专用版")

    g = "PNG · 标志与组合（透明底）"
    for c, bg in (("crimson", IVORY), ("ink", IVORY), ("ivory", NIGHT)):
        png(f"svg/mark/neurobook-mark-{c}.svg", f"png/mark/neurobook-mark-{c}-512.png", 512, 512, g, f"标志 512px（{c}）", bg)
    for kind, w in (("horizontal", 1200), ("stacked", 800)):
        png(f"svg/lockup/neurobook-lockup-{kind}-color.svg", f"png/lockup/neurobook-lockup-{kind}-color-{w}.png", w, None, g, f"{w}px 宽", IVORY)
        png(f"svg/lockup/neurobook-lockup-{kind}-badge.svg", f"png/lockup/neurobook-lockup-{kind}-badge-{w}.png", w, None, g, f"{w}px 宽，应用图标 + 字标", IVORY)
        png(f"svg/lockup/neurobook-lockup-{kind}-outline.svg", f"png/lockup/neurobook-lockup-{kind}-outline-{w}.png", w, None, g, f"{w}px 宽，描边白猫", IVORY)
        png(f"svg/lockup/neurobook-lockup-{kind}-reversed.svg", f"png/lockup/neurobook-lockup-{kind}-reversed-{w}.png", w, None, g, f"{w}px 宽", NIGHT)

    # ---------- 网站 ----------
    g = "网站"
    os.makedirs(os.path.join(ROOT, "web"), exist_ok=True)
    shutil.copy(os.path.join(ROOT, "svg/app-icon/neurobook-app-icon-plain.svg"), os.path.join(ROOT, "web/favicon.svg"))
    MANIFEST.append((g, "web/favicon.svg", "矢量 favicon（不带边框）：高分屏浏览器优先用它", IVORY))
    ico = os.path.join(ROOT, "web/favicon.ico")
    write_ico([os.path.join(ROOT, f"png/app-icon/neurobook-app-icon-{s}.png") for s in (16, 32, 48)], ico)
    MANIFEST.append((g, "web/favicon.ico", "16（像素版）、32、48；1 倍屏和旧浏览器用", IVORY))
    write("web/.apple-touch-icon.svg", tile_svg(frame=False, full_bleed=True, scale=TOUCH_SCALE), g, "")
    MANIFEST.pop()
    png("web/.apple-touch-icon.svg", "web/apple-touch-icon.png", 180, 180, g, "180px 满版方块、不带边框，iOS 自己加圆角")
    png("svg/app-icon/neurobook-app-icon.svg", "web/icon-192.png", 192, 192, g, "网页清单 192px")
    png("svg/app-icon/neurobook-app-icon.svg", "web/icon-512.png", 512, 512, g, "网页清单 512px")
    write("web/.maskable.svg", tile_svg(frame=False, full_bleed=True, scale=MASKABLE_SCALE), g, "")
    MANIFEST.pop()
    png("web/.maskable.svg", "web/icon-maskable-512.png", 512, 512, g, "可遮罩图标：标志在 80% 安全圆内")
    for tmp in ("web/.apple-touch-icon.svg", "web/.maskable.svg"):
        os.remove(os.path.join(ROOT, tmp))

    # ---------- 桌面应用 ----------
    g = "桌面应用"
    win = os.path.join(ROOT, "desktop/windows/neurobook.ico")
    # 不放 16、24 的像素专用版（开发者 2026-11-15：太丑、太糊）：任务栏、托盘、标题栏这类小尺寸由系统从 32 缩。
    write_ico([os.path.join(ROOT, f"png/app-icon/neurobook-app-icon-{s}.png") for s in (32, 48, 64, 128, 256)], win)
    MANIFEST.append((g, "desktop/windows/neurobook.ico", "Windows：32–256（小尺寸由系统从 32 缩，不用像素版）", IVORY))

    iconset = os.path.join(ROOT, "desktop/macos/neurobook.iconset")
    os.makedirs(iconset, exist_ok=True)
    mac_src = "svg/app-icon/neurobook-app-icon-macos.svg"
    mac_plain = "svg/app-icon/neurobook-app-icon-macos-plain.svg"
    for base in (16, 32, 128, 256, 512):
        for px, name in ((base, f"icon_{base}x{base}.png"), (base * 2, f"icon_{base}x{base}@2x.png")):
            png(mac_src if px >= 128 else mac_plain, f"desktop/macos/neurobook.iconset/{name}", px, px)
    icns = os.path.join(ROOT, "desktop/macos/neurobook.icns")
    files = sorted(os.path.join(iconset, n) for n in os.listdir(iconset))
    subprocess.run(["uv", "run", "--no-project", "--with", "icnsutil", "icnsutil", "compose", "-f", icns] + files, check=True, capture_output=True)
    MANIFEST.append((g, "desktop/macos/neurobook.icns", "macOS：由 neurobook.iconset 打包，16–1024", IVORY))
    MANIFEST.append((g, "desktop/macos/neurobook.iconset/icon_512x512@2x.png", "macOS iconset（Apple 图标网格）", IVORY))

    os.makedirs(os.path.join(ROOT, "desktop/linux"), exist_ok=True)
    shutil.copy(os.path.join(ROOT, "svg/app-icon/neurobook-app-icon.svg"), os.path.join(ROOT, "desktop/linux/neurobook.svg"))
    png("svg/app-icon/neurobook-app-icon.svg", "desktop/linux/neurobook.png", 512, 512, g, "Linux：512px PNG，另附同名 SVG")


# ---------- 预览页 ----------
def index():
    groups = {}
    for group, rel, use, bg in MANIFEST:
        groups.setdefault(group, []).append((rel, use, bg))
    sections = []
    for group, items in groups.items():
        cells = []
        for rel, use, bg in items:
            size = os.path.getsize(os.path.join(ROOT, rel))
            ext = rel.rsplit(".", 1)[-1]
            # SVG 没有固有尺寸，按比例塞满预览框；位图按原始像素显示，16px 的图不被放大。
            preview = f'<img class="{"vec" if ext == "svg" else "bmp"}" src="{rel}" alt="">' if ext in ("svg", "png", "ico") else ""
            if rel.endswith(".icns"):
                preview = '<img class="bmp" src="desktop/macos/neurobook.iconset/icon_256x256.png" alt="">'
            if rel.endswith(".webm"):
                preview = f'<video class="vec" src="{rel}" autoplay loop muted playsinline></video>'
            if rel.endswith((".js", ".html")):
                preview = '<img class="vec" src="animation/loop/neurobook-mood-think.svg" alt="">'
            if rel.endswith(".ans"):
                preview = f'<img class="vec" src="{rel.replace("terminal/", "terminal/preview/").rsplit(".", 1)[0]}.svg" alt="">'
            color = INK if bg != NIGHT else IVORY
            cells.append(f'<figure><div class="pv" style="background:{bg};color:{color}">{preview}</div>'
                         f'<figcaption><a href="{rel}"><code>{escape(rel)}</code></a><br>{escape(use)} · {size / 1024:.1f} KB</figcaption></figure>')
        sections.append(f'<h2>{escape(group)}</h2><div class="grid">{"".join(cells)}</div>')
    html = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NeuroBook 成品文件</title>
<link rel="icon" href="web/favicon.ico" sizes="32x32"><link rel="icon" href="web/favicon.svg" type="image/svg+xml">
<style>
:root{{--ivory:{IVORY};--paper:#FBF8F4;--line:#E4D9CC;--ink:{INK};--muted:#7A6A5E;--crimson:{CRIMSON}}}
*{{box-sizing:border-box}}
body{{margin:0;background:#EDE5DA;color:var(--ink);font:14px/1.7 system-ui,"PingFang SC","Noto Sans CJK SC",sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:36px 16px 80px}}
h1{{font-size:28px;margin:0 0 6px}} h2{{font-size:19px;margin:34px 0 10px}}
a{{color:var(--crimson)}} code{{font-size:12px;word-break:break-all}}
.lede{{color:var(--muted);max-width:860px;margin:0}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(250px,100%),1fr));gap:10px}}
figure{{margin:0;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px}}
.pv{{display:grid;place-items:center;height:150px;border-radius:8px;padding:14px}}
.pv img.vec,.pv video.vec{{width:100%;height:122px;object-fit:contain}} .pv img.bmp{{max-width:100%;max-height:122px}}
figcaption{{font-size:12px;color:var(--muted);margin-top:8px}}
</style></head><body><main>
<h1>NeuroBook 标识 · 06 成品文件</h1>
<p class="lede">由 <code>tools/produce.py</code> 生成；几何来自 <code>tools/mark.py</code>、<code>tools/lockup.py</code> 和 <code>tools/wordmark.json</code>。SVG 不含 transform、mask 和 clip-path，换色只改 fill。第三次交付（精修第十九到二十一轮）：默认标志带光环，头型改成两腮微鼓、耳朵加大、头顶微拱，尾巴加粗，猫在底块里放大，应用图标加封面边框；心情差分、终端版本、组合和动画都跟着更新。早期探索草图与前两次交付归档在本地 <code>.local/brand/logo-archive/</code>。使用规则见 <a href="../07-guidelines/index.html">第七步的使用规范</a>。整理于 2026-10-03。</p>
{"".join(sections)}
</main></body></html>"""
    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)


# ---------- 心情差分、终端 ----------
def build_moods():
    import ascii_mark
    import moods
    import pixel_moods as pm

    for key, name, when, *_ in moods.STATES:
        write(f"svg/moods/neurobook-mood-{key}.svg", moods.svg(key), "心情差分 · SVG", f"{name}：{when}；赤红底块，不带边框")
        write(f"svg/moods/neurobook-mood-{key}-dark.svg", moods.svg(key, tile=False), "心情差分 · SVG", f"{name}：透明底，放在深色底上", NIGHT)
    for key, name, *_ in moods.STATES:
        for size in (512, 128):
            png(f"svg/moods/neurobook-mood-{key}.svg", f"png/moods/neurobook-mood-{key}-{size}.png", size, size,
                "心情差分 · PNG" if size == 512 else None, f"{name} {size}px")

    def term(rel, ansi, rows, use, bg=NIGHT):
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(ansi + "\n")
        # 网页里看不了 ANSI，另存一张按格子画的预览，和终端里的样子一致
        prev = rel.replace("terminal/", "terminal/preview/").rsplit(".", 1)[0] + ".svg"
        ppath = os.path.join(ROOT, prev)
        os.makedirs(os.path.dirname(ppath), exist_ok=True)
        with open(ppath, "w", encoding="utf-8") as fh:
            fh.write(ascii_mark.to_svg(rows).replace("<svg ", f'<svg style="background:{bg}" ', 1) + "\n")
        MANIFEST.append(("终端（半块字符，24 位色）", rel, use, bg))

    for cols in (80, 100, 120):
        ansi, rows = moods.terminal_mark(cols)
        term(f"terminal/neurobook-{cols}.ans", ansi, rows, f"{cols} 列，深色终端；cat 输出")
    ansi, rows = moods.terminal_mark(100, "crimson")
    term("terminal/neurobook-crimson-100.ans", ansi, rows, "100 列，浅色终端", "#F4EFE8")
    everything = []
    for key, name, *_ in moods.STATES:
        rows = pm.to_rows(pm.state(key))
        ansi = ascii_mark.to_ansi(rows)
        everything.append(f"# {key} {name}\n{ansi}")
        term(f"terminal/moods/neurobook-mood-{key}-48.ans", ansi, rows, f"心情差分 · {name}：48 列 × 30 行，逐像素画")
    with open(os.path.join(ROOT, "terminal/moods/all-48.ans"), "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(everything) + "\n")


# ---------- 动画 ----------
def write_file(rel, text, group=None, use="", bg=IVORY):
    """写文本文件（JS、HTML、Markdown），不做 SVG 的 XML 检查。"""
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    if group:
        MANIFEST.append((group, rel, use, bg))


def build_animation(video=True):
    import tempfile
    import mood_anim
    import moods

    g = "动画"
    write_file("animation/neurobook-mood.js", mood_anim.component_js(), g, "网页组件 <neurobook-mood>：切换动画、循环、空闲时跟鼠标；用法见 README.md")
    write_file("animation/demo.html", mood_anim.demo_html(), g, "演示页：点状态看切换")
    write_file("animation/README.md", mood_anim.readme(), g, "用法、状态和动作表、以后怎么加动画和改动画")
    for key, name, *_ in moods.STATES:
        write(f"animation/loop/neurobook-mood-{key}.svg", mood_anim.looping_svg(key), "动画 · 循环 SVG", f"{name}：赤红底块；不要脚本，可当图片用")
        write(f"animation/loop/neurobook-mood-{key}-dark.svg", mood_anim.looping_svg(key, tile=False), "动画 · 循环 SVG", f"{name}：透明底，深色背景", NIGHT)
    if not video:
        webm = os.path.join(ROOT, "animation/video/neurobook-moods-tour.webm")
        if os.path.isfile(webm):
            MANIFEST.append(("动画 · 录屏", "animation/video/neurobook-moods-tour.webm", "十一个状态轮播，360px、24 帧；网页、文档里放视频用", IVORY))
        print("skip video (--no-video)")
        return
    if not shutil.which("ffmpeg") or not shutil.which("node"):
        print("skip video: 需要 ffmpeg 和 node")
        return
    order = ",".join(k for k, *_ in moods.STATES)
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "capture_moods.cjs"), os.path.join(ROOT, "animation/neurobook-mood.js"),
                            tmp, order, "24", "360"], capture_output=True, text=True)
        if r.returncode:
            print("skip video:", r.stderr.strip()[:200])
            return
        vdir = os.path.join(ROOT, "animation/video")
        os.makedirs(vdir, exist_ok=True)
        frames = os.path.join(tmp, "f_%05d.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "24", "-i", frames, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34",
                        "-pix_fmt", "yuv420p", os.path.join(vdir, "neurobook-moods-tour.webm")], check=True)
        if "--gif" in sys.argv:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "24", "-i", frames, "-vf",
                            "fps=12,scale=240:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
                            os.path.join(vdir, "neurobook-moods-tour.gif")], check=True)
    MANIFEST.append(("动画 · 录屏", "animation/video/neurobook-moods-tour.webm", "十一个状态轮播，360px、24 帧；网页、文档里放视频用", IVORY))
    if "--gif" in sys.argv:
        MANIFEST.append(("动画 · 录屏", "animation/video/neurobook-moods-tour.gif", "同上，240px、12 帧；聊天、不能放视频的地方", IVORY))


def main():
    saved_webm = None
    webm_path = os.path.join(ROOT, "animation/video/neurobook-moods-tour.webm")
    if "--no-video" in sys.argv and os.path.isfile(webm_path):
        with open(webm_path, "rb") as fh:
            saved_webm = fh.read()
    if os.path.isdir(ROOT):
        shutil.rmtree(ROOT)  # 整个目录都由本脚本生成，重跑时从空目录开始，避免留下改名前的旧文件
    os.makedirs(ROOT)
    if saved_webm is not None:
        os.makedirs(os.path.dirname(webm_path), exist_ok=True)
        with open(webm_path, "wb") as fh:
            fh.write(saved_webm)
    build_svgs()
    build_rasters()
    build_moods()
    build_animation(video="--no-video" not in sys.argv)
    index()
    print("wrote", ROOT, len(MANIFEST), "entries")


if __name__ == "__main__":
    main()
