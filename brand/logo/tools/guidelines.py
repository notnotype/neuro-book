"""阶段 7：简短使用规范。生成 07-guidelines/index.html。

范围按简报第 5 节：标准色、安全留白、最小尺寸、背景使用方式与常见误用；另加各场景该用哪个成品文件，
以及装饰（腮红、封面角饰、赤星之节、光环）在各版本里画不画。
图示用 mark.py、lockup.py 现场画，不另存图片；文件链接指向 06-production/，那里的文件由 produce.py 生成。
心情差分的状态表来自 moods.py（需要 shapely）：

    uv run --no-project --with shapely python tools/guidelines.py
"""
import os
import subprocess
import sys
from html import escape

sys.path.insert(0, os.path.dirname(__file__))
import halo
import mark
from mark import CRIMSON, IVORY, INK, NIGHT, GOLD, GOLD_DEEP, PINK, f
from lockup import CLEAR, GAP_H, K_MID, MARK_BOX, MARK_FULL, MARK_H, FULL_W, FULL_H, colors_of, parts_h, parts_v, render
from produce import centered_mark, full_box

OUT = os.path.join(os.path.dirname(__file__), "..", "07-guidelines")
PROD = "../06-production"
DIM = "#2F6FD0"
BAD = "#C0392B"


# ---------- 画图 ----------
def svg(body, vb, width=None, style="", attrs=""):
    w = f' width="{width}"' if width else ""
    st = f' style="{style}"' if style else ""
    return f'<svg viewBox="{vb}"{w}{st}{attrs} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NeuroBook">{body}</svg>'


def vb_of(box, pad=0):
    x0, y0, x1, y1 = box
    return f"{f(x0 - pad)} {f(y0 - pad)} {f(x1 - x0 + 2 * pad)} {f(y1 - y0 + 2 * pad)}"


def horizontal(mark_color="crimson", wm_color=INK, **kw):
    """mark_color 是标志的颜色版本（mark.STYLES 的键；给一个颜色就按单色版画）。"""
    geo, colors = colors_of(mark_color, wm_color)
    parts, box = parts_h(geo=geo, **kw)
    return render(parts, colors, flat=True), box


def stacked(mark_color="crimson", wm_color=INK):
    geo, colors = colors_of(mark_color, wm_color)
    parts, box = parts_v(geo=geo)
    return render(parts, colors, flat=True), box


def mark_only(key):
    geo, colors = halo.style(key)
    x0, y0, x1, y1 = full_box(geo)
    side = max(x1 - x0, y1 - y0)
    return render(centered_mark(FULL_W, side / 2, side / 2, geo), colors, flat=True), (0, 0, side, side)


def tile(size=None):
    """应用图标直接引用成品文件，规范里看到的就是交付的那一份。"""
    w = f' width="{size}" height="{size}"' if size else ' class="icon"'
    return f'<img src="{PROD}/svg/app-icon/neurobook-app-icon.svg"{w} alt="NeuroBook 应用图标">'


def plain_tile():
    return f'<img class="icon" src="{PROD}/svg/app-icon/neurobook-app-icon-plain.svg" alt="NeuroBook 应用图标（不带边框）">'


def small_png(src_name, out_name, folder="app-icon"):
    """把成品 SVG 按 16px 真实像素渲染成 PNG，供误用示例放大显示（页面里放大 4 倍，看得到糊掉的像素）。"""
    src = os.path.join(OUT, PROD, "svg", folder, src_name)
    dst = os.path.join(OUT, "assets", out_name)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(["resvg", "-w", "16", "-h", "16", src, dst], check=True)
    return f"assets/{out_name}"


def label(x, y, text, size=40, color=DIM, anchor="middle"):
    return f'<text x="{f(x)}" y="{f(y)}" font-size="{size}" fill="{color}" text-anchor="{anchor}" font-family="system-ui,sans-serif">{escape(text)}</text>'


# ---------- 各节 ----------
def lockup_img(name):
    return f'<img class="lk" src="{PROD}/svg/lockup/{name}.svg" alt="NeuroBook">'


