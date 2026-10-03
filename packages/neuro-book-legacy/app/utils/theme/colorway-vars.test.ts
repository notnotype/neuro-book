import {describe, expect, it} from "vitest";
import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway";
import {
    checkColorwayVarValue,
    colorwaySwatchOf,
    colorwayVarGroupOf,
    colorwayVarGroups,
    colorwayVarKeys,
    filterColorwayContractVars,
    resolveUserColorwayVars,
} from "nbook/app/utils/theme/colorway-vars";

/**
 * 配色变量校验在 Node 下走的是**结构性**回退路径（没有 `CSS` 全局）：
 * 判得了 hex / 函数式写法 / 语句分隔符，判不了命名色。浏览器里由 `CSS.supports` 兜底，
 * 那条路径在浏览器实测里覆盖（见验收报告）。所以这里用的取值都不含命名色。
 */
describe("配色变量取值校验", () => {
    it("颜色类变量：合法取值通过、空值表示继承、坏值一律拒绝", () => {
        expect(checkColorwayVarValue("--bg-main", "#1a1b1e")).toBeNull();
        expect(checkColorwayVarValue("--bg-main", "color-mix(in srgb, #000000 46%, #ffffff)")).toBeNull();
        expect(checkColorwayVarValue("--bg-main", "rgba(10, 132, 255, 0.16)")).toBeNull();
        expect(checkColorwayVarValue("--bg-main", "")).toBe("empty");
        expect(checkColorwayVarValue("--bg-main", "   ")).toBe("empty");
        expect(checkColorwayVarValue("--bg-main", "not-a-color")).toBe("invalid");
        expect(checkColorwayVarValue("--bg-main", "#12345")).toBe("invalid");
        expect(checkColorwayVarValue("--bg-main", "red; background: url(x)")).toBe("invalid");
        expect(checkColorwayVarValue("--bg-main", "color-mix(in srgb, #000 50%, #fff")).toBe("invalid");
    });

    it("--color-scheme 是枚举不是颜色，--shadow-panel 按阴影取值校验", () => {
        expect(checkColorwayVarValue("--color-scheme", "dark")).toBeNull();
        expect(checkColorwayVarValue("--color-scheme", "light")).toBeNull();
        expect(checkColorwayVarValue("--color-scheme", "#1a1b1e")).toBe("invalid");

        expect(checkColorwayVarValue("--shadow-panel", "0 1px 2px rgba(0, 0, 0, 0.5)")).toBeNull();
        expect(checkColorwayVarValue("--shadow-panel", "none")).toBeNull();
        expect(checkColorwayVarValue("--shadow-panel", "很深的阴影")).toBe("invalid");
    });

    it("白名单过滤：契约外的键与坏值都丢掉，好值留下", () => {
        const filtered = filterColorwayContractVars({
            "--bg-main": "#101010",
            "--bg-panel": "not-a-color",
            "--not-in-contract": "#ffffff",
            "bg-main": "#101010",
        });

        expect(filtered).toEqual({"--bg-main": "#101010"});
        expect(filterColorwayContractVars(null)).toEqual({});
        expect(filterColorwayContractVars(["--bg-main"])).toEqual({});
    });

    it("用户配色逐键兜底到基础配色：没改的键沿用、改过的键覆盖", () => {
        const resolved = resolveUserColorwayVars({
            id: "custom-night",
            label: "夜航",
            appearance: "dark",
            vars: {"--bg-panel": "#123456", "--bg-main": "not-a-color"},
        }, {"--bg-main": "#000000", "--bg-panel": "#111111"});

        expect(resolved["--bg-panel"]).toBe("#123456");
        // 坏值不是「写进去再坏掉」，而是被丢掉：这个键落到基础配色的取值上
        expect(resolved["--bg-main"]).toBe("#000000");
    });

    it("变量名单来自 nb-ui 配色契约，分组按前缀派生", () => {
        expect(colorwayVarKeys).toEqual([...nbColorwayVarKeys]);
        expect(colorwayVarKeys).toHaveLength(33);
        expect(colorwayVarGroupOf("--bg-hover")).toBe("background");
        expect(colorwayVarGroupOf("--text-muted")).toBe("text");
        expect(colorwayVarGroupOf("--border-accent")).toBe("border");
        expect(colorwayVarGroupOf("--accent-text")).toBe("accent");
        expect(colorwayVarGroupOf("--status-danger-border")).toBe("status");
        expect(colorwayVarGroupOf("--overlay-bg")).toBe("other");
        expect(colorwayVarGroupOf("--color-scheme")).toBe("other");
        // 分组只覆盖契约里的键：每个变量的分组都必须落在已登记的分组里
        expect(colorwayVarKeys.every((name) => colorwayVarGroups.includes(colorwayVarGroupOf(name)))).toBe(true);
    });

    it("预览色块取解析后的底色，缺键时为空串", () => {
        expect(colorwaySwatchOf({"--bg-main": "#abcdef"})).toBe("#abcdef");
        expect(colorwaySwatchOf(undefined)).toBe("");
    });
});
