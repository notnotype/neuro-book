"""NeuroBook 标志「书后露头」的定稿几何（精修第二轮起；第十二轮后加上豆豆眼、耳洞、尾巴和装饰）。

草图阶段的猫头用局部坐标、蒙版和裁切拼出来；这里改成画布坐标下的纯路径：
猫头一条闭合路径（眼睛、耳洞是 evenodd 的洞），书一条闭合路径（书脊折痕是洞），尾巴一条闭合路径，
装饰（腮红、封面角饰、赤星之节）各一条。这样换色只改 fill，导出到其他工具也不依赖 mask 和 clip-path。
精修第四到十二轮用 shapely 画的草稿（tools/refine_round*.py）在这里改写成解析路径，形状与草稿一致。

画布 100×100。猫头即第五轮梯形头平移到 (50, 46)、缩放 0.95。
"""
import math

# ---------- 标准色（精修第二轮提出，待确认） ----------
CRIMSON = "#871222"   # 赤红：底块、象牙底上的图形
IVORY = "#F7F2EC"     # 象牙：底色、赤红底块和深色底上的图形
INK = "#2E211B"       # 墨：单色版
NIGHT = "#1C1418"     # 夜：深色底
GOLD = "#E1B285"      # 金：只在赤红或深色底上用（光环特别版）
GOLD_DEEP = "#A8762F"  # 深金：象牙底上的金色点缀
PINK = "#F2B3AE"      # 粉：腮红，只作点缀（看板娘的脸红）

GAP = 2.6  # 猫头和书之间的缝，与书脊折痕同宽


def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def pt(p):
    return f"{f(p[0])},{f(p[1])}"


# ---------- 几何工具 ----------
def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def split(c, t):
    """de Casteljau：把三次贝塞尔在 t 处分成两段。"""
    p0, p1, p2, p3 = c
    a, b, d = lerp(p0, p1, t), lerp(p1, p2, t), lerp(p2, p3, t)
    e, g = lerp(a, b, t), lerp(b, d, t)
    m = lerp(e, g, t)
    return [p0, a, e, m], [m, g, d, p3]


def at(c, t):
    return split(c, t)[0][3]


def sub(c, t0, t1):
    """取 [t0, t1] 那一段。"""
    right = split(c, t0)[1]
    return split(right, (t1 - t0) / (1 - t0))[0] if t0 < 1 else right


def unit(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n)


def offset_cubic(c, d):
    """Tiller–Hanson 偏移：控制多边形三条边各沿法线平移 d，相邻两条求交得新控制点。
    曲线平缓时误差很小；调用方负责检查。d 为正时朝行进方向的右手侧（屏幕坐标，y 向下）。"""
    legs = [(c[0], c[1]), (c[1], c[2]), (c[2], c[3])]
    moved = []
    for a, b in legs:
        u = unit((b[0] - a[0], b[1] - a[1]))
        n = (u[1], -u[0])
        moved.append(((a[0] + n[0] * d, a[1] + n[1] * d), (b[0] + n[0] * d, b[1] + n[1] * d)))

    def cross(l1, l2):
        (x1, y1), (x2, y2) = l1
        (x3, y3), (x4, y4) = l2
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    return [moved[0][0], cross(moved[0], moved[1]), cross(moved[1], moved[2]), moved[2][1]]


def solve(fn, lo, hi, n=60):
    """二分求 fn(t) = 0，要求 fn(lo) 与 fn(hi) 异号。"""
    a, b = fn(lo), fn(hi)
    assert a * b <= 0, (a, b)
    for _ in range(n):
        mid = (lo + hi) / 2
        m = fn(mid)
        if a * m <= 0:
            hi, b = mid, m
        else:
            lo, a = mid, m
    return (lo + hi) / 2


def fillet(prev, p, nxt, r):
    """在折点 p 处倒圆角：返回 (起点, 终点, sweep)。"""
    u, v = unit((prev[0] - p[0], prev[1] - p[1])), unit((nxt[0] - p[0], nxt[1] - p[1]))
    theta = math.acos(max(-1, min(1, u[0] * v[0] + u[1] * v[1])))
    t = r / math.tan(theta / 2)
    sweep = 1 if (u[0] * v[1] - u[1] * v[0]) < 0 else 0
    return (p[0] + u[0] * t, p[1] + u[1] * t), (p[0] + v[0] * t, p[1] + v[1] * t), sweep


def mirror(p):
    return (100 - p[0], p[1])


def cubic(c):
    return f" C{pt(c[1])} {pt(c[2])} {pt(c[3])}"


