"""心情差分的定稿（精修第十六轮确认，第二十一轮改头型、尾巴、光环）：各状态用哪些部件，以及出成品用的纯路径组装。

部件几何来自精修草稿模块：头和眼睛（mood_parts）、尾巴（mood_v3、mood_v4）、光环的环（mood_v4 摆正的那个）、
小符号（mood_parts、mood_v4）。草稿里光环是 SVG 描边、星光和环之间的缝靠底色描边；这里全部改成填充路径——
光环沿椭圆加粗成多边形，缝用几何挖出来——所以透明底也能用，换色只改 fill。
猫、书、腮红、角饰、赤星之节仍用 mark.py 的解析路径；其余是高精度多边形（折线容差 0.015 画布单位）。
默认标志带光环，所以每个状态都有光环（「羞到躲起来」除外，头顶冒热气）；亮着的环后半圈暗一点。
摆放见 halo.placement：比应用图标略小、不带封面边框（有的尾巴和小符号伸得远），切换状态时猫不动。

需要 shapely：uv run --no-project --with shapely python tools/produce.py
"""
import os
import sys

from shapely import affinity
from shapely.geometry import LineString, LinearRing, Point
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import halo as hl
import mark
import mood_parts as mp
import mood_v4 as v4
from lockup import FULL_W, MARK_FULL, flatten
from mark import CRIMSON, IVORY, GOLD, GOLD_DEEP, PINK
from shapes import BOOK_ZONE, QS, blush, capsule, path as poly_path, star4

# 状态：(键, 名称, 产品里的状态, 眼睛, 尾巴, 光环, 小符号, 状态文案)
STATES = [
    ("focus", "专注", "默认", "bean", "up", "gold", (), "开始编织。"),
    ("think", "思考", "Agent 思考", "up", "flick", "think", (), "在文字抵达之前。"),
    ("write", "写作中", "生成正文", "bean", "up", "write", (), "一根一根，将故事织成形。"),
    ("done", "完成", "任务完成", "happy", "tall_a", "done", (), "世界已经成形。"),
    ("ask", "等你选择", "等用户确认或选分支", "vbar", "q_smooth", "gold", ("qbubble",), "命运正在分岔。"),
    ("error", "出错", "失败、重试", "cross", "puff", "error", ("sweat",), "尾巴碰到了时间线，正在恢复。"),
    ("idle", "空闲", "没有任务", "equal", "droop_a", "gold", (), "猫已经看过了。问题不大。"),
    ("sleep", "睡着", "长时间空闲、离线", "sleep", "curl", "sleep", ("zz",), "有只猫压住了剧情线。稍等。"),
    ("idea", "灵感", "发现新线索", "big", "tall_a", "idea", (), "一颗星刚刚改变了位置。"),
    ("shy", "害羞", "被夸、收到好评", "shy", "curl", "shy", ("blush",), "看板娘的「微羞」"),
    ("shy_more", "羞到躲起来", "被大夸特夸", "cross", "curl", None, ("blush",), "羞到躲进书后面了。"),
]
# 状态在「眼睛、尾巴、光环、小符号」之外的样子（精修第十八轮加的「羞到躲起来」）：
# sink 头往书后面沉多少（画布单位）；ear_pink 耳洞填粉；blush_lines 腮红上加「///」；steam 头顶冒热气。
LOOK = {"shy_more": dict(sink=3.2, ear_pink=True, blush_lines=True, steam=True)}
STEAM = [(44.0, 15.5, 1.3), (50.0, 12.5, 1.6), (56.0, 15.5, 1.1)]   # 热气：三个小圆 (x, y, r)


def blush_lines():
    """腮红上的「///」：每边三道斜短线。"""
    lines = [capsule((cx + dx - 0.7, 52.9), (cx + dx + 0.7, 49.4), 0.45) for cx in (28.0, 72.0) for dx in (-2.3, 0.0, 2.3)]
    return unary_union(lines)