def overview():
    m, mb = mark_only("crimson")
    return f"""<div class="ov">
<figure class="wide"><div class="pv light">{lockup_img("neurobook-lockup-horizontal-badge")}</div><figcaption><b>横排组合（首选）</b>：官网头部、文档封面、宣传物料，绝大多数场合用它。浅色底上用应用图标 + 字标。</figcaption></figure>
<figure><div class="pv light">{lockup_img("neurobook-lockup-stacked-badge")}</div><figcaption><b>竖排组合</b>：方形或居中的版面，例如启动页、关于页。</figcaption></figure>
<figure><div class="pv light">{svg(m, vb_of(mb, 8))}</div><figcaption><b>标志</b>：空间不够放字，或名字已经出现在旁边时，例如标题栏、头像。</figcaption></figure>
<figure><div class="pv light">{tile()}</div><figcaption><b>应用图标</b>：赤红底块加封面边框，用在系统图标、社交头像；小尺寸用不带边框的那一版。</figcaption></figure>
</div>"""


VERSIONS = [
    ("赤红剪影", "赤红标志、墨色字标", IVORY, "crimson", INK, "浅色底上只需要剪影的地方，例如压印、烫金、很小的行内标识"),
    ("反白", "象牙标志、象牙字标", NIGHT, "ivory", IVORY, "夜色、深色或赤红底"),
    ("单色", "全部用墨", IVORY, "ink", INK, "只能印一色、黑白打印、书印"),
    ("跟随文字颜色", "currentColor", "#E9E3DC", "current", "currentColor", "界面里的图标，颜色随主题变"),
]


def versions():
    cells = []
    for name, desc, bg, mc, wc, use in VERSIONS:
        body, box = horizontal(mc, wc)
        color = "#5B4636" if mc == "current" else ""
        cells.append(f'<figure><div class="pv" style="background:{bg};{f"color:{color}" if color else ""}">{svg(body, vb_of(box, 40))}</div>'
                     f'<figcaption><b>{name}</b>：{escape(desc)}。用于{escape(use)}。</figcaption></figure>')
    for name, file, desc in (("应用图标 + 字标", "neurobook-lockup-horizontal-badge",
                              "浅色底首选。标志直接用应用图标：白猫、黑眼睛，和应用图标一模一样；官网头部、横幅、宣传物料"),
                             ("描边白猫 + 字标", "neurobook-lockup-horizontal-outline",
                              "浅色底。象牙色的猫加一圈赤红描边，没有底块、版面更轻；文档、书印、留白多的版面，不用在横幅里")):
        cells.append(f'<figure><div class="pv light">{lockup_img(file)}</div><figcaption><b>{name}</b>：{escape(desc)}。</figcaption></figure>')
    on_crimson, box = horizontal("ivory", IVORY)
    cells.append(f'<figure><div class="pv" style="background:{CRIMSON}">{svg(on_crimson, vb_of(box, 40))}</div>'
                 f'<figcaption><b>赤红底</b>：用反白版，标志和字标都是象牙色。</figcaption></figure>')
    return "".join(cells)


DECOR = [
    # (部件, 取自看板娘的什么)
    ("豆豆眼", "埋头看书的小圆点眼，猫自己很认真，看的人觉得呆萌"),
    ("水滴形耳洞", "看板娘的粉色内耳"),
    ("尾巴", "白色猫尾，从书的右边翘起来，尾尖朝上"),
    ("腮红", "看板娘的脸红"),
    ("封面角饰", "精装书的包角，金色呼应披风的金边"),
    ("赤星之节", "看板娘法杖顶上的红星金环，放在封面上"),
    ("光环", "头顶的金环，默认就带；后半圈暗一点，左后方一道高光，旁边三颗小星"),
    ("封面边框", "只在应用图标上：把赤红底块当成一本书的封面，沿边一圈细金线，正下方嵌一颗星"),
]

DECOR_RULES = [
    # (版本, 文件, 腮红, 封面角饰, 赤星之节, 光环, 尾巴和耳洞)
    ("象牙猫：应用图标、反白", "svg/app-icon/、*-ivory.svg、*-reversed.svg", "粉", "深金", "深金环、赤红星", "金环、象牙小星", "画"),
    ("赤红猫：赤红剪影", "*-crimson.svg、*-color.svg", "粉", "金", "金环，星挖空透出底色", "深金环、深金小星", "画"),
    ("描边白猫", "*-outline.svg", "粉", "深金", "深金环、赤红星", "金环加赤红描边、深金小星", "画；耳洞填粉、眼睛填赤红"),
    ("单色、跟随文字颜色", "*-ink.svg、neurobook-mark.svg 等", "不画", "不画", "整个挖空", "只画环", "画"),
    ("24px 及以下像素专用版", "svg/small/、*-24.svg、*-16.svg", "不画", "不画", "不画", "不画", "不画"),
]


