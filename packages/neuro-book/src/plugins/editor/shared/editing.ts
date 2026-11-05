/**
 * 编辑动作的目录（docs/specs/workbench/markdown-editing.md）：命令声明、公开键与菜单都读这一份。只有数据，不引 Tiptap：
 * 插件入口要静态引用它，编辑内核留在按需加载的控件里（`markdown/web/plugin.ts` 的头注释）。实现在控件那边，按同一个 `id` 对应。
 */

import type {Ref} from "@vue/reactivity";

import type {DisplayText} from "nbook/shared/localized-text";

/** 决定命令要哪些公开键：`format` 改文字，`block` 改块，`move` 只要可写。 */
export type EditingKind = "format" | "block" | "move";

export interface EditingActionInfo {
    readonly kind: EditingKind;
    readonly icon: string;
    /** 只用于显示；按键由控件处理（Spec 的命令表），`editing-actions.dom.test.ts` 核对它们管用。 */
    readonly keybinding?: string;
    /** 勾选状态的公开键名。 */
    readonly format?: string;
    /** 带参数：不进命令面板。 */
    readonly args?: "color" | "text" | "align";
    /** 要先有选区才可用。 */
    readonly needsSelection?: boolean;
}

export const EDITING_ACTIONS = {
    bold: {kind: "format", icon: "i-lucide-bold", keybinding: "Mod+B", format: "formatBold"},
    italic: {kind: "format", icon: "i-lucide-italic", keybinding: "Mod+I", format: "formatItalic"},
    strike: {kind: "format", icon: "i-lucide-strikethrough", keybinding: "Mod+Shift+S", format: "formatStrike"},
    code: {kind: "format", icon: "i-lucide-code", keybinding: "Mod+E", format: "formatCode"},
    superscript: {kind: "format", icon: "i-lucide-superscript", format: "formatSuperscript"},
    subscript: {kind: "format", icon: "i-lucide-subscript", format: "formatSubscript"},
    "clear-format": {kind: "format", icon: "i-lucide-remove-formatting"},
    "text-color": {kind: "format", icon: "i-lucide-baseline", args: "color"},
    highlight: {kind: "format", icon: "i-lucide-highlighter", args: "color"},
    ruby: {kind: "format", icon: "i-lucide-languages", args: "text", needsSelection: true},
    paragraph: {kind: "block", icon: "i-lucide-pilcrow", keybinding: "Mod+Alt+0"},
    "heading-1": {kind: "block", icon: "i-lucide-heading-1", keybinding: "Mod+Alt+1", format: "formatHeading1"},
    "heading-2": {kind: "block", icon: "i-lucide-heading-2", keybinding: "Mod+Alt+2", format: "formatHeading2"},
    "heading-3": {kind: "block", icon: "i-lucide-heading-3", keybinding: "Mod+Alt+3", format: "formatHeading3"},
    "bullet-list": {kind: "block", icon: "i-lucide-list", keybinding: "Mod+Shift+8", format: "formatBulletList"},
    "ordered-list": {kind: "block", icon: "i-lucide-list-ordered", keybinding: "Mod+Shift+7", format: "formatOrderedList"},
    "task-list": {kind: "block", icon: "i-lucide-list-checks", keybinding: "Mod+Shift+9", format: "formatTaskList"},
    quote: {kind: "block", icon: "i-lucide-quote", keybinding: "Mod+Shift+B", format: "formatQuote"},
    callout: {kind: "block", icon: "i-lucide-info", format: "formatCallout"},
    "code-block": {kind: "block", icon: "i-lucide-square-code", keybinding: "Mod+Alt+C", format: "formatCodeBlock"},
    align: {kind: "block", icon: "i-lucide-align-left", args: "align"},
    bilingual: {kind: "block", icon: "i-lucide-book-open-text", args: "text"},
    divider: {kind: "block", icon: "i-lucide-minus"},
    table: {kind: "block", icon: "i-lucide-table"},
} as const satisfies Readonly<Record<string, EditingActionInfo>>;

export type EditingActionId = keyof typeof EDITING_ACTIONS;

export const editingCommandId = (action: EditingActionId): string => `nbook.edit.${action}`;

/** 控件交出的编辑动作（控件句柄的 `editing`）：`active`、`enabled` 在选区或文档变化时重新求值，放进 computed 里读会跟着变。 */
export interface EditorEditing {
    run(action: string, args?: Readonly<Record<string, unknown>>): {readonly ok: true} | {readonly ok: false; readonly reason: DisplayText};
    active(action: string): boolean;
    enabled(action: string): boolean;
    readonly hasSelection: Readonly<Ref<boolean>>;
}
