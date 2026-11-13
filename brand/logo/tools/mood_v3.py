"""心情差分的第三版部件（精修第十五轮）：重新设计的光环、更自然的问号尾巴、不拉长的高高竖起、几种垂下来的尾巴。

光环：所有状态共用同一个细一点的金环，状态只靠几样克制的变化区分——一道高光、亮金和暗金、一段拖着尾巴的流光、
一个缺口、一圈外晕——不再换形状，也不拆成碎块。尾巴：各姿势中心线的可见长度都和定稿尾巴相近。
"""
import math
import os
import sys

from shapely.geometry import LineString

sys.path.insert(0, os.path.dirname(__file__))
import mood_parts as mp
from mark import GOLD, GOLD_DEEP, IVORY, PINK, f
from shapes import P, bezier_chain, star4

# ==================== 光环 ====================
RING = dict(c=(53.5, 4.0), rx=16.5, ry=4.9, w=3.6, tilt=-12)   # 比特别版的光环细，和光环特别版一样正上方、歪 12°
SHINE = (196, 232)   # 高光在环的左后方（参数角，度）


def ring(color, h=RING, extra=""):
    return mp.stroke(mp.ell_d(h), color, h["w"], extra)


def shine(h=RING, span=SHINE):
    """环上一道细高光：沿环的中心线，很短、很细，像金属的反光。"""
    return mp.stroke(mp.ell_d(h, *span), IVORY, 1.0, ' opacity="0.85"')


def sparkle(x, y, r, bg):
    return P(star4(x, y, r, ratio=1.3), IVORY, f' stroke="{bg}" stroke-width="1.2" paint-order="stroke"')


def comet(h=RING, head=35, length=70, cls="comet"):
    """流光：暗金环上一段亮金，尾巴由三段越来越细、越来越长的弧叠出来，头是圆的。
    用同一条 pathLength=100 的椭圆和 dasharray 画，演示里一起改 dashoffset 就沿着环转。"""
    out = ""
    for k, (w, frac) in enumerate(((h["w"], 0.45), (h["w"] * 0.7, 0.75), (h["w"] * 0.42, 1.0))):
        L = length / 360 * 100 * frac
        start = (head / 360 * 100 - L) % 100
        out += (f'<path class="{cls}" d="{mp.ell_d(h, 0, 360)}" pathLength="100" fill="none" stroke="{GOLD}" stroke-width="{f(w)}" '
                f'stroke-linecap="round" stroke-dasharray="0 {f(start)} {f(L)} {f(100 - start - L)}"/>')
    return out


def make_halos(R, error_shift=((1.0, 1.5), 7), sleep_drop=2.0):
    """按一个环的几何（R）生成整套光环。error_shift 是出错时环的 ((右移, 下沉), 反向倾斜角)。"""
    (edx, edy), etilt = error_shift

    def gold(bg):
        return ring(GOLD, R) + shine(R), mp.halo_box(R)

    def think(bg):
        return ring(GOLD_DEEP, R) + comet(R), mp.halo_box(R)

    def write(bg, done=0.62):
        arc = (f'<path class="prog" d="{mp.ell_d(R, -90, 270)}" pathLength="100" fill="none" stroke="{GOLD}" stroke-width="{f(R["w"])}" '
               f'stroke-linecap="round" stroke-dasharray="{f(done * 100)} 100"/>')
        return ring(GOLD_DEEP, R) + arc, mp.halo_box(R)

    def done(bg):
        x, y = mp.ell_pt(R, -38)
        return ring(GOLD, R) + shine(R) + sparkle(x + 2.2, y - 3.6, 2.9, bg) + sparkle(x + 7.0, y - 0.6, 1.6, bg), mp.halo_box(R, 5)

    def error(bg):
        """缺了一口、往下沉一点；两头圆头，不拆碎块。"""
        h = {**R, "c": (R["c"][0] + edx, R["c"][1] + edy), "tilt": R["tilt"] + etilt}
        return mp.stroke(mp.ell_d(h, 28, 332), GOLD, h["w"]) + shine(h), mp.halo_box(h)

    def sleep(bg):
        """没点亮：暗金，没有高光，往下沉一点。"""
        h = {**R, "c": (R["c"][0], R["c"][1] + sleep_drop)}
        return ring(GOLD_DEEP, h), mp.halo_box(h)

    def shy(bg):
        return ring(PINK, R) + shine(R), mp.halo_box(R)

    def idea(bg):
        """发光：外面多一圈细的光晕，加一颗星。"""
        outer = {**R, "rx": R["rx"] + 3.4, "ry": R["ry"] + 1.7, "w": 0.9}
        x, y = mp.ell_pt(outer, -60)
        return (ring(GOLD, R) + mp.stroke(mp.ell_d(outer), GOLD, outer["w"], ' opacity="0.9"') + shine(R)
                + sparkle(x + 1.2, y - 2.4, 2.8, bg)), mp.halo_box(outer, 4)

    return {
        # 键: (名称, 表示什么, 工厂(bg) → (SVG, 外框))
        "gold": ("金环", "常态、完成；左后方一道高光", gold),
        "think": ("流光", "思考中：暗金环上一段亮金绕着转", think),
        "write": ("进度", "写作中：亮金从正上方顺时针铺开", write),
        "done": ("金环 + 星光", "完成", done),
        "error": ("缺口", "出错：缺了一口" + ("，歪向另一边" if etilt else "，往下沉一点"), error),
        "sleep": ("熄灭", "睡着、离线：暗金，没有高光", sleep),
        "shy": ("粉环", "害羞", shy),
        "idea": ("光晕", "灵感：外面多一圈细光晕", idea),
    }