def decor():
    items = "".join(f"<li><b>{escape(n)}</b>：{escape(t)}</li>" for n, t in DECOR)
    figs = []
    for key, bg, cap in (("ivory", CRIMSON, "象牙猫"), ("crimson", IVORY, "赤红猫"), ("ink", IVORY, "单色")):
        m, mb = mark_only(key)
        figs.append(f'<figure><div class="pv" style="background:{bg}">{svg(m, vb_of(mb, 6))}</div><figcaption><b>{cap}</b></figcaption></figure>')
    px = mark.pixel_svg(24, tile=True).replace("<svg ", '<svg width="96" height="96" style="image-rendering:pixelated" ', 1)
    figs.append(f'<figure><div class="pv" style="background:{IVORY}">{px}</div><figcaption><b>像素专用版</b>（24px 放大显示）</figcaption></figure>')
    rows = "".join("<tr>" + "".join(f"<td>{escape(c)}</td>" for c in r) + "</tr>" for r in DECOR_RULES)
    return f"""<ul class="decor">{items}</ul>
<div class="grid4">{"".join(figs)}</div>
<table><thead><tr><th>版本</th><th>文件</th><th>腮红</th><th>封面角饰</th><th>赤星之节</th><th>光环</th><th>尾巴、耳洞</th></tr></thead><tbody>{rows}</tbody></table>
<p class="note">一种颜色画不出腮红和角饰，所以单色版不画，赤星之节在书上挖空，光环只留一个环。赤红猫的书也是赤红，赤红星放上去看不见，所以星挖空、环用金色。
装饰按上表用成品文件，不自己增减：不给单色版补腮红和角饰，不另加蝴蝶结、耳饰之类的配饰，不把赤星之节换成别的符号。</p>"""


PALETTE = [
    ("赤红", CRIMSON, "135, 18, 34", "标志主色；应用图标底块；象牙猫封面上的星"),
    ("象牙", IVORY, "247, 242, 236", "底色；反白版的图形"),
    ("墨", INK, "46, 33, 27", "字标；单色版"),
    ("夜", NIGHT, "28, 20, 24", "深色底"),
    ("金", GOLD, "225, 178, 133", "光环、封面边框；赤红猫的角饰和环；只放在赤红或深色底上"),
    ("深金", GOLD_DEEP, "168, 118, 47", "象牙底上的金色点缀：象牙猫的角饰和环，浅色底上的光环"),
    ("粉", PINK, "242, 179, 174", "腮红；只作点缀"),
]


def palette():
    sw = "".join(f'<figure class="sw"><div style="background:{hx};color:{INK if hx in (IVORY, GOLD, PINK) else IVORY}"><b>{n}</b><code>{hx}</code></div>'
                 f'<figcaption>RGB {rgb}<br>{escape(use)}</figcaption></figure>' for n, hx, rgb, use in PALETTE)
    return f"""<div class="sws">{sw}</div>
<p class="note">对比度：象牙 / 赤红 8.8，墨 / 象牙 14.0，象牙 / 夜 16.2，金 / 赤红 5.1，深金 / 象牙 3.6，粉 / 赤红 5.5。
金色放在象牙底上只有 1.7，赤红放在夜色底上只有 1.8，这两种组合都不要用。粉色腮红在象牙猫脸上只有 1.6，是有意淡的点缀，不承担辨认。</p>"""


def clear_space():
    body, box = horizontal()
    x0, y0, x1, y1 = box
    c = CLEAR
    sm = K_MID * 100 / MARK_H
    mr = (MARK_FULL[2] - MARK_BOX[0]) * sm   # 尾巴右沿：标志和字标的间距从这里量
    ann = (f'<rect x="{f(x0 - c)}" y="{f(y0 - c)}" width="{f(x1 - x0 + 2 * c)}" height="{f(y1 - y0 + 2 * c)}" fill="none" stroke="{DIM}" stroke-width="2" stroke-dasharray="8 6"/>'
           f'<rect x="{f(x0 - c)}" y="-100" width="{c}" height="100" fill="{DIM}" opacity=".14"/>' + label(x0 - c / 2, -34, "X")
           + f'<rect x="{f(x0)}" y="{f(y0 - c)}" width="100" height="{c}" fill="{DIM}" opacity=".14"/>' + label(x0 + 50, y0 - c / 2 + 14, "X")
           + f'<rect x="{f(mr)}" y="-100" width="{GAP_H}" height="100" fill="{BAD}" opacity=".16"/>' + label(mr + GAP_H / 2, 40, "0.4X", 30, BAD))
    h = svg(ann + body, vb_of(box, c + 16))
    m, mb = mark_only("crimson")
    side = mb[2]
    q = FULL_W / 4
    m_ann = f'<rect x="{f(-q)}" y="{f(-q)}" width="{f(side + 2 * q)}" height="{f(side + 2 * q)}" fill="none" stroke="{DIM}" stroke-width=".8" stroke-dasharray="3 2"/>'
    ms = svg(m_ann + m, vb_of(mb, q + 3))
    return h, ms


