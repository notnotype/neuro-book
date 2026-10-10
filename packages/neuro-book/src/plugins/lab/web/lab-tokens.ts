/**
 * 变量页签列出的设计变量：nb-ui 配色合同的颜色变量、设计 token 与主题度量，再加上已装主题自己声明的变量。都从
 * nb-ui 的公开入口取，不另写一份清单。主题声明的那组要在主题装好之后读（`lab-theme.ts` 在导入时装主题）。
 */

import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway";
import {
    getInstalledThemes,
    nbElevationTokens,
    nbMotionTokens,
    nbRadiusTokens,
    nbSpacingTokens,
    nbThemeDecorTokens,
    nbThemeMetricTokens,
    nbThemeRoleTokens,
    nbTypographyTokens,
} from "@notnotype/nb-ui/theme";

export type LabTokenGroup = {
    readonly id: string;
    readonly label: string;
    readonly tokens: readonly string[];
};

const colorway = (prefix: string): string[] => nbColorwayVarKeys.filter((token) => token.startsWith(prefix));
const COLORWAY_PREFIXES = ["--bg-", "--text-", "--border-", "--accent-", "--status-"];

const CORE_GROUPS: LabTokenGroup[] = [
    {id: "colorway-surface", label: "配色 · 表面", tokens: [...colorway("--bg-"), ...nbColorwayVarKeys.filter((token) => token === "--color-scheme")]},
    {id: "colorway-text", label: "配色 · 文字", tokens: colorway("--text-")},
    {id: "colorway-border", label: "配色 · 描边", tokens: colorway("--border-")},
    {id: "colorway-accent", label: "配色 · 强调", tokens: colorway("--accent-")},
    {id: "colorway-status", label: "配色 · 状态", tokens: colorway("--status-")},
    {id: "colorway-other", label: "配色 · 其他", tokens: nbColorwayVarKeys.filter((token) => token !== "--color-scheme" && !COLORWAY_PREFIXES.some((prefix) => token.startsWith(prefix)))},
    {id: "typography", label: "设计 · 排版", tokens: nbTypographyTokens},
    {id: "spacing", label: "设计 · 间距", tokens: nbSpacingTokens},
    {id: "radius", label: "设计 · 圆角", tokens: nbRadiusTokens},
    {id: "elevation", label: "设计 · 层级", tokens: nbElevationTokens},
    {id: "motion", label: "设计 · 动效", tokens: nbMotionTokens},
    {id: "theme-metric", label: "主题 · 度量", tokens: nbThemeMetricTokens},
    {id: "theme-decor", label: "主题 · 装饰", tokens: nbThemeDecorTokens},
    {id: "theme-role", label: "主题 · 角色", tokens: nbThemeRoleTokens},
];

/** 全部分组：核心组加上已装主题声明、核心组没有的变量。 */
export function labTokenGroups(): LabTokenGroup[] {
    const registered = new Set(CORE_GROUPS.flatMap((group) => group.tokens));
    const declared: string[] = [];
    for (const theme of getInstalledThemes()) {
        for (const declaration of theme.manifest.declares ?? []) {
            if (!registered.has(declaration.name) && !declared.includes(declaration.name)) declared.push(declaration.name);
        }
    }
    return declared.length === 0 ? CORE_GROUPS : [...CORE_GROUPS, {id: "theme-declares", label: "主题 · 声明", tokens: declared}];
}