# ---------- 书 ----------
# 书的上沿、下沿都是从书脊往外的三次曲线；左半边，右半边镜像。
BOOK_TOP_L = [(50, 62), (40, 57.5), (26, 56.5), (12, 58.5)]
BOOK_BOT_L = [(12, 88), (26, 86), (40, 87), (50, 91)]
BOOK_CORNER = 2.2   # 书的四个外角
CREASE = (66.5, 86.5)  # 书脊折痕的上下端（圆头中心），两端各留约 3 的连接


def _corner_t(c, from_end, r):
    """在曲线靠近角的一端，找到离角点直线距离为 r 的参数。"""
    corner = c[3] if from_end else c[0]
    g = lambda t: math.dist(at(c, t), corner) - r
    return solve(g, 0.5, 1.0) if from_end else solve(g, 0.0, 0.5)


def book_path():
    top = BOOK_TOP_L
    bot = BOOK_BOT_L
    t_top = _corner_t(top, True, BOOK_CORNER)       # 上沿靠左上角那一端
    t_bot = _corner_t(bot, False, BOOK_CORNER)      # 下沿靠左下角那一端
    top_cut = sub(top, 0, t_top)                    # 书脊 → 左上角前
    bot_cut = sub(bot, t_bot, 1)                    # 左下角后 → 书脊
    tl, bl = top[3], bot[0]
    # 左半：书脊顶 → 左上角 → 左下角 → 书脊底
    d = f"M{pt(top[0])}" + cubic(top_cut)
    d += f" Q{pt(tl)} {pt((tl[0], tl[1] + BOOK_CORNER))}"
    d += f" L{pt((bl[0], bl[1] - BOOK_CORNER))} Q{pt(bl)} {pt(bot_cut[0])}"
    d += cubic(bot_cut)
    # 右半：书脊底 → 右下角 → 右上角 → 书脊顶（左半镜像、倒序）
    rb = [mirror(p) for p in reversed(bot_cut)]
    rt = [mirror(p) for p in reversed(top_cut)]
    d += cubic(rb)
    d += f" Q{pt(mirror(bl))} {pt((100 - bl[0], bl[1] - BOOK_CORNER))}"
    d += f" L{pt((100 - tl[0], tl[1] + BOOK_CORNER))} Q{pt(mirror(tl))} {pt(rt[0])}"
    d += cubic(rt) + " Z"
    # 书脊折痕：一道圆头短槽，evenodd 下成为洞。
    w = GAP / 2
    y0, y1 = CREASE
    d += f" M{f(50 - w)},{f(y0)} A{f(w)},{f(w)} 0 0 1 {f(50 + w)},{f(y0)} L{f(50 + w)},{f(y1)} A{f(w)},{f(w)} 0 0 1 {f(50 - w)},{f(y1)} Z"
    return d


# ---------- 猫头 ----------
HEAD_S, HEAD_X, HEAD_Y = 0.95, 50, 46


def _abs(p):
    return (HEAD_X + p[0] * HEAD_S, HEAD_Y + p[1] * HEAD_S)


# 第五轮梯形头的折点（局部坐标）：头侧边一直延伸到耳尖，耳朵内沿斜向下接头顶。
SIDE_LOW = _abs((-30, 4))
EAR_TIP = _abs((-25.87, -33.8))    # 头侧边与耳朵内沿延长后的交点
EAR_INNER = _abs((-11, -21))
# 第一次交付的椭圆眼；精修第二到五轮的脚本拿它对照，定稿不再用。
EYE_DX, EYE_Y, EYE_RX, EYE_RY = 11 * HEAD_S, HEAD_Y + 2 * HEAD_S, 4.4 * HEAD_S, 5.4 * HEAD_S

# 豆豆眼（精修第五轮）：小圆点，放低、拉开，眼睛底边离书上沿 GAP + BEAN_MARGIN，像在埋头看书。
BEAN_R, BEAN_DX, BEAN_MARGIN = 4.1, 12.5, 2.6


def _side_x(y):
    """头侧边（过 SIDE_LOW 与 EAR_TIP 的直线）在 y 处的 x（左边）。"""
    (sx, sy), (ex, ey) = SIDE_LOW, EAR_TIP
    return sx + (ex - sx) * (y - sy) / (ey - sy)


def book_top_y(x):
    """书上沿在 x 处的 y。"""
    xx = x if x <= 50 else 100 - x
    t = solve(lambda t: at(BOOK_TOP_L, t)[0] - xx, 0.0, 1.0)
    return at(BOOK_TOP_L, t)[1]