def min_sizes():
    body, box = horizontal()
    w_per_cap = (box[2] - box[0]) / 100
    hw = round(w_per_cap * 11)
    v, vbx = stacked()
    px14 = mark.pixel_svg(14, tile=False, color=INK).replace("<svg ", '<svg width="14" height="14" ', 1)
    px16 = mark.pixel_svg(16, tile=True).replace("<svg ", '<svg width="16" height="16" ', 1)
    return f"""<div class="mins">
<div>{svg(body, vb_of(box), hw)}<span>横排 {hw}px 宽 · 印刷 25mm</span></div>
<div>{svg(v, vb_of(vbx), 80)}<span>竖排 80px 宽 · 印刷 20mm</span></div>
<div>{px14}<span>标志 14px · 印刷 5mm</span></div>
<div>{px16}<span>应用图标 16px</span></div>
</div>
<table><thead><tr><th>尺寸</th><th>用哪一版</th><th>文件</th></tr></thead><tbody>
<tr><td>64px 及以上</td><td>标准版；应用图标带封面边框</td><td><code>svg/mark/</code>、<code>svg/app-icon/neurobook-app-icon.svg</code></td></tr>
<tr><td>32–48px</td><td>标准版；应用图标不带边框（猫更大）</td><td><code>svg/mark/</code>、<code>svg/app-icon/neurobook-app-icon-plain.svg</code></td></tr>
<tr><td>24px</td><td>像素专用版（没有尾巴、装饰和光环）</td><td><code>svg/small/neurobook-mark-24.svg</code>、<code>svg/app-icon/neurobook-app-icon-24.svg</code></td></tr>
<tr><td>16px</td><td>像素专用版</td><td><code>svg/small/neurobook-mark-16.svg</code>、<code>svg/app-icon/neurobook-app-icon-16.svg</code></td></tr>
<tr><td>14px</td><td>像素专用版（标题栏）</td><td><code>svg/small/neurobook-mark-14.svg</code></td></tr>
</tbody></table>
<p class="note">像素专用版画在像素格上，只在 1 倍屏上用；2 倍屏上 16px 实际有 32 个像素，用标准版即可。ICO、ICNS 已经把两种尺寸都装进去，由系统挑。</p>"""


SCENES = [
    ("桌面标题栏", "svg/small/neurobook-mark-14.svg", "14px 单色，currentColor 跟随标题栏文字色；2 倍屏可用 svg/mark/neurobook-mark.svg"),
    ("浏览器标签", "web/favicon.ico", "同时引用 web/favicon.svg（不带边框）；高分屏浏览器用 SVG，其他用 ICO"),
    ("iOS 主屏、网页清单", "web/apple-touch-icon.png", "满版、不带边框；另有 web/icon-192.png、icon-512.png、icon-maskable-512.png"),
    ("Windows 应用、托盘", "desktop/windows/neurobook.ico", "16、24px 是像素专用版，32、48px 不带边框"),
    ("macOS 应用", "desktop/macos/neurobook.icns", "按 Apple 图标网格：1024 画布里 824 的底块"),
    ("Linux 应用", "desktop/linux/neurobook.svg", "另有 512px PNG"),
    ("官网头部", "svg/lockup/neurobook-lockup-horizontal-badge.svg", "深色头部用 -reversed"),
    ("启动页、关于页", "svg/lockup/neurobook-lockup-stacked-badge.svg", "版面已经很满时，标志可换成不带边框的应用图标"),
    ("社交头像", "png/app-icon/neurobook-app-icon-plain-1024.png", "不带边框：平台会裁成圆形，边框会被裁掉一截"),
    ("导出书籍的书印", "svg/lockup/neurobook-lockup-horizontal-ink.svg", "单色墨；版面很小时只用 svg/mark/neurobook-mark-ink.svg"),
    ("界面里的 Agent 头像", "animation/neurobook-mood.js", "网页组件，随 Agent 状态切换并播动画；只要静态图时用 svg/moods/ 下的心情差分，深色界面用 -dark"),
    ("终端（TUI）启动画面", "terminal/neurobook-100.ans", "80、100、120 列都可以；浅色终端用 neurobook-crimson-100.ans"),
    ("终端状态栏旁", "terminal/moods/neurobook-mood-focus-48.ans", "48 列心情差分，逐像素画；各状态行数一样"),
]


