/** 菜单共用的取值：文字颜色与高亮写进 Markdown 的是字面量（方言 Spec 输出 24），所以不是主题 token；色板取自旧应用。 */

export interface PaletteColor {
    readonly id: string;
    readonly value: string;
}

export const TEXT_COLORS: ReadonlyArray<PaletteColor> = [
    {id: "slate", value: "#64748b"},
    {id: "orange", value: "#f97316"},
    {id: "amber", value: "#f59e0b"},
    {id: "yellow", value: "#eab308"},
    {id: "emerald", value: "#10b981"},
    {id: "sky", value: "#0ea5e9"},
    {id: "violet", value: "#8b5cf6"},
    {id: "pink", value: "#ec4899"},
    {id: "red", value: "#ef4444"},
];

export const HIGHLIGHT_COLORS: ReadonlyArray<PaletteColor> = [
    {id: "neutral", value: "#f1f5f9"},
    {id: "stone", value: "#ede9e1"},
    {id: "orange", value: "#ffedd5"},
    {id: "yellow", value: "#fef9c3"},
    {id: "green", value: "#dcfce7"},
    {id: "blue", value: "#dbeafe"},
    {id: "purple", value: "#ede9fe"},
    {id: "pink", value: "#fce7f3"},
    {id: "red", value: "#fee2e2"},
];

/** 链接的命令归链接那个 Task，这里只留入口：命令不在目录里时按钮不出现。 */
export const LINK_COMMAND = "nbook.edit.link";