def circle(c, r):
    x, y = c
    return f" M{f(x - r)},{f(y)} A{f(r)},{f(r)} 0 1 0 {f(x + r)},{f(y)} A{f(r)},{f(r)} 0 1 0 {f(x - r)},{f(y)} Z"


def ellipse(c, rx, ry):
    x, y = c
    return f" M{f(x - rx)},{f(y)} A{f(rx)},{f(ry)} 0 1 0 {f(x + rx)},{f(y)} A{f(rx)},{f(ry)} 0 1 0 {f(x - rx)},{f(y)} Z"


def bean_eyes():
    out = ""
    for x in (50 - BEAN_DX, 50 + BEAN_DX):
        out += circle((x, book_top_y(x) - GAP - BEAN_MARGIN - BEAN_R), BEAN_R)
    return out


# 水滴形耳洞（精修第十轮）：耳朵三角形（耳尖、耳根内侧、头侧边上 y=37 的点）内缩 EAR_HOLE_INSET，
# 三个角倒 EAR_HOLE_R 的圆角；耳尖那个角最尖，倒完圆角读成水滴。
EAR_HOLE_Y = 37.0
EAR_HOLE_INSET, EAR_HOLE_R = 3.2, 1.8


def inset_triangle(pts, d):
    """三角形各边往里平移 d 后的三个顶点（顺序不变）：顶点沿角平分线移动 d / sin(半角)。"""
    out = []
    for k, v in enumerate(pts):
        a, b = pts[k - 1], pts[(k + 1) % 3]
        u1 = unit((a[0] - v[0], a[1] - v[1]))
        u2 = unit((b[0] - v[0], b[1] - v[1]))
        bis = unit((u1[0] + u2[0], u1[1] + u2[1]))
        half = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2
        out.append((v[0] + bis[0] * d / math.sin(half), v[1] + bis[1] * d / math.sin(half)))
    return out


def rounded_polygon(pts, r):
    d = ""
    n = len(pts)
    for k in range(n):
        a0, a1, sw = fillet(pts[k - 1], pts[k], pts[(k + 1) % n], r)
        d += f"{' L' if d else ' M'}{pt(a0)} A{f(r)},{f(r)} 0 0 {sw} {pt(a1)}"
    return d + " Z"


def ear_holes_v1():
    """第二次交付的耳洞（直边梯形头）；历史脚本对照用。"""
    left = inset_triangle([EAR_TIP, EAR_INNER, (_side_x(EAR_HOLE_Y), EAR_HOLE_Y)], EAR_HOLE_INSET)
    return rounded_polygon(left, EAR_HOLE_R) + rounded_polygon([mirror(p) for p in reversed(left)], EAR_HOLE_R)


# 头型定稿（精修第十九到二十一轮）：在梯形头上，两腮微鼓（侧边由直线改成往外鼓的二次曲线）、
# 耳朵加大（耳尖抬高 EAR_GROW、耳根往里加宽）、头顶微拱 HEAD_TOP_ARC。
HEAD_TOP_ARC, HEAD_BULGE, EAR_GROW = 0.3, 1.3, 2.5
HEAD_LOW = (_side_x(74.0), 74.0)                                   # 侧边的下端，藏在书后面
EAR_TIP2 = (EAR_TIP[0] - 0.25 * EAR_GROW, EAR_TIP[1] - EAR_GROW)
EAR_INNER2 = (EAR_INNER[0] + 0.9 * EAR_GROW, EAR_INNER[1])
SIDE_CTRL = ((HEAD_LOW[0] + EAR_TIP2[0]) / 2 - HEAD_BULGE * 2, (HEAD_LOW[1] + EAR_TIP2[1]) / 2 + 8)
HEAD_TIP_R, HEAD_INNER_R = 3.2, 2.8                                # 耳尖、耳根的圆角


def qat(q, u):
    """二次贝塞尔上的点。"""
    return lerp(lerp(q[0], q[1], u), lerp(q[1], q[2], u), u)


