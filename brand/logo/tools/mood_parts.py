"""心情差分的部件草稿（精修第十四轮起）：尾巴姿势、光环、眼睛、小符号，以及把它们装到猫身上。

猫、书、腮红、角饰、赤星之节用 mark.py 的定稿路径；头用 shapely 画（要挖不同的眼睛），尾巴用 shapely 画
（每种姿势一条中心线，等宽圆头，和书、头之间让出缝）。光环是 SVG 椭圆描边：椭圆和圆弧由浏览器按曲线画，
圆头收尾，比多边形切出来的光滑；定稿时再改写成纯路径。坐标都是猫的画布坐标（100×100）。
"""
import math
import os
import sys

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import mark
from mark import CRIMSON, IVORY, INK, GOLD, GOLD_DEEP, PINK, f
from shapes import ABOVE_BOOK, BOOK_ZONE, CRIMSON_LIGHT, P, QS, bezier_chain, capsule, star4

# 头和耳洞取 mark.py 的定稿（精修第二十一轮：两腮微鼓、耳朵加大、头顶微拱）；HEAD_ZONE 是头往外让出缝的范围，尾巴避开它。
HEAD_RAW = Polygon(mark.head_outline()).intersection(ABOVE_BOOK)
_EAR = Polygon(mark.ear_triangle()).buffer(-(mark.EAR_HOLE_INSET + mark.EAR_HOLE_R), join_style="mitre").buffer(mark.EAR_HOLE_R, quad_segs=QS)
EARS = unary_union([_EAR, affinity.scale(_EAR, -1, 1, origin=(50, 0))])
HEAD_ZONE = HEAD_RAW.buffer(mark.GAP, quad_segs=QS)


def path_el(d, fill, rule="nonzero", extra=""):
    r = ' fill-rule="evenodd"' if rule == "evenodd" else ""
    return f'<path d="{d}" fill="{fill}"{r}{extra}/>'


# ==================== 眼睛 ====================
EYE_Y = mark.book_top_y(37.5) - mark.GAP - mark.BEAN_MARGIN - mark.BEAN_R
EYE_X = (50 - mark.BEAN_DX, 50 + mark.BEAN_DX)