HALOS = make_halos(RING, error_shift=((1.0, 1.5), 19))   # 第十五轮：出错时歪到 +7°


# ==================== 尾巴 ====================
STEM = mp.STEM


def visible_length(segs):
    """尾巴露在书外面的中心线长度（x > 书缝）。"""
    pts = [p for p in bezier_chain(segs, 80) if p[0] > 90.6 or p[1] > 93.5]
    return LineString(pts).length if len(pts) > 1 else 0


T_UP = mp.UPRIGHT
T_TALL_A = [[(83, 77), (92.5, 76.5), (96.8, 72.5), (96.8, 64.5)], [(96.8, 64.5), (96.8, 58.5), (96.8, 53.5), (96.2, 49.5)]]
T_TALL_B = [[(83, 77), (93, 76.5), (98, 72), (98.2, 64)], [(98.2, 64), (98.4, 58), (97.8, 53), (95.8, 50.2)]]
T_Q_A = [STEM, [(96.5, 64), (96.6, 60.5), (97.3, 56.8), (95.6, 54.6)], [(95.6, 54.6), (94.2, 52.8), (91.7, 53.4), (91.4, 56)]]
T_Q_B = [[(83, 77), (93, 76.5), (97.5, 72.5), (97.3, 66)], [(97.3, 66), (97.2, 60.5), (98.3, 55.5), (95.9, 52.6)],
         [(95.9, 52.6), (93.9, 50.3), (90.4, 51), (90.5, 54.5)]]
T_Q_C = [STEM, [(96.5, 64), (96.8, 61), (98.7, 58), (97.8, 54.5)], [(97.8, 54.5), (97, 51.3), (93, 51), (92, 54)]]
T_DROOP_A = [[(80, 78), (92, 79.5), (97.5, 82), (97.5, 88)], [(97.5, 88), (97.5, 93), (95.8, 96), (97.2, 99.5)]]
T_DROOP_B = [[(80, 84), (91, 85), (94.5, 88.5), (93.2, 94)], [(93.2, 94), (92.4, 97.5), (89.5, 99.5), (86.5, 99.6)]]
T_DROOP_C = [[(80, 79), (92, 80), (96.8, 83.5), (96.8, 89.5)], [(96.8, 89.5), (96.8, 95), (99, 97.5), (101.8, 95.5)]]
T_DROOP_D = [[(59, 84), (59, 91), (59, 96), (59.6, 100.5)], [(59.6, 100.5), (60.3, 104), (63, 105.8), (66, 104.6)]]

TAILS = {
    # 键: (名称, 意思, 几何工厂, 根部)
    "up": ("竖起 · 尾尖朝上", "默认", lambda: mp.band(bezier_chain(T_UP)), (91.5, 79.0)),
    "tall_a": ("竖直 · A", "开心：一出书边就竖直往上，长度不变", lambda: mp.band(bezier_chain(T_TALL_A)), (91.5, 77.0)),
    "tall_b": ("竖直 · B", "开心：略往外挺，尾尖往回勾", lambda: mp.band(bezier_chain(T_TALL_B)), (91.5, 77.0)),
    "q_a": ("问号 · A", "尾尖往头这边弯下来，钩子小、开口", lambda: mp.band(bezier_chain(T_Q_A)), (91.5, 79.0)),
    "q_b": ("问号 · B", "先竖直，再往头这边弯一个圆一点的钩", lambda: mp.band(bezier_chain(T_Q_B)), (91.5, 77.0)),
    "q_c": ("问号 · C", "往外鼓一下再弯回来，更像字符 ?", lambda: mp.band(bezier_chain(T_Q_C)), (91.5, 79.0)),
    "droop_a": ("垂下 · A", "贴着书边自然垂下，尾尖往外一撇", lambda: mp.band(bezier_chain(T_DROOP_A)), (91.5, 79.0)),
    "droop_b": ("垂下 · B", "从书角后面耷拉下来，尾尖往书底下收", lambda: mp.band(bezier_chain(T_DROOP_B)), (91.5, 85.0)),
    "droop_c": ("垂下 · C", "垂下来，尾尖往上翘成小钩", lambda: mp.band(bezier_chain(T_DROOP_C)), (91.5, 80.0)),
    "droop_d": ("垂下 · D", "从书底中间垂下，像书签", lambda: mp.band(bezier_chain(T_DROOP_D)), (59.0, 93.5)),
    "flick": mp.TAILS["flick"],
    "curl": mp.TAILS["curl"],
    "puff": mp.TAILS["puff"],
}