def head_geom(tip_r=HEAD_TIP_R, inner_r=HEAD_INNER_R):
    """左半边头的各段：侧边（二次曲线，下端 HEAD_LOW、上端接耳尖圆角）、耳尖圆角、耳根圆角、头顶（三次曲线，到中线）。
    侧边的控制点在耳尖圆角的切线上，头顶从耳根圆角的终点顺着切线出发，所以各段之间切线连续。"""
    a0, a1, sa = fillet(SIDE_CTRL, EAR_TIP2, EAR_INNER2, tip_r)
    aim = (EAR_INNER2[0] + 3.5, EAR_INNER2[1] - HEAD_TOP_ARC * 0.8)   # 头顶起步的方向
    b0, b1, sb = fillet(EAR_TIP2, EAR_INNER2, aim, inner_r)
    d = unit((aim[0] - EAR_INNER2[0], aim[1] - EAR_INNER2[1]))
    span, top_y = 50 - b1[0], EAR_INNER2[1] - HEAD_TOP_ARC
    top = [b1, (b1[0] + d[0] * span / 3, b1[1] + d[1] * span / 3), (50 - span / 3, top_y), (50, top_y)]
    return (HEAD_LOW, SIDE_CTRL, a0), (a0, a1, sa, tip_r), (b0, b1, sb, inner_r), top


def head_side_x(y):
    """头侧边（左边）在 y 处的 x。"""
    side = head_geom()[0]
    return qat(side, solve(lambda u: qat(side, u)[1] - y, 0.0, 1.0))[0]


def ear_triangle():
    """左耳的三角形：耳尖、耳根内侧、头侧边上 y = EAR_HOLE_Y 的点。"""
    return [EAR_TIP2, EAR_INNER2, (head_side_x(EAR_HOLE_Y), EAR_HOLE_Y)]


def ear_holes():
    left = inset_triangle(ear_triangle(), EAR_HOLE_INSET)
    return rounded_polygon(left, EAR_HOLE_R) + rounded_polygon([mirror(p) for p in reversed(left)], EAR_HOLE_R)


def _arc_pts(a, b, r, toward, n=10):
    """半径 r、从 a 到 b 的小圆弧上的点；圆心取离 toward 近的那一个。"""
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    half = math.dist(a, b) / 2
    h = math.sqrt(max(r * r - half * half, 0))
    u = unit((b[0] - a[0], b[1] - a[1]))
    c = min(((mx - u[1] * h, my + u[0] * h), (mx + u[1] * h, my - u[0] * h)), key=lambda q: math.dist(q, toward))
    a0, a1 = math.atan2(a[1] - c[1], a[0] - c[0]), math.atan2(b[1] - c[1], b[0] - c[0])
    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    return [(c[0] + r * math.cos(a0 + da * i / n), c[1] + r * math.sin(a0 + da * i / n)) for i in range(n + 1)]


def head_outline(n=40):
    """整个头的轮廓折线（不切书、不挖眼睛和耳洞，下端到 y = 74）：心情差分和动画用它做布尔运算。"""
    side, (a0, a1, _sa, tr), (b0, b1, _sb, ir), top = head_geom()
    inside = (EAR_TIP2[0] + 6, EAR_TIP2[1] + 12)                     # 耳朵里面的一点：耳尖圆角的圆心在这一侧
    above = (EAR_INNER2[0], EAR_INNER2[1] - 10)                      # 耳根上方：耳根圆角的圆心在头的外面
    left = [qat(side, i / n) for i in range(n + 1)] + _arc_pts(a0, a1, tr, inside)[1:] + _arc_pts(b0, b1, ir, above) + [at(top, i / n) for i in range(1, n + 1)]
    return [(50, 74.0)] + left + [mirror(p) for p in reversed(left[:-1])]


