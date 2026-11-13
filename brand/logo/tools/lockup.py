"""NeuroBook 组合（标志加字标）的定稿几何，精修第三轮定下，页面和成品导出共用。

组合在「大写高 = 100」的单位里搭，基线在 y=0：字标按大写高缩放，标志按目标高度缩放。
每个组合拆成若干部件 (角色, 路径, fill-rule, 缩放, 平移)，渲染时可以包成带 transform 的
<g>（页面用），也可以把缩放和平移直接算进路径坐标（成品文件用，见 flatten）。
"""
import json
import os
import re

import mark
from mark import f

WM = json.load(open(os.path.join(os.path.dirname(__file__), "wordmark.json"), encoding="utf-8"))

# 标志的实际外框（resvg 2000px 渲染后裁边量得），画布单位。
# MARK_BOX 只算猫头和书：组合里标志的大小、对齐都按它，尾巴从右边伸出去，不参与。
# MARK_FULL 连尾巴：单独摆放标志（方形画布、应用图标）时按它居中，组合里按它右沿留出和字标的间距。
# 精修第二十一轮重新量过（halo.boxes()）：耳朵加大后头顶到 14.45，尾巴加粗后右沿到 99.23；默认标志带光环，
# 光环从头顶往上伸出去，和尾巴一样不参与大小和对齐：MARK_TOP 是各几何版本的最高点（单色版只有环，其余还有三颗小星）。
MARK_BOX = (12.0, 14.45, 88.0, 91.0)
MARK_W, MARK_H = MARK_BOX[2] - MARK_BOX[0], MARK_BOX[3] - MARK_BOX[1]
MARK_FULL = (12.0, 14.45, 99.23, 91.0)
MARK_TOP = {"mono": 0.3, "full": -4.06, "cutout": -4.06}
FULL_W, FULL_H = MARK_FULL[2] - MARK_FULL[0], MARK_FULL[3] - MARK_FULL[1]
BOOK_TOP = 58.5  # 书两侧的上沿
# 猫头和书的视觉重心在外框高度的 55.2% 处（书在下半部，比耳朵重），按面积重心量得。
# 横排组合用它对齐大写字母的中线；按外框几何居中，标志会显得偏低。
MARK_CENTROID = 0.552
K_MID = 1.4        # 横排：标志高度 = 1.4 倍大写高
GAP_H = 40         # 横排：标志与字标之间 0.4 倍大写高
K_STACK = 240      # 竖排：标志高度 = 2.4 倍大写高
GAP_STACK = 45     # 竖排：标志与字标之间 0.45 倍大写高
CLEAR = 100        # 组合四周的安全留白 = 大写高

XH = WM["tracking"]["0"]["xheight"] * 100 / WM["tracking"]["0"]["cap"]  # 小写高，约 67.5
# 书的上沿对齐小写高时，标志高度相对大写高的倍数（第三轮初稿 A 的参数）。
K_XH = XH / 100 / ((MARK_BOX[3] - BOOK_TOP) / MARK_H)


def wordmark(tracking=None):
    """返回 (路径, 缩放, 墨迹外框)；路径是字体单位，缩放把它换成「大写高 = 100」。"""
    r = WM["tracking"][str(WM["chosen"] if tracking is None else tracking)]
    s = 100 / r["cap"]
    x0, y0, x1, y1 = r["bounds"]
    return r["d"], s, (x0 * s, y0 * s, x1 * s, y1 * s)


def mark_parts(s, tx, ty, geo="mono"):
    """标志的部件（猫、书、尾巴、装饰、光环）；geo 是 mark.layers 的几何版本（full、cutout、mono）。"""
    import halo
    return [(role, d, rule, s, tx, ty) for role, d, rule in halo.mark_layers(geo)]


def parts_h(tracking=None, k=K_MID, gap=GAP_H, align="optical", geo="mono"):
    """横排组合。align="optical"：猫头和书的视觉重心对齐大写中线（定稿）；
    "mid"：外框中心对齐大写中线；"base"：书底落在基线上（第三轮初稿）。
    字标从尾巴右沿往右 gap 处开始。返回 (部件, 外框)；外框按墨迹计算。"""
    d, s, (bx0, by0, bx1, by1) = wordmark(tracking)
    sm = k * 100 / MARK_H
    top = {"base": -k * 100, "mid": -50 - k * 50, "optical": -50 - MARK_CENTROID * k * 100}[align]
    parts = mark_parts(sm, -MARK_BOX[0] * sm, top - MARK_BOX[1] * sm, geo)
    wx = (MARK_FULL[2] - MARK_BOX[0]) * sm + gap - bx0
    parts.append(("wordmark", d, "nonzero", s, wx, 0))
    halo_top = top - (MARK_BOX[1] - MARK_TOP[geo]) * sm
    return parts, (0, min(halo_top, by0), wx + bx1, max(top + k * 100, by1))


def parts_v(tracking=None, k=K_STACK, gap=GAP_STACK, geo="mono"):
    """竖排组合：猫头和书居中在字标上方，尾巴往右伸；k 是标志高度。"""
    d, s, (bx0, by0, bx1, by1) = wordmark(tracking)
    sm = k / MARK_H
    width = bx1 - bx0
    mark_bottom = by0 - gap
    left = (width - MARK_W * sm) / 2
    parts = mark_parts(sm, left - MARK_BOX[0] * sm, mark_bottom - MARK_BOX[3] * sm, geo)
    parts.append(("wordmark", d, "nonzero", s, -bx0, 0))
    right = left + (MARK_FULL[2] - MARK_BOX[0]) * sm
    return parts, (min(0, left), mark_bottom - k - (MARK_BOX[1] - MARK_TOP[geo]) * sm, max(width, right), by1)