# 定稿用到的尾巴姿势的正式名称（草稿模块里是探索期的名字，带 A、B 编号）
TAIL_NAMES = {"up": "竖起", "flick": "平伸、甩尾尖", "tall_a": "竖直", "q_smooth": "问号", "puff": "炸毛", "droop_a": "垂下", "curl": "绕到书底下"}
TILE_MARK_WIDTH, TILE_RX = 62.3, 22   # TILE_MARK_WIDTH 是第二次交付的猫宽，只有精修第十九轮的草稿还在用；现在的摆放见 placement()
SHINE = hl.SHINE    # 高光：象牙色以 85% 盖在金色上的颜色；成品不用透明度
SHADE_PINK = "#E2A19C"   # 粉环的后半圈
GAP = 0.6           # 星光四周挖出来的缝


# ==================== 光环（填充多边形） ====================
def ell_pts(h, t0=0.0, t1=360.0, n=180):
    return [mp.ell_pt(h, t0 + (t1 - t0) * i / n) for i in range(n + 1)]


def band(h, t0=0.0, t1=360.0, w=None):
    """沿椭圆（参数角 t0 到 t1）加粗 w：整圈是一个带洞的环，一段弧两头是圆头。"""
    w = h["w"] if w is None else w
    if t1 - t0 >= 360:
        return LinearRing(ell_pts(h, 0, 360)[:-1]).buffer(w / 2, quad_segs=QS)
    return LineString(ell_pts(h, t0, t1, max(8, int((t1 - t0) / 2)))).buffer(w / 2, quad_segs=QS)


def shine(h):
    return band(h, 196, 232, 1.0)


def sparkle(x, y, r):
    return star4(x, y, r, ratio=1.3)


def halo(key):
    """返回 [(形状, 颜色)]，按从下到上的顺序。"""
    R = v4.RING
    lit = lambda shape, h=R, shade=hl.SHADE: (hl.back(shape, h["c"]), shade)   # 亮着的环后半圈暗一点
    if key == "gold":
        return [(band(R), GOLD), lit(band(R)), (shine(R), SHINE), (hl.sparks(R["c"]), IVORY)]
    if key == "think":
        head, length = 35, 70
        out = [(band(R), GOLD_DEEP)]
        for w, frac in ((R["w"], 0.45), (R["w"] * 0.7, 0.75), (R["w"] * 0.42, 1.0)):
            out.append((band(R, head - length * frac, head, w), GOLD))
        return out
    if key == "write":
        return [(band(R), GOLD_DEEP), (band(R, -90, -90 + 0.62 * 360), GOLD)]
    if key == "done":
        x, y = mp.ell_pt(R, -38)
        stars = [sparkle(x + 2.2, y - 3.6, 2.9), sparkle(x + 7.0, y - 0.6, 1.6)]
        cut = unary_union(stars).buffer(GAP, quad_segs=QS)
        return [(band(R).difference(cut), GOLD), lit(band(R).difference(cut)), (shine(R).difference(cut), SHINE)] + [(s, IVORY) for s in stars]
    if key == "error":
        h = {**R, "c": (R["c"][0], R["c"][1] + 1.5)}
        return [(band(h, 28, 332), GOLD), lit(band(h, 28, 332), h), (shine(h), SHINE)]
    if key == "sleep":
        return [(band({**R, "c": (R["c"][0], R["c"][1] + 2.0)}), GOLD_DEEP)]
    if key == "shy":
        return [(band(R), PINK), lit(band(R), shade=SHADE_PINK), (shine(R), SHINE), (hl.sparks(R["c"]), IVORY)]
    if key == "idea":
        outer = {**R, "rx": R["rx"] + 3.4, "ry": R["ry"] + 1.7, "w": 0.9}
        x, y = mp.ell_pt(outer, -60)
        star = sparkle(x + 1.2, y - 2.4, 2.8)
        cut = star.buffer(GAP, quad_segs=QS)
        return [(band(outer).difference(cut), GOLD), (band(R).difference(cut), GOLD), lit(band(R).difference(cut)), (shine(R).difference(cut), SHINE), (star, IVORY)]
    raise KeyError(key)