def head_path(tip_r=HEAD_TIP_R, inner_r=HEAD_INNER_R, gap=GAP, eyes="bean", ears=True):
    # 猫头下沿 = 书上沿往上偏移 gap，缝在任何位置都等宽。上沿从书脊往左走，往上是负方向。
    edge = offset_cubic(BOOK_TOP_L, -gap)
    # 偏移后的曲线与书脊中线 x=50 相交处是左右两半的接缝。
    t_mid = solve(lambda t: at(edge, t)[0] - 50, 0.0, 0.5)
    side, (a0, a1, sa, _), (b0, b1, sb, _), top = head_geom(tip_r, inner_r)
    side_x = lambda y: qat(side, solve(lambda u: qat(side, u)[1] - y, 0.0, 1.0))[0]
    t_side = solve(lambda t: at(edge, t)[0] - side_x(at(edge, t)[1]), 0.3, 1.0)   # 头侧边与偏移曲线的交点
    bottom = sub(edge, t_mid, t_side)   # 中线 → 左侧边
    corner_l = bottom[3]
    u = solve(lambda u: qat(side, u)[1] - corner_l[1], 0.0, 1.0)
    ctrl = lerp(side[1], side[2], u)    # 侧边从交点到耳尖圆角那一段的控制点
    d = f"M{pt(corner_l)} Q{pt(ctrl)} {pt(a0)} A{f(tip_r)},{f(tip_r)} 0 0 {sa} {pt(a1)}"
    d += f" L{pt(b0)} A{f(inner_r)},{f(inner_r)} 0 0 {sb} {pt(b1)}" + cubic(top)
    d += cubic([mirror(p) for p in reversed(top)])
    d += f" A{f(inner_r)},{f(inner_r)} 0 0 {sb} {pt(mirror(b0))}"
    d += f" L{pt(mirror(a1))} A{f(tip_r)},{f(tip_r)} 0 0 {sa} {pt(mirror(a0))}"
    d += f" Q{pt(mirror(ctrl))} {pt(mirror(corner_l))}"
    d += cubic([mirror(p) for p in reversed(bottom)])  # 右侧边 → 中线
    d += cubic(list(bottom))                           # 中线 → 左侧边
    d += " Z"
    if eyes == "bean":
        d += bean_eyes()
    else:
        for x in (HEAD_X - EYE_DX, HEAD_X + EYE_DX):
            d += ellipse((x, EYE_Y), EYE_RX, EYE_RY)
    if ears:
        d += ear_holes()
    return d


# ---------- 尾巴（精修第九轮「侧边 · 尾尖朝上」） ----------
# 中心线两段三次曲线：从书后面往右伸出，贴着书的右侧往上卷，尾尖朝上、不回头碰书。
# 第二段的第一个控制点比草稿挪了 0.25，让两段在接点处切线连续，偏移出来的两条边才接得上。
# 精修第十九轮加粗：线宽 5 → 6.6，整体往书这边挪 0.6。
TAIL = [[(79.4, 80), (90.4, 82), (96.4, 74), (95.9, 64)],
        [(95.9, 64), (95.65, 59), (95.4, 55), (94.2, 52)]]
TAIL_W = 6.6
TAIL_CUT_X = 100 - BOOK_TOP_L[3][0] + GAP   # 书右侧往外 GAP：尾巴和书之间的缝与头和书之间一样宽
TAIL_PIECES = 4                              # 每段曲线切成几小段再偏移，Tiller–Hanson 在弯处才够准


def _tail_side(d):
    """中心线往一侧偏移 d 的一串三次曲线，从书缝处切齐开始。"""
    out = []
    for c in TAIL:
        for i in range(TAIL_PIECES):
            out.append(offset_cubic(sub(c, i / TAIL_PIECES, (i + 1) / TAIL_PIECES), d))
    k = next(i for i, c in enumerate(out) if c[3][0] > TAIL_CUT_X)
    t = solve(lambda t: at(out[k], t)[0] - TAIL_CUT_X, 0.0, 1.0)
    return [sub(out[k], t, 1.0)] + out[k + 1:]


def tail_path():
    """等宽圆头的尾巴：两侧偏移线，尾尖一个半圆，根部被书缝切成一道竖直的直边。"""
    h = TAIL_W / 2
    a, b = _tail_side(h), _tail_side(-h)
    end, prev = TAIL[-1][3], TAIL[-1][2]
    u = unit((end[0] - prev[0], end[1] - prev[1]))
    tip = (end[0] + u[0] * h, end[1] + u[1] * h)
    a_end, b_end = a[-1][3], b[-1][3]
    va, vt = (a_end[0] - end[0], a_end[1] - end[1]), (tip[0] - end[0], tip[1] - end[1])
    sweep = 1 if va[0] * vt[1] - va[1] * vt[0] > 0 else 0
    d = f"M{pt(a[0][0])}" + "".join(cubic(c) for c in a)
    d += f" A{f(h)},{f(h)} 0 0 {sweep} {pt(b_end)}"
    d += "".join(cubic(list(reversed(c))) for c in reversed(b))
    return d + " Z"


def tail_offset_error(n=40):
    """尾巴两条边到中心线的距离与半宽之差的最大值（中心线密采样）。"""
    base = [at(c, i / 400) for c in TAIL for i in range(401)]
    worst = 0
    for d in (TAIL_W / 2, -TAIL_W / 2):
        for c in _tail_side(d):
            for i in range(n + 1):
                p = at(c, i / n)
                worst = max(worst, abs(min(math.dist(p, q) for q in base) - abs(d)))
    return worst


# ---------- 装饰 ----------
# 腮红（精修第六轮）：两颗扁椭圆，在豆豆眼外下方。
BLUSH = [(28.5, 50.6), (71.5, 50.6)]
BLUSH_RX, BLUSH_RY = 3.3, 1.8