def parts_wordmark(tracking=None):
    d, s, (bx0, by0, bx1, by1) = wordmark(tracking)
    return [("wordmark", d, "nonzero", s, -bx0, 0)], (0, by0, bx1 - bx0, by1)


# ---------- 渲染 ----------
_TOKEN = re.compile(r"[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "Q": 4, "A": 7, "Z": 0}


def flatten(d, s, tx, ty):
    """把「先缩放 s、再平移 (tx, ty)」算进路径坐标。只接受绝对坐标命令，缩放必须等比。"""
    out, cmd, nums = [], None, []

    def emit(c, vals):
        if c in "ML" or c in "CQ":
            vals = [v * s + (tx if i % 2 == 0 else ty) for i, v in enumerate(vals)]
        elif c == "H":
            vals = [vals[0] * s + tx]
        elif c == "V":
            vals = [vals[0] * s + ty]
        elif c == "A":
            rx, ry, rot, large, sweep, x, y = vals
            vals = [rx * s, ry * s, rot, int(large), int(sweep), x * s + tx, y * s + ty]
        out.append(c + " ".join(f(v) if not isinstance(v, int) else str(v) for v in vals))

    for tok in _TOKEN.findall(d):
        if tok.isalpha():
            if tok not in _ARITY:
                raise ValueError(f"不支持的路径命令 {tok}（只接受绝对坐标）")
            if tok == "Z":
                out.append("Z")
            cmd = tok
            continue
        nums.append(float(tok))
        if len(nums) == _ARITY[cmd]:
            emit(cmd, nums)
            nums = []
            if cmd == "M":
                cmd = "L"  # M 后面接着的坐标对按 L 处理
    assert not nums, "路径参数个数不对"
    return " ".join(out)


def render(parts, colors, flat=False):
    """colors 按角色给颜色：{"mark": ..., "wordmark": ...}。"""
    out = []
    for role, d, rule, s, tx, ty in parts:
        fill = colors[role]
        rule_attr = ' fill-rule="evenodd"' if rule == "evenodd" else ""
        if flat:
            out.append(f'<path d="{flatten(d, s, tx, ty)}" fill="{fill}"{rule_attr}/>')
        else:
            # 缩放系数不能按两位小数输出：字标的 100/1400 = 0.0714 会被写成 0.07，整行字小 2%。
            out.append(f'<g transform="translate({f(tx)} {f(ty)}) scale({s:.6g})"><path d="{d}" fill="{fill}"{rule_attr}/></g>')
    return "".join(out)


def colors_of(mark_color, wm_color):
    """标志的颜色版本（mark.STYLES 的键，或一个颜色按单色版画）加上字标颜色 → (几何版本, 各角色的颜色)。"""
    import halo
    geo, colors = halo.style(mark_color)
    return geo, {**colors, "wordmark": wm_color}


def lockup_h(tracking=None, k=K_MID, gap=GAP_H, align="optical", mark_color="current", wm_color="currentColor"):
    geo, colors = colors_of(mark_color, wm_color)
    parts, box = parts_h(tracking, k, gap, align, geo)
    return render(parts, colors), box


def lockup_v(tracking=None, k=K_STACK, gap=GAP_STACK, mark_color="current", wm_color="currentColor"):
    geo, colors = colors_of(mark_color, wm_color)
    parts, box = parts_v(tracking, k, gap, geo)
    return render(parts, colors), box


# ---------- 应用图标 + 字标（精修第十八轮：浅色底上的第二种组合） ----------
# 浅色底上的标准色把白猫涂成赤红、眼睛透出底色成了白眼睛；这版直接把应用图标当标志，白猫黑眼睛和应用图标一模一样。
BADGE_H, BADGE_GAP_H = 190, 45       # 横排：底块边长 1.9X，和字标之间 0.45X
BADGE_V, BADGE_GAP_V = 280, 50       # 竖排
TILE_MARK_WIDTH, TILE_RX = 62.3, 22  # 和 produce.py 的应用图标一致


def rounded_rect(x, y, w, h, r):
    return (f"M{f(x + r)},{f(y)} H{f(x + w - r)} A{f(r)},{f(r)} 0 0 1 {f(x + w)},{f(y + r)} V{f(y + h - r)} "
            f"A{f(r)},{f(r)} 0 0 1 {f(x + w - r)},{f(y + h)} H{f(x + r)} A{f(r)},{f(r)} 0 0 1 {f(x)},{f(y + h - r)} "
            f"V{f(y + r)} A{f(r)},{f(r)} 0 0 1 {f(x + r)},{f(y)} Z")


def badge_parts(size, x, y):
    """边长 size 的应用图标（带封面边框），左上角在 (x, y)；和成品的应用图标一模一样。"""
    import halo
    return halo.icon_parts(size, x, y)


def parts_h_badge(tracking=None, size=BADGE_H, gap=BADGE_GAP_H):
    """横排：底块竖直居中在大写字母中线上，字标在右边 gap 处。"""
    d, s, (bx0, by0, bx1, by1) = wordmark(tracking)
    top = -50 - size / 2
    parts = badge_parts(size, 0, top)
    wx = size + gap - bx0
    parts.append(("wordmark", d, "nonzero", s, wx, 0))
    return parts, (0, min(top, by0), wx + bx1, max(top + size, by1))


def parts_v_badge(tracking=None, size=BADGE_V, gap=BADGE_GAP_V):
    d, s, (bx0, by0, bx1, by1) = wordmark(tracking)
    width = bx1 - bx0
    top = by0 - gap - size
    parts = badge_parts(size, (width - size) / 2, top)
    parts.append(("wordmark", d, "nonzero", s, -bx0, 0))
    return parts, (0, top, width, by1)
