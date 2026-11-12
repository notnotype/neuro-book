"""终端心情差分的像素画（精修第十五轮）：48×60 像素，半块字符显示成 48 列 × 30 行。

自动栅格化在这个尺寸下左右不对称、书脊偏半格、眼睛和赤星之节糊成杂点，所以逐像素手画：
对称轴是第 20 列（标志的 x = 50 落在这一列正中），书脊只占这一列；底图按行写左半边，右半边镜像；
眼睛、耳洞、腮红、角饰、赤星之节、尾巴、光环、小符号都是手画的小块，按状态拼起来。
像素和标志坐标的换算：列 = (x − 9) × 0.5，行 = (y + 10) × 0.5。

    python3 tools/pixel_moods.py   # 写出 05-refine/round-15/ascii/ 下的 .ans
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mark import CRIMSON, IVORY, GOLD, GOLD_DEEP, PINK

W, H, AXIS = 48, 60, 20
PAL = {"W": IVORY, "R": CRIMSON, "G": GOLD, "D": GOLD_DEEP, "P": PINK}

# ---------- 底图：每行左半边的实心区间（含第 20 列），右半边镜像 ----------
HEAD = {
    13: [(8, 9)], 14: [(8, 10)], 15: [(8, 11)], 16: [(8, 12)], 17: [(8, 14)],
    **{r: [(7, 20)] for r in range(18, 26)},
    **{r: [(6, 20)] for r in range(26, 32)},
    32: [(7, 20)], 33: [(15, 20)], 34: [(19, 20)],
}
BOOK = {
    34: [(2, 14)], 35: [(1, 18)],
    **{r: [(1, 20)] for r in range(36, 48)},
    48: [(2, 20)], 49: [(17, 20)],
}
CREASE = [(r, AXIS) for r in range(38, 48)]                        # 书脊：第 20 列的一道缝
EAR_HOLE = [(16, 9), (16, 10), (17, 9), (17, 10), (17, 11), (18, 10), (18, 11)]   # 左耳洞，水滴尖朝耳尖
CORNERS = [(34, 2), (34, 3), (35, 1), (35, 2), (36, 1),             # 左上角饰
           (48, 2), (48, 3), (47, 1), (47, 2), (46, 1)]             # 左下角饰
BLUSH = [(30, 8), (30, 9), (30, 10)]
BIG_BLUSH = [(30, 7), (30, 8), (30, 9), (30, 10), (31, 8), (31, 9)]
EMBLEM_C = (41, 30)   # 行、列
EMBLEM = [   # 红星穿过一圈金环：星的四个角伸出环外，环在四个象限各剩一小段弧
    "....R....",
    "...DRD...",
    "..D.R.D..",
    ".D.RRR.D.",
    "RRRRRRRRR",
    ".D.RRR.D.",
    "..D.R.D..",
    "...DRD...",
    "....R....",
]

# ---------- 眼睛：左眼的 4×4 块（# 挖空，W 留成头的颜色），右眼镜像 ----------
EYE_AT = (28, 12)   # 左眼块的左上角（行、列）
EYES = {
    "bean":  [".##.", "####", "####", ".##."],
    "up":    [".##.", "####", "####", ".##."],       # 往上看：豆豆眼往右上挪一格
    "happy": ["....", ".##.", "#..#", "...."],       # ∩
    "sleep": ["....", "#..#", ".##.", "...."],       # ∪
    "equal": ["####", "....", "####", "...."],
    "vbar":  [".##.", ".##.", ".##.", ".##."],
    "cross": ["##..", "..##", "##..", "...."],       # 左眼 >，右眼镜像成 <
    "big":   [".###.", "###W#", "#####", ".###."],   # 5 宽：大眼加高光
    "shy":   [".##.", "####", "####", ".##."],       # 豆豆眼往外挪一格，配大腮红
}
EYE_OFFSET = {"up": (-1, 1), "big": (0, -1), "shy": (0, -1)}   # 相对 EYE_AT 的偏移（行、列）；右眼按镜像

# ---------- 尾巴：[(行, 起列, 止列)] ----------
TAILS = {
    "up": [(30, 42, 43), (31, 43, 44)] + [(r, 43, 44) for r in range(32, 42)] + [(42, 42, 44), (43, 41, 43), (44, 41, 42)],
    "tall": [(r, 43, 44) for r in range(28, 41)] + [(41, 42, 44), (42, 41, 43), (43, 41, 42)],
    "question": [(30, 41, 43), (31, 40, 41), (31, 43, 44), (32, 40, 40), (32, 43, 44)] + [(r, 43, 44) for r in range(33, 41)]
                + [(41, 42, 44), (42, 41, 43), (43, 41, 42)],   # 精修第十六轮：钩子放低一行，尾尖收成 1 格
    "flick": [(42, 46, 47), (43, 45, 47), (44, 41, 46), (45, 41, 45)],
    "droop_a": [(43, 41, 42), (44, 41, 43), (45, 42, 44)] + [(r, 43, 44) for r in range(46, 55)] + [(55, 44, 45)],
    "droop_b": [(47, 41, 41)] + [(r, 41, 42) for r in range(48, 53)] + [(53, 39, 42), (54, 38, 41)],
    "droop_c": [(43, 41, 42), (44, 41, 43), (45, 42, 44)] + [(r, 43, 44) for r in range(46, 52)] + [(52, 43, 45), (53, 44, 47), (52, 47, 47), (51, 47, 47)],
    "droop_d": [(r, 24, 25) for r in range(51, 56)] + [(56, 24, 26), (57, 25, 28), (56, 28, 28)],
    "curl": [(47, 41, 41), (48, 41, 42), (49, 41, 42), (50, 41, 42), (51, 40, 42), (52, 32, 33), (52, 39, 41), (53, 32, 40), (54, 33, 38)],
    "puff": [(29, 42, 45), (30, 42, 45), (31, 41, 45), (32, 42, 46), (33, 42, 45), (34, 41, 45), (35, 42, 46), (36, 42, 45),
             (37, 41, 45), (38, 42, 46), (39, 42, 45), (40, 41, 45), (41, 41, 44), (42, 41, 43), (43, 41, 42)],
}

# ---------- 光环：17×5，中心在第 20 列；G 亮金、D 暗金、P 粉、W 高光 ----------
HALO_AT = (5, 12)   # 左上角（行、列）
RING = [
    "....#########....",
    ".###.........###.",
    "##.............##",
    ".###.........###.",
    "....#########....",
]


def ring(color, shine=False, drop=0):
    rows = [r.replace("#", color) for r in RING]
    if shine:
        rows[1] = rows[1][:1] + "WW" + rows[1][3:]
    return rows, drop


def ring_parts(spec, drop=0):
    """按位置上色：spec 是和 RING 一样大小的字符画，# 的位置取 spec 里的颜色。"""
    return [("".join(s if r == "#" else "." for r, s in zip(rr, ss))) for rr, ss in zip(RING, spec)], drop