def scenes():
    rows = "".join(f'<tr><td>{escape(n)}</td><td><a href="{PROD}/{p}"><code>{escape(p)}</code></a></td><td>{escape(t)}</td></tr>' for n, p, t in SCENES)
    return f'<table><thead><tr><th>场景</th><th>文件</th><th>说明</th></tr></thead><tbody>{rows}</tbody></table>'


def moods_section():
    import moods
    cells = "".join(f'<figure><div class="pv light"><img class="icon" src="{PROD}/svg/moods/neurobook-mood-{k}.svg" alt="{escape(n)}"></div>'
                    f'<figcaption><b>{escape(n)}</b>：{escape(w)}。「{escape(c)}」</figcaption></figure>' for k, n, w, *_r, c in moods.STATES)
    import mood_parts as mp
    import mood_v4 as v4
    rows = ""
    for k, n, w, eyes, tail, halo, extras, c in moods.STATES:
        halo_name = v4.HALOS[halo][0] if halo else "—"
        extra = "、".join(v4.EXTRAS[e][0] for e in extras) or "—"
        rows += (f"<tr><td>{escape(n)}</td><td>{escape(w)}</td><td>{escape(mp.EYES[eyes][0])}</td><td>{escape(moods.TAIL_NAMES[tail])}</td>"
                 f"<td>{escape(halo_name)}</td><td>{escape(extra)}</td><td><code>neurobook-mood-{k}</code></td></tr>")
    return f"""<p class="note">标志的角色会随产品状态换心情。猫和书的大小、位置都不变，每个状态最多换四样：眼睛、尾巴、光环、一个小符号。默认标志带光环，所以每个状态都有光环（「羞到躲起来」除外）。心情差分的底块不带封面边框、猫比应用图标略小，给伸出去的尾巴和小符号留位置；各状态之间猫不会动。</p>
<div class="moods">{cells}</div>
<table><thead><tr><th>状态</th><th>产品里的状态</th><th>眼睛</th><th>尾巴</th><th>光环</th><th>小符号</th><th>文件</th></tr></thead><tbody>{rows}</tbody></table>
<ul class="rules">
<li>只放在赤红底块（<code>svg/moods/*.svg</code>）或深色底（<code>*-dark.svg</code>）上；浅色底不用：金色光环在象牙底上对比度只有 1.7。</li>
<li>48px 及以上才换状态；更小的地方用应用图标或像素专用版，不换。</li>
<li>只用这十一个状态，不自己拼新的组合，也不单拿一个部件用；要新增状态先回到设计。</li>
<li>可以加动画，但都是可选的：光环上下浮动（3.2 秒一次）；思考时流光绕着环走（2.2 秒一圈）；写作中进度从空走到满；尾巴按状态晃（平时 5 秒一次，问号尾巴 2.4 秒，竖直时轻轻抖）；约 4 秒眨一次眼；睡着时 z 往上飘。系统设了减少动画时全部停下。演示见 <a href="{PROD}/animation/demo.html">animation/demo.html</a>。</li>
</ul>"""


