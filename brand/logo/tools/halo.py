"""默认标志的光环、应用图标的摆放和封面边框（精修第二十一轮定稿）。

默认标志带光环：等宽的金环，后半圈暗一点（前亮后暗），左后方一道高光，旁边三颗小星。
应用图标：猫连光环一起摆进赤红底块，左右按面积重心居中，上下取「外框居中」和「重心居中」的中间；
带封面边框（沿边一圈细金线，正下方断开嵌一颗星）时猫宽占底块 68%，不带边框时 75%。
几何用 shapely 画成多边形（折线容差 0.015 画布单位），输出只有填充路径；猫和书仍是 mark.py 的解析路径。

需要 shapely：uv run --no-project --with shapely python tools/produce.py
"""
import functools
import math
import os
import sys

from shapely.geometry import LineString, LinearRing, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import mark
from mark import CRIMSON, GOLD, GOLD_DEEP, IVORY
from shapes import BOOK, BOOK_ZONE, QS, bezier_chain, ellipse, path as poly_path, star4

# ---------- 光环 ----------
C = (50.0, 7.0)                 # 中心：两耳之间的上方，离头顶 12
RX, RY, W = 16.5, 4.9, 3.6      # 椭圆半径和线宽
SHADE = "#C29156"               # 后半圈：深金以 55% 盖在金色上的颜色；成品不用透明度
SHINE = "#F4E8DC"               # 高光：象牙色以 85% 盖在金色上的颜色
SHADE_DEEP = "#8A5F22"          # 浅色底上（光环用深金）后半圈的颜色
SPARKS = [(22.5, -4.5, 2.3), (-23.0, 1.0, 1.6), (15.0, -9.5, 1.2)]   # 三颗小星：相对光环中心的 (dx, dy, 半径)


def ell_pts(c=C, rx=RX, ry=RY, t0=0.0, t1=360.0, n=180):
    return [(c[0] + rx * math.cos(math.radians(t0 + (t1 - t0) * i / n)), c[1] + ry * math.sin(math.radians(t0 + (t1 - t0) * i / n))) for i in range(n + 1)]


def ring(c=C, w=W):
    return LinearRing(ell_pts(c)[:-1]).buffer(w / 2, quad_segs=QS)


def arc(t0, t1, w, c=C):
    return LineString(ell_pts(c, t0=t0, t1=t1, n=max(8, int((t1 - t0) / 2)))).buffer(w / 2, quad_segs=QS)


def back(shape, c=C):
    """环的后半圈（离观众远的上半边）。"""
    return shape.intersection(box(-50, c[1] - 30, 150, c[1] - 0.4))


def shine(c=C):
    return arc(196, 232, 1.0, c)


def sparks(c=C):
    return unary_union([star4(c[0] + dx, c[1] + dy, r, ratio=1.3) for dx, dy, r in SPARKS])


@functools.lru_cache(maxsize=None)
def layers(geo="full"):
    """光环的图层 [(角色, 路径, fill-rule)]，猫的画布坐标，从下到上。单色版（mono）只画环。"""
    out = [("halo", poly_path(ring()), "evenodd")]
    if geo != "mono":
        out += [("halo_shade", poly_path(back(ring())), "evenodd"), ("halo_shine", poly_path(shine()), "evenodd"),
                ("spark", poly_path(sparks()), "evenodd")]
    return out


# 各颜色版本里光环的颜色（键同 mark.STYLES）
COLORS = {
    "ivory": dict(halo=GOLD, halo_shade=SHADE, halo_shine=SHINE, spark=IVORY),
    "crimson": dict(halo=GOLD_DEEP, halo_shade=SHADE_DEEP, halo_shine=GOLD, spark=GOLD_DEEP),
}


def style(s):
    """mark.style 加上光环：返回 (几何版本, 各角色的颜色)。单色版光环和猫同色。"""
    geo, colors = mark.style(s)
    one = colors["mark"]   # 没有专门配色的版本（单色、临时给的颜色）：光环各部分都和猫同色
    extra = COLORS[s] if isinstance(s, str) and s in COLORS else dict(halo=one, halo_shade=one, halo_shine=one, spark=one)
    return geo, {**colors, **extra}


def mark_layers(geo="mono"):
    """默认标志的全部图层：猫、书、尾巴、装饰（mark.layers），再加光环。"""
    return mark.layers(geo) + layers(geo)


