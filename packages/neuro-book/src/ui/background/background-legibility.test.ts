/** 背景的可读性计算（docs/specs/ui/backgrounds.md 输出 5、7）：用主题的真实配色值。 */
import {describe, expect, it} from "bun:test";

import {BACKGROUND_COLOR_PRESETS, blend, colorIsLegible, contrast, MIN_CONTRAST, parseColor, scrimFloor, WORST_CASE_EXTREMES} from "./background-legibility";
import type {Rgb, TextRole} from "./background-legibility";

const rgb = (hex: string): Rgb => {
    const parsed = parseColor(hex);
    if (parsed === null) throw new Error(hex);
    return parsed.rgb;
};
const dark = {surface: rgb("#2d2925"), roles: [{color: rgb("#efe9df")}, {color: rgb("#c3bcb0")}, {color: rgb("#5eb0ff")}, {color: rgb("#efe9df"), over: {color: rgb("#ff9f0a"), alpha: 0.32}}] satisfies TextRole[]};
const light = {surface: rgb("#fffcf5"), roles: [{color: rgb("#1f1c17")}, {color: rgb("#57534b")}, {color: rgb("#0060df")}, {color: rgb("#1f1c17"), over: {color: rgb("#9a5b00"), alpha: 0.32}}] satisfies TextRole[]};

describe("颜色解析", () => {
    it.each([
        ["#ff8000", [255, 128, 0], 1],
        ["rgb(255, 128, 0)", [255, 128, 0], 1],
        ["rgba(255, 128, 0, 0.5)", [255, 128, 0], 0.5],
        ["rgb(255 128 0 / 0.5)", [255, 128, 0], 0.5],
        ["color(srgb 1 0.5 0 / 0.25)", [255, 127.5, 0], 0.25],
    ])("%s", (text, color, alpha) => {
        expect(parseColor(text)).toEqual({rgb: color as unknown as Rgb, alpha});
    });
    it("看不懂的是 null", () => {
        expect(parseColor("oklch(0.5 0.1 200)")).toBeNull();
    });
});

describe("遮罩下限", () => {
    it("模糊时温和的图用模式下限", () => {
        const extremes = {lightest: [235, 235, 225] as Rgb, darkest: [190, 195, 180] as Rgb};
        expect(scrimFloor({...light, extremes, blur: true})).toBe(75);
    });

    it("不模糊时不低于 92：比值够也不行，细节会和字混在一起", () => {
        const extremes = {lightest: [120, 130, 110] as Rgb, darkest: [90, 100, 85] as Rgb};
        expect(scrimFloor({...light, extremes, blur: false})).toBeGreaterThanOrEqual(92);
    });

    it("最坏的图上算出来的下限，每种文字在最亮、最暗处都够", () => {
        for (const theme of [dark, light]) {
            const floor = scrimFloor({...theme, extremes: WORST_CASE_EXTREMES, blur: true});
            expect(floor).toBeGreaterThan(75);
            for (const extreme of [WORST_CASE_EXTREMES.lightest, WORST_CASE_EXTREMES.darkest]) {
                const background = blend(theme.surface, extreme, floor / 100);
                for (const role of theme.roles) {
                    const under = role.over === undefined ? background : blend(role.over.color, background, role.over.alpha);
                    expect(contrast(role.color, under)).toBeGreaterThanOrEqual(MIN_CONTRAST);
                }
            }
        }
    });

    it("实心面上本来就到不了 4.5 的角色不把下限顶到 100", () => {
        const muted = {color: rgb("#918a7e")};
        expect(contrast(muted.color, dark.surface)).toBeLessThan(MIN_CONTRAST);
        expect(scrimFloor({surface: dark.surface, roles: [...dark.roles, muted], extremes: WORST_CASE_EXTREMES, blur: true})).toBeLessThan(100);
    });
});

describe("纯色底", () => {
    const roles = (theme: typeof light | typeof dark): TextRole[] => theme.roles.slice(0, 3);
    it("预设都合格", () => {
        for (const preset of BACKGROUND_COLOR_PRESETS) {
            expect(colorIsLegible(rgb(preset.light), roles(light)), preset.id).toBe(true);
            expect(colorIsLegible(rgb(preset.dark), roles(dark)), preset.id).toBe(true);
        }
    });
    it("浅色主题上的深色不合格，反过来也一样", () => {
        expect(colorIsLegible(rgb("#2a2520"), roles(light))).toBe(false);
        expect(colorIsLegible(rgb("#f4ecd8"), roles(dark))).toBe(false);
    });
});
