"""心情差分的动画：网页组件 <neurobook-mood>、每个状态的循环动画 SVG、演示页和 README。

组件：<neurobook-mood state="think">。改 state 属性就播切换动画——眼睛眨一下、闭眼那一刻换眼型；尾巴沿中心线平滑变形；
旧光环往上淡出、新光环落下来；小符号、笔、热气弹出或收回；腮红、粉耳朵、「///」淡入淡出。平时按状态循环播动作；
空闲时跟着鼠标看。系统设了减少动画时循环全停、切换直接换。一个 JS 文件，不依赖库。

动画分三层，以后加、改只动其中一层（README 里有同样的说明）：
  1. 动作表 MOTIONS：每个动作是周期加关键帧（位移、旋转、缩放、缓动）。组件和循环 SVG 都从这张表生成。
  2. 状态表：moods.STATES、moods.LOOK（样子）和这里的 ANIM（每个部件播哪个动作）。
  3. 播放：JS 模板。头和尾巴由 JS 按动作表逐帧算（要和跟随鼠标、下沉、尾巴变形叠加）；书、笔、星、环用动作表生成的 CSS。

为了能动，组件里的画法和静态成品不同：眼睛放在遮罩里挖头（才能单独眨、跟着看），头的下半截伸到书后面、靠裁切挡住
（沉下去、跳起来都不露断口），尾巴是沿中心线的描边（才能变形）。静态成品见 moods.py；几何来自同一批部件。
"""
import json
import math
import os
import sys

from shapely.geometry import LineString
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import mark
import mood_parts as mp
import mood_v3 as v3
import mood_v4 as v4
import moods
from mark import CRIMSON, IVORY, GOLD, GOLD_DEEP, PINK, f
from shapes import BOOK, BOOK_ZONE, QS, bezier_chain, capsule, path as poly_path, star4
import halo as hl

HEAD_ZONE = mp.HEAD_ZONE

N_TAIL = 72   # 尾巴中心线重采样的点数：所有姿势点数一样，才能逐点插值变形

# 尾巴姿势的中心线；puff 用 up 的中心线，外面叠一层炸毛的形状；各姿势的摆动见动作表 TAIL_MOTION
TAIL_SEGS = {
    "up": mp.UPRIGHT, "flick": [[(80, 79), (94, 80.5), (104, 80.5), (107.5, 75.5)], [(107.5, 75.5), (109.5, 72.5), (109.2, 69), (107.2, 67)]],
    "tall_a": v3.T_TALL_A, "droop_a": v3.T_DROOP_A,
    "curl": [[(80, 82), (90, 83.5), (96.5, 89), (93, 95)], [(93, 95), (89.5, 100), (79, 100.5), (74.5, 96.5)]],
}


def resample(pts, n=N_TAIL):
    line = LineString(pts)
    return [[round(p.x, 2), round(p.y, 2)] for p in (line.interpolate(i / (n - 1), normalized=True) for i in range(n))]


def tail_pts(key):
    if key == "q_smooth":
        return v4.question_pts()
    return bezier_chain(TAIL_SEGS["up" if key == "puff" else key], 60)


def eye_parts(key):
    """把一对眼睛拆成左右两只：[(路径, 中心 x, 中心 y)]。"""
    g = mp.EYES[key][1]()
    geoms = list(getattr(g, "geoms", [g]))
    out = []
    for side in (lambda p: p.centroid.x < 50, lambda p: p.centroid.x >= 50):
        part = unary_union([p for p in geoms if side(p)])
        b = part.bounds
        out.append({"d": poly_path(part), "cx": round((b[0] + b[2]) / 2, 2), "cy": round((b[1] + b[3]) / 2, 2)})
    return out


# ---------- 光环（描边；星光下面的缝用遮罩挖） ----------
def ring(h, color, extra=""):
    return mp.stroke(mp.ell_d(h), color, h["w"], extra)


def halo_markup(key):
    """光环（描边画法）。亮着的环后半圈暗一点；常态和害羞时一道高光沿着环转（sweep）、旁边三颗小星轮流闪。"""
    R = v4.RING
    arc = lambda h, t0, t1, color, w, cap="butt", extra="": (f'<path d="{mp.ell_d(h, t0, t1)}" fill="none" stroke="{color}" stroke-width="{f(w)}" '
                                                             f'stroke-linecap="{cap}"{extra}/>')
    shade = lambda h=R, color=hl.SHADE, t1=360: arc(h, 180, t1, color, h["w"])
    shine = mp.stroke(mp.ell_d(R, 196, 232), moods.SHINE, 1.0)
    sweep = (f'<path class="sweep" d="{mp.ell_d(R)}" pathLength="100" fill="none" stroke="{moods.SHINE}" stroke-width="{f(R["w"])}" '
             f'stroke-dasharray="9 91" stroke-dashoffset="-56"/>')
    stars, sparks = [], ""
    if key in ("gold", "shy"):
        sparks = "".join(f'<path class="twinkle" style="--i:{i}" d="{poly_path(star4(R["c"][0] + dx, R["c"][1] + dy, r, ratio=1.3))}" fill="{IVORY}"/>'
                         for i, (dx, dy, r) in enumerate(hl.SPARKS))
    if key == "gold":
        body = ring(R, GOLD) + shade() + sweep
    elif key == "think":
        body = ring(R, GOLD_DEEP) + v3.comet(R)
    elif key == "write":
        body = ring(R, GOLD_DEEP) + (f'<path class="prog" d="{mp.ell_d(R, -90, 270)}" pathLength="100" fill="none" stroke="{GOLD}" '
                                     f'stroke-width="{f(R["w"])}" stroke-linecap="round" stroke-dasharray="62 100"/>')
    elif key == "done":
        x, y = mp.ell_pt(R, -38)
        stars = [star4(x + 2.2, y - 3.6, 2.9, ratio=1.3), star4(x + 7.0, y - 0.6, 1.6, ratio=1.3)]
        body = ring(R, GOLD) + shade() + shine
    elif key == "error":
        h = {**R, "c": (R["c"][0], R["c"][1] + 1.5)}
        body = mp.stroke(mp.ell_d(h, 28, 332), GOLD, h["w"]) + arc(h, 180, 332, hl.SHADE, h["w"], "round") + mp.stroke(mp.ell_d(h, 196, 232), moods.SHINE, 1.0)
    elif key == "sleep":
        body = ring({**R, "c": (R["c"][0], R["c"][1] + 2.0)}, GOLD_DEEP)
    elif key == "shy":
        body = ring(R, PINK) + shade(color=moods.SHADE_PINK) + sweep
    elif key == "idea":
        outer = {**R, "rx": R["rx"] + 3.4, "ry": R["ry"] + 1.7, "w": 0.9}
        x, y = mp.ell_pt(outer, -60)
        stars = [star4(x + 1.2, y - 2.4, 2.8, ratio=1.3)]
        body = ring(R, GOLD) + shade() + mp.stroke(mp.ell_d(outer), GOLD, outer["w"]) + shine
    else:
        raise KeyError(key)
    if stars:
        cut = poly_path(unary_union(stars).buffer(moods.GAP, quad_segs=QS))
        mask = (f'<mask id="hm-{key}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="220" height="220">'
                f'<rect x="-50" y="-50" width="220" height="220" fill="white"/><path d="{cut}" fill="black"/></mask>')
        star_el = "".join(f'<path class="twinkle" style="--i:{i}" d="{poly_path(s)}" fill="{IVORY}"/>' for i, s in enumerate(stars))
        return mask + f'<g mask="url(#hm-{key})">{body}</g>' + star_el
    return body + sparks


