import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {nbDesignTokens, nbRadiusTokens, nbReservedTokens, nbThemeTokens} from "./tokens";
import {nbColorwayVarKeys} from "../colorway/colorway-contract";

/**
 * 设计 token 层 + 主题层基线的兜底。
 *
 * 值的事实源是 src/tokens.css 与 src/theme.css（后者是与 Tailwind 主题键同名的那批，声明在 @theme static 里），
 * 名单在 theme/tokens.ts。两边任一侧漏改都会在这里失败。
 */

function readTokensCss(): string {
    return readFileSync(join(import.meta.dirname, "..", "tokens.css"), "utf-8");
}

/** theme.css 与 tokens.css 的合并文本：名单里的 token 落在两个文件中的哪一个，由它是否属于 Tailwind 主题命名空间决定。 */
function readDeclarationSources(): string {
    return `${readFileSync(join(import.meta.dirname, "..", "theme.css"), "utf-8")}\n${readTokensCss()}`;
}

describe("nb-ui design tokens", () => {
    it("declares every registered token in theme.css or tokens.css", () => {
        const css = readDeclarationSources();
        const missing = nbReservedTokens.filter((token) => !css.includes(`${token}:`));

        expect(missing, `theme.css 与 tokens.css 里缺少这些 token 的声明: ${missing.join(", ")}`).toEqual([]);
    });

    it("registers the menu radius as a design token with a baseline fallback", () => {
        expect(nbRadiusTokens).toContain("--radius-menu");
        expect(readTokensCss()).toContain("--radius-menu: var(--radius-panel)");
    });

    it("registers the compact dialog radius as a theme token that falls back to the dialog radius", () => {
        expect(nbThemeTokens).toContain("--radius-dialog-compact");
        expect(readTokensCss()).toContain("--radius-dialog-compact: var(--radius-dialog)");
    });

    it("registers the floating window radius as a theme token that falls back to the dialog radius", () => {
        expect(nbThemeTokens).toContain("--radius-window");
        expect(readTokensCss()).toContain("--radius-window: var(--radius-dialog)");
    });

    /*
     * 「一个主题都没装」是受支持的状态，所以主题层基线必须落在裸 :root 上，
     * 不能只在 :root[data-nb-theme] 下成立——否则零主题时角色映射全空，界面直接塌。
     */
    it("declares the theme-layer baseline outside any [data-nb-theme] block", () => {
        // 注释里提到这个选择器是允许的（正是用来解释主题怎么压过基线），只看真实选择器
        const withoutComments = readDeclarationSources().replaceAll(/\/\*[\s\S]*?\*\//g, "");
        const rootBlock = withoutComments.split("[data-nb-theme")[0] ?? "";
        const missing = nbThemeTokens.filter((token) => !rootBlock.includes(`${token}:`));

        expect(missing, `这些主题层变量没有裸 :root 默认值: ${missing.join(", ")}`).toEqual([]);
        expect(withoutComments, "theme.css 与 tokens.css 是库的基线，不该按具体主题分档——那是主题包自己 vars.css 的事").not.toContain(
            "[data-nb-theme",
        );
    });

    it("keeps tokens out of the per-colorway colour contract", () => {
        // 排版/间距/圆角/动效与主题层基线都不随配色变化，混进配色契约会让每套配色重复声明一遍
        const overlap = nbReservedTokens.filter((token) => (nbColorwayVarKeys as readonly string[]).includes(token));

        expect(overlap, `这些 token 不该同时出现在配色契约里: ${overlap.join(", ")}`).toEqual([]);
    });

    it("keeps the design-token and theme-layer registries disjoint", () => {
        const overlap = nbDesignTokens.filter((token) => (nbThemeTokens as readonly string[]).includes(token));

        expect(overlap, `这些变量在两张登记表里各出现了一次: ${overlap.join(", ")}`).toEqual([]);
    });

    it("derives elevation from the themed shadow colour, not fixed rgba", () => {
        // 阴影必须走 --shadow-color，否则换主题时阴影不跟着变
        const css = readTokensCss();
        const elevationLines = css
            .split(/\r?\n/)
            .filter((line) => /--elevation-(popover|dialog):/.test(line));

        expect(elevationLines).toHaveLength(2);
        for (const line of elevationLines) {
            expect(line, `${line.trim()} 没有引用 --shadow-color`).toContain("var(--shadow-color");
        }
    });

    it("zeroes motion durations under prefers-reduced-motion", () => {
        const css = readTokensCss();
        const reducedBlock = css.slice(css.indexOf("prefers-reduced-motion"));

        for (const token of ["--motion-fast", "--motion-base", "--motion-enter", "--motion-reveal-in", "--motion-reveal-hold", "--motion-reveal-out"]) {
            // !important 是必需的：这一段是 :root（0,1,0），任意主题都写在 :root[data-nb-theme]（0,2,0）里，
            // 特异性天然更低；主题又来自第三方、选择器还能再往上加，靠特异性或顺序都没有稳赢的写法。
            expect(reducedBlock, `${token} 未在 reduced-motion 下归零并压过主题`).toContain(`${token}: 0ms !important`);
        }
    });

    it("declares tokens only at :root, never per theme host", () => {
        // applyColorway 会给每个主题宿主加 .nb-ui-colorway，而 html 与 body 都是宿主。
        // 一旦 tokens.css 也按宿主声明，body 就会把 html 上的覆盖遮住，换肤层直接失效，
        // 且现象是「变量改了但元素没变」。2026-08-10 实测踩过这个坑，这条守住它。
        // 只看选择器：注释里提到这个 class 名是允许的（正是用来解释为什么不能用）。
        const withoutComments = readTokensCss().replaceAll(/\/\*[\s\S]*?\*\//g, "");

        expect(withoutComments, "tokens.css 不得按 .nb-ui-colorway 宿主重复声明 token，否则根级覆盖会被遮住").not.toContain(
            ".nb-ui-colorway",
        );
    });
});
