/**
 * 颜色计算的对比度调整（docs/specs/theme/editor.md 输出 7）：方向由“哪一端能达标”决定，判断按取整后的颜色，背景可以随候选变。
 */

import {describe, expect, it} from "bun:test";

import {contrast, ensureContrast, formatColor, parseColor} from "./color";
import type {Rgba} from "./color";

const color = (value: string): Rgba => parseColor(value) as Rgba;

describe("ensureContrast", () => {
    it("中灰底：黑字能达标就往黑调，不是往白（曾返回只有 3.54 的白字）", () => {
        const result = ensureContrast(color("#777777"), [color("#888888")], 4.5);
        expect(contrast(result, color("#888888"))).toBeGreaterThanOrEqual(4.5);
        expect(result.r).toBeLessThan(120);
    });

    it("两端都行时留在前景原来偏的那一侧", () => {
        const light = ensureContrast(color("#9a9a9a"), [color("#202020")], 4.5);
        expect(light.r).toBeGreaterThan(150);
        const dark = ensureContrast(color("#606060"), [color("#f0f0f0")], 4.5);
        expect(dark.r).toBeLessThan(100);
    });

    it("没有任何颜色能同时满足两个背景：返回更好的那一端，不假装达标", () => {
        const result = ensureContrast(color("#777777"), [color("#767676"), color("#797979")], 7);
        expect([formatColor(result)]).toEqual(["#000000"]);
    });

    it("背景随候选变（状态色的底是它自己叠出来的）：按候选自己的底判断", () => {
        const panel = color("#ffffff");
        const result = ensureContrast(color("#ff0000"), (candidate) => [{...candidate, a: 0.12}].map((tint) => ({r: tint.r * 0.12 + panel.r * 0.88, g: tint.g * 0.12 + panel.g * 0.88, b: tint.b * 0.12 + panel.b * 0.88, a: 1})), 4.5);
        const final = parseColor(formatColor(result)) as Rgba;
        const tinted = {r: final.r * 0.12 + 255 * 0.88, g: final.g * 0.12 + 255 * 0.88, b: final.b * 0.12 + 255 * 0.88, a: 1};
        expect(contrast(final, tinted)).toBeGreaterThanOrEqual(4.5);
    });
});
