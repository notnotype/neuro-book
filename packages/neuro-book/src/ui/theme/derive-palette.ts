/**
 * 由三个主色推导一套 33 个配色变量（docs/specs/theme/editor.md 输出 7）。推导只是起点，编辑器里每一项都能再改。
 *
 * 保证：主文字、次要文字、弱化文字与链接色（`--accent-text`）对背景、面板、侧栏与悬停底都不低于 4.5；状态色对面板与各自的底色也是。
 * 面板比背景亮（亮暗两套都是），与 NeuroBook 默认配色的关系一致（`@notnotype/nb-ui/colorway` 的 `nbColorways`）。
 */

import type {NbColorwayVarKey} from "@notnotype/nb-ui/colorway-contract";

import {composite, contrast, ensureContrast, formatColor, fromOklch, mix, parseColor, toOklch, withLightness} from "./color";
import type {Rgba} from "./color";

export interface PaletteSeed {
    /** 背景色，对应 `--bg-main`。 */
    readonly background: string;
    readonly text: string;
    readonly accent: string;
    readonly appearance: "light" | "dark";
}

export type DerivedPalette = Readonly<Record<NbColorwayVarKey, string>>;

/** 文字类颜色对背景的最低对比度，与 docs/specs/theme/skins.md 一致。 */
export const MINIMUM_TEXT_CONTRAST = 4.5;

const BLACK: Rgba = {r: 0, g: 0, b: 0, a: 1};

/** 状态色的起点：按明暗各取一组，推导时再按各自的底色调到够对比度。 */
const STATUS_BASE = {
    dark: {info: "#60a5fa", success: "#22c55e", warning: "#f59e0b", danger: "#fb7185"},
    light: {info: "#2563eb", success: "#16a34a", warning: "#b45309", danger: "#dc2626"},
} as const;

const withAlpha = (color: Rgba, alpha: number): Rgba => ({...color, a: alpha});

/** 种子里有读不懂的颜色时返回 null。 */
export function derivePalette(seed: PaletteSeed): DerivedPalette | null {
    const [background, text, accent] = [parseColor(seed.background), parseColor(seed.text), parseColor(seed.accent)];
    if (background === null || text === null || accent === null || background.a < 1 || text.a < 1 || accent.a < 1) return null;
    const dark = seed.appearance === "dark";
    const lightness = toOklch(background).l;

    const panel = withLightness(background, dark ? lightness + 0.035 : Math.min(0.985, lightness + 0.025));
    const sidebar = withLightness(background, dark ? lightness - 0.02 : lightness - 0.03);
    const input = dark ? withLightness(background, lightness - 0.03) : panel;
    const hover = withLightness(background, dark ? lightness + 0.075 : lightness - 0.055);
    const subtle = dark ? mix(sidebar, panel, 0.22) : sidebar;
    const surfaces = [background, panel, sidebar, hover];

    const main = ensureContrast(text, surfaces, MINIMUM_TEXT_CONTRAST);
    const secondary = ensureContrast(mix(main, background, 0.22), surfaces, MINIMUM_TEXT_CONTRAST);
    const muted = ensureContrast(mix(main, background, 0.4), surfaces, MINIMUM_TEXT_CONTRAST);
    const inverse = contrast(accent, {r: 17, g: 17, b: 17, a: 1}) >= contrast(accent, {r: 250, g: 250, b: 250, a: 1}) ? {r: 17, g: 17, b: 17, a: 1} : {r: 250, g: 250, b: 250, a: 1};

    const border = mix(panel, main, 0.13);
    const accentBg = withAlpha(accent, dark ? 0.15 : 0.14);
    const accentText = ensureContrast(accent, [...surfaces, composite(accentBg, panel)], MINIMUM_TEXT_CONTRAST);

    const status = (base: string, alphaBg: number): [Rgba, Rgba, Rgba] => {
        const color = parseColor(base) as Rgba;
        const tint = withAlpha(color, alphaBg);
        const adjusted = ensureContrast(color, [...surfaces, composite(tint, panel)], MINIMUM_TEXT_CONTRAST);
        return [adjusted, withAlpha(adjusted, alphaBg), withAlpha(adjusted, dark ? 0.32 : 0.3)];
    };
    const [info, success, warning, danger] = (["info", "success", "warning", "danger"] as const).map((kind) => status(STATUS_BASE[seed.appearance][kind], dark ? 0.15 : 0.12)) as [[Rgba, Rgba, Rgba], [Rgba, Rgba, Rgba], [Rgba, Rgba, Rgba], [Rgba, Rgba, Rgba]];

    const f = formatColor;
    return {
        "--color-scheme": seed.appearance,
        "--bg-main": f(background),
        "--bg-panel": f(panel),
        "--bg-sidebar": f(sidebar),
        "--bg-subtle": f(subtle),
        "--bg-input": f(input),
        "--bg-hover": f(hover),
        "--text-main": f(main),
        "--text-secondary": f(secondary),
        "--text-muted": f(muted),
        "--text-inverse": f(inverse),
        "--border-color": f(border),
        "--border-strong": f(mix(panel, main, 0.24)),
        "--border-accent": f(mix(accent, border, 0.46)),
        "--accent-main": f(accent),
        "--accent-bg": f(accentBg),
        "--accent-text": f(accentText),
        "--status-info": f(info[0]),
        "--status-info-bg": f(info[1]),
        "--status-info-border": f(info[2]),
        "--status-success": f(success[0]),
        "--status-success-bg": f(success[1]),
        "--status-success-border": f(success[2]),
        "--status-warning": f(warning[0]),
        "--status-warning-bg": f(warning[1]),
        "--status-warning-border": f(warning[2]),
        "--status-danger": f(danger[0]),
        "--status-danger-bg": f(danger[1]),
        "--status-danger-border": f(danger[2]),
        "--shadow-color": dark ? f(BLACK) : "#0f172a",
        "--selection-bg": f(withAlpha(accent, dark ? 0.34 : 0.28)),
        "--shadow-panel": dark ? "0 1px 2px rgba(0, 0, 0, 0.45), 0 20px 48px rgba(0, 0, 0, 0.55)" : "0 1px 2px rgba(15, 23, 42, 0.10), 0 18px 44px rgba(15, 23, 42, 0.14)",
        "--overlay-bg": dark ? "rgba(0, 0, 0, 0.5)" : "rgba(15, 23, 42, 0.35)",
    };
}


/**
 * 由一套的三个主色换算另一套明暗的主色（docs/specs/theme/editor.md 输出 7 的“从另一套派生”）：保持各自的色相与色度，只把明度挪到
 * 目标明暗的合理区间——背景在暗色里很暗、亮色里很亮，文字相反，强调色保证在目标背景上醒目。读不懂的颜色返回 null。
 */
export function mirrorSeed(seed: PaletteSeed, appearance: "light" | "dark"): PaletteSeed | null {
    const [background, text, accent] = [parseColor(seed.background), parseColor(seed.text), parseColor(seed.accent)];
    if (background === null || text === null || accent === null) return null;
    if (seed.appearance === appearance) return seed;
    const dark = appearance === "dark";
    const recolor = (color: Rgba, lightness: number): string => {
        const lch = toOklch(color);
        return formatColor(fromOklch({...lch, l: lightness}));
    };
    const accentLightness = toOklch(accent).l;
    return {
        background: recolor(background, dark ? 0.22 : 0.95),
        text: recolor(text, dark ? 0.93 : 0.25),
        accent: recolor(accent, dark ? Math.max(accentLightness, 0.74) : Math.min(accentLightness, 0.52)),
        appearance,
    };
}
