import {nbColorways} from "@notnotype/nb-ui/colorway";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import {collectThemeColorways, getInstalledTheme} from "@notnotype/nb-ui/theme";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";

import type {DocumentTheme} from "./document-theme";
import {installThemePacks} from "./install-theme-packs";
import type {ProductTheme} from "./product-theme-shape";

/**
 * 产品的两套主题包（docs/specs/theme/system.md）。配色不单独选：取主题包自带的 `defaultColorway[明暗]`，两条轴就是
 * 配置项里的主题与明暗。
 */

// 装主题必须先于读配色表：配色表要合并各主题自带的配色。与 Lab 的装载（多两套对照主题）共用 `installThemePacks`，
// 谁先求值谁装，后来的复用。
installThemePacks([nbookTheme, macosTheme]);

const colorways: Record<string, NbColorwayVars> = {...nbColorways, ...collectThemeColorways().colorways};

/** 主题与解析后的明暗（`system` 已按系统明暗换成 light 或 dark）对应的文档根主题。`vars` 盖在缺省配色上，所以写了部分配色也不会留下未定义的变量。 */
export function productTheme(theme: ProductTheme, appearance: "light" | "dark"): DocumentTheme {
    const colorwayId = getInstalledTheme(theme.base)?.manifest.defaultColorway?.[appearance];
    const colorway = colorwayId === undefined ? undefined : colorways[colorwayId];
    const vars = {...colorway, ...theme.vars};
    return {themeId: theme.base, skin: theme.skin, appearance, vars: Object.keys(vars).length === 0 ? undefined : vars, scene: theme.scene, icons: theme.icons};
}

/** 一个主题包在某个明暗下的缺省配色：主题写的配色盖在它上面（`productTheme`），编辑器也用它补出没写的变量。没有则是空表。 */
export function baseColors(base: string, appearance: "light" | "dark"): Readonly<Record<string, string>> {
    const colorwayId = getInstalledTheme(base)?.manifest.defaultColorway?.[appearance];
    return ((colorwayId === undefined ? undefined : colorways[colorwayId]) as Readonly<Record<string, string>> | undefined) ?? {};
}
