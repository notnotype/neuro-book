/**
 * 说明框的文字与主题：都由宿主注入（docs/specs/agent/page-agent.md 输出 10 的“随界面语言”）。包里只带英文文字与亮色的兜底值，
 * 宿主不给时也能用。
 */

/** 说明框上的文字。 */
export interface GuideText {
    /** 进度，例如“第 1 步，共 3 步”。 */
    readonly progress: (step: number, total: number) => string;
    readonly next: string;
    /** 最后一步的“下一步”。 */
    readonly done: string;
    readonly back: string;
    readonly skip: string;
    readonly ask: string;
    readonly askPlaceholder: string;
    readonly askSubmit: string;
    readonly askClose: string;
}

export const ENGLISH_GUIDE_TEXT: GuideText = {
    progress: (step, total) => `Step ${String(step)} of ${String(total)}`,
    next: "Next",
    done: "Done",
    back: "Back",
    skip: "Skip tour",
    ask: "Ask",
    askPlaceholder: "Ask the agent…",
    askSubmit: "Send",
    askClose: "Never mind",
};

/**
 * 主题的各个值与兜底。宿主给的是 CSS 值，通常是 `var(--宿主的变量)`：它们写在说明框的 shadow 宿主上，在那里取值，所以
 * 跟着目标所在那一层的主题走（局部换了主题的弹层也对）。
 */
export const GUIDE_THEME_DEFAULTS = {
    accent: "#2f6fdb",
    onAccent: "#ffffff",
    surface: "rgba(255, 255, 255, 0.97)",
    outline: "rgba(15, 23, 42, 0.1)",
    shadow: "0 10px 30px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.08)",
    blur: "none",
    text: "#1f2329",
    textSecondary: "#4b5563",
    textMuted: "#6b7280",
    radius: "10px",
    controlRadius: "6px",
    controlHeight: "28px",
    font: "system-ui, -apple-system, \"Segoe UI\", sans-serif",
    fontSize: "13px",
    fontSizeSmall: "12px",
    fontSizeTiny: "11px",
    dim: "rgba(15, 17, 21, 0.38)",
} as const;

export type GuideThemeSlot = keyof typeof GUIDE_THEME_DEFAULTS;
export type GuideTheme = Partial<Readonly<Record<GuideThemeSlot, string>>>;

/** 值里有这些字符会让样式表断开：宿主写错时用兜底值，不让一个值弄坏整张样式表。 */
const UNSAFE_VALUE = /[;{}<>]/u;

/** `:host` 上的自定义属性，名字是 `--pa-` 加槽名的短横线写法。 */
export function themeDeclarations(theme: GuideTheme = {}): string {
    const lines = (Object.keys(GUIDE_THEME_DEFAULTS) as GuideThemeSlot[]).map((slot) => {
        const given = theme[slot];
        const value = given === undefined || given.trim() === "" || UNSAFE_VALUE.test(given) ? GUIDE_THEME_DEFAULTS[slot] : given;
        return `--pa-${slot.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}: ${value};`;
    });
    return `:host {\n${lines.join("\n")}\n}`;
}