HALOS = {
    "gold": lambda: ring("G", shine=True),
    "think": lambda: ring_parts([
        "....DDDDDDDDD....",
        ".DDD.........GGG.",
        "DD.............GW",
        ".DDD.........GGG.",
        "....DDDDDDDGG....",
    ]),
    "write": lambda: ring_parts([
        "....DDDDGGGGG....",
        ".DDD.........GGG.",
        "DD.............GG",
        ".DDD.........GGG.",
        "....DDDDGGGGG....",
    ]),
    "error": lambda: ([
        "....#########....",
        ".###.........#...",
        "##...............",
        ".###.........#...",
        "....#########....",
    ], 1),
    "sleep": lambda: ring("D", drop=1),
    "shy": lambda: ring("P", shine=True),
}
SPARKLE = [".W.", "WWW", ".W."]


def done_extras():
    return [(SPARKLE, (1, 28)), (["W"], (4, 32))]


def idea_extras():
    return [(SPARKLE, (0, 29)), (["W"], (3, 33)), (["W"], (3, 9))]


# ---------- 小符号 ----------
BUBBLE_AT = (13, 36)   # 问号气泡左上角（行、列）：在右耳外侧，尖角朝左下指向猫头
BUBBLE = [
    "..WWWWW.",
    ".WWRRRWW",
    ".WWWWRWW",
    ".WWWRRWW",
    ".WWWRWWW",
    ".WWWWWWW",
    ".WWWRWWW",
    "WWWWWWW.",
    "W.......",
]
Z_SMALL = ["WWW", ".W.", "WWW"]
Z_BIG = ["WWWW", "..W.", ".W..", "WWWW"]
DROP = [".W.", ".W.", "WWW", "WWW", ".W."]


# ==================== 拼图 ====================
def blank():
    return [[None] * W for _ in range(H)]


def mirror_col(c):
    return 2 * AXIS - c


def fill_spans(g, spans, color, sym=True):
    for r, parts in spans.items():
        for a, b in parts:
            for c in range(a, b + 1):
                g[r][c] = color
                if sym:
                    g[r][mirror_col(c)] = color


def put(g, sprite, top, left, color_map=None, hole=None):
    """把字符画贴到 (top, left)：'.' 跳过；'#' 表示 hole 时挖空（设成 None），否则按 color_map 取色。"""
    for i, row in enumerate(sprite):
        for j, ch in enumerate(row):
            r, c = top + i, left + j
            if ch == "." or not (0 <= r < H and 0 <= c < W):
                continue
            if ch == "#" and hole:
                g[r][c] = None
            else:
                g[r][c] = PAL.get(ch, ch) if color_map is None else color_map.get(ch, PAL.get(ch))


def mirror_sprite(sprite):
    return [row[::-1] for row in sprite]


STEAM_PX = [(10, 17), (9, 20), (8, 20), (10, 23)]   # 羞到躲起来：头顶的热气


