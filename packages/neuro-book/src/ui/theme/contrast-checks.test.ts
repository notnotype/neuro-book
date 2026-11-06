import {describe, expect, it} from "bun:test";

import {checkContrast, CONTRAST_KEYS, contrastGrade} from "./contrast-checks";
import {derivePalette} from "./derive-palette";

describe("配色的对比度检查", () => {
    const palette = derivePalette({background: "#f3ead8", text: "#2e261c", accent: "#8a5a24", appearance: "light"}) as Record<string, string>;

    it("推导出的整套每一项都有比值且不低于 4.5", () => {
        const checks = checkContrast(palette);
        expect(checks.map((check) => check.key)).toEqual([...CONTRAST_KEYS]);
        for (const check of checks) {
            expect(check.ratio, check.key).not.toBeNull();
            expect(check.ok, check.key).toBe(true);
        }
    });

    it("把弱化文字改成接近背景的颜色：这一项不合格，并写明落在哪个底上最差", () => {
        const checks = checkContrast({...palette, "--text-muted": "#e8dfcc"});
        const muted = checks.find((check) => check.key === "--text-muted");
        expect(muted?.ok).toBe(false);
        expect(muted?.ratio).toBeLessThan(4.5);
        expect(muted?.against).toMatch(/^--bg-/u);
        expect(checks.filter((check) => check.ok === false).map((check) => check.key)).toEqual(["--text-muted"]);
    });

    it("样张取的是最差那个底色的实色：半透明的状态底已经叠在面板上", () => {
        const checks = checkContrast({...palette, "--bg-panel": "#ffffff", "--status-info-bg": "rgba(0, 0, 0, 0.5)", "--status-info": "#000000"});
        const info = checks.find((check) => check.key === "--status-info");
        expect(info?.against).toBe("--status-info-bg 叠在 --bg-panel");
        expect(info?.sample).toEqual({foreground: "#000000", surface: "#808080"});
    });

    it("等级：4.5 以下不合格，4.5 到 7 是 AA，7 以上是 AAA，边界归上一档", () => {
        expect([4.49, 4.5, 6.99, 7].map(contrastGrade)).toEqual(["low", "aa", "aa", "aaa"]);
    });

    it("读不懂的写法、缺底色：没有比值，不算不合格", () => {
        const checks = checkContrast({...palette, "--text-main": "color-mix(in srgb, #000 90%, #fff)"});
        expect(checks.find((check) => check.key === "--text-main")).toEqual({key: "--text-main", against: null, ratio: null, ok: null, sample: null});
        expect(checkContrast({})[0]).toEqual({key: "--text-main", against: null, ratio: null, ok: null, sample: null});
    });
});