def arc_line(cx, cy, r, a0, a1, width, n=24):
    pts = [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    return LineString(pts).buffer(width / 2, quad_segs=QS)


def both(fn):
    return unary_union([fn(x, -1 if x < 50 else 1) for x in EYE_X])


EYES = {
    # 键: (名称, 几何)；在头上挖洞。side 是 -1（观者左眼）或 1。
    "bean": ("豆豆眼", lambda: both(lambda x, s: Point(x, EYE_Y).buffer(mark.BEAN_R, quad_segs=QS))),
    "up": ("抬头看", lambda: both(lambda x, s: Point(x + 1.4, EYE_Y - 3.0).buffer(3.9, quad_segs=QS))),
    "happy": ("弯弯眼", lambda: both(lambda x, s: arc_line(x, EYE_Y + 1.8, 3.6, 200, 340, 2.1))),
    "sleep": ("闭眼", lambda: both(lambda x, s: arc_line(x, EYE_Y - 1.2, 3.6, 20, 160, 1.9))),
    "equal": ("等号眼", lambda: both(lambda x, s: unary_union([capsule((x - 3.2, EYE_Y + dy), (x + 3.2, EYE_Y + dy), 0.85) for dy in (-1.7, 1.7)]))),
    "vbar": ("竖线眼", lambda: both(lambda x, s: capsule((x, EYE_Y - 3.6), (x, EYE_Y + 2.6), 1.35))),
    "cross": ("> <", lambda: both(lambda x, s: LineString([(x + 2.3 * s, EYE_Y - 2.9), (x - 2.1 * s, EYE_Y), (x + 2.3 * s, EYE_Y + 2.9)])
                                   .buffer(0.95, quad_segs=QS))),
    "big": ("大眼 + 高光", lambda: both(lambda x, s: Point(x, EYE_Y - 0.6).buffer(5.0, quad_segs=QS)
                                     .difference(Point(x + 1.7, EYE_Y - 2.4).buffer(1.4, quad_segs=QS)))),
    "shy": ("往下看", lambda: both(lambda x, s: Point(x - 1.8, EYE_Y + 0.8).buffer(3.7, quad_segs=QS))),
}
BLINK = {"bean", "up", "vbar", "big", "shy"}


def big_blush():
    return unary_union([affinity.scale(Point(x, 51.0).buffer(1, quad_segs=QS), 4.3, 2.3) for x in (28.0, 72.0)])


# ==================== 尾巴 ====================
TAIL_W = mark.TAIL_W
STEM = mark.TAIL[0]   # 定稿尾巴的第一段：从书后往右伸出，贴着书往上


def circle_pts(c, r, a0, a1, n=28):
    return [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def band(pts, width=TAIL_W):
    g = LineString(pts).buffer(width / 2, quad_segs=QS)
    return g.difference(BOOK_ZONE).difference(HEAD_ZONE)


def question_pts():
    """问号：尾巴竖起来，顶上往右鼓、绕过头顶再从左边垂下，尾尖停在钩子里、朝下。"""
    c, r = (93.8, 43.0), 5.2
    start = circle_pts(c, r, 35, 35)[0]
    stem = bezier_chain([STEM, [(96.5, 64), (96.4, 58), (96.6, 53), start]], 40)
    return stem + circle_pts(c, r, 35, -205)[1:]


def puffed(pts, inner=4.0, outer=5.6, step=2.3):
    """炸毛：比平时粗，两侧边缘是一圈锯齿状的毛尖；尾尖是一个大圆头。"""
    line = LineString(pts)
    n = int(line.length / step)
    left, right = [], []
    for i in range(n + 1):
        d = line.length * i / n
        p = line.interpolate(d)
        q = line.interpolate(min(d + 0.5, line.length)) if d + 0.5 <= line.length else line.interpolate(d)
        o = line.interpolate(max(d - 0.5, 0))
        ux, uy = q.x - o.x, q.y - o.y
        m = math.hypot(ux, uy) or 1
        nx, ny = -uy / m, ux / m
        r = outer if i % 2 else inner
        left.append((p.x + nx * r, p.y + ny * r))
        right.append((p.x - nx * r, p.y - ny * r))
    body = Polygon(left + right[::-1]).buffer(0.35, quad_segs=QS).buffer(-0.2, quad_segs=QS)
    tip = Point(pts[-1]).buffer(outer, quad_segs=QS)
    return unary_union([body, tip]).difference(BOOK_ZONE).difference(HEAD_ZONE)


UPRIGHT = mark.TAIL
TAILS = {
    # 键: (名称, 猫的身体语言, 几何工厂, 根部——动画绕它转)
    "up": ("竖起 · 尾尖朝上", "默认：放松、专注", lambda: band(bezier_chain(UPRIGHT)), (91.5, 79.0)),
    "tall": ("高高竖起", "开心、打招呼、得意", lambda: band(bezier_chain([STEM, [(96.5, 64), (96.2, 52), (96.8, 41), (95.4, 32.5)]])), (91.5, 79.0)),
    "question": ("问号", "好奇、想问你", lambda: band(question_pts()), (91.5, 79.0)),
    "flick": ("平伸 · 尾尖翘", "专注思考；尾尖一下一下地甩", lambda: band(bezier_chain([[(80, 79), (94, 80.5), (104, 80.5), (107.5, 75.5)], [(107.5, 75.5), (109.5, 72.5), (109.2, 69), (107.2, 67)]])), (91.0, 79.5)),
    "droop": ("垂下来", "懒洋洋、没事做", lambda: band(bezier_chain([[(80, 80), (92, 81.5), (97.5, 85), (98, 92)], [(98, 92), (98.5, 99), (97.5, 103.5), (100.5, 106.5)]])), (91.5, 80.5)),
    "curl": ("绕到书底下", "蜷着睡", lambda: band(bezier_chain([[(80, 82), (90, 83.5), (96.5, 89), (93, 95)], [(93, 95), (89.5, 100), (79, 100.5), (74.5, 96.5)]])), (91.5, 82.0)),
    "puff": ("炸毛", "吓一跳", lambda: puffed(bezier_chain(UPRIGHT)), (91.5, 79.0)),
}


# ==================== 光环 ====================
HALO = dict(c=(54.0, 3.0), rx=17.0, ry=5.2, w=4.8, tilt=-14)   # 差分里光环的默认位置，和光环特别版一样歪着


def ell_pt(h, t):
    c, rx, ry, tilt = h["c"], h["rx"], h["ry"], math.radians(h["tilt"])
    x, y = rx * math.cos(math.radians(t)), ry * math.sin(math.radians(t))
    return (c[0] + x * math.cos(tilt) - y * math.sin(tilt), c[1] + x * math.sin(tilt) + y * math.cos(tilt))


def ell_d(h, t0=0, t1=360):
    """椭圆（参数角 t0 到 t1，度，y 向下顺时针）的 SVG 路径；整圈拆成两段半圆弧。"""
    rx, ry, tilt = f(h["rx"]), f(h["ry"]), f(h["tilt"])
    p = lambda t: "{},{}".format(*(f(v) for v in ell_pt(h, t)))
    if t1 - t0 >= 360:
        return f"M{p(t0)} A{rx},{ry} {tilt} 0 1 {p(t0 + 180)} A{rx},{ry} {tilt} 0 1 {p(t0)} Z"
    large = 1 if t1 - t0 > 180 else 0
    return f"M{p(t0)} A{rx},{ry} {tilt} {large} 1 {p(t1)}"


def stroke(d, color, w, extra=""):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{f(w)}" stroke-linecap="round"{extra}/>'


def halo_box(h, pad=0.0):
    pts = [ell_pt(h, t) for t in range(0, 360, 10)]
    e = h["w"] / 2 + pad
    return (min(x for x, _ in pts) - e, min(y for _, y in pts) - e, max(x for x, _ in pts) + e, max(y for _, y in pts) + e)


def halo_gold(bg, color=GOLD, **kw):
    h = {**HALO, **kw}
    return stroke(ell_d(h), color, h["w"]), halo_box(h)


def halo_dashed(bg):
    """圆头虚线环：演示里虚线沿着环走（stroke-dashoffset），像在转。"""
    h = HALO
    return (f'<path class="dash" d="{ell_d(h)}" pathLength="100" fill="none" stroke="{GOLD}" stroke-width="{f(h["w"])}" '
            f'stroke-linecap="round" stroke-dasharray="3.2 5.13"/>'), halo_box(h)


def halo_progress(bg, done=0.65):
    """进度环：一圈同样粗的暗色底轨，上面一段金色弧从正上方顺时针走；pathLength 让动画按百分比走。"""
    h = HALO
    track = stroke(ell_d(h), CRIMSON_LIGHT if bg == CRIMSON else "#E4D9CC", h["w"])
    arc = (f'<path class="prog" d="{ell_d(h, -90, 270)}" pathLength="100" fill="none" stroke="{GOLD}" stroke-width="{f(h["w"])}" '
           f'stroke-linecap="round" stroke-dasharray="{f(done * 100)} 100" style="--p:{f(done * 100)}"/>')
    return track + arc, halo_box(h)


def halo_broken(bg):
    """缺了一口：右边断开一截，掉下来的那截在缺口下面，光环整体往右歪。"""
    h = {**HALO, "c": (55.0, 4.0), "tilt": 8}
    ring = stroke(ell_d(h, 32, 322), GOLD, h["w"])
    piece_h = {**h}
    x0, y0 = ell_pt(h, 0)
    piece = stroke(ell_d(piece_h, -20, 22), GOLD, h["w"], f' transform="translate(4.5 7.5) rotate(34 {f(x0)} {f(y0)})"')
    b = halo_box(h)
    return ring + f'<g class="fall">{piece}</g>', (b[0], b[1], b[2] + 6, b[3] + 10)


def halo_unlit(bg):
    """没点亮：只剩一圈细边（金色描边，中间透出底色）。"""
    h = HALO
    return stroke(ell_d(h), GOLD, h["w"]) + stroke(ell_d(h), bg, h["w"] - 2.2), halo_box(h)


def halo_sparkle(bg):
    """金环上落了两颗星：星和环之间用底色描边让出缝。"""
    ring, b = halo_gold(bg)
    out = ring
    for t, r, dx, dy in ((-40, 3.4, 1.0, -1.2), (205, 2.3, -0.6, -0.6)):
        x, y = ell_pt(HALO, t)
        out += P(star4(x + dx, y + dy, r, ratio=1.3), IVORY, f' stroke="{bg}" stroke-width="1.6" paint-order="stroke"')
    return out, (b[0], b[1] - 4, b[2] + 2, b[3])


HALOS = {
    # 键: (名称, 表示什么, 工厂(bg) → (SVG, 外框))
    "gold": ("金环", "完成、正常", halo_gold),
    "dashed": ("虚线环", "思考中；演示里虚线沿着环走", halo_dashed),
    "progress": ("进度环", "写作中；金色那段是进度", halo_progress),
    "broken": ("缺了一口", "出错", halo_broken),
    "unlit": ("没点亮", "睡着、离线", halo_unlit),
    "pink": ("粉环", "害羞", lambda bg: halo_gold(bg, PINK)),
    "sparkle": ("环上落了星", "灵感", halo_sparkle),
}


# ==================== 小符号 ====================
def z_glyph(x, y, s, r=0.75):
    return unary_union([capsule((x, y), (x + s, y), r), capsule((x + s, y), (x, y + s), r), capsule((x, y + s), (x + s, y + s), r)])


def teardrop(cx, cy, r=2.3):
    tip = (cx, cy - r * 2.3)
    a = math.asin(1 / 2.3)
    return unary_union([Point(cx, cy).buffer(r, quad_segs=QS), Polygon([(cx - r * math.cos(a), cy - r * math.sin(a)), tip, (cx + r * math.cos(a), cy - r * math.sin(a))])])


EXTRAS = {
    "sweat": ("汗滴", lambda: [(teardrop(83.5, 33.5, 2.6), IVORY)]),
    "zz": ("z z", lambda: [(z_glyph(81.0, 21.0, 4.6), IVORY), (z_glyph(87.5, 9.5, 6.2, 0.85), IVORY)]),
    "blush": ("大腮红", None),
}


# ==================== 组装 ====================
def cat(eyes="bean", tail="up", halo=None, extras=(), style="ivory", bg=CRIMSON, animated=False, tails=None, halos=None, extra_parts=None):
    """返回 (猫的坐标系里的 SVG 片段, 外框)。tails、halos、extra_parts 换用别的部件表（后面几轮重画的版本）。"""
    TAILS_, HALOS_, EXTRAS_ = tails or TAILS, halos or HALOS, extra_parts or EXTRAS
    geo, colors = mark.STYLES[style]
    head = HEAD_RAW.difference(EARS).difference(EYES[eyes][1]()).difference(BOOK_ZONE)
    tname, tnote, tfn, root = TAILS_[tail]
    tg = tfn()
    lay = mark.layers(geo)
    body = P(head, colors["mark"]) + path_el(lay[1][1], colors["mark"], "evenodd")
    tb = tg.bounds
    origin = f"{f((root[0] - tb[0]) / (tb[2] - tb[0]) * 100)}% {f((root[1] - tb[1]) / (tb[3] - tb[1]) * 100)}%"
    body += f'<g class="tail t-{tail}" style="transform-origin:{origin}">{P(tg, colors["mark"])}</g>'
    for role, d, rule in lay[3:]:
        if role == "blush" and "blush" in extras:
            body += P(big_blush(), colors["blush"])
        else:
            body += path_el(d, colors[role], rule)
    if animated and eyes in BLINK:
        g = EYES[eyes][1]()
        body += "".join(f'<ellipse class="lid" cx="{f(p.centroid.x)}" cy="{f(p.centroid.y)}" rx="{f((p.bounds[2] - p.bounds[0]) / 2 + 0.6)}" '
                        f'ry="{f((p.bounds[3] - p.bounds[1]) / 2 + 0.6)}" fill="{colors["mark"]}"/>' for p in getattr(g, "geoms", [g]))
    boxes = [mark_box(), tb]
    if halo:
        hs, hb = HALOS_[halo][2](bg)
        body += f'<g class="halo h-{halo}">{hs}</g>'
        boxes.append(hb)
    for key in extras:
        fn = EXTRAS_[key][1]
        if fn:
            items = fn()
            body += f'<g class="x-{key}">' + "".join(P(g, c, f' style="--i:{k}"') for k, (g, c) in enumerate(items)) + "</g>"
            boxes += [g.bounds for g, _ in items]
    return body, (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def mark_box():
    """猫头和书的外框；尾巴、光环、小符号的外框另算。"""
    from lockup import MARK_BOX
    return MARK_BOX