def blush_path():
    return "".join(ellipse(c, BLUSH_RX, BLUSH_RY) for c in BLUSH).strip()


# 封面角饰（精修第六轮）：书的四个外角各盖一块，内边是一条 45° 斜线，离角点 CORNER_LEG。
# 外边沿用书的轮廓（同一组曲线和角），和书严丝合缝。
CORNER_LEG = 4.5


def corners_path():
    top, bot = BOOK_TOP_L, BOOK_BOT_L
    tl, bl = top[3], bot[0]
    t_top = _corner_t(top, True, BOOK_CORNER)
    t_bot = _corner_t(bot, False, BOOK_CORNER)
    # 斜线：左上角 x + y = 角点和 + LEG；左下角 x - y = 角点差 + LEG。
    s_top = solve(lambda t: at(top, t)[0] + at(top, t)[1] - (tl[0] + tl[1] + CORNER_LEG), 0.0, t_top)
    s_bot = solve(lambda t: at(bot, t)[0] - at(bot, t)[1] - (bl[0] - bl[1] + CORNER_LEG), t_bot, 1.0)
    up = sub(top, s_top, t_top)
    down = sub(bot, t_bot, s_bot)
    left = (f"M{pt(up[0])}" + cubic(up) + f" Q{pt(tl)} {pt((tl[0], tl[1] + BOOK_CORNER))} L{pt((tl[0], tl[1] + CORNER_LEG))} Z"
            f" M{pt((bl[0], bl[1] - CORNER_LEG))} L{pt((bl[0], bl[1] - BOOK_CORNER))} Q{pt(bl)} {pt(down[0])}" + cubic(down) + " Z")
    right = (f" M{pt(mirror(up[0]))}" + cubic([mirror(p) for p in up]) + f" Q{pt(mirror(tl))} {pt((100 - tl[0], tl[1] + BOOK_CORNER))}"
             f" L{pt((100 - tl[0], tl[1] + CORNER_LEG))} Z"
             f" M{pt((100 - bl[0], bl[1] - CORNER_LEG))} L{pt((100 - bl[0], bl[1] - BOOK_CORNER))} Q{pt(mirror(bl))} {pt(mirror(down[0]))}"
             + cubic([mirror(p) for p in down]) + " Z")
    return left + right


# 赤星之节（精修第十二轮，取自看板娘的法杖）：封面中间一颗四角星，套一圈环；星的四个角穿出环外，
# 环在穿过的地方断开，和星之间留缝。下面的尺寸是 EMBLEM_S = 1 时的值，整体按 EMBLEM_S 缩放。
# 精修第十三轮放大到 1.4 倍（32px 还认得出是星），中心挪到封面正中。
EMBLEM_C = (69.6, 72.6)          # 中心，在封面（观者右半边）上
EMBLEM_S = 1.4
STAR_R, STAR_K = 6.6, 0.2        # 星角到中心的距离；四条内凹边是二次曲线，控制点在对角线上 STAR_R·STAR_K 处
RING_R = (4.2, 5.3)              # 环的内外半径
EMBLEM_GAP = 0.55


def star_path(c=None, s=None):
    cx, cy = c or EMBLEM_C
    r = STAR_R * (s or EMBLEM_S)
    k = r * STAR_K
    tips = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    ctrl = [(cx + k, cy - k), (cx + k, cy + k), (cx - k, cy + k), (cx - k, cy - k)]
    return f"M{pt(tips[0])}" + "".join(f" Q{pt(ctrl[i])} {pt(tips[(i + 1) % 4])}" for i in range(4)) + " Z"


def _ring_cut(r, c, s):
    """星右上那条边往外偏出缝宽后，在靠近上方星角处与半径 r 的圆的交点。"""
    cx, cy = c
    R, gap = STAR_R * s, EMBLEM_GAP * s
    p0, p1, p2 = (cx, cy - R), (cx + R * STAR_K, cy - R * STAR_K), (cx + R, cy)

    def off(t):
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
        dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
        dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
        n = unit((dy, -dx))
        if n[0] * (x - cx) + n[1] * (y - cy) < 0:
            n = (-n[0], -n[1])
        return (x + n[0] * gap, y + n[1] * gap)

    t = solve(lambda t: math.dist(off(t), c) - r, 0.0, 0.5)
    return off(t)


