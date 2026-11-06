import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway-contract";
import {describe, expect, it} from "bun:test";

import {composite, contrast, formatColor, parseColor} from "./color";
import type {Rgba} from "./color";
import {derivePalette, MINIMUM_TEXT_CONTRAST, mirrorSeed} from "./derive-palette";
import type {PaletteSeed} from "./derive-palette";

const color = (value: string | undefined): Rgba => parseColor(value ?? "") as Rgba;

const SEEDS: ReadonlyArray<[string, PaletteSeed]> = [
    ["书房亮色", {background: "#f3ead8", text: "#2e261c", accent: "#8a5a24", appearance: "light"}],
    ["书房暗色", {background: "#241c15", text: "#efe4d0", accent: "#e0ac62", appearance: "dark"}],
    ["白底蓝强调", {background: "#ffffff", text: "#111111", accent: "#2563eb", appearance: "light"}],
    ["纯黑底", {background: "#000000", text: "#ffffff", accent: "#22c55e", appearance: "dark"}],
    ["文字太浅的亮色", {background: "#f5f5f5", text: "#bbbbbb", accent: "#fbbf24", appearance: "light"}],
    ["文字太深的暗色", {background: "#1a1a1a", text: "#555555", accent: "#7c3aed", appearance: "dark"}],
];

describe("颜色解析", () => {
    it("认 #rgb、#rrggbb、#rrggbbaa 与逗号写法，其它写法读不懂", () => {
        expect(parseColor("#fa0")).toEqual({r: 255, g: 170, b: 0, a: 1});
        expect(parseColor("#8a5a2480")?.a).toBeCloseTo(0.5, 1);
        expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({r: 10, g: 20, b: 30, a: 0.5});
        for (const text of ["red", "hsl(10, 20%, 30%)", "color-mix(in srgb, #fff 50%, #000)", "#12", "rgb(300, 0, 0)"]) expect(parseColor(text), text).toBeNull();
    });

    it("对比度按 WCAG：黑白 21，同色 1", () => {
        expect(contrast(color("#000"), color("#fff"))).toBeCloseTo(21, 5);
        expect(contrast(color("#777"), color("#777"))).toBeCloseTo(1, 5);
    });
});

describe("推导整套配色", () => {
    it.each(SEEDS)("%s：33 个变量都有值，文字类对各底色不低于 4.5", (_name, seed) => {
        const palette = derivePalette(seed);
        expect(palette).not.toBeNull();
        if (palette === null) return;
        expect(Object.keys(palette).sort()).toEqual([...nbColorwayVarKeys].sort());
        expect(palette["--color-scheme"]).toBe(seed.appearance);
        const surfaces = ["--bg-main", "--bg-panel", "--bg-sidebar", "--bg-hover"].map((key) => color(palette[key as keyof typeof palette]));
        for (const key of ["--text-main", "--text-secondary", "--text-muted", "--accent-text", "--status-info", "--status-success", "--status-warning", "--status-danger"] as const) {
            for (const surface of surfaces) expect(contrast(color(palette[key]), surface), `${key} 对 ${formatColor(surface)}`).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        }
        // 链接落在强调色的底上，状态色落在各自的底上，也要读得动。
        const panel = color(palette["--bg-panel"]);
        expect(contrast(color(palette["--accent-text"]), composite(color(palette["--accent-bg"]), panel))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        for (const kind of ["info", "success", "warning", "danger"] as const) {
            expect(contrast(color(palette[`--status-${kind}`]), composite(color(palette[`--status-${kind}-bg`]), panel)), kind).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        }
    });

    it("面板比背景亮；用户给的够好的文字色原样保留", () => {
        const light = derivePalette({background: "#f3ead8", text: "#2e261c", accent: "#8a5a24", appearance: "light"});
        const dark = derivePalette({background: "#241c15", text: "#efe4d0", accent: "#e0ac62", appearance: "dark"});
        for (const palette of [light, dark]) {
            const [main, panel] = [color(palette?.["--bg-main"]), color(palette?.["--bg-panel"])];
            expect(panel.r + panel.g + panel.b).toBeGreaterThan(main.r + main.g + main.b);
        }
        expect(light?.["--text-main"]).toBe("#2e261c");
        expect(dark?.["--text-main"]).toBe("#efe4d0");
    });

    it("同样的种子得到同样的结果；种子读不懂或带透明度时没有结果", () => {
        const seed = SEEDS[0]?.[1] as PaletteSeed;
        expect(derivePalette(seed)).toEqual(derivePalette(seed));
        expect(derivePalette({...seed, accent: "teal"})).toBeNull();
        expect(derivePalette({...seed, background: "rgba(0, 0, 0, 0.5)"})).toBeNull();
    });
});

describe("从另一套明暗换算主色", () => {
    it("亮换暗：背景变暗、文字变亮，色相保持，再推导得到合格的整套", () => {
        const light: PaletteSeed = {background: "#f3ead8", text: "#2e261c", accent: "#8a5a24", appearance: "light"};
        const dark = mirrorSeed(light, "dark");
        expect(dark?.appearance).toBe("dark");
        const [bg, text, accent] = [color(dark?.background), color(dark?.text), color(dark?.accent)];
        expect(bg.r + bg.g + bg.b).toBeLessThan(200);
        expect(text.r + text.g + text.b).toBeGreaterThan(550);
        expect(contrast(accent, bg)).toBeGreaterThan(4.5);
        const palette = dark === null ? null : derivePalette(dark);
        expect(palette).not.toBeNull();
        expect(contrast(color(palette?.["--text-main"]), color(palette?.["--bg-panel"]))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    });

    it("同一明暗原样返回；读不懂的颜色没有结果", () => {
        const seed = SEEDS[0]?.[1] as PaletteSeed;
        expect(mirrorSeed(seed, "light")).toEqual(seed);
        expect(mirrorSeed({...seed, text: "teal"}, "dark")).toBeNull();
    });
});
