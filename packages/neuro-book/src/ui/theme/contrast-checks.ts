/**
 * 配色的对比度检查（docs/specs/theme/editor.md 输出 14）：文字类的颜色落在哪些底色上，就对那些底色算，取最差的一个。
 * 值读不懂（`color-mix()` 这类编辑器不解析的写法）或缺底色时那一项没有比值，既不通过也不算不合格。
 */

import {composite, contrast, formatColor, parseColor} from "./color";
import type {Rgba} from "./color";
import {MINIMUM_TEXT_CONTRAST} from "./derive-palette";

export interface ContrastCheck {
    /** 被检查的文字类变量，例如 `--text-main`。 */
    readonly key: string;
    /** 最差的那个底色的变量名（或 `<状态>-bg` 叠在面板上）；没有比值时为 null。 */
    readonly against: string | null;
    readonly ratio: number | null;
    /** 有比值时：是否不低于 4.5。 */
    readonly ok: boolean | null;
    /** 文字色与最差那个底色的实色（半透明的底已叠在面板上），编辑器拿它们画“真实效果”的样张；没有比值时为 null。 */
    readonly sample: {readonly foreground: string; readonly surface: string} | null;
}

/** WCAG 正文的两档：不到 4.5 不合格，4.5 到 7 是 AA，7 以上是 AAA。 */
export const ENHANCED_TEXT_CONTRAST = 7;
export type ContrastGrade = "low" | "aa" | "aaa";

export function contrastGrade(ratio: number): ContrastGrade {
    if (ratio < MINIMUM_TEXT_CONTRAST) return "low";
    return ratio < ENHANCED_TEXT_CONTRAST ? "aa" : "aaa";
}

const TEXT_SURFACES = ["--bg-main", "--bg-panel", "--bg-sidebar", "--bg-hover"] as const;
const STATUS = ["info", "success", "warning", "danger"] as const;

/** 每个文字类变量落在哪些底色上；`tint` 是叠在面板上的半透明底（强调与状态色的底）。 */
const TARGETS: ReadonlyArray<{readonly key: string; readonly surfaces: ReadonlyArray<string>; readonly tint?: string}> = [
    {key: "--text-main", surfaces: TEXT_SURFACES},
    {key: "--text-secondary", surfaces: TEXT_SURFACES},
    {key: "--text-muted", surfaces: TEXT_SURFACES},
    {key: "--accent-text", surfaces: TEXT_SURFACES, tint: "--accent-bg"},
    {key: "--text-inverse", surfaces: ["--accent-main"]},
    ...STATUS.map((kind) => ({key: `--status-${kind}`, surfaces: ["--bg-panel"], tint: `--status-${kind}-bg`})),
];

/** 这些变量都是文字类的，编辑器在它们旁边显示比值。 */
export const CONTRAST_KEYS: ReadonlyArray<string> = TARGETS.map((target) => target.key);

export function checkContrast(colors: Readonly<Record<string, string | undefined>>): ReadonlyArray<ContrastCheck> {
    const read = (name: string): Rgba | null => {
        const value = colors[name];
        return value === undefined ? null : parseColor(value);
    };
    return TARGETS.map(({key, surfaces, tint}): ContrastCheck => {
        const foreground = read(key);
        const candidates: Array<{readonly name: string; readonly color: Rgba}> = [];
        for (const name of surfaces) {
            const surface = read(name);
            if (surface !== null && surface.a >= 1) candidates.push({name, color: surface});
        }
        const panel = read("--bg-panel");
        const tinted = tint === undefined ? null : read(tint);
        if (tint !== undefined && tinted !== null && panel !== null && panel.a >= 1) candidates.push({name: `${tint} 叠在 --bg-panel`, color: composite(tinted, panel)});
        if (foreground === null || candidates.length === 0) return {key, against: null, ratio: null, ok: null, sample: null};
        let worst = {name: "", ratio: Number.POSITIVE_INFINITY, color: candidates[0]!.color};
        for (const candidate of candidates) {
            const ratio = contrast(foreground, candidate.color);
            if (ratio < worst.ratio) worst = {name: candidate.name, ratio, color: candidate.color};
        }
        return {key, against: worst.name, ratio: worst.ratio, ok: worst.ratio >= MINIMUM_TEXT_CONTRAST, sample: {foreground: formatColor(foreground), surface: formatColor(worst.color)}};
    });
}