def ring_path(c=None, s=None):
    """环被星角断成四段；每段两头的切口在缝的偏移线上，只有一小段，用直线连。"""
    c, s = c or EMBLEM_C, s or EMBLEM_S
    cx, cy = c
    r_in, r_out = RING_R[0] * s, RING_R[1] * s
    a_out, a_in = _ring_cut(r_out, c, s), _ring_cut(r_in, c, s)
    flip = lambda p: (cx - (p[1] - cy), cy - (p[0] - cx))          # 沿右上对角线翻到靠近右边星角处
    turn = lambda p, k: [(cx + (p[0] - cx), cy + (p[1] - cy)),
                         (cx - (p[1] - cy), cy + (p[0] - cx)),
                         (cx - (p[0] - cx), cy - (p[1] - cy)),
                         (cx + (p[1] - cy), cy - (p[0] - cx))][k]  # 绕中心顺时针转 k×90°
    d = ""
    for k in range(4):
        p1, p2, p3, p4 = (turn(q, k) for q in (a_out, flip(a_out), flip(a_in), a_in))
        d += (f" M{pt(p1)} A{f(r_out)},{f(r_out)} 0 0 1 {pt(p2)} L{pt(p3)}"
              f" A{f(r_in)},{f(r_in)} 0 0 0 {pt(p4)} Z")
    return d.strip()


# ---------- 版本 ----------
# 几何版本：
#   full   装饰全画，赤星之节画在实心的书上（象牙猫：应用图标、深色底、赤红底）；
#   cutout 星在书上挖空透出底色，环、角饰、腮红上色（赤红猫：浅色底，赤红星放在赤红书上会看不见）；
#   mono   腮红、角饰不画，赤星之节整个挖空（单色、currentColor；一种颜色画不出它们）。
# 24px 及以下另有像素专用版（PIXEL），尾巴和装饰都不画。
def layers(geo="mono", c=None, s=None):
    """返回 [(角色, 路径, fill-rule)]，按从下到上的顺序。c、s 覆盖赤星之节的中心和缩放（比较尺寸用）。"""
    star, ring = star_path(c, s), ring_path(c, s)
    if geo == "full":
        book = book_path()
    elif geo == "cutout":
        book = book_path() + " " + star
    else:
        book = book_path() + " " + star + " " + ring
    out = [("mark", head_path(), "evenodd"), ("mark", book, "evenodd"), ("mark", tail_path(), "nonzero")]
    if geo in ("full", "cutout"):
        out += [("blush", blush_path(), "nonzero"), ("corners", corners_path(), "nonzero"), ("ring", ring, "nonzero")]
    if geo == "full":
        out.append(("star", star, "nonzero"))
    return out


# 颜色版本：键 → (几何版本, 各角色的颜色)。
STYLES = {
    "ivory": ("full", dict(mark=IVORY, blush=PINK, corners=GOLD_DEEP, ring=GOLD_DEEP, star=CRIMSON)),
    "crimson": ("cutout", dict(mark=CRIMSON, blush=PINK, corners=GOLD, ring=GOLD)),
    "ink": ("mono", dict(mark=INK)),
    "current": ("mono", dict(mark="currentColor")),
}


def style(s):
    """STYLES 的键、(几何版本, 颜色) 元组，或者一个颜色（按单色版画）。"""
    if isinstance(s, tuple):
        return s
    return STYLES[s] if s in STYLES else ("mono", dict(mark=s))


def mark_body(s="current"):
    """标志本体（不含底块），画布 100×100。"""
    geo, colors = style(s)
    out = ""
    for role, d, rule in layers(geo):
        rule_attr = ' fill-rule="evenodd"' if rule == "evenodd" else ""
        out += f'<path d="{d}" fill="{colors[role]}"{rule_attr}/>'
    return out


def offset_error(d=GAP, n=200):
    """检查 Tiller–Hanson 偏移的误差：偏移曲线上各点到原曲线的最近距离与 d 之差的最大值。"""
    edge = offset_cubic(BOOK_TOP_L, -d)
    base = [at(BOOK_TOP_L, i / n) for i in range(n + 1)]
    worst = 0
    for i in range(n + 1):
        p = at(edge, i / n)
        worst = max(worst, abs(min(math.dist(p, q) for q in base) - d))
    return worst


if __name__ == "__main__":
    print("offset error", round(offset_error(), 4), "tail offset error", round(tail_offset_error(), 4))
    print(head_path())
    print(book_path())


