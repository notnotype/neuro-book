import {nbColorways} from "@notnotype/nb-ui/colorway";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import {collectThemeColorways, getInstalledTheme} from "@notnotype/nb-ui/theme";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";

import type {DocumentTheme} from "./document-theme";
import {installThemePacks} from "./install-theme-packs";

/**
 * 产品的两套主题包（docs/specs/theme/system.md）。配色不单独选：取主题包自带的 `defaultColorway[明暗]`，两条轴就是
 * 配置项里的主题与明暗。
 */

// 装主题必须先于读配色表：配色表要合并各主题自带的配色。与 Lab 的装载（多两套对照主题）共用 `installThemePacks`，
// 谁先求值谁装，后来的复用。
installThemePacks([nbookTheme, macosTheme]);

const colorways: Record<string, NbColorwayVars> = {...nbColorways, ...collectThemeColorways().colorways};

/** 主题与解析后的明暗（`system` 已按系统明暗换成 light 或 dark）对应的文档根主题。 */
export function productTheme(themeId: string, appearance: "light" | "dark"): DocumentTheme {
    const colorwayId = getInstalledTheme(themeId)?.manifest.defaultColorway?.[appearance];
    return {themeId, appearance, vars: colorwayId === undefined ? undefined : colorways[colorwayId]};
}