def animation_section():
    import mood_anim
    import moods
    rows = "".join(f"<tr><td>{escape(n)}</td><td>{escape(mood_anim.STATE_NOTES.get(k, ''))}</td></tr>" for k, n, *_ in moods.STATES)
    return f"""<div class="anim">
<figure><div class="pv light"><video class="gif" src="{PROD}/animation/video/neurobook-moods-tour.webm" autoplay loop muted playsinline></video></div>
<figcaption><b>轮播录屏</b>：<code>animation/video/neurobook-moods-tour.webm</code></figcaption></figure>
<div><table><thead><tr><th>状态</th><th>动起来是什么样</th></tr></thead><tbody>{rows}</tbody></table></div>
</div>
<ul class="rules">
<li><b>网页、应用界面</b>用组件 <code>animation/neurobook-mood.js</code>：<code>&lt;neurobook-mood state="think"&gt;</code>，改 <code>state</code> 就播切换动画（眨眼换眼型、尾巴变形、光环落下、小符号弹出）；空闲时跟着鼠标看。演示见 <a href="{PROD}/animation/demo.html">animation/demo.html</a>。</li>
<li><b>不能跑脚本的地方</b>（README、文档）用 <code>animation/loop/</code> 的循环动画 SVG，当图片用；没有切换动画和跟随鼠标。聊天、社交媒体用录屏。</li>
<li>动画都是锦上添花：静态的心情差分是底，系统设了减少动画时一律停下。动画和静态是同一套十一个状态，颜色、摆放都一样。</li>
<li>改动画、加状态按 <code>animation/README.md</code> 的三层来：动作表、状态表、播放；改完重新运行 <code>tools/produce.py</code>，不要手改导出的文件。</li>
</ul>"""


def terminal_section():
    items = [("terminal/neurobook-100.ans", "100 列 · 深色终端", "另有 80、120 列"), ("terminal/neurobook-crimson-100.ans", "100 列 · 浅色终端", "赤红猫"),
             ("terminal/moods/neurobook-mood-focus-48.ans", "48 列 · 专注", "心情差分，逐像素画"), ("terminal/moods/neurobook-mood-ask-48.ans", "48 列 · 等你选择", "")]
    cells = "".join(f'<figure><div class="pv term"><img src="{PROD}/{p.replace("terminal/", "terminal/preview/").rsplit(".", 1)[0]}.svg" alt=""></div>'
                    f'<figcaption><b>{escape(n)}</b>{"：" + escape(note) if note else ""}<br><code>{escape(p)}</code></figcaption></figure>' for p, n, note in items)
    return f"""<div class="grid">{cells}</div>
<p class="note">终端版本用半块字符（▀ ▄ █）画，每格上下两个像素，颜色是 24 位色的 ANSI 转义；用 <code>cat</code> 输出就是彩色。需要终端支持 24 位色、字体有方块字符。
标准标志 80、100、120 列效果一样，按窗口宽度挑；48 列的心情差分是逐像素画的（<code>tools/pixel_moods.py</code>），十一个状态都是 48 列 × 30 行，切换时不跳。</p>"""


def halo_rules():
    return f"""<div class="halo2"><figure><div class="pv light">{tile()}</div><figcaption><b>带封面边框</b>：默认的应用图标，64px 及以上。猫宽占底块 68%。</figcaption></figure>
<figure><div class="pv light">{plain_tile()}</div><figcaption><b>不带边框</b>：32–48px、会被裁成圆形或系统自己加圆角的地方、版面已经很满的时候。猫宽占底块 75%。</figcaption></figure>
<ul>
<li>光环是标志的一部分，默认就带：金环，后半圈暗一点，左后方一道高光，旁边三颗小星。不单独拿掉，也不换形状。</li>
<li>光环用金色，放在赤红或深色底上；象牙底上换深金；单色版和猫同色、只画环。24px 及以下的像素专用版不画光环（会糊成一道线）。</li>
<li>组合里标志的大小和对齐仍按猫头加书算，光环和尾巴一样从外框伸出去；留白从光环顶和尾巴右沿往外量。</li>
<li>封面边框只用在应用图标上：细金线离底块边缘 6%，正下方断开嵌一颗四角星。不换成别的边框，不加在心情差分上。</li>
</ul></div>"""


