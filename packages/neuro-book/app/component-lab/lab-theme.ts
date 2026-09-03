import {collectThemeColorways, getInstalledThemes, installTheme} from "@notnotype/nb-ui/theme";
import {NB_UI_COLORWAY_HOST_CLASS, applyColorway, nbColorwayMeta, nbColorways} from "@notnotype/nb-ui/colorway";
import type {ColorwayMeta, NbColorwayVars} from "@notnotype/nb-ui/colorway";
import auroraTheme from "@notnotype/nb-ui/themes/aurora";
import editorialTheme from "@notnotype/nb-ui/themes/editorial";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";

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
for (const module of [nbookTheme, macosTheme, editorialTheme, auroraTheme]) {
    installTheme(module);
}

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

/** 上一次写下去的配色变量名，清理时要逐个 removeProperty，否则会残留在 <html> 上。 */
let appliedVarNames: string[] = [];

/**
 * 主题只能写在 `<html>` 上，不能作用域到 Lab 自己的根节点：主题包的变量声明在
 * `:root[data-nb-theme="…"]` 选择器下，且 macos / nbook 的取值大量派生自配色变量
 * （`color-mix(… var(--accent-main) …)`）。自定义属性在**声明处**完成替换，配色不写在
 * `:root` 的话，这些派生值会拿主应用 `:root` 上那套米黄底色去算，玻璃与阴影全部失真。
 *
 * `/lab` 是整页路由，页面上没有产品界面，因此写文档根不会影响到用户看得见的东西；
 * 离开页面时 clearLabTheme 复原。
 */
export function applyLabTheme(themeId: string, colorwayId: string): void {
    if (typeof document === "undefined") {
        return;
    }
    const vars = labColorways[colorwayId];
    const appearance = labColorwayMeta[colorwayId]?.appearance ?? "dark";
    const root = document.documentElement;

    root.dataset.nbTheme = themeId;
    root.dataset.nbAppearance = appearance;
    root.style.colorScheme = appearance;
    if (vars !== undefined) {
        clearColorwayVars();
        applyColorway(root, vars);
        applyColorway(document.body, vars);
        appliedVarNames = Object.keys(vars);
    }
}

export function clearLabTheme(): void {
    if (typeof document === "undefined") {
        return;
    }
    const root = document.documentElement;
    delete root.dataset.nbTheme;
    delete root.dataset.nbAppearance;
    root.style.removeProperty("color-scheme");
    clearColorwayVars();
    root.classList.remove(NB_UI_COLORWAY_HOST_CLASS);
    document.body.classList.remove(NB_UI_COLORWAY_HOST_CLASS);
}

function clearColorwayVars(): void {
    for (const name of appliedVarNames) {
        document.documentElement.style.removeProperty(name);
        document.body.style.removeProperty(name);
    }
    appliedVarNames = [];
}