def cat(eyes="bean", tail="up", halo=None, extras=(), shy_blush=False, sink=0, ear_pink=False, steam=False):
    """sink：头往书后面沉几行；ear_pink：耳洞填粉；steam：头顶冒热气（羞到躲起来）。"""
    # 头单独画在一层上，沉下去以后再和书合起来：沉到书上沿（和上面那一行缝）以下的部分不画
    h = blank()
    fill_spans(h, HEAD, IVORY)
    for r, c in EAR_HOLE:
        h[r][c] = h[r][mirror_col(c)] = PINK if ear_pink else None
    for r, c in (BIG_BLUSH if shy_blush else BLUSH):
        h[r][c] = h[r][mirror_col(c)] = PINK
    sp = EYES[eyes]   # 眼睛：左眼按块贴，右眼镜像贴
    dr, dc = EYE_OFFSET.get(eyes, (0, 0))
    top, left = EYE_AT[0] + dr, EYE_AT[1] + dc
    put(h, sp, top, left, hole=True)
    wid = len(sp[0])
    put(h, mirror_sprite(sp), top, mirror_col(left + wid - 1), hole=True)
    g = blank()
    fill_spans(g, BOOK, IVORY)
    book_top = [min((r for r in range(H) if g[r][c]), default=H) for c in range(W)]
    for r in range(H - 1, -1, -1):
        for c in range(W):
            src = r - sink
            if 0 <= src < H and h[src][c] and r < book_top[c] - 1:
                g[r][c] = h[src][c]
    for r, c in CREASE:
        g[r][c] = None
    for r, c in CORNERS:
        g[r][c] = g[r][mirror_col(c)] = GOLD_DEEP
    put(g, EMBLEM, EMBLEM_C[0] - 4, EMBLEM_C[1] - 4)
    if steam:
        for r, c in STEAM_PX:
            g[r][c] = IVORY
    for r, a, b in TAILS[tail]:
        for c in range(a, b + 1):
            g[r][c] = IVORY
    if halo:
        rows, drop = HALOS[halo]()
        put(g, rows, HALO_AT[0] + drop, HALO_AT[1], color_map={"#": GOLD})
        if halo == "gold" and "done" in extras:
            pass
    for key in extras:
        if key == "done":
            for sp_, (r, c) in done_extras():
                put(g, sp_, r, c)
        elif key == "idea":
            for sp_, (r, c) in idea_extras():
                put(g, sp_, r, c)
        elif key == "zz":
            put(g, Z_SMALL, 12, 35)
            put(g, Z_BIG, 6, 39)
        elif key == "sweat":
            put(g, DROP, 13, 37)
        elif key == "qbubble":
            put(g, BUBBLE, *BUBBLE_AT)
    return g


STATES = [
    # (键, 名称, 眼睛, 尾巴, 光环, 其他)
    ("focus", "专注", "bean", "up", "gold", ()),
    ("think", "思考", "up", "flick", "think", ()),
    ("write", "写作中", "bean", "up", "write", ()),
    ("done", "完成", "happy", "tall", "gold", ("done",)),
    ("ask", "等你选择", "vbar", "question", "gold", ("qbubble",)),
    ("error", "出错", "cross", "puff", "error", ("sweat",)),
    ("idle", "空闲", "equal", "droop_a", "gold", ()),
    ("sleep", "睡着", "sleep", "curl", "sleep", ("zz",)),
    ("idea", "灵感", "big", "tall", "gold", ("idea",)),
    ("shy", "害羞", "shy", "curl", "shy", ("blush",)),
    ("shy_more", "羞到躲起来", "cross", "curl", None, ("blush", "hide")),
]


def state(key):
    _, _, eyes, tail, halo, extras = next(s for s in STATES if s[0] == key)
    hide = "hide" in extras
    return cat(eyes, tail, halo, extras, shy_blush="blush" in extras, sink=2 if hide else 0, ear_pink=hide, steam=hide)


def to_rows(g):
    """像素网格 → 半块字符行（和 ascii_mark.half_blocks 的输出一样）。"""
    rows = []
    for y in range(0, H, 2):
        row = []
        for x in range(W):
            top, bot = g[y][x], g[y + 1][x]
            if top is None and bot is None:
                row.append((" ", None, None))
            elif top == bot:
                row.append(("█", top, None))
            elif bot is None:
                row.append(("▀", top, None))
            elif top is None:
                row.append(("▄", bot, None))
            else:
                row.append(("▀", top, bot))
        rows.append(row)
    return rows


def preview_svg(g, bg="#1C1418", cell=1):
    rects = [f'<rect width="{W}" height="{H}" fill="{bg}"/>']
    for y in range(H):
        x = 0
        while x < W:
            c, run = g[y][x], 1
            while x + run < W and g[y][x + run] == c:
                run += 1
            if c:
                rects.append(f'<rect x="{x}" y="{y}" width="{run + 0.02:g}" height="1.02" fill="{c}"/>')
            x += run
    return f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">{"".join(rects)}</svg>'


if __name__ == "__main__":
    import ascii_mark
    out = os.path.join(os.path.dirname(__file__), "..", "05-refine", "round-15", "ascii")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "moods-48.ans"), "w", encoding="utf-8") as fh:
        for key, name, *_ in STATES:
            fh.write(f"# {key} {name}\n{ascii_mark.to_ansi(to_rows(state(key)))}\n\n")
    print("wrote", out)
