/// <reference types="node" />
/**
 * 渲染层样式只消费 nb-ui 的 token。规则与它们的理由在 `@notnotype/neuro-book-test-support/style-tokens`，与 nb-ui 共用；这里只写
 * 本包的声明来源。目前没有豁免，要加时每条写理由，并用 `findStaleExemptions` 查死条目。
 */

import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";

import {describe, expect, it} from "vitest";

import {
    findStyleViolations,
    findUndeclaredVars,
    readVueSources,
    stripStyleComments,
    styleTokenRules,
} from "@notnotype/neuro-book-test-support/style-tokens";
import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway";
import {nbTypographyTokens} from "@notnotype/nb-ui/theme";

const RULES = styleTokenRules({typographyTokens: nbTypographyTokens});

describe("表单渲染层的样式 token", () => {
    const sources = readVueSources(import.meta.dirname);

    for (const rule of RULES) {
        it(rule.name, () => {
            expect(findStyleViolations(rule, sources)).toEqual([]);
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
});
