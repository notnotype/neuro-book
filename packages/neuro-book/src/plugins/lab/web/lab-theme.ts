import {collectThemeColorways, getInstalledThemes} from "@notnotype/nb-ui/theme";
import {nbColorwayMeta, nbColorways} from "@notnotype/nb-ui/colorway";
import type {ColorwayMeta, NbColorwayVars} from "@notnotype/nb-ui/colorway";
import auroraTheme from "@notnotype/nb-ui/themes/aurora";
import editorialTheme from "@notnotype/nb-ui/themes/editorial";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {createDocumentThemeWriter} from "nbook/ui/theme/document-theme";
import {installThemePacks} from "nbook/ui/theme/install-theme-packs";

/**
 * Lab 用的是 nb-ui 那套主题（配色 + 主题包），不是主应用自己那 8 套。
 *
 * Lab 是这套主题系统在本仓库里的第一个消费方——先在开发工具上跑通，产品再决定要不要迁。
 *
 * Lab 不直接使用 nb-ui 的 createThemeStore / createColorwayStore：Lab 的主题与其它界面偏好
 * 需要写入同一份版本化文档，并由 Lab 自己控制恢复、校验与清除边界。这里只复用无状态的
 * 主题装载与应用函数。
 */

// 装主题必须先于读配色表：配色表要合并各主题自带的配色，而模块副作用只在 import 时跑一次。
// 装载顺序 = 主题切换器里的显示顺序（getInstalledThemes 按装载顺序返回）。
// 产品侧（`src/ui/theme/product-themes.ts`）也装 nbook / macos，缺则装、已装则复用由这个入口统一承担。
installThemePacks([nbookTheme, macosTheme, editorialTheme, auroraTheme]);

const fromThemes = collectThemeColorways();

const allColorways: Record<string, NbColorwayVars> = {...nbColorways, ...fromThemes.colorways};
const allColorwayMeta: Record<string, ColorwayMeta> = {...nbColorwayMeta, ...fromThemes.colorwayMeta};

/**
 * Lab 的配色只留 NeuroBook 主题自带的这两套（开发者拍板，2026-09-01）。
 *
 * 代价记在这里：aurora / editorial / macos 各自带的配色不再出现在切换器里，其中 macos
 * 那两套是为它自己的玻璃调的——按 nb-ui `themes/macos/colorways.ts` 的说法，那套玻璃在别人的
 * 配色下会发灰。所以 Lab 里看到的 macOS 主题不是它设计时的样子；真要按设计观感评判它，
 * 得先把 `macos-light` / `macos-dark` 放回这个数组。
 */
const LAB_COLORWAY_IDS = ["nbook-light", "nbook-dark"];

export const labThemes = getInstalledThemes();
export const labColorways: Record<string, NbColorwayVars> = pick(allColorways);
export const labColorwayMeta: Record<string, ColorwayMeta> = pick(allColorwayMeta);

export const LAB_DEFAULT_THEME = nbookTheme.manifest.id;
export const LAB_DEFAULT_COLORWAY = nbookTheme.manifest.defaultColorway?.dark ?? "nbook-dark";

/** 按 LAB_COLORWAY_IDS 的顺序取子集，顺序即切换器里的显示顺序。 */
function pick<T>(source: Record<string, T>): Record<string, T> {
    const out: Record<string, T> = {};
    for (const id of LAB_COLORWAY_IDS) {
        const value = source[id];
        if (value !== undefined) {
            out[id] = value;
        }
    }
    return out;
}

const writer = createDocumentThemeWriter();

/**
 * Lab 的主题写在文档根（原因见 `createDocumentThemeWriter`）。`/lab` 是整页路由，页面上没有产品界面，写文档根不会
 * 影响到用户看得见的东西；离开页面时 clearLabTheme 复原。
 */
export function applyLabTheme(themeId: string, colorwayId: string): void {
    if (typeof document === "undefined") {
        return;
    }
    writer.apply({themeId, appearance: labColorwayMeta[colorwayId]?.appearance ?? "dark", vars: labColorways[colorwayId]});
}

export function clearLabTheme(): void {
    if (typeof document === "undefined") {
        return;
    }
    writer.clear();
}