# ---------- 外框和摆放 ----------
@functools.lru_cache(maxsize=None)
def shapes():
    """猫头、书、尾巴、光环的形状（量外框和重心用）。"""
    import mood_parts as mp
    head = mp.HEAD_RAW.difference(BOOK_ZONE)
    tail = LineString(bezier_chain(mark.TAIL)).buffer(mark.TAIL_W / 2, quad_segs=QS).difference(BOOK_ZONE)
    return dict(head=head, book=BOOK, tail=tail, halo=ring())


@functools.lru_cache(maxsize=None)
def boxes():
    """core 猫头加书；full 再加尾巴；halo 再加光环；all 再加三颗小星。"""
    s = shapes()
    core = unary_union([s["head"], s["book"]])
    full = unary_union([core, s["tail"]])
    with_halo = unary_union([full, s["halo"]])
    return dict(core=core.bounds, full=full.bounds, halo=with_halo.bounds, all=unary_union([with_halo, sparks()]).bounds,
                centroid=(with_halo.centroid.x, with_halo.centroid.y), core_centroid=(core.centroid.x, core.centroid.y))


SCALE_FRAMED, SCALE_PLAIN = 0.78, 0.86   # 猫的画布单位 → 底块单位：带边框（猫宽占 68%）、不带边框（75%）
SCALE_MOOD = 0.76                        # 心情差分：尾巴会伸得更远，再小一点；各状态里猫的位置不变


def placement(scale, v="mid"):
    """应用图标里的摆放 (缩放, 平移 x, 平移 y)：左右按面积重心；上下 mid 取外框中心和面积重心的中间（应用图标），
    box 按外框居中（心情差分：给垂下来的尾巴在下面留出位置）。"""
    b = boxes()
    _, y0, _, y1 = b["halo"]
    cx, my = b["centroid"]
    cy = ((y0 + y1) / 2 + my) / 2 if v == "mid" else (y0 + y1) / 2
    return scale, 50 - cx * scale, 50 - cy * scale


# ---------- 封面边框（底块坐标 100×100） ----------
TILE_RX = 22
FRAME_INSET, FRAME_W = 6.0, 0.8          # 细金线离底块边缘的距离和线宽
FRAME_STAR = (50.0, 94.0, 3.6)           # 正下方嵌的四角星 (x, y, 半径)
FRAME_DOTS = [(44.6, 94.0, 0.6), (55.4, 94.0, 0.6)]


def rounded_rect(inset=0.0, rx=TILE_RX):
    r = rx - inset
    return box(inset + r, inset + r, 100 - inset - r, 100 - inset - r).buffer(r, quad_segs=QS)


@functools.lru_cache(maxsize=None)
def frame_path(full_bleed=False):
    """封面边框「底部嵌星」：一圈细金线在正下方断开，嵌一颗四角星，两边各一个小点。"""
    line = rounded_rect(FRAME_INSET).boundary.buffer(FRAME_W / 2, quad_segs=QS)
    x, y, r = FRAME_STAR
    line = line.difference(box(x - 7.5, y - 6, x + 7.5, 100))
    extra = [star4(x, y, r, ratio=1.0)] + [Point(px, py).buffer(pr, quad_segs=QS) for px, py, pr in FRAME_DOTS]
    return poly_path(unary_union([line] + extra))


def tile_rect(size=100.0, x=0.0, y=0.0, rx=TILE_RX, full_bleed=False):
    from lockup import rounded_rect as rr
    k = size / 100
    return f"M{mark.f(x)},{mark.f(y)} H{mark.f(x + size)} V{mark.f(y + size)} H{mark.f(x)} Z" if full_bleed else rr(x, y, size, size, rx * k)


def icon_parts(size=100.0, x=0.0, y=0.0, frame=True, scale=None, full_bleed=False, key="ivory"):
    """应用图标的部件 [(角色, 路径, fill-rule, 缩放, 平移 x, 平移 y)]：底块（角色 tile）、封面边框（frame）、猫和光环。
    边长 size、左上角在 (x, y)。"""
    k = size / 100
    geo, _ = mark.style(key)
    s, tx, ty = placement(scale or (SCALE_FRAMED if frame else SCALE_PLAIN))
    parts = [("tile", tile_rect(size, x, y, full_bleed=full_bleed), "nonzero", 1, 0, 0)]
    if frame:
        parts.append(("frame", frame_path(), "evenodd", k, x, y))
    return parts + [(role, d, rule, s * k, tx * k + x, ty * k + y) for role, d, rule in mark_layers(geo)]


def icon_colors(key="ivory"):
    return {**style(key)[1], "tile": CRIMSON, "frame": GOLD}
