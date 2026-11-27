/** 描边框与说明框的几何、主题的兜底（docs/specs/agent/page-agent.md 输出 9、10）；画到页面上的样子在 `e2e/guide.e2e.ts`。 */

import {describe, expect, test} from "bun:test";

import {edgeAnchor, frameClip, frameFor} from "./geometry";
import {GUIDE_THEME_DEFAULTS, themeDeclarations} from "./theme";

const viewport = {left: 0, top: 0, right: 1280, bottom: 800};

describe("描边框", () => {
    test("放得下时画在外侧 3px，圆角跟着外扩；不到 28 的边按 28 画、中心不变", () => {
        expect(frameFor({left: 100, top: 100, right: 220, bottom: 132}, viewport, 6)).toEqual({box: {left: 97, top: 97, right: 223, bottom: 135}, inside: false, radius: 9});
        expect(frameFor({left: 100, top: 100, right: 110, bottom: 110}, viewport, 0).box).toEqual({left: 88, top: 88, right: 122, bottom: 122});
    });

    test("外侧的描边会伸出可见区域（贴着边）时画在里面 2px；圆角不超过短边的一半", () => {
        const panel = frameFor({left: 0, top: 40, right: 300, bottom: 800}, viewport, 0);
        expect(panel).toEqual({box: {left: 2, top: 42, right: 298, bottom: 798}, inside: true, radius: 0});
        // 离边 5px 正好放得下描边（间隙 3 加描边 2），离 4px 就放不下。
        expect(frameFor({left: 5, top: 100, right: 100, bottom: 140}, viewport, 0).inside).toBe(false);
        expect(frameFor({left: 4, top: 100, right: 100, bottom: 140}, viewport, 0).inside).toBe(true);
        expect(frameFor({left: 100, top: 100, right: 140, bottom: 130}, viewport, 999).radius).toBe(18);
    });

    test("裁剪多边形以描边框自己的左上角为原点，把可见区域外扩描边与晕的宽度", () => {
        const frame = frameFor({left: 100, top: 100, right: 200, bottom: 140}, viewport, 0);
        expect(frameClip(frame, {left: 0, top: 120, right: 400, bottom: 400})).toBe("polygon(-108px 12px, 314px 12px, 314px 314px, -108px 314px)");
    });
});

describe("目标滚出可见区域时说明框贴的边", () => {
    const visible = {left: 100, top: 100, right: 500, bottom: 400};
    test("目标在哪边就贴哪条边，说明框朝里放；目标中心夹进区域", () => {
        expect(edgeAnchor({left: 300, top: 0, right: 340, bottom: 30}, visible)).toEqual({box: {left: 320, right: 320, top: 100, bottom: 100}, side: "bottom"});
        expect(edgeAnchor({left: 600, top: 500, right: 640, bottom: 530}, visible)).toEqual({box: {left: 500, right: 500, top: 400, bottom: 400}, side: "top"});
        expect(edgeAnchor({left: 0, top: 200, right: 40, bottom: 230}, visible)).toEqual({box: {left: 100, right: 100, top: 215, bottom: 215}, side: "right"});
        expect(edgeAnchor({left: 700, top: 200, right: 740, bottom: 230}, visible)).toEqual({box: {left: 500, right: 500, top: 215, bottom: 215}, side: "left"});
    });
});

describe("主题", () => {
    test("宿主给的值写成 --pa-* 自定义属性；没给、空白或带会断开样式表的字符的用兜底值", () => {
        const css = themeDeclarations({accent: "var(--accent-main)", text: "  ", surface: "red; } body { color: red"});
        expect(css).toContain("--pa-accent: var(--accent-main);");
        expect(css).toContain(`--pa-text: ${GUIDE_THEME_DEFAULTS.text};`);
        expect(css).toContain(`--pa-surface: ${GUIDE_THEME_DEFAULTS.surface};`);
        expect(css).toContain(`--pa-text-secondary: ${GUIDE_THEME_DEFAULTS.textSecondary};`);
        expect(css).not.toContain("body");
    });
});