def extra_markup(key):
    if key == "qbubble":
        return f'<path d="{poly_path(v4.bubble())}" fill="{IVORY}" fill-rule="evenodd"/>'
    if key == "sweat":
        return "".join(f'<path d="{poly_path(g)}" fill="{IVORY}"/>' for g, _ in mp.EXTRAS["sweat"][1]())
    if key == "zz":
        return "".join(f'<path class="z" style="--i:{i}" d="{poly_path(g)}" fill="{IVORY}"/>' for i, (g, _) in enumerate(mp.EXTRAS["zz"][1]()))
    raise KeyError(key)


def pen_markup():
    """写作时的笔：笔尖藏在书后面，笔杆从书的右上方露出来；金色笔杆加一道象牙色的环。"""
    body = capsule(PEN_TIP, PEN_END, PEN_W / 2)
    ux, uy = PEN_END[0] - PEN_TIP[0], PEN_END[1] - PEN_TIP[1]
    at = lambda t: (PEN_TIP[0] + ux * t, PEN_TIP[1] + uy * t)
    band = LineString([at(0.78), at(0.86)]).buffer(PEN_W / 2 + 0.3, cap_style="flat").intersection(body)
    return f'<path d="{poly_path(body)}" fill="{GOLD}"/><path d="{poly_path(band)}" fill="{IVORY}"/>', body.bounds


MOTES = [(90.0, 40.0, 0.75), (88.2, 37.5, 0.6), (91.4, 34.8, 0.5)]   # 写作时笔旁边飘起的小金点


def motes_markup():
    return "".join(f'<circle class="mote" style="--i:{i}" cx="{x}" cy="{y}" r="{r}" fill="{GOLD}"/>' for i, (x, y, r) in enumerate(MOTES))


def steam_markup():
    return "".join(f'<circle class="puffs" style="--i:{i}" cx="{x}" cy="{y}" r="{r}" fill="{IVORY}"/>' for i, (x, y, r) in enumerate(moods.STEAM))


# ==================== 动作表 ====================
# 缓动：cubic-bezier 的四个参数。组件里的 JS 和循环 SVG 的 CSS 用的是同一组曲线，播出来一样。
EASE = {"lin": (0, 0, 1, 1), "io": (0.45, 0, 0.55, 1), "in": (0.55, 0, 1, 0.45), "out": (0, 0.55, 0.45, 1), "back": (0.34, 1.56, 0.64, 1)}


def K(t, x=0.0, y=0.0, r=0.0, s=1.0, e="io"):
    """一个关键帧：进度 t（0–1）、位移 x、y（画布单位）、角度 r（°）、缩放 s；e 是从这一帧到下一帧的缓动。"""
    return [round(t, 4), round(x, 3), round(y, 3), round(r, 3), round(s, 3), e]


def motion(period, keys, tau=70):
    """一个循环动作：周期（秒）和关键帧。tau 是组件里换状态时往新动作靠拢的快慢（毫秒），快动作要小。"""
    return {"period": period, "keys": keys, "tau": tau}


def sway(period, amp, axis="r", y=0.0):
    """来回摆：0 → +amp → 0 → −amp → 0，每段先快后慢，接近正弦。"""
    v = lambda a: {"x": dict(x=a), "y": dict(y=a), "r": dict(r=a)}[axis]
    return motion(period, [K(0, y=y, e="out"), K(0.25, y=y, **v(amp), e="in"), K(0.5, y=y, e="out"), K(0.75, y=y, **v(-amp), e="in"), K(1, y=y)])


def bursts(period, active, step, fn, tail):
    """写两秒、停一下这类节奏：active 秒内每 step 秒一帧，fn(i, 秒) 给出这一帧；tail 是停下来那段的关键帧。"""
    n = int(active / step)
    return [K(i * step / period, **fn(i, i * step), e="lin") for i in range(n)] + tail


