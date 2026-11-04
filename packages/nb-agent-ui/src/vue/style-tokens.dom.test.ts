/// <reference types="node" />
/**
 * 渲染层样式只消费 nb-ui 的 token。规则与它们的理由在 `@notnotype/neuro-book-test-support/style-tokens`，与 nb-ui 共用；这里只写
 * 本包的豁免与声明来源。
 *
 * 放在渲染层、由 Vitest 运行：要读 nb-ui 的配色契约，它带 DOM 类型，核心的 tsconfig 没有 DOM。
 */

import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";

import {describe, expect, it} from "vitest";

import {
    findStaleExemptions,
    findStyleViolations,
    findUndeclaredVars,
    readVueSources,
    stripStyleComments,
    styleTokenRules,
    type StyleExemptions,
} from "@notnotype/neuro-book-test-support/style-tokens";
import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway";
import {nbTypographyTokens} from "@notnotype/nb-ui/theme";

/** 每条豁免都要写理由。 */
const EXEMPTIONS: StyleExemptions = {
    "literal-duration": [{file: "fallback/PlainMarkdown.vue", reason: "流式光标一秒闪一次，是固定节拍，不是随主题快慢的界面动效"}],
};

const RULES = styleTokenRules({typographyTokens: nbTypographyTokens});

describe("渲染层的样式 token", () => {
    const sources = readVueSources(import.meta.dirname);

    for (const rule of RULES) {
        it(rule.name, () => {
            expect(findStyleViolations(rule, sources, EXEMPTIONS)).toEqual([]);
        });
    }

    it("用到的 CSS 变量都有声明", () => {
        const require = createRequire(import.meta.url);
        const nbUiSource = dirname(require.resolve("@notnotype/nb-ui/colorway").replace(/colorway[/\\]index\.ts$/u, "index.ts"));
        expect(findUndeclaredVars({
            sources,
            declaringTexts: ["theme.css", "tokens.css", "styles.css"].map((name) => stripStyleComments(readFileSync(join(nbUiSource, name), "utf8"))),
            declared: nbColorwayVarKeys,
            runtimePrefixes: ["--tw-"],
        })).toEqual([]);
    });

    it("豁免都还命中代码（防止豁免变成死条目）", () => {
        expect(findStaleExemptions(RULES, sources, EXEMPTIONS)).toEqual([]);
    });
});
