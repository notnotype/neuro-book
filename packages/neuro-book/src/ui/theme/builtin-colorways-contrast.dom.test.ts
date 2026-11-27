/**
 * 内置配色的对比度（nb-ui 设计语言“五、颜色角色”的“对比度”，WCAG 2.2 AA）。放在 dom 测试里：主题包的入口带着 CSS 与 DOM 类型，
 * 只有前端的 Vite 配置收得下。
 */
import {describe, expect, it} from "vitest";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";

import {composite, contrast, parseColor} from "./color";
import type {Rgba} from "./color";
import {checkContrast} from "./contrast-checks";

// 用主题编辑器同一段计算，内置配色和用户自己的配色按同一把尺子量。
const BUILTIN = [
    ...Object.entries(nbookTheme.colorways ?? {}),
    ...Object.entries(macosTheme.colorways ?? {}),
] as ReadonlyArray<readonly [string, Readonly<Record<string, string | undefined>>]>;

const solid = (colors: Readonly<Record<string, string | undefined>>, name: string): Rgba => {
    const value = colors[name];
    const color = value === undefined ? null : parseColor(value);
    if (color === null) throw new Error(`${name} 读不懂：${String(value)}`);
    return color;
};

describe("内置配色的对比度", () => {
    it("四种内置组合都在", () => {
        expect(BUILTIN.map(([id]) => id).sort()).toEqual(["macos-dark", "macos-light", "nbook-dark", "nbook-light"]);
    });

    for (const [id, colors] of BUILTIN) {
        it(`${id}：文字类变量对它们落的每个底都不低于 4.5`, () => {
            const failing = checkContrast(colors)
                .filter((check) => check.ok !== true)
                .map((check) => `${check.key} 对 ${String(check.against)} 只有 ${check.ratio?.toFixed(2) ?? "（读不懂）"}`);
            expect(failing).toEqual([]);
        });

        it(`${id}：焦点外框对面板不低于 3`, () => {
            // `--focus-outline` 是强调色与控件描边的混色（tokens.css）；描边按配色的 `--border-color`，与 tokens.css 的回退一致。
            const panel = solid(colors, "--bg-panel");
            const accent = solid(colors, "--accent-main");
            const border = composite(solid(colors, "--border-color"), panel);
            const outline = {r: accent.r * 0.8 + border.r * 0.2, g: accent.g * 0.8 + border.g * 0.2, b: accent.b * 0.8 + border.b * 0.2, a: 1};
            expect(contrast(outline, panel)).toBeGreaterThanOrEqual(3);
        });
    }
});
