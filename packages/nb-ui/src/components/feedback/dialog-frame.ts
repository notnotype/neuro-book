/**
 * `Dialog` 与 `FloatingWindow` 共用的外框尺寸：面板宽度的几档预设、宽高写法的换算，以及外框与正文的留白。
 * 外框本身在 `DialogSurface.vue`；两个组件只在定位、叠放与关闭方式上不同。
 */

/** 面板宽度刻度（不是控件尺寸 `ControlSize`）：`default` 是 sm 与 md 之间真实的一档。 */
export type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";

type DialogSizePreset = {
    width: string;
    height: string;
    maxHeight: string;
};

const DIALOG_SIZE_PRESETS: Record<DialogSize, DialogSizePreset> = {
    sm: {width: "min(360px, calc(100cqw - 32px))", height: "auto", maxHeight: "85cqh"},
    default: {width: "min(420px, calc(100cqw - 32px))", height: "auto", maxHeight: "85cqh"},
    md: {width: "min(560px, calc(100cqw - 32px))", height: "auto", maxHeight: "85cqh"},
    lg: {width: "min(720px, calc(100cqw - 32px))", height: "auto", maxHeight: "calc(100cqh - 32px)"},
    xl: {width: "min(1080px, calc(100cqw - 20px))", height: "min(780px, calc(100cqh - 20px))", maxHeight: "calc(100cqh - 20px)"},
    full: {width: "calc(100cqw - 24px)", height: "calc(100cqh - 24px)", maxHeight: "calc(100cqh - 24px)"},
};

export type DialogFrameInput = {
    size: DialogSize;
    /** CSS 宽度，或 px 数字（按容器收窄，不会比容器宽）。 */
    width?: string | number;
    height?: string | number;
    maxHeight?: string;
};

export type DialogFrame = {width: string; height: string; maxHeight: string};

const cssLength = (value: string | number): string => (typeof value === "number" ? `${String(value)}px` : value);

/** 按尺寸档与显式宽高算出面板的宽、高与最大高度；数字宽度和预设一样两侧至少留 16px。 */
export function resolveDialogFrame(input: DialogFrameInput): DialogFrame {
    const preset = DIALOG_SIZE_PRESETS[input.size];
    return {
        width: input.width === undefined ? preset.width : typeof input.width === "number" ? `min(${String(input.width)}px, calc(100cqw - 32px))` : input.width,
        height: cssLength(input.height ?? preset.height),
        maxHeight: input.maxHeight ?? preset.maxHeight,
    };
}

/** 高度写成数字或 `Npx` 时的像素值。 */
export function pxOf(value: string | number | undefined): number | null {
    if (typeof value === "number") return value;
    const match = value === undefined ? null : /^([0-9]+(?:\.[0-9]+)?)px$/u.exec(value.trim());
    return match === null ? null : Number(match[1]);
}

/*
 * 三段的留白由一处算出来，不各写各的。
 *
 * **不设头尾条。** 这是从 Apple 官方 macOS 27 UI Kit 实测回来的结论：那份文件里 Save Dialog 与 Alert
 * 都是**一列 flex，四边留白基本一致**，标题只是这一列的第一个块，按钮只是最后一个块。官方读到的取值：
 * Save Dialog `padding: 20px; gap: 20px`；Alert `padding: 20px 16px 16px; gap: 14px`。上留白比左右多一档，
 * 也是官方原值：标题的字面顶端比它的行盒要低，四边等距时读起来会像偏上。浮动窗口用同一个外框。
 */
export const DIALOG_SURFACE_STYLE = {
    paddingBlockStart: "calc(var(--panel-p) + var(--space-2))",
    paddingInline: "var(--panel-p)",
    paddingBlockEnd: "var(--panel-p)",
    /* 14px 是官方 Alert 的原值。这一档是块与块之间的空，不跟着中文放松 */
    gap: "calc(var(--space-6) - var(--space-1))",
} as const;

/*
 * 按钮平分整行还是右对齐——Apple 自己就是分两档的（官方 macOS 27 UI Kit 实测）：窄的 Alert 两颗按钮平分整行，
 * 宽的 Save Dialog 按钮右对齐。判据是「这个框窄不窄」：sm / default 平分，md 以上右对齐。
 */
export function footerFillsRow(size: DialogSize): boolean {
    return size === "sm" || size === "default";
}