# ==================== 组装 ====================
def layers(key):
    """一个状态的全部图层：[(形状或 ("d", 路径, fill-rule), 颜色)]，猫的画布坐标。"""
    _, _, _, eyes, tail, halo_key, extras, _ = next(s for s in STATES if s[0] == key)
    geo, colors = mark.STYLES["ivory"]
    lay = mark.layers(geo)   # 头、书、尾巴、腮红、角饰、环、星；这里只取书和装饰，头和尾巴换成差分的
    look = LOOK.get(key, {})
    sink = look.get("sink", 0)
    down = lambda g: affinity.translate(g, 0, sink).difference(BOOK_ZONE)   # 头上的东西跟着头往下沉，沉到书后面的部分切掉
    head = down(mp.HEAD_RAW.difference(mp.EARS).difference(mp.EYES[eyes][1]()))
    out = [(head, IVORY), (("d", lay[1][1], lay[1][2]), IVORY), (v4.TAILS[tail][2](), IVORY)]
    if look.get("ear_pink"):
        out.append((down(mp.EARS), PINK))
    for role, d, rule in lay[3:]:
        if role == "blush" and "blush" in extras:
            out.append((down(mp.big_blush()), PINK))
        elif role == "blush" and sink:
            out.append((down(mark_blush()), PINK))
        else:
            out.append((("d", d, rule), colors[role]))
    if look.get("blush_lines"):
        out.append((down(blush_lines()), CRIMSON))
    if look.get("steam"):
        out += [(Point(x, y).buffer(r, quad_segs=QS), IVORY) for x, y, r in STEAM]
    if halo_key:
        out += halo(halo_key)
    for e in extras:
        fn = v4.EXTRAS[e][1]
        if fn:
            out += [(g, IVORY if c == mp.IVORY else c) for g, c in fn()]
    return out


def mark_blush():
    return blush()


def placement():
    """心情差分里猫的摆放：和应用图标同一套算法（halo.placement），缩放用 SCALE_MOOD。"""
    return hl.placement(hl.SCALE_MOOD, "box")


def body(key):
    s, tx, ty = placement()
    out = ""
    for g, color in layers(key):
        if isinstance(g, tuple):
            _, d, rule = g
            r = ' fill-rule="evenodd"' if rule == "evenodd" else ""
            out += f'<path d="{flatten(d, s, tx, ty)}" fill="{color}"{r}/>'
        else:
            d = poly_path(affinity.affine_transform(g, [s, 0, 0, s, tx, ty]))
            if d:
                out += f'<path d="{d}" fill="{color}" fill-rule="evenodd"/>'
    return out


def svg(key, tile=True, title="NeuroBook"):
    bg = f'<rect width="100" height="100" rx="{TILE_RX}" fill="{CRIMSON}"/>' if tile else ""
    name = next(s[1] for s in STATES if s[0] == key)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="{title} · {name}">'
            f'<title>{title} · {name}</title>{bg}{body(key)}</svg>\n')


# ==================== 终端 ====================
TERM_PALETTE = [IVORY, CRIMSON, GOLD, GOLD_DEEP, PINK, hl.SHADE, hl.SHADE_DEEP]


def terminal_mark(cols, style="ivory"):
    """标准标志的半块字符：连尾巴的外框四周留 1，按列数栅格化（不抗锯齿），颜色吸附到标准色。
    返回 (ANSI 文本, 半块字符行)。48 列的心情差分是逐像素手画的，见 pixel_moods.py。"""
    import ascii_mark
    geo, colors = hl.style(style)
    inner = "".join(mp.path_el(d, colors[role], rule) for role, d, rule in hl.mark_layers(geo))
    bx0, by0, bx1, by1 = hl.boxes()["all"]
    x0, y0, x1, y1 = bx0 - 1, by0 - 1, bx1 + 1, by1 + 1
    h = round(cols * (y1 - y0) / (x1 - x0) / 2) * 2
    src = f'<svg xmlns="http://www.w3.org/2000/svg" width="{cols}" height="{h}" viewBox="{x0} {y0} {x1 - x0} {y1 - y0}">{inner}</svg>'
    rows = ascii_mark.half_blocks(ascii_mark.raster(src, cols, h, crisp=True), TERM_PALETTE)
    while rows and all(ch == " " for ch, _, _ in rows[-1]):
        rows.pop()
    while rows and all(ch == " " for ch, _, _ in rows[0]):
        rows.pop(0)
    return ascii_mark.to_ansi(rows), rows