def misuse():
    h, box = horizontal()
    vb = vb_of(box, 40)
    items = []

    def add(title, pv, bg=IVORY):
        items.append(f'<figure class="bad"><div class="pv" style="background:{bg}">{pv}</div><figcaption><span>×</span>{escape(title)}</figcaption></figure>')

    add("拉伸或压扁", svg(h, vb, attrs=' preserveAspectRatio="none" class="stretch"'))
    add("旋转或倾斜", svg(f'<g transform="rotate(-8 {f((box[0] + box[2]) / 2)} -50)">{h}</g>', vb))
    recolor, _ = horizontal("#2F6FD0", "#3D8B5E")
    add("换成标准色以外的颜色", svg(recolor, vb))
    gold_on_ivory, _ = horizontal(GOLD, GOLD)
    add("金色放在象牙底上", svg(gold_on_ivory, vb))
    crimson_on_night, _ = horizontal("crimson", CRIMSON)
    add("赤红放在深色底上", svg(crimson_on_night, vb), NIGHT)
    mono_deco, _ = horizontal(("cutout", dict(mark=INK, blush=PINK, corners=GOLD, ring=GOLD)), INK)
    add("单色版补画腮红、角饰", svg(mono_deco, vb))
    m, mb = mark_only("crimson")
    add("换字体、自己重新排字", f'<div class="retype">{svg(m, vb_of(mb), 44)}<span>NeuroBook</span></div>')
    big, bbox = horizontal(k=2.4, gap=120)
    add("改变标志大小或间距", svg(big, vb_of(bbox, 40)))
    fx = (f'<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="6" dy="10" stdDeviation="6" flood-opacity=".45"/></filter></defs>'
          f'<g filter="url(#sh)">{horizontal("crimson", INK)[0]}</g>')
    add("加阴影、描边或渐变", svg(fx, vb))
    add("放在杂乱的背景上", svg(h, vb), "repeating-linear-gradient(45deg,#C9A27E 0 10px,#8FB3C9 10px 20px,#E7D5B8 20px 30px)")
    tiny = "".join(f'<figure class="px"><img src="{src}" width="64" height="64" alt=""><figcaption>{escape(cap)}</figcaption></figure>' for src, cap in (
        (small_png("neurobook-app-icon.svg", "std-16.png"), "标准版缩到 16px"),
        (f"{PROD}/png/app-icon/neurobook-app-icon-16.png", "应该用：像素专用版")))
    add("小尺寸直接缩小标准版", f'<div class="tiny">{tiny}</div>')
    return "".join(items)


CSS = f"""
:root{{--ivory:{IVORY};--paper:#FBF8F4;--line:#E4D9CC;--ink:{INK};--muted:#7A6A5E;--night:{NIGHT};--crimson:{CRIMSON}}}
*{{box-sizing:border-box}}
body{{margin:0;background:#EDE5DA;color:var(--ink);font:14px/1.7 system-ui,"PingFang SC","Noto Sans CJK SC",sans-serif}}
main{{max-width:1080px;margin:0 auto;padding:40px 16px 80px}}
h1{{font-size:30px;margin:0 0 6px}}
h2{{font-size:21px;margin:44px 0 10px;padding-top:18px;border-top:2px solid var(--line)}}
a{{color:var(--crimson)}} code{{font-size:12px;word-break:break-all}}
.lede{{color:var(--muted);max-width:820px;margin:0}}
.note{{color:var(--muted);font-size:13px;max-width:820px}}
.box{{background:var(--paper);border:1px solid var(--crimson);border-radius:14px;padding:14px 18px;margin:22px 0 0}}
.box ul{{margin:0;padding-left:20px}}
figure{{margin:0;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px}}
figcaption{{font-size:13px;color:var(--muted);margin-top:8px}} figcaption b{{color:var(--ink)}}
.pv{{display:grid;place-items:center;min-height:130px;border-radius:8px;padding:14px;overflow:hidden}}
.pv svg{{width:100%;height:auto;max-height:150px;display:block}}
.light{{background:var(--ivory)}}
.ov{{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:10px}}
.sws{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(150px,100%),1fr));gap:10px}}
.sw{{padding:0;border:0;background:none}} .sw div{{height:92px;border-radius:12px;padding:12px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line)}}
.sw b{{font-size:16px}} .sw code{{font-size:13px}}
.clear{{display:grid;grid-template-columns:3fr 1fr;gap:10px;align-items:start}}
.clear svg{{width:100%;height:auto;display:block;background:var(--ivory);border-radius:8px}}
.mins{{display:flex;flex-wrap:wrap;align-items:flex-end;gap:30px;background:var(--ivory);border:1px solid var(--line);border-radius:12px;padding:20px}}
.mins div{{display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--muted)}} .mins svg{{display:block}}
table{{border-collapse:collapse;width:100%;font-size:13px;background:var(--paper);border:1px solid var(--line);border-radius:12px;margin-top:12px;display:block;overflow-x:auto}}
th,td{{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}} th{{color:var(--muted);white-space:nowrap}}
tbody tr:last-child td{{border-bottom:0}}
.halo2{{display:grid;grid-template-columns:200px 200px 1fr;gap:12px;align-items:start}} .halo2 ul{{margin:0;padding-left:20px}}
.bad figcaption span{{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:{BAD};color:#fff;font-weight:700;margin-right:6px}}
.stretch{{height:120px!important;max-height:120px}}
.retype{{display:flex;align-items:center;gap:10px;font:400 36px/1 Arial,Helvetica,sans-serif;color:{INK}}}
.tiny{{display:flex;gap:10px;align-items:flex-start}} .tiny .px{{border:0;padding:0;background:none;text-align:center}} .tiny img{{display:block;image-rendering:pixelated;margin:0 auto}} .tiny figcaption{{font-size:11px;margin-top:4px}}
.pv img.icon{{width:130px;height:130px;display:block}}
.pv img.lk{{width:100%;max-height:150px;object-fit:contain;display:block}}
.moods{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(180px,100%),1fr));gap:10px;margin-bottom:12px}}
.pv.term{{background:var(--night)}} .pv.term img{{max-width:100%;max-height:220px;display:block;image-rendering:pixelated}}
.rules{{max-width:820px;padding-left:20px}}
.anim{{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:12px;align-items:start}}
.anim img.gif,.anim video.gif{{width:100%;max-width:240px;display:block;margin:0 auto}}
@media (max-width:760px){{.anim{{grid-template-columns:1fr}}}}
.decor{{margin:0 0 12px;padding-left:20px;max-width:820px}}
.grid4{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:10px}}
@media (max-width:760px){{.ov,.clear,.halo2{{grid-template-columns:1fr}} .halo2 figure{{max-width:220px}}}}
"""


