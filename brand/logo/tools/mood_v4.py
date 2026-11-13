"""心情差分的第四版部件（精修第十六轮）：光环摆正、问号尾巴做顺、问号气泡。

光环：和第三版同一套（mood_v3.make_halos），环改成水平、居中在头顶上方；出错时不再歪，只沉一点。
问号尾巴：第三版的钩子由三段三次曲线拼成，接点处切线和曲率都有跳变，看着一折一折的。这版在定稿尾巴的第一段
之后接一段曲率从 0 线性增大、再保持不变的曲线（欧拉螺线接圆弧），从竖直到钩子一路平滑地越弯越紧。
问号气泡：圆形对话气泡，尖角指向猫头，中间挖出一个问号。
"""
import math
import os
import sys

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import mood_parts as mp
import mood_v3 as v3
from shapes import QS, bezier_chain

# ==================== 光环 ====================
RING = dict(c=(50.0, 7.0), rx=16.5, ry=4.9, w=3.6, tilt=0)   # 精修第二十一轮：从离头顶 15 降到 12（和 halo.C 一致）
HALOS = v3.make_halos(RING, error_shift=((0.0, 1.5), 0))


# ==================== 问号尾巴 ====================
def question_pts(straight=8.0, ramp=5.0, arc=7.5, radius=4.6, ds=0.05):   # 尾巴加粗到 6.6 后钩子放大、少转一点（约 125°），否则钩子糊成一团、还会碰到脸
    """定稿尾巴第一段（从书后伸出、往上）之后：先直走一小段，再用欧拉螺线把曲率从 0 加到 1/radius，
    最后按这个半径绕到尾尖。往头这边（左）弯，总共转约 125°，尾尖朝左下。"""
    pts = bezier_chain([mp.STEM], 60)
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    phi = math.atan2(y1 - y0, x1 - x0)
    x, y = x1, y1
    k_max = 1 / radius
    s, total = 0.0, straight + ramp + arc
    while s < total:
        if s < straight:
            k = 0.0
        elif s < straight + ramp:
            k = k_max * (s - straight) / ramp
        else:
            k = k_max
        phi -= k * ds            # y 向下的坐标里，往左转是角度减小
        x += math.cos(phi) * ds
        y += math.sin(phi) * ds
        s += ds
        pts.append((x, y))
    return pts


def curvature_profile(pts, step=6):
    """沿中心线每隔 step 个点估一次曲率（1/半径），用来检查有没有跳变。"""
    out = []
    for i in range(step, len(pts) - step, step):
        a, b, c = pts[i - step], pts[i], pts[i + step]
        ab, bc, ca = math.dist(a, b), math.dist(b, c), math.dist(c, a)
        area2 = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        out.append(2 * area2 / (ab * bc * ca) if ab * bc * ca else 0)
    return out


TAILS = {
    **v3.TAILS,
    "q_smooth": ("问号 · A（做顺）", "竖直往上后越弯越紧，接成一个小钩；长度和默认尾巴相近", lambda: mp.band(question_pts()), (91.5, 79.0)),
}


# ==================== 问号气泡 ====================
BUBBLE_C, BUBBLE_R = (89.0, 23.5), 7.2
BUBBLE_TIP = (80.6, 31.6)   # 尖角指向猫头右侧，离头边约 4


def question_glyph(c=BUBBLE_C):
    """问号：上面一个钩（圆弧），中间一小竖，下面一个点；线宽 1.7。"""
    cx, cy = c
    hook = mp.circle_pts((cx, cy - 1.9), 2.3, 195, 415, 30)
    line = LineString(hook + [(cx, cy + 0.9)]).buffer(0.85, quad_segs=QS)
    dot = Point(cx, cy + 3.7).buffer(1.0, quad_segs=QS)
    return unary_union([line, dot])


def bubble():
    cx, cy = BUBBLE_C
    r = BUBBLE_R
    body = Point(cx, cy).buffer(r, quad_segs=QS)
    a1 = (cx + r * math.cos(math.radians(125)), cy + r * math.sin(math.radians(125)))
    a2 = (cx + r * math.cos(math.radians(160)), cy + r * math.sin(math.radians(160)))
    shape = unary_union([body, Polygon([a1, a2, BUBBLE_TIP])]).buffer(0.6, quad_segs=QS).buffer(-0.6, quad_segs=QS)
    return shape.difference(question_glyph())


EXTRAS = {**mp.EXTRAS, "qbubble": ("问号气泡", lambda: [(bubble(), mp.IVORY)])}
