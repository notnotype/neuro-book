"""NeuroBook 字标转曲：Fraunces 固定一组轴值，HarfBuzz 排字（保留字体自带的字距对），导出字形轮廓为 SVG 路径。

需要 fontTools 与 uharfbuzz，不在系统 Python 里；用 uv 临时环境运行：
    uv run --no-project --with fonttools --with uharfbuzz python tools/wordmark.py
结果写进 tools/wordmark.json，mark.py 和各页面只读这个 JSON，不再依赖字体文件。
"""
import io
import json
import os

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(__file__)
FONT = os.environ.get("NEUROBOOK_FRAUNCES_FONT") or os.path.join(HERE, "..", "..", "..", ".local", "brand", "logo-archive", "fonts", "Fraunces.ttf")
OUT = os.path.join(HERE, "wordmark.json")

TEXT = "NeuroBook"
# 精修第一轮选定 W2：字重 700、SOFT 拉满、关掉 WONK、光学尺寸 72。
AXES = {"wght": 700, "SOFT": 100, "WONK": 0, "opsz": 72}
# 额外字距，单位是千分之一 em；本轮比较几档，选定的一档见 TRACKING_CHOSEN。
TRACKINGS = [0, -10, -20, -30]
TRACKING_CHOSEN = -10


def instance():
    font = TTFont(FONT)
    static = instantiateVariableFont(font, AXES)
    buf = io.BytesIO()
    static.save(buf)
    return static, buf.getvalue()


def shape(data, text):
    face = hb.Face(data)
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False})
    return buf.glyph_infos, buf.glyph_positions


def outline(static, infos, positions, tracking):
    """字形轮廓拼成一条路径，y 轴翻转成 SVG 方向，基线在 y=0。"""
    upm = static["head"].unitsPerEm
    order = static.getGlyphOrder()
    gs = static.getGlyphSet()
    track = tracking * upm / 1000
    pen = SVGPathPen(gs)
    bounds = BoundsPen(gs)
    x = 0
    glyphs = []
    for i, (info, pos) in enumerate(zip(infos, positions)):
        name = order[info.codepoint]
        t = (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)
        gs[name].draw(TransformPen(pen, t))
        gs[name].draw(TransformPen(bounds, t))
        gb = BoundsPen(gs)
        gs[name].draw(TransformPen(gb, t))
        glyphs.append({"name": name, "x": x, "advance": pos.x_advance, "bounds": gb.bounds})
        x += pos.x_advance + (track if i < len(infos) - 1 else 0)
    return {
        "d": pen.getCommands(),
        "bounds": bounds.bounds,              # (xmin, ymin, xmax, ymax)，SVG 方向
        "advance": x,
        "upm": upm,
        # OS/2 里的值是默认实例的；这里量实际字形：N 的平顶是大写高，u 的平顶是小写高。
        "cap": -next(g["bounds"][1] for g in glyphs if g["name"] == "N"),
        "xheight": -next(g["bounds"][1] for g in glyphs if g["name"] == "u"),
        "glyphs": glyphs,
    }


def main():
    static, data = instance()
    infos, positions = shape(data, TEXT)
    result = {"axes": AXES, "text": TEXT, "chosen": TRACKING_CHOSEN,
              "tracking": {str(t): outline(static, infos, positions, t) for t in TRACKINGS}}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False)
    r = result["tracking"][str(TRACKING_CHOSEN)]
    print("wrote", OUT, "upm", r["upm"], "cap", r["cap"], "x", r["xheight"], "bounds", [round(v) for v in r["bounds"]])
    print([(g["name"], g["advance"]) for g in r["glyphs"]])


if __name__ == "__main__":
    main()
