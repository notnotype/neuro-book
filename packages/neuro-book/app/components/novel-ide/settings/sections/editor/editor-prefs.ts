/**
 * 数值字段的区间与步长；与旧宿主 NovelIdeSettingsDialog 里的 min/max/step 逐字一致。
 * 视图据此渲染控件，也据此夹紧输入，两处只有这一个来源。
 */
export const MARKDOWN_NUMBER_LIMITS = {
    fontSize: {min: 12, max: 28, step: 1},
    lineHeight: {min: 1.2, max: 2.6, step: 0.05},
    contentWidth: {min: 520, max: 1280, step: 20},
    paragraphIndentEm: {min: 0, max: 4, step: 0.25},
} as const;

export const MONACO_NUMBER_LIMITS = {
    fontSize: {min: 10, max: 32, step: 1},
    lineHeight: {min: 16, max: 56, step: 1},
    tabSize: {min: 2, max: 8, step: 1},
} as const;

export type MarkdownNumberKey = keyof typeof MARKDOWN_NUMBER_LIMITS;
export type MonacoNumberKey = keyof typeof MONACO_NUMBER_LIMITS;

/**
 * 字体候选：系统字体走 i18n key，品牌字体名本身就是展示名，只有 label。
 */
export type EditorFontOption = {
    value: string;
    labelKey?: string;
    label?: string;
};

export const MARKDOWN_FONT_OPTIONS: EditorFontOption[] = [
    {
        value: "\"Source Han Serif SC\", \"Noto Serif SC\", \"Songti SC\", serif",
        labelKey: "settings.editor.fontChineseSerif",
    },
    {
        value: "\"Microsoft YaHei\", \"Noto Sans SC\", sans-serif",
        labelKey: "settings.editor.fontChineseSans",
    },
    {
        value: "\"LXGW WenKai\", \"KaiTi\", \"STKaiti\", serif",
        labelKey: "settings.editor.fontChineseKai",
    },
    {
        value: "ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        labelKey: "settings.editor.fontSystemSans",
    },
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        labelKey: "settings.editor.fontMonospace",
    },
];

export const MONACO_FONT_OPTIONS: EditorFontOption[] = [
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        labelKey: "settings.editor.fontSystemMonospace",
    },
    {
        value: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        label: "JetBrains Mono",
    },
    {
        value: "Cascadia Code, Consolas, ui-monospace, monospace",
        label: "Cascadia Code",
    },
    {
        value: "Fira Code, ui-monospace, Menlo, Monaco, Consolas, monospace",
        label: "Fira Code",
    },
];

/** 候选字体的展示名：有 i18n key 的走翻译，品牌字体名直接用 label。 */
export function editorFontLabel(option: EditorFontOption, translate: (key: string) => string): string {
    return option.labelKey ? translate(option.labelKey) : option.label ?? option.value;
}

type NumberLimits = {readonly min: number; readonly max: number; readonly step: number};

/**
 * 解析数值输入：空串与非数字返回 null——调用方不写回，清空输入框的过程不该把区间下限落进配置；
 * 越界夹到区间内。旧宿主在这里把空串当成 0 再夹紧，会把下限写进去。
 */
function parseClamped(value: string, limits: NumberLimits): number | null {
    if (value.trim() === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return Math.min(Math.max(parsed, limits.min), limits.max);
}

export function clampEditorNumber(key: MarkdownNumberKey, value: string): number | null {
    return parseClamped(value, MARKDOWN_NUMBER_LIMITS[key]);
}

export function clampMonacoNumber(key: MonacoNumberKey, value: string): number | null {
    return parseClamped(value, MONACO_NUMBER_LIMITS[key]);
}
