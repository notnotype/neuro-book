/**
 * 正文的斜杠触发（docs/specs/workbench/markdown-editing.md 输出 10）：`/` 在行首或空白之后；`、` 只在行首也算，中文输入法下这个键
 * 打出的是它，行首打 `、` 不会是正文。只在段落里，所以代码块、原样块不触发；表格单元格另外排除。是否在组字由宿主看视图判断。
 */

import {Extension} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import {closeHistory} from "@tiptap/pm/history";
import {PluginKey, TextSelection} from "@tiptap/pm/state";
import type {EditorState} from "@tiptap/pm/state";

import {createTriggerPlugin, DISMISS_TRIGGER} from "../trigger/trigger-plugin";
import type {TriggerState} from "../trigger/trigger-plugin";

export interface SlashMatch {
    readonly from: number;
    readonly to: number;
    readonly query: string;
}

export const markdownSlashKey = new PluginKey<TriggerState<SlashMatch>>("markdownSlash");

/** 行内原子节点在匹配里读成这个字符：查询里不能跨过它。 */
const ATOM = "￼";
const SLASH = new RegExp(`(?:^|\\s)(/)([^\\s${ATOM}]*)$`, "u");
const ENUMERATION_COMMA = new RegExp(`^(、)([^\\s${ATOM}]*)$`, "u");

function readSlash(state: EditorState): SlashMatch | null {
    const {selection} = state;
    if (!selection.empty || !(selection instanceof TextSelection)) return null;
    const {$from} = selection;
    if ($from.parent.type.name !== "paragraph") return null;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.spec.tableRole !== undefined) return null;
    }
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, ATOM);
    const match = SLASH.exec(before) ?? ENUMERATION_COMMA.exec(before);
    if (match === null) return null;
    const query = match[2] ?? "";
    return {from: $from.pos - query.length - 1, to: $from.pos, query};
}

export const MarkdownSlashTrigger = Extension.create({
    name: "markdownSlashTrigger",
    addProseMirrorPlugins() {
        const editor = this.editor;
        return [createTriggerPlugin(markdownSlashKey, (state) => (editor.isEditable ? readSlash(state) : null))];
    },
});

/** 此刻的触发；没有为 null。 */
export function activeSlash(editor: Editor): SlashMatch | null {
    return markdownSlashKey.getState(editor.state)?.active ?? null;
}

/** 收起：这一处查询不变时不再打开（输出 10）。 */
export function dismissSlash(editor: Editor): void {
    editor.view.dispatch(editor.state.tr.setMeta(markdownSlashKey, DISMISS_TRIGGER));
}

/** 选了一项：删掉 `/查询`。`closeHistory` 把它和打字分开，撤销一步回到 `/查询`（输出 13）。 */
export function removeSlashQuery(editor: Editor): void {
    const match = activeSlash(editor);
    if (match === null) return;
    editor.view.dispatch(closeHistory(editor.state.tr).delete(match.from, match.to));
}
