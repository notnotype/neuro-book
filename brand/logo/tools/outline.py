"""描边白猫（精修第十八轮：浅色底上的第三种组合）：象牙色的猫加一圈赤红描边，眼睛填赤红、耳洞填粉，
颜色关系和应用图标里的白猫一样（白猫、深色眼睛），不用底块，版面更轻。

描边由猫头、书、尾巴各自往外扩 OUTLINE 得到，先画描边再画象牙色的填充；头和书之间的缝被两边的描边填满，
成了一道赤红的分隔线。几何是 shapely 多边形（折线容差 0.015 画布单位），装饰仍用 mark.py 的解析路径。
需要 shapely：uv run --no-project --with shapely python tools/produce.py
"""
import functools
import os
import sys

from shapely.geometry import LineString

sys.path.insert(0, os.path.dirname(__file__))
import halo as hl
import lockup
import mark
import mood_parts as mp
import mood_v4 as v4
from mark import CRIMSON, GOLD, GOLD_DEEP, IVORY, PINK
from shapes import BOOK, BOOK_ZONE, QS, path as poly_path

OUTLINE = 2.2   # 描边宽（画布单位）


@functools.lru_cache(maxsize=None)
def layers():
    """[(路径, 颜色, fill-rule)]，猫的画布坐标，从下到上。"""
    head = mp.HEAD_RAW.difference(BOOK_ZONE)
    tail = v4.TAILS["up"][2]()
    parts = [head, BOOK, tail]
    ring = hl.ring()   # 光环同样描一圈赤红边，里面填金色，后半圈暗一点；三颗小星用深金，不描边
    out = [(poly_path(g.buffer(OUTLINE, quad_segs=QS)), CRIMSON, "evenodd") for g in parts + [ring]]
    out += [(poly_path(g), IVORY, "evenodd") for g in parts]
    out += [(poly_path(ring), GOLD, "evenodd"), (poly_path(hl.back(ring)), hl.SHADE, "evenodd"), (poly_path(hl.sparks()), GOLD_DEEP, "evenodd")]
    geo, colors = mark.STYLES["ivory"]
    out += [(d, colors[role], rule) for role, d, rule in mark.layers(geo)[3:]]
    y0, y1 = mark.CREASE
    out.append((poly_path(LineString([(50, y0), (50, y1)]).buffer(mark.GAP / 2, quad_segs=QS)), CRIMSON, "nonzero"))
    out.append((poly_path(mp.EYES["bean"][1]()), CRIMSON, "evenodd"))
    out.append((poly_path(mp.EARS), PINK, "evenodd"))
    return out


def mark_parts(s, tx, ty):
    return [(f"o{i}", d, rule, s, tx, ty) for i, (d, _c, rule) in enumerate(layers())]


def colors():
    return {f"o{i}": c for i, (_d, c, _r) in enumerate(layers())}


def parts_h(tracking=None, k=lockup.K_MID, gap=lockup.GAP_H):
    """和定稿横排组合同一套摆放；描边让猫往外多出 OUTLINE，字标跟着往右让。"""
    d, s, (bx0, by0, bx1, by1) = lockup.wordmark(tracking)
    sm = k * 100 / lockup.MARK_H
    top = -50 - lockup.MARK_CENTROID * k * 100
    parts = mark_parts(sm, -(lockup.MARK_BOX[0] - OUTLINE) * sm, top - lockup.MARK_BOX[1] * sm)
    wx = (lockup.MARK_FULL[2] + 2 * OUTLINE - lockup.MARK_BOX[0]) * sm + gap - bx0
    parts.append(("wordmark", d, "nonzero", s, wx, 0))
    return parts, (0, min(top - (lockup.MARK_BOX[1] - lockup.MARK_TOP["full"]) * sm, by0), wx + bx1, max(top + (k * 100) + OUTLINE * sm, by1))


def parts_v(tracking=None, k=lockup.K_STACK, gap=lockup.GAP_STACK):
    d, s, (bx0, by0, bx1, by1) = lockup.wordmark(tracking)
    sm = k / lockup.MARK_H
    width = bx1 - bx0
    mark_bottom = by0 - gap - OUTLINE * sm
    left = (width - lockup.MARK_W * sm) / 2
    parts = mark_parts(sm, left - lockup.MARK_BOX[0] * sm, mark_bottom - lockup.MARK_BOX[3] * sm)
    parts.append(("wordmark", d, "nonzero", s, -bx0, 0))
    return parts, (min(0, left - OUTLINE * sm), mark_bottom - k - (lockup.MARK_BOX[1] - lockup.MARK_TOP["full"]) * sm, width, by1)
