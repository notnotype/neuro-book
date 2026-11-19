/**
 * Vue 层只读清单里的 CSS 变量、回退与清单一致、不用 nb-ui 的样式类（docs/specs/ui/nested-grid.md 输出 141，`theme-vars.ts`）。
 * 不装 nb-ui 的宿主靠这些回退得到能用的外观；JS 读变量时的缺省值也取自清单，两边对不上，过渡的计时就和画面不一致。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

import {NB_LAYOUT_THEME_VARS} from "./theme-vars";

const VUE_ROOT = join(import.meta.dir, "vue");

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|vue|css)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

/** 自定义属性名：前面不是名字字符，排除 BEM 修饰符（`nb-float-handle--bottom-right`）与 `i--` 这类写法。 */
const PROPERTY = /(?<![A-Za-z0-9_-])--[a-z][a-z0-9-]*/gu;

/** 找出每处 `var(--名字[, 回退])`，回退按括号配对截取（回退里可以再有 `var()`、`color-mix()`）。 */
function varUses(text: string): Array<{readonly name: string; readonly fallback: string | undefined; readonly at: number}> {
    const uses: Array<{readonly name: string; readonly fallback: string | undefined; readonly at: number}> = [];
    for (const match of text.matchAll(/var\((--[a-z][a-z0-9-]*)\s*(,)?/gu)) {
        const at = match.index;
        let depth = 1;
        let end = at + match[0].length;
        while (depth > 0 && end < text.length) {
            const char = text[end];
            if (char === "(") depth += 1;
            else if (char === ")") depth -= 1;
            end += 1;
        }
        const fallback = match[2] === undefined ? undefined : text.slice(at + match[0].length, end - 1).trim();
        uses.push({name: match[1]!, fallback, at});
    }
    return uses;
}

const lineOf = (text: string, at: number): number => text.slice(0, at).split("\n").length;
const BY_NAME = new Map(NB_LAYOUT_THEME_VARS.map((entry) => [entry.name as string, entry]));

function violations(path: string, text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(PROPERTY)) {
        if (!BY_NAME.has(match[0])) found.push(`${path}:${String(lineOf(text, match.index))} ${match[0]} 不在清单里`);
    }
    for (const use of varUses(text)) {
        const entry = BY_NAME.get(use.name);
        if (entry === undefined) continue;
        const where = `${path}:${String(lineOf(text, use.at))} ${use.name}`;
        if (entry.kind === "inline" && entry.fallback === undefined) continue;
        if (use.fallback === undefined) found.push(`${where} 没写回退`);
        else if (use.fallback !== entry.fallback) found.push(`${where} 的回退是 ${use.fallback}，清单写的是 ${String(entry.fallback)}`);
    }
    for (const match of text.matchAll(/\bnb-ui-[a-z][a-z0-9-]*/gu)) found.push(`${path}:${String(lineOf(text, match.index))} 用了 nb-ui 的样式类 ${match[0]}`);
    return found;
}

describe("Vue 层的 CSS 变量", () => {
    it("只读清单里的 --nb-layout-*，每处 var() 的回退与清单相同，不用 nb-ui 的样式类", () => {
        const found = sourceFiles(VUE_ROOT).flatMap((file) => violations(relative(import.meta.dir, file), readFileSync(file, "utf8")));
        expect(found).toEqual([]);
    });

    it("清单的名字不重复、都在 --nb-layout- 命名空间里；只有行内写的几何可以不带回退", () => {
        const names = NB_LAYOUT_THEME_VARS.map((entry) => entry.name);
        expect(new Set(names).size).toBe(names.length);
        for (const entry of NB_LAYOUT_THEME_VARS) {
            expect(entry.name).toMatch(/^--nb-layout-[a-z][a-z0-9-]*$/u);
            if (entry.kind !== "inline") expect(entry.fallback.length).toBeGreaterThan(0);
        }
    });

    it("README 的变量表正好列出主题级的那一批：承诺不随意改名的就是表里这些", () => {
        const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
        const listed = [...readme.matchAll(/^\| `(--nb-layout-[a-z0-9-]+)` \|/gmu)].map((match) => match[1]).sort();
        const themed = NB_LAYOUT_THEME_VARS.filter((entry) => entry.kind === "bridged" && entry.themed).map((entry) => entry.name as string).sort();
        expect(listed).toEqual(themed);
    });

    it("这条检查拦得下旧名、漏写的回退、对不上的回退与 nb-ui 的类", () => {
        expect(violations("x.vue", "a { color: var(--accent-main); }")).toEqual(["x.vue:1 --accent-main 不在清单里"]);
        expect(violations("x.vue", "a { color: var(--nb-layout-text-main); }")).toEqual(["x.vue:1 --nb-layout-text-main 没写回退"]);
        expect(violations("x.vue", "a { color: var(--nb-layout-text-main, red); }")).toEqual(["x.vue:1 --nb-layout-text-main 的回退是 red，清单写的是 CanvasText"]);
        expect(violations("x.vue", `a { box-shadow: var(--nb-layout-sortable-held-shadow, ${String(BY_NAME.get("--nb-layout-sortable-held-shadow")?.fallback)}); }`)).toEqual([]);
        expect(violations("x.vue", `<i class="nb-ui-focus-ring" />`)).toEqual(["x.vue:1 用了 nb-ui 的样式类 nb-ui-focus-ring"]);
        expect(violations("x.vue", `<i class="nb-float-handle--bottom-right" />`)).toEqual([]);
    });
});
