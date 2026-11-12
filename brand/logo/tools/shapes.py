"""定稿生成器共用的 shapely 几何原语（从探索期 refine_round5/6/7 提炼，去除草图页面与冗余代码）。"""
import math
import os
import sys

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import mark
from mark import GAP, f

QS = 24
CRIMSON_LIGHT = "#A5283A"
ABOVE_BOOK = Polygon([(0, -10), (100, -10), (100, 70), (0, 70)])


def cubic_pts(c, n=48):
    return [mark.at(c, i / n) for i in range(n + 1)]


def opening(g, r):
    return g.buffer(-r, quad_segs=QS).buffer(r, quad_segs=QS)


def ellipse(cx, cy, rx, ry):
    return affinity.scale(Point(cx, cy).buffer(1, quad_segs=QS * 2), rx, ry)


def capsule(p0, p1, r):
    return LineString([p0, p1]).buffer(r, quad_segs=QS)


def bezier_chain(segs, n=40):
    pts = []
    for c in segs:
        pts += [mark.at(c, i / n) for i in range(n + (1 if c is segs[-1] else 0))]
    return pts


def _book():
    left = cubic_pts(mark.BOOK_TOP_L) + cubic_pts(mark.BOOK_BOT_L)
    right = [(100 - x, y) for x, y in reversed(left)]
    g = opening(Polygon(left + right[1:-1]), mark.BOOK_CORNER)
    y0, y1 = mark.CREASE
    return g.difference(capsule((50, y0), (50, y1), GAP / 2))


BOOK = _book()
BOOK_ZONE = BOOK.buffer(GAP, quad_segs=QS)


def blush():
    return unary_union([affinity.scale(Point(x, 50.6).buffer(1, quad_segs=QS), 3.3, 1.8) for x in (28.5, 71.5)])


def star4(cx, cy, r, ratio=1.25, k=0.2, n=16):
    ry = r * ratio
    tips = [(cx, cy - ry), (cx + r, cy), (cx, cy + ry), (cx - r, cy)]
    ctrl = [(cx + r * k, cy - ry * k), (cx + r * k, cy + ry * k), (cx - r * k, cy + ry * k), (cx - r * k, cy - ry * k)]
    pts = []
    for i in range(4):
        p0, c, p1 = tips[i], ctrl[i], tips[(i + 1) % 4]
        for j in range(n):
            t = j / n
            pts.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
                        (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]))
    return Polygon(pts)


def path(g, tol=0.015):
    if g.is_empty:
        return ""
    g = g.simplify(tol)
    polys = [g] if g.geom_type == "Polygon" else [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]
    out = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            out.append("M" + " L".join(f"{f(x)},{f(y)}" for x, y in pts) + "Z")
    return "".join(out)


def P(g, fill, extra=""):
    return f'<path d="{path(g)}" fill="{fill}" fill-rule="evenodd"{extra}/>'