MOTIONS = {
    # 头
    "none": motion(1, [K(0), K(1)]),
    "drift": sway(4, 1.6),
    "nod": motion(2.8, [k for i in range(8) for k in (K(i * 0.25 / 2.8), K((i * 0.25 + 0.125) / 2.8, y=0.35))] + [K(2.0 / 2.8), K(1)]),
    "hop": motion(2.2, [K(0, e="out"), K(0.14, y=-2.4, e="in"), K(0.28), K(1)]),
    "tilt": motion(3.2, [K(0), K(0.12, r=-7), K(0.7, r=-7), K(0.82), K(1)]),
    "shake": motion(2.4, [K(i * 0.03, x=v, e="lin") for i, v in enumerate((0, 0.9, -0.8, 0.65, -0.5, 0.35, -0.2, 0))] + [K(1)], tau=12),
    "breathe": motion(3.6, [K(0), K(0.5, y=0.45), K(1)]),
    "breathe_deep": motion(4.2, [K(0), K(0.5, y=0.8), K(1)]),
    "pop": motion(2.6, [K(0, e="out"), K(0.08, y=-1.6, e="in"), K(0.16), K(1)]),
    "shy": sway(3, 1.2, y=1.0),
    "tremble": motion(0.24, [K(0, e="lin"), K(0.25, x=0.16, e="lin"), K(0.75, x=-0.16, e="lin"), K(1, e="lin")], tau=12),
    # 书、笔
    "jitter": motion(2.8, bursts(2.8, 2.0, 0.085, lambda i, t: dict(x=0.22 * (-1) ** i, y=0.12 * (-1) ** (i // 2), r=0.35 * (-1) ** (i // 3)),
                                 [K(2.0 / 2.8), K(1)]), tau=12),
    "scribble": motion(2.8, bursts(2.8, 2.0, 0.17, lambda i, t: dict(x=-1.2 + 2.4 * t / 2.0, r=4.5 * (-1) ** i),
                                   [K(2.04 / 2.8, x=1.2, y=-0.8), K(2.5 / 2.8, x=-1.2, y=-0.8), K(2.7 / 2.8, x=-1.2), K(1, x=-1.2)]), tau=12),
    # 赤星之节
    "spin": motion(10, [K(0, e="lin"), K(1, r=360)]),
    "pulse": motion(1.1, [K(0), K(0.5, s=0.88), K(1)]),
    "click": motion(2.4, [K(0), K(0.55, e="back"), K(0.75, r=90), K(1, r=90)]),
    "flash": motion(2.6, [K(0), K(0.6, e="out"), K(0.7, s=1.28), K(1)]),
    "kick": motion(2.6, [K(0), K(0.6, e="back"), K(0.8, r=90), K(1, r=90)]),
    # 尾巴（绕尾巴根部转）
    "tail_sway": sway(5, 3),
    "tail_sway_fast": sway(2.4, 3),
    "tail_sway_slow": sway(7, 2),
    "tail_quiver": motion(0.36, [K(0, e="lin"), K(0.25, r=1.4, e="lin"), K(0.75, r=-1.4, e="lin"), K(1, e="lin")], tau=20),
    "tail_flick": motion(1.8, [K(0), K(0.6, e="out"), K(0.7, r=-8), K(0.8, r=2.8), K(0.9), K(1)], tau=30),
}
TAIL_MOTION = {"up": "tail_sway", "flick": "tail_flick", "tall_a": "tail_quiver", "q_smooth": "tail_sway_fast",
               "droop_a": "tail_sway_slow", "curl": "tail_sway_slow", "puff": "tail_quiver"}

# 每个状态让哪个部件播哪个动作（没写的部件不动）；follow：空闲时跟着鼠标看。
ANIM = {
    "focus": dict(head="none"),
    "think": dict(head="drift", ring="spin"),
    "write": dict(head="nod", book="jitter", pen="scribble", star="pulse"),
    "done": dict(head="hop", star="click"),
    "ask": dict(head="tilt"),
    "error": dict(head="shake"),
    "idle": dict(head="breathe", follow=True),
    "sleep": dict(head="breathe_deep"),
    "idea": dict(head="pop", star="flash", ring="kick"),
    "shy": dict(head="shy"),
    "shy_more": dict(head="tremble"),
}
# 每个状态动起来是什么样（写进 README 和使用规范；改了 ANIM 或动作表记得同步这里）
STATE_NOTES = {
    "focus": "眨眼，尾巴慢慢晃",
    "think": "头轻轻左右偏，赤星之节外面的环慢慢转，光环上的流光绕圈",
    "write": "书右上方露出一支笔在写（写两秒停一下），书跟着轻微抖，头一点一点，星轻轻脉动，笔旁边飘起小金点",
    "done": "跳一下，星「咔」地转 90°，光环旁的星光闪",
    "ask": "歪头，停一会儿再回正，问号尾巴晃",
    "error": "摇头，炸毛的尾巴发抖",
    "idle": "呼吸；鼠标一动就睁眼看过来、头往鼠标那边歪，停下 2.5 秒后眯回去",
    "sleep": "深呼吸，z 往上飘",
    "idea": "往上一冒，星闪一下、环转 90°",
    "shy": "头往书后面沉一点，轻轻晃",
    "shy_more": "头缩到书后面只露眼睛，微微发抖，头顶冒热气",
}
HEAD_PIVOT, BOOK_PIVOT = (50.0, 68.0), (50.0, 75.0)   # 头绕脖子（藏在书后面）转，书绕中间偏下的点转
PEN_TIP, PEN_END, PEN_W = (82.0, 64.0), (87.0, 40.5), 3.4


def motion_css(name, m):
    """把动作表里的一个动作写成 CSS @keyframes（循环 SVG 和组件里 CSS 驱动的部件都用它）。"""
    frames = ""
    for t, x, y, r, s, e in m["keys"]:
        bez = ",".join(str(v) for v in EASE[e])
        frames += f"{f(t * 100)}%{{transform:translate({f(x)}px,{f(y)}px) rotate({f(r)}deg) scale({f(s)});animation-timing-function:cubic-bezier({bez})}}"
    return f"@keyframes nb-{name}{{{frames}}}.m-{name}{{animation:nb-{name} {m['period']}s infinite}}"


def origin(bounds, pivot):
    """transform-origin：支点在元素外框里的百分比（transform-box: fill-box 用）。"""
    x0, y0, x1, y1 = bounds
    return f"{f((pivot[0] - x0) / (x1 - x0) * 100)}% {f((pivot[1] - y0) / (y1 - y0) * 100)}%"


# ==================== 数据 ====================
def data():
    geo, colors = mark.STYLES["ivory"]
    head_full = mp.HEAD_RAW.difference(mp.EARS)   # 下半截伸到书后面，靠裁切挡住：头沉下去、跳起来都不露断口
    zone = unary_union([BOOK_ZONE, HEAD_ZONE])
    s, tx, ty = moods.placement()
    pen, pen_bounds = pen_markup()
    states = {}
    for k, n, _w, e, t, h, ex, c in moods.STATES:
        look = moods.LOOK.get(k, {})
        a = ANIM[k]
        states[k] = {"name": n, "eyes": e, "tail": t, "halo": h, "extras": [x for x in ex if x != "blush"], "copy": c,
                     "blush": "blush" in ex, "sink": look.get("sink", 0), "earPink": bool(look.get("ear_pink")),
                     "blushLines": bool(look.get("blush_lines")), "steam": bool(look.get("steam")),
                     "motion": {part: a.get(part) for part in ("head", "book", "pen", "star", "ring")}, "follow": bool(a.get("follow"))}
    used_tails = sorted({v["tail"] for v in states.values()})
    return {
        "place": [round(s, 5), round(tx, 3), round(ty, 3)],
        "colors": {"tile": CRIMSON, "cat": IVORY, "blush": PINK, "ring": GOLD_DEEP, "star": CRIMSON, "corner": GOLD_DEEP, "line": CRIMSON},
        "head": poly_path(mp.HEAD_RAW.difference(mp.EARS).difference(BOOK_ZONE)), "headFull": poly_path(head_full),
        "book": mark.layers(geo)[1][1], "corners": mark.corners_path(), "ring": mark.ring_path(), "star": mark.star_path(),
        "ears": poly_path(mp.EARS), "blushLines": poly_path(moods.blush_lines()),
        "blush": {"normal": mark.blush_path(), "big": poly_path(mp.big_blush())},
        "tailClip": "M-60,-60 H220 V220 H-60 Z " + poly_path(zone),
        "bookClip": "M-60,-60 H220 V220 H-60 Z " + poly_path(BOOK_ZONE),
        "puff": poly_path(mp.puffed(bezier_chain(mp.UPRIGHT))),
        "pen": pen, "motes": motes_markup(), "steam": steam_markup(),
        "pivots": {"head": list(HEAD_PIVOT), "book": origin(mark_book_bounds(), BOOK_PIVOT), "pen": origin(pen_bounds, PEN_TIP),
                   "headOrigin": origin(head_full.bounds, HEAD_PIVOT)},
        "eyes": {k: eye_parts(k) for k in sorted({v["eyes"] for v in states.values()} | {"bean"})},
        "tails": {k: {"pts": resample(tail_pts(k)), "motion": TAIL_MOTION[k], "puff": k == "puff"} for k in used_tails},
        "halos": {k: halo_markup(k) for k in sorted({v["halo"] for v in states.values() if v["halo"]})},
        "extras": {k: extra_markup(k) for k in sorted({x for v in states.values() for x in v["extras"]})},
        "motions": MOTIONS, "ease": EASE,
        "states": states,
        "order": [k for k, *_ in moods.STATES],
    }


def mark_book_bounds():
    return BOOK.bounds


# ==================== 组件 ====================
# 装饰自己的循环（光环浮动、流光、进度、z、星光、金点、热气）不走动作表：它们改的是描边、透明度，不是位移旋转缩放。
DECOR_CSS = """
.bob{animation:bob 3.2s ease-in-out infinite}
.comet{animation:orbit 2.2s linear infinite}
.sweep{animation:sweep 5.5s linear infinite}
.prog{animation:grow 5s ease-in-out infinite}
.z{animation:zz 2.6s ease-in-out infinite;animation-delay:calc(var(--i) * .9s)}
.twinkle{transform-box:fill-box;transform-origin:center;animation:twinkle 2.4s ease-in-out infinite;animation-delay:calc(var(--i) * .7s)}
.mote{animation:mote 1.8s ease-out infinite;animation-delay:calc(var(--i) * .6s)}
.puffs{animation:puff 1.6s ease-out infinite;animation-delay:calc(var(--i) * .5s)}
.ring,.star{transform-box:fill-box;transform-origin:center}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.4px)}}
@keyframes orbit{to{stroke-dashoffset:-100}}
@keyframes sweep{from{stroke-dashoffset:-56}to{stroke-dashoffset:-156}}
@keyframes grow{0%{stroke-dasharray:0 100}85%,100%{stroke-dasharray:100 100}}
@keyframes zz{0%{opacity:0;transform:translate(0,3px)}30%,70%{opacity:1}100%{opacity:0;transform:translate(2px,-4px)}}
@keyframes twinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.75}}
@keyframes mote{0%{opacity:0;transform:translate(0,2px)}25%{opacity:1}100%{opacity:0;transform:translate(1.5px,-6px)}}
@keyframes puff{0%{opacity:0;transform:translate(0,2px) scale(.6)}30%{opacity:.95}100%{opacity:0;transform:translate(0,-5px) scale(1.2)}}
"""
CSS = ":host{display:inline-block;width:128px;aspect-ratio:1;line-height:0}svg{width:100%;height:100%;display:block;overflow:visible}" + DECOR_CSS + ".still *{animation:none!important}"

JS = r"""/* NeuroBook 心情差分组件。由 .local/brand/logo/tools/mood_anim.py 生成，不要手改；改动画请改那里的动作表（MOTIONS、ANIM）再重新导出。
 *
 * 用法：<script src="neurobook-mood.js"></script>（普通脚本，本地 file:// 也能打开；当模块引入也行）
 *       <neurobook-mood state="focus"></neurobook-mood>
 * 属性：state   状态键（focus think write done ask error idle sleep idea shy shy_more）；改它就播切换动画
 *       variant tile（赤红底块，默认）| dark（透明底，放在深色背景上）
 *       paused  有这个属性时不播循环动画（切换仍会换样子）
 * 尺寸：CSS 的 width（默认 128px）。空闲（idle）时跟着鼠标看。系统设了减少动画时：不循环、切换不播动画、不跟鼠标。
 * 事件：statechange，detail = { from, to }。
 * 扩展（在页面里，不改这个文件）：
 *   NeuroBookMood.defineMotion("wiggle", { period: 1, keys: [[0, 0,0,0,1, "io"], [0.5, 0,0,5,1, "io"], [1, 0,0,0,1, "io"]] })
 *     关键帧 [进度 0–1, x, y, 角度°, 缩放, 到下一帧的缓动 lin|io|in|out|back]，单位是标志的画布单位（100×100）。
 *   NeuroBookMood.defineState("cheer", { from: "done", name: "欢呼", motion: { head: "wiggle" } })
 *     从已有状态复制再覆盖；眼睛、尾巴、光环、小符号只能用已有的部件（见 NeuroBookMood.parts）。
 *   新动作、新状态要在创建元素之前定义；已经在页面上的元素调用 el.rebuild()。
 * 录屏、测试：NeuroBookMood.manual = true 停掉自动播放，NeuroBookMood.clock = () => 毫秒，然后 el.tick() 画一帧。 */
(() => {
const DATA = __DATA__;
const BASE_CSS = __CSS__;
const OPEN_EYES = new Set(["bean", "up", "vbar", "big", "shy"]);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 1)));
const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, D = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x, d = D(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; }
    return Y(clamp(t, 0, 1));
  };
}
const EASE = Object.fromEntries(Object.entries(DATA.ease).map(([k, v]) => [k, bezier(...v)]));

/** 按动作表取 t 秒时的 [x, y, 角度, 缩放]。 */
function sample(name, t) {
  const m = DATA.motions[name];
  if (!m) return [0, 0, 0, 1];
  const p = (((t / m.period) % 1) + 1) % 1, k = m.keys;
  let i = 0;
  while (i < k.length - 2 && p > k[i + 1][0]) i++;
  const a = k[i], b = k[i + 1] || a, span = b[0] - a[0] || 1, u = (EASE[a[5]] || EASE.io)(clamp((p - a[0]) / span, 0, 1));
  return [lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u), lerp(a[4], b[4], u)];
}

/** 动作表 → CSS @keyframes（和 tools/mood_anim.py 的 motion_css 一样）。 */
function motionCss() {
  const n = (v) => +(+v).toFixed(3);
  return Object.entries(DATA.motions).map(([name, m]) => {
    const frames = m.keys.map(([t, x, y, r, s, e]) =>
      `${n(t * 100)}%{transform:translate(${n(x)}px,${n(y)}px) rotate(${n(r)}deg) scale(${n(s)});animation-timing-function:cubic-bezier(${(DATA.ease[e] || DATA.ease.io).join(",")})}`).join("");
    return `@keyframes nb-${name}{${frames}}.m-${name}{animation:nb-${name} ${m.period}s infinite}`;
  }).join("");
}

class NeuroBookMood extends HTMLElement {
  static get observedAttributes() { return ["state", "variant", "paused"]; }
  static get states() { return DATA.states; }
  static get motions() { return DATA.motions; }
  static get parts() {
    return { eyes: Object.keys(DATA.eyes), tails: Object.keys(DATA.tails), halos: Object.keys(DATA.halos), extras: Object.keys(DATA.extras) };
  }
  static defineMotion(name, m) { DATA.motions[name] = { tau: 70, ...m }; }
  static defineState(key, def) {
    const base = DATA.states[def.from || "focus"];
    DATA.states[key] = { ...base, ...def, motion: { ...base.motion, ...(def.motion || {}) }, name: def.name || key };
    if (!DATA.order.includes(key)) DATA.order.push(key);
  }
  static now() { return NeuroBookMood.clock ? NeuroBookMood.clock() : performance.now(); }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._key = null;
    this._raf = 0;
    this._last = 0;
    this._blinkAt = 0;
    this._tail = null;
    this._morph = null;
    this._head = [0, 0, 0, 0, 0];   // x, y, 角度, 下沉, 尾巴角度
    this._eyeOff = [0, 0];
    this._pointer = null;
    this._awake = false;
    this._onPointer = (e) => { this._pointer = { x: e.clientX, y: e.clientY, t: NeuroBookMood.now() }; };
  }

  get state() { return this._key; }
  set state(v) { this.setAttribute("state", v); }

  connectedCallback() {
    this.rebuild();
    window.addEventListener("pointermove", this._onPointer, { passive: true });
    this._schedule();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("pointermove", this._onPointer);
  }

  attributeChangedCallback(name, _old, value) {
    if (!this._svg) return;
    if (name === "state" && value !== this._key) this._apply(value || "focus", !this._still());
    if (name === "variant") this._bg.style.display = value === "dark" ? "none" : "";
    if (name === "paused") this._classes();
  }

  /** 重新画一遍（新定义了动作或状态以后调用）。 */
  rebuild() {
    const key = this._key || this.getAttribute("state") || "focus";
    this._key = null; this._tail = null;
    this._build();
    this._apply(key, false);
  }

  /** 手动画一帧（NeuroBookMood.manual 为真时由外部调用）。 */
  tick(now = NeuroBookMood.now()) { this._frame(now); }

  _still() { return reduce() || this.hasAttribute("paused"); }

  _schedule() {
    if (NeuroBookMood.manual) return;
    this._raf = requestAnimationFrame(() => { this._frame(NeuroBookMood.now()); this._schedule(); });
  }

  _build() {
    const [s, tx, ty] = DATA.place, C = DATA.colors, P = DATA.pivots;
    const eye = (i) => `<g class="eye" data-i="${i}"><path fill="black" fill-rule="evenodd"/></g>`;
    const halos = Object.entries(DATA.halos).map(([k, m]) => `<g class="halo" data-k="${k}" style="display:none"><g class="bob">${m}</g></g>`).join("");
    const extras = Object.entries(DATA.extras).map(([k, m]) => `<g class="extra" data-k="${k}" style="display:none">${m}</g>`).join("");
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${motionCss()}</style>
<svg viewBox="0 0 100 100" role="img" aria-label="NeuroBook">
<defs>
  <mask id="eyes" maskUnits="userSpaceOnUse" x="-60" y="-60" width="240" height="240"><rect x="-60" y="-60" width="240" height="240" fill="white"/>${eye(0)}${eye(1)}</mask>
  <clipPath id="tailclip"><path clip-rule="evenodd" d="${DATA.tailClip}"/></clipPath>
  <clipPath id="bookclip"><path clip-rule="evenodd" d="${DATA.bookClip}"/></clipPath>
</defs>
<rect class="bg" width="100" height="100" rx="22" fill="${C.tile}"/>
<g transform="translate(${tx} ${ty}) scale(${s})">
  <g clip-path="url(#bookclip)">
    <g class="headg">
      <path d="${DATA.headFull}" fill="${C.cat}" fill-rule="evenodd" mask="url(#eyes)"/>
      <path class="ears" d="${DATA.ears}" fill="${C.blush}" style="opacity:0"/>
      <path class="blush-normal" d="${DATA.blush.normal}" fill="${C.blush}"/>
      <path class="blush-big" d="${DATA.blush.big}" fill="${C.blush}" style="opacity:0"/>
      <path class="lines" d="${DATA.blushLines}" fill="${C.line}" style="opacity:0"/>
    </g>
    <g class="pen" style="display:none"><g class="part" data-part="pen" style="transform-box:fill-box;transform-origin:${P.pen}">${DATA.pen}</g>${DATA.motes}</g>
  </g>
  <g class="part" data-part="book" style="transform-box:fill-box;transform-origin:${P.book}">
    <path d="${DATA.book}" fill="${C.cat}" fill-rule="evenodd"/>
    <path d="${DATA.corners}" fill="${C.corner}"/>
    <path class="ring part" data-part="ring" d="${DATA.ring}" fill="${C.ring}"/>
    <path class="star part" data-part="star" d="${DATA.star}" fill="${C.star}"/>
  </g>
  <g clip-path="url(#tailclip)"><g class="tail">
    <path class="stroke" fill="none" stroke="${C.cat}" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="puff" d="${DATA.puff}" fill="${C.cat}" style="opacity:0"/>
  </g></g>
  <g class="follow">${halos}${extras}<g class="steam" style="display:none">${DATA.steam}</g></g>
</g>
</svg>`;
    const q = (sel) => this.shadowRoot.querySelector(sel);
    this._svg = q("svg");
    this._bg = q(".bg");
    this._eyes = [...this.shadowRoot.querySelectorAll(".eye")];
    this._headG = q(".headg");
    this._pen = q(".pen");
    this._parts = [...this.shadowRoot.querySelectorAll(".part")];
    this._follow = q(".follow");
    this._tailG = q(".tail");
    this._stroke = q(".tail .stroke");
    this._puff = q(".tail .puff");
    if (this.getAttribute("variant") === "dark") this._bg.style.display = "none";
  }

  _classes() { this._svg.classList.toggle("still", this._still()); }

  _apply(key, animate) {
    const st = DATA.states[key];
    if (!st) return;
    const prevKey = this._key, prev = prevKey ? DATA.states[prevKey] : null;
    this._key = key;
    this._awake = false;
    this._svg.setAttribute("aria-label", `NeuroBook · ${st.name}`);
    this._classes();
    // 书、笔、星、环：按动作表生成的 CSS 播
    for (const el of this._parts) {
      const m = st.motion[el.dataset.part];
      el.setAttribute("class", (el.classList.contains("ring") ? "ring " : el.classList.contains("star") ? "star " : "") + "part" + (m ? ` m-${m}` : ""));
    }
    // 眼睛：切换时先闭眼再换眼型
    if (animate && prev && prev.eyes !== st.eyes) this._blink(() => this._setEyes(st.eyes), 90, 150);
    else this._setEyes(st.eyes);
    this._blinkAt = NeuroBookMood.now() + 2500 + Math.random() * 2000;
    // 尾巴
    const to = DATA.tails[st.tail];
    if (animate && this._tail && this._tail !== to) this._morph = { from: this._curPts(), fromPuff: this._tail.puff, to, t0: NeuroBookMood.now(), dur: 460 };
    else { this._morph = null; this._puff.style.opacity = to.puff ? 1 : 0; this._stroke.style.opacity = to.puff ? 0 : 1; }
    this._tail = to;
    // 光环、小符号、笔、热气
    this._swap(".halo", prev ? prev.halo : null, st.halo, animate);
    const had = new Set(prev ? prev.extras : []), want = new Set(st.extras);
    for (const g of this.shadowRoot.querySelectorAll(".extra")) {
      const k = g.dataset.k;
      this._toggle(g, had.has(k), want.has(k), animate, { inScale: 0.6, inDur: 300, delay: 160 }, { outScale: 0.8 });
    }
    this._toggle(this._pen, !!(prev && prev.motion.pen), !!st.motion.pen, animate, { inY: 5, inDur: 380 }, { outY: 5 });
    this._toggle(this.shadowRoot.querySelector(".steam"), !!(prev && prev.steam), st.steam, animate, { inScale: 0.7, inDur: 300, delay: 200 }, { outScale: 0.8 });
    // 腮红、粉耳朵、///
    const fade = (sel, v) => {
      const el = this.shadowRoot.querySelector(sel);
      if (animate) this._track(el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: v }], { duration: 320, fill: "forwards" }));
      else { el.getAnimations().forEach((a) => a.cancel()); el.style.opacity = v; }
    };
    fade(".blush-big", st.blush ? 1 : 0); fade(".blush-normal", st.blush ? 0 : 1);
    fade(".ears", st.earPink ? 1 : 0); fade(".lines", st.blushLines ? 1 : 0);
    if (!animate) this._head[3] = st.sink;
    this.dispatchEvent(new CustomEvent("statechange", { detail: { from: prevKey, to: key }, bubbles: true, composed: true }));
  }

  _track(a) { a.startVirtual = NeuroBookMood.now(); return a; }

  _toggle(g, was, want, animate, inOpt, outOpt) {
    if (want && !was) this._show(g, animate, inOpt);
    else if (!want && was) this._hide(g, animate, outOpt);
    else g.style.display = want ? "" : "none";
  }

  _swap(sel, from, to, animate) {
    if (from === to) {
      for (const g of this.shadowRoot.querySelectorAll(sel)) g.style.display = g.dataset.k === to ? "" : "none";
      return;
    }
    for (const g of this.shadowRoot.querySelectorAll(sel)) {
      if (g.dataset.k === from) this._hide(g, animate, { outY: -3 });
      else if (g.dataset.k === to) this._show(g, animate, { inY: -7, inDur: 420, delay: from ? 120 : 0 });
      else g.style.display = "none";
    }
  }

  _show(g, animate, o) {
    g.style.display = "";
    if (!animate) return;
    const a = o.inScale ? `scale(${o.inScale})` : `translateY(${o.inY}px)`;
    g.style.transformBox = "fill-box"; g.style.transformOrigin = "center";
    this._track(g.animate([{ opacity: 0, transform: a }, { opacity: 1, transform: "none" }],
      { duration: o.inDur, delay: o.delay || 0, easing: "cubic-bezier(.2,1.35,.45,1)", fill: "backwards" }));
  }

  _hide(g, animate, o) {
    if (!animate) { g.style.display = "none"; return; }
    const b = o.outScale ? `scale(${o.outScale})` : `translateY(${o.outY}px)`;
    g.style.transformBox = "fill-box"; g.style.transformOrigin = "center";
    const a = this._track(g.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: b }], { duration: 200, easing: "ease-in", fill: "forwards" }));
    a.onfinish = () => { if (!this._isActive(g)) g.style.display = "none"; a.cancel(); };
  }

  _isActive(g) {
    const st = DATA.states[this._key];
    if (g.classList.contains("halo")) return g.dataset.k === st.halo;
    if (g.classList.contains("pen")) return !!st.motion.pen;
    if (g.classList.contains("steam")) return st.steam;
    return st.extras.includes(g.dataset.k);
  }

  _setEyes(k) {
    DATA.eyes[k].forEach((e, i) => {
      const g = this._eyes[i];
      g.firstElementChild.setAttribute("d", e.d);
      g.dataset.cx = e.cx; g.dataset.cy = e.cy;
    });
    this._eyeKey = k;
  }

  _blink(mid, down = 80, up = 130) { this._blinking = { t0: NeuroBookMood.now(), down, up, mid, swapped: false }; }

  _eyeScale(now) {
    const b = this._blinking;
    if (!b) return 1;
    const t = now - b.t0;
    if (t < b.down) return 1 - t / b.down;
    if (!b.swapped) { b.swapped = true; if (b.mid) b.mid(); }
    if (t < b.down + b.up) return (t - b.down) / b.up;
    this._blinking = null;
    return 1;
  }

  _curPts() { return this._morph ? this._interp(NeuroBookMood.now()) : this._tail.pts; }

  _interp(now) {
    const m = this._morph, e = smooth(clamp((now - m.t0) / m.dur, 0, 1));
    return m.to.pts.map((p, i) => [lerp(m.from[i][0], p[0], e), lerp(m.from[i][1], p[1], e)]);
  }

  _frame(now) {
    const dt = this._last ? clamp(now - this._last, 0, 64) : 16;
    this._last = now;
    const still = this._still(), t = now / 1000, st = DATA.states[this._key];
    // 空闲时跟着鼠标：鼠标一动就睁眼看过来，停下 2.5 秒后眯回去
    let look = [0, 0], lean = 0;
    if (st.follow && !still && this._pointer && now - this._pointer.t < 2500) {
      const r = this.getBoundingClientRect();
      const dx = clamp((this._pointer.x - (r.left + r.width / 2)) / Math.max(r.width, 1), -1.5, 1.5) / 1.5;
      const dy = clamp((this._pointer.y - (r.top + r.height * 0.45)) / Math.max(r.height, 1), -1.5, 1.5) / 1.5;
      look = [dx * 1.7, dy * 1.1]; lean = dx * 3;
      if (!this._awake) { this._awake = true; this._blink(() => this._setEyes("bean"), 70, 120); }
    } else if (this._awake) {
      this._awake = false;
      this._blink(() => this._setEyes(st.eyes), 90, 150);
    }
    // 头：动作表里的动作 + 下沉 + 跟鼠标的倾斜，逐帧往目标靠拢（换状态时不跳）
    const hm = st.motion.head || "none", [hx, hy, ha] = still ? [0, 0, 0] : sample(hm, t);
    const tau = (DATA.motions[hm] || {}).tau || 70;
    this._head[0] = approach(this._head[0], hx, dt, tau);
    this._head[1] = approach(this._head[1], hy, dt, tau);
    this._head[2] = approach(this._head[2], ha + lean, dt, Math.max(tau, 60));
    this._head[3] = approach(this._head[3], st.sink, dt, 200);
    const [x, y, a, sink] = this._head, [px, py] = DATA.pivots.head;
    this._headG.setAttribute("transform", `translate(${x.toFixed(3)} ${(y + sink).toFixed(3)}) rotate(${a.toFixed(2)} ${px} ${py})`);
    this._follow.setAttribute("transform", `translate(${(x * 0.6).toFixed(3)} ${((y + sink) * 0.6).toFixed(3)})`);
    // 尾巴：变形 + 动作表里按姿势的摆动（绕根部转）
    let pts = this._tail.pts;
    if (this._morph) {
      const m = this._morph, k = clamp((now - m.t0) / m.dur, 0, 1);
      pts = this._interp(now);
      const po = m.to.puff ? smooth(k) : m.fromPuff ? 1 - smooth(k) : 0;
      this._puff.style.opacity = po; this._stroke.style.opacity = 1 - po;
      if (k >= 1) this._morph = null;
    }
    this._stroke.setAttribute("d", "M" + pts.map((p) => p[0].toFixed(2) + "," + p[1].toFixed(2)).join(" L"));
    const tm = this._tail.motion, ang = still ? 0 : sample(tm, t)[2];
    this._head[4] = approach(this._head[4], ang, dt, (DATA.motions[tm] || {}).tau || 70);
    const root = pts[Math.round(pts.length * 0.22)];
    this._tailG.setAttribute("transform", `rotate(${this._head[4].toFixed(2)} ${root[0].toFixed(2)} ${root[1].toFixed(2)})`);
    // 眨眼、看鼠标
    if (!still && !this._blinking && OPEN_EYES.has(this._eyeKey) && now > this._blinkAt) {
      this._blink(null);
      this._blinkAt = now + 3200 + Math.random() * 2400;
    }
    this._eyeOff[0] = approach(this._eyeOff[0], look[0], dt, 110);
    this._eyeOff[1] = approach(this._eyeOff[1], look[1], dt, 110);
    const sy = Math.max(0.02, this._eyeScale(now)), [ex, ey] = this._eyeOff;
    for (const g of this._eyes) {
      const cx = +g.dataset.cx, cy = +g.dataset.cy;
      g.setAttribute("transform", `translate(${(cx + ex).toFixed(2)} ${(cy + ey).toFixed(2)}) scale(1 ${sy.toFixed(3)}) translate(${-cx} ${-cy})`);
    }
  }
}

NeuroBookMood.clock = null;
NeuroBookMood.manual = false;
window.NeuroBookMood = NeuroBookMood;
if (!customElements.get("neurobook-mood")) customElements.define("neurobook-mood", NeuroBookMood);
})();
"""


def component_js():
    return JS.replace("__DATA__", json.dumps(data(), ensure_ascii=False, separators=(",", ":"))).replace("__CSS__", json.dumps(CSS))


# ==================== 演示页 ====================
def demo_html(js_src="neurobook-mood.js", title="NeuroBook 心情差分 · 动画"):
    d = data()
    buttons = "".join(f'<button type="button" data-k="{k}">{d["states"][k]["name"]}</button>' for k in d["order"])
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
body{{margin:0;background:#EDE5DA;color:#2E211B;font:14px/1.7 system-ui,"PingFang SC","Noto Sans CJK SC",sans-serif}}
main{{max-width:980px;margin:0 auto;padding:32px 16px 60px}}
h1{{font-size:24px;margin:0 0 6px}} p{{color:#7A6A5E;margin:0 0 12px}}
.stage{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;margin:16px 0}}
.panel{{border-radius:14px;padding:24px;display:grid;place-items:center;gap:10px}}
.panel.light{{background:#FBF8F4;border:1px solid #E4D9CC}} .panel.dark{{background:#1C1418;color:#F7F2EC}}
neurobook-mood{{width:220px;max-width:100%}}
.copy{{min-height:1.7em;margin:0;color:inherit;opacity:.8}}
.btns{{display:flex;flex-wrap:wrap;gap:8px}}
button{{font:inherit;border:1px solid #E4D9CC;background:#fff;border-radius:999px;padding:4px 14px;cursor:pointer;color:#2E211B}}
button[aria-pressed="true"]{{background:#871222;border-color:#871222;color:#F7F2EC}}
label{{display:inline-flex;align-items:center;gap:6px;margin-left:8px}}
code{{font-size:12px}}
</style></head><body><main>
<h1>心情差分 · 动画</h1>
<p>点状态看切换动画；勾上「自动轮播」每 2.6 秒换一个；选「空闲」后移动鼠标，猫会睁眼看过来。组件：<code>&lt;neurobook-mood state="think"&gt;&lt;/neurobook-mood&gt;</code>，改 <code>state</code> 属性就播切换动画；用法和扩展见同目录的 README.md。</p>
<div class="btns">{buttons}<label><input type="checkbox" id="auto"> 自动轮播</label></div>
<div class="stage">
<div class="panel light"><neurobook-mood state="focus"></neurobook-mood><p class="copy"></p></div>
<div class="panel dark"><neurobook-mood state="focus" variant="dark"></neurobook-mood><p class="copy"></p></div>
</div>
<script src="{js_src}"></script>
<script>
const order = {json.dumps(d["order"])}, copy = {json.dumps({k: v["copy"] for k, v in d["states"].items()}, ensure_ascii=False)};
const set = (k) => {{
  document.querySelectorAll("neurobook-mood").forEach((m) => m.setAttribute("state", k));
  document.querySelectorAll(".copy").forEach((p) => (p.textContent = copy[k]));
  document.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k));
}};
document.querySelector(".btns").addEventListener("click", (e) => {{ const b = e.target.closest("button"); if (b) set(b.dataset.k); }});
let timer = 0;
document.getElementById("auto").addEventListener("change", (e) => {{
  clearInterval(timer);
  if (e.target.checked) timer = setInterval(() => {{
    const cur = document.querySelector("neurobook-mood").getAttribute("state");
    set(order[(order.indexOf(cur) + 1) % order.length]);
  }}, 2600);
}});
set("focus");
</script>
</main></body></html>"""


# ==================== 单个状态的循环动画 SVG ====================
LOOP_CSS = DECOR_CSS + """
.eye{transform-box:fill-box;transform-origin:center;animation:blink 4.2s infinite}
.eye.shut{animation:none}
@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.05)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
"""


def looping_svg(key, tile=True):
    """一个状态单独循环播放的动画 SVG：动作和组件用同一张动作表生成成 CSS，不要脚本，可以直接当 <img> 用。
    没有切换动画和跟随鼠标（那两样要脚本，用组件）。"""
    d = data()
    st = d["states"][key]
    s, tx, ty = d["place"]
    c = d["colors"]
    used = {v for v in st["motion"].values() if v} | {d["tails"][st["tail"]]["motion"]}
    css = LOOP_CSS + "".join(motion_css(n, MOTIONS[n]) for n in sorted(used))
    cls = lambda part: f' class="m-{st["motion"][part]}"' if st["motion"].get(part) else ""
    shut = "" if st["eyes"] in ("bean", "up", "vbar", "big", "shy") else " shut"
    eyes = "".join(f'<g class="eye{shut}"><path d="{e["d"]}" fill="black" fill-rule="evenodd"/></g>' for e in d["eyes"][st["eyes"]])
    t = d["tails"][st["tail"]]
    pts = t["pts"]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    root = pts[round(len(pts) * 0.22)]
    tail_el = (f'<path d="{d["puff"]}" fill="{c["cat"]}"/>' if t["puff"] else
               f'<path d="M{" L".join(f"{x},{y}" for x, y in pts)}" fill="none" stroke="{c["cat"]}" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/>')
    blush = d["blush"]["big" if st["blush"] else "normal"]
    head_bits = (f'<path d="{d["headFull"]}" fill="{c["cat"]}" fill-rule="evenodd" mask="url(#eyes)"/>'
                 + (f'<path d="{d["ears"]}" fill="{c["blush"]}"/>' if st["earPink"] else "")
                 + f'<path d="{blush}" fill="{c["blush"]}"/>'
                 + (f'<path d="{d["blushLines"]}" fill="{c["line"]}"/>' if st["blushLines"] else ""))
    head_motion = st["motion"]["head"] or "none"
    pen = (f'<g class="m-{st["motion"]["pen"]}" style="transform-box:fill-box;transform-origin:{d["pivots"]["pen"]}">{d["pen"]}</g>{d["motes"]}'
           if st["motion"].get("pen") else "")
    halo = f'<g class="bob">{d["halos"][st["halo"]]}</g>' if st["halo"] else ""
    extras = "".join(d["extras"][x] for x in st["extras"]) + (d["steam"] if st["steam"] else "")
    bg = f'<rect width="100" height="100" rx="22" fill="{c["tile"]}"/>' if tile else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="NeuroBook · {st["name"]}">'
            f'<title>NeuroBook · {st["name"]}</title><style>{css}</style>'
            f'<defs><mask id="eyes" maskUnits="userSpaceOnUse" x="-60" y="-60" width="240" height="240">'
            f'<rect x="-60" y="-60" width="240" height="240" fill="white"/>{eyes}</mask>'
            f'<clipPath id="tailclip"><path clip-rule="evenodd" d="{d["tailClip"]}"/></clipPath>'
            f'<clipPath id="bookclip"><path clip-rule="evenodd" d="{d["bookClip"]}"/></clipPath></defs>'
            f'{bg}<g transform="translate({tx} {ty}) scale({s})">'
            f'<g clip-path="url(#bookclip)"><g transform="translate(0 {st["sink"]})">'
            f'<g class="m-{head_motion}" style="transform-box:fill-box;transform-origin:{d["pivots"]["headOrigin"]}">{head_bits}</g></g>{pen}</g>'
            f'<g{cls("book")} style="transform-box:fill-box;transform-origin:{d["pivots"]["book"]}">'
            f'<path d="{d["book"]}" fill="{c["cat"]}" fill-rule="evenodd"/><path d="{d["corners"]}" fill="{c["corner"]}"/>'
            f'<path class="ring{(" m-" + st["motion"]["ring"]) if st["motion"].get("ring") else ""}" d="{d["ring"]}" fill="{c["ring"]}"/>'
            f'<path class="star{(" m-" + st["motion"]["star"]) if st["motion"].get("star") else ""}" d="{d["star"]}" fill="{c["star"]}"/></g>'
            f'<g clip-path="url(#tailclip)"><g class="m-{t["motion"]}" style="transform-box:fill-box;transform-origin:{origin((min(xs), min(ys), max(xs), max(ys)), root)}">{tail_el}</g></g>'
            f'{halo}{extras}</g></svg>\n')


# ==================== README ====================
def readme():
    d = data()
    rows = "\n".join(f"| `{k}` | {v['name']} | {STATE_NOTES.get(k, '')} | {', '.join(f'{p}: `{m}`' for p, m in v['motion'].items() if m) or '—'} |"
                     for k, v in d["states"].items())
    motions = "\n".join(f"| `{k}` | {m['period']} s | {len(m['keys'])} |" for k, m in MOTIONS.items())
    return f"""# NeuroBook 心情差分 · 动画

由 `brand/logo/tools/mood_anim.py` 生成（`produce.py` 导出），不要手改这里的文件。

## 文件

- `neurobook-mood.js`：网页组件 `<neurobook-mood>`，一个 JS 文件、不依赖库。切换状态播切换动画，平时循环；空闲时跟着鼠标看。
- `demo.html`：演示页，点状态看切换。
- `loop/neurobook-mood-<状态>.svg`、`-dark.svg`：每个状态单独循环播放的动画 SVG，不要脚本，可以直接当 `<img>` 用；没有切换动画和跟随鼠标。
- `video/neurobook-moods-tour.webm`：十一个状态轮播一遍的录屏，放在不能跑网页的地方（文档、聊天、社交媒体）；加 `--gif` 时另导出 `.gif`。

## 用法

```html
<script src="neurobook-mood.js"></script>
<neurobook-mood state="think" style="width:96px"></neurobook-mood>
<script>document.querySelector("neurobook-mood").state = "write";</script>
```

- `state`：状态键，见下表。`variant="dark"`：透明底，放在深色背景上。`paused`：停掉循环动画。
- 事件 `statechange`：`detail = {{ from, to }}`。
- 系统设了减少动画时：不循环、切换不播动画、不跟鼠标。

## 状态和动作

| 状态 | 名称 | 动起来是什么样 | 动作表里的动作 |
| --- | --- | --- | --- |
{rows}

尾巴的摆动跟着尾巴姿势走，眨眼、光环浮动、流光、进度、z、星光、金点、热气是各自部件的循环。

## 以后加动画、改动画

动画分三层，改哪层只动那一层：

1. **动作表**（`mood_anim.py` 的 `MOTIONS`）：每个动作是周期加关键帧 `K(进度, x, y, 角度, 缩放, 缓动)`，单位是标志的画布单位（100×100）。
   改幅度、节奏只改这里；组件（头、尾巴由 JS 按表算，书、笔、星、环用表生成的 CSS）和循环 SVG 都从这张表生成。
2. **状态表**：`moods.py` 的 `STATES`（眼睛、尾巴、光环、小符号）和 `LOOK`（下沉、粉耳朵等），`mood_anim.py` 的 `ANIM`（每个部件播哪个动作）和 `STATE_NOTES`（说明文字）。
   加一个状态：在这三处各加一行；要新部件（新眼睛、新尾巴姿势）先在 `mood_parts.py`、`mood_v4.py` 里画。
3. **播放**（`mood_anim.py` 里的 JS 模板）：只有加新种类的部件或新交互（像跟随鼠标）时才要改。

改完运行 `uv run --no-project --with shapely python tools/produce.py` 重新导出。

不改文件、在页面里临时加：`NeuroBookMood.defineMotion(名字, {{ period, keys }})`、`NeuroBookMood.defineState(键, {{ from, name, motion }})`，
在创建元素之前调用；已在页面上的元素调用 `el.rebuild()`。录屏、测试时 `NeuroBookMood.manual = true`，设 `NeuroBookMood.clock`，再 `el.tick()` 逐帧画。

动作表一览：

| 动作 | 周期 | 关键帧数 |
| --- | --- | --- |
{motions}
"""