def build():
    h, ms = clear_space()
    html = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NeuroBook 标识规范</title>
<link rel="icon" href="{PROD}/web/favicon.ico" sizes="32x32"><link rel="icon" href="{PROD}/web/favicon.svg" type="image/svg+xml">
<style>{CSS}</style></head><body><main>
<h1>NeuroBook 标识使用规范</h1>
<p class="lede">NeuroBook 的标志是一只从书后探出头、埋头看书的白猫，头顶一个金色光环：书是你的作品，猫是陪你写的伙伴。尾巴从书边翘起来，封面上是看板娘法杖上的赤星之节。本页说明怎么用标志、组合、心情差分、动画和终端版本；所有文件在 <a href="{PROD}/index.html">06-production</a>。2026-10-03。</p>
<div class="box"><ul>
<li>首选横排组合；浅色底用应用图标 + 字标，深色或赤红底用反白。</li>
<li>只用成品文件，不重画、不换字体、不改比例和颜色，不增减装饰。</li>
<li>四周留出至少一个大写高 X 的空白；应用图标 64px 以下用不带边框的，32px 以下换像素专用版；桌面应用的图标（Windows 的 ICO、任务栏、托盘）例外，只放 32px 及以上，小尺寸由系统缩放。</li>
</ul></div>

<h2>标志与组合</h2>
{overview()}

<h2>颜色版本</h2>
<div class="grid">{versions()}</div>

<h2>装饰</h2>
{decor()}

<h2>标准色</h2>
{palette()}

<h2>安全留白</h2>
<div class="clear"><figure>{h}<figcaption>组合四周至少留 X（字标的大写高），标志与字标之间固定为 0.4X。</figcaption></figure>
<figure>{ms}<figcaption>单独用标志时，四周至少留标志宽度的四分之一。</figcaption></figure></div>

<h2>最小尺寸</h2>
{min_sizes()}

<h2>各场景用哪个文件</h2>
<p class="note">路径相对于 06-production/。</p>
{scenes()}

<h2>光环与封面边框</h2>
{halo_rules()}

<h2>心情差分</h2>
{moods_section()}

<h2>动画</h2>
{animation_section()}

<h2>终端</h2>
{terminal_section()}

<h2>常见误用</h2>
<div class="grid">{misuse()}</div>

<h2>来源</h2>
<p class="note">设计简报见 <a href="../01-brief.md">01 简报</a>；早期探索草图（02–05）与前两次交付归档在开发者本地 <code>.local/brand/logo-archive/</code>。
字标由 Fraunces（SIL Open Font License）700 转曲，文件里不含字体。成品由 <code>tools/produce.py</code> 生成，几何来自 <code>tools/mark.py</code>、<code>tools/halo.py</code>、<code>tools/lockup.py</code>。</p>
</main></body></html>"""
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "index.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("wrote", path)


if __name__ == "__main__":
    build()