# ---------- 独立 SVG 文件 ----------
def tile_svg(pad=9, rx=22):
    """赤红底块版（应用图标）。pad 是图形到底块边缘的距离，画布单位。"""
    s = (100 - 2 * pad) / 100
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="{rx}" fill="{CRIMSON}"/>'
            f'<g transform="translate({f(pad)} {f(pad)}) scale({f(s)})">{mark_body("ivory")}</g></svg>')


def plain_svg(color=INK):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{mark_body(color)}</svg>'


# 24px、16px 和 14px 专用版直接画在像素格上：水平、竖直的边都落在整像素上，缝和眼睛各占整像素，
# 不靠缩放后的抗锯齿。书脊折痕在这些尺寸不到 0.7 像素，去掉；书的上沿中间改成一个
# 两像素宽的缺口，下沿中间多一个像素，仍然读得出翻开的书。
# 豆豆眼在 24px 是 2×2 的方块，放低、拉开；16px、14px 是单个像素（2×2 在 16px 像面具）。
# 耳洞、尾巴和装饰在这些尺寸都只有零点几个像素，不画。
# 14px 用于桌面标题栏：高分屏上按 28 像素显示，每格正好两个像素，格线依然对齐。
PIXEL = {
    24: dict(
        head={"slant": "M6,13 L6,4 L9.6,7 L14.4,7 L18,4 L18,13 Z",
              "stair": "M6,13 V4 H7 V5 H8 V6 H9 V7 H15 V6 H16 V5 H17 V4 H18 V13 Z"},
        eyes="M8,10 h2 v2 h-2 Z M14,10 h2 v2 h-2 Z",
        book={"flat": "M3,14 H21 V20 H3 Z",
              "notch": "M3,14 H11 V15 H13 V14 H21 V20 H3 Z",
              "tab": "M3,14 H11 V15 H13 V14 H21 V20 H13 V21 H11 V20 H3 Z"},
        rx=5),
    16: dict(
        head={"slant": "M4,9 L4,1.5 L6.8,4 L9.2,4 L12,1.5 L12,9 Z",
              "stair": "M4,9 V2 H5 V3 H6 V4 H10 V3 H11 V2 H12 V9 Z"},
        eyes="M6,7 h1 v1 h-1 Z M9,7 h1 v1 h-1 Z",
        book={"flat": "M2,10 H14 V14 H2 Z",
              "notch": "M2,10 H7 V11 H9 V10 H14 V14 H2 Z",
              "tab": "M2,10 H7 V11 H9 V10 H14 V14 H9 V15 H7 V14 H2 Z"},
        rx=3.5),
    14: dict(
        head={"slant": "M3,8 L3,1 L5.6,3.4 L8.4,3.4 L11,1 L11,8 Z",
              "stair": "M3,8 V1 H4 V2 H5 V3 H9 V2 H10 V1 H11 V8 Z"},
        eyes="M5,6 h1 v1 h-1 Z M8,6 h1 v1 h-1 Z",
        book={"flat": "M1,9 H13 V12 H1 Z",
              "notch": "M1,9 H6 V10 H8 V9 H13 V12 H1 Z",
              "tab": "M1,9 H6 V10 H8 V9 H13 V12 H8 V13 H6 V12 H1 Z"},
        rx=3),
}


def pixel_svg(size=16, ears="slant", book="tab", tile=True, color=IVORY):
    g = PIXEL[size]
    body = (f'<path d="{g["head"][ears]} {g["eyes"]}" fill="{color}" fill-rule="evenodd"/>'
            f'<path d="{g["book"][book]}" fill="{color}"/>')
    bg = f'<rect width="{size}" height="{size}" rx="{g["rx"]}" fill="{CRIMSON}"/>' if tile else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{bg}{body}</svg>'


# ---------- 光环特别版 ----------
# 猫和书以书底中点为基准缩到 0.86，给头顶腾出位置。光环水平、居中在头顶上方
# （精修第十六轮摆正；之前歪 12 度、往右偏 3）。
HALO_SCALE = 0.86
HALO = dict(cx=50, cy=14, rx=16, ry=4.8, width=4.5, tilt=0)


def halo_body(color="currentColor", halo_color=GOLD):
    s = HALO_SCALE
    cat = f'<g transform="translate(50 92) scale({s}) translate(-50 -92)">{mark_body(color)}</g>'
    h = HALO
    ring = (f'<ellipse cx="{h["cx"]}" cy="{h["cy"]}" rx="{h["rx"]}" ry="{h["ry"]}" fill="none" stroke="{halo_color}" '
            f'stroke-width="{h["width"]}" transform="rotate({h["tilt"]} {h["cx"]} {h["cy"]})"/>')
    return cat + ring
