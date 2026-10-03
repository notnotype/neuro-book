import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import type {UserColorwayConfig} from "nbook/shared/theme/user-colorway";
import {isStructurallySafeColorwayVarValue} from "nbook/shared/theme/user-colorway";

/**
 * 配色变量的**取值**契约：哪些变量可编辑、每一类该长什么样。
 *
 * 变量名单从 nb-ui 配色契约读（`nbColorwayVarKeys`，33 个），产品侧不抄第二份——
 * 抄一份就等于给配色契约建了第二个事实源，nb-ui 加一个变量时这边会静默漏掉。
 *
 * 判据（颜色 / 长度）分三类，而不是 33 个变量各写一条：
 * · `--color-scheme` 不是颜色，是浏览器原生 UI 的明暗枚举；
 * · `--shadow-panel` 是完整阴影值（`0 1px 2px rgba(...), …`），布局类字面串；
 * · 其余 31 个都是颜色。色彩类取值可能是 `color-mix(...)` 字面串（主题自带配色就在用），
 *   所以「是不是合法颜色」**必须问浏览器**：`CSS.supports("color", value)`。
 *   自己写一份颜色正则去覆盖 color-mix / oklab / 命名色是不可能的，而且会和浏览器漂移。
 *
 * Node（测试 / SSR）里没有 `CSS`，此时退到**结构性**判定：形状对、括号配平。
 * 那条路径能守住「不能把别的 CSS 语句写进变量」，但判不了命名色——它只在没有浏览器的场合用。
 */

export const colorwayVarKeys: readonly string[] = nbColorwayVarKeys;

type ColorwayVarKind = "color" | "color-scheme" | "shadow";

/** 只有这三个变量不是「颜色」，其余按颜色校验。 */
const COLORWAY_VAR_KINDS: Record<string, ColorwayVarKind> = {
    "--color-scheme": "color-scheme",
    "--shadow-panel": "shadow",
};

const COLOR_FUNCTION_PATTERN = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var)\(.*\)$/i;
/** hex 只有 3 / 4 / 6 / 8 位四种写法。写成 `{3,8}` 会把 `#12345` 这种废值放过去。 */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_WIDE_KEYWORDS = ["currentcolor", "transparent"];

function hasBalancedParens(value: string): boolean {
    let depth = 0;
    for (const character of value) {
        if (character === "(") {
            depth += 1;
        } else if (character === ")") {
            depth -= 1;
            if (depth < 0) {
                return false;
            }
        }
    }
    return depth === 0;
}

/** 没有浏览器时的颜色判定：hex、受支持的函数式写法、无参关键字。 */
function isStructurallyColorLike(value: string): boolean {
    return HEX_COLOR_PATTERN.test(value)
        || CSS_WIDE_KEYWORDS.includes(value.toLowerCase())
        || (COLOR_FUNCTION_PATTERN.test(value) && hasBalancedParens(value));
}

function isBrowserAcceptedColor(value: string): boolean {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
        return CSS.supports("color", value);
    }
    return isStructurallyColorLike(value);
}

function isBrowserAcceptedShadow(value: string): boolean {
    if (value === "none") {
        return true;
    }
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
        return CSS.supports("box-shadow", value);
    }
    // 没有浏览器时只判「里面有长度」：阴影没有长度就不成立，这一条能挡住写错的词
    return /[0-9]/.test(value);
}

/** 取值不合法的原因。`empty` 是「没填」（合法，表示继承），`value` 是「填错了」。 */
export type ColorwayVarValueIssue = "empty" | "invalid";

/**
 * 校验单个变量取值。
 *
 * 空串**不是**错误：用户配色允许只覆盖一部分变量，没填的键在应用时逐键回落到基础配色。
 */
export function checkColorwayVarValue(name: string, value: string): ColorwayVarValueIssue | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return "empty";
    }
    if (!isStructurallySafeColorwayVarValue(trimmed)) {
        return "invalid";
    }
    const kind = COLORWAY_VAR_KINDS[name] ?? "color";
    if (kind === "color-scheme") {
        return trimmed === "light" || trimmed === "dark" ? null : "invalid";
    }
    if (kind === "shadow") {
        return isBrowserAcceptedShadow(trimmed) ? null : "invalid";
    }
    return isBrowserAcceptedColor(trimmed) ? null : "invalid";
}

/**
 * 过滤一张变量表：只留下配色契约里的键、且取值校验通过的项。
 *
 * 用于两个「不报错」的入口——配置文件里读到的、导入 JSON 里带进来的。
 * 丢掉的是无效项，不是整套配色：一个变量写坏了不该让用户丢掉整套取值。
 */
export function filterColorwayContractVars(vars: unknown): Record<string, string> {
    if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const name of colorwayVarKeys) {
        const value = (vars as Record<string, unknown>)[name];
        if (typeof value !== "string") {
            continue;
        }
        if (checkColorwayVarValue(name, value) !== null) {
            continue;
        }
        out[name] = value.trim();
    }
    return out;
}

/**
 * 用户配色的最终取值 = 基础配色逐键铺底 + 用户改过的键盖上去。
 *
 * 逐键兜底而不是「存全量」：nb-ui 将来往配色契约里加一个变量时，老配色不会因为这个新键缺失
 * 而在屏幕上塌成空值——它会落到基础配色（当前主题按明暗给出的那一套）的值上。
 */
export function resolveUserColorwayVars(colorway: UserColorwayConfig, base: NbColorwayVars | undefined): NbColorwayVars {
    const resolved: Record<string, string | undefined> = {...base};
    for (const [name, value] of Object.entries(filterColorwayContractVars(colorway.vars))) {
        resolved[name] = value;
    }
    return resolved;
}

/** 当前配色变量表里供预览用的底色（自定义配色卡片的小色块）。 */
export function colorwaySwatchOf(vars: NbColorwayVars | undefined): string {
    return vars?.["--bg-main"] ?? "";
}

/**
 * 变量在编辑器里的分组。按前缀派生而不是写一张 33 行的分组表：
 * 分组表就是配色契约的第二个副本，nb-ui 加变量时它会先忘掉新变量，再默默把它归错地方。
 */
export type ColorwayVarGroup = "background" | "text" | "border" | "accent" | "status" | "other";

export const colorwayVarGroups: readonly ColorwayVarGroup[] = ["background", "text", "border", "accent", "status", "other"];

const GROUP_BY_PREFIX: ReadonlyArray<readonly [string, ColorwayVarGroup]> = [
    ["--bg-", "background"],
    ["--text-", "text"],
    ["--border-", "border"],
    ["--accent-", "accent"],
    ["--status-", "status"],
];

export function colorwayVarGroupOf(name: string): ColorwayVarGroup {
    const matched = GROUP_BY_PREFIX.find(([prefix]) => name.startsWith(prefix));
    return matched === undefined ? "other" : matched[1];
}
