/**
 * Markdown 的编辑命令（docs/specs/workbench/markdown-editing.md 的命令表）：作用于活动组的活动控件。键位不写进声明：按键留在
 * 控件里，和其它编辑器命令一样。Agent 改正文走文件工具，不调用这些命令。
 */

import {Type} from "typebox";
import type {ShallowRef} from "@vue/reactivity";

import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";

import {EDITING_ACTIONS, editingCommandId} from "../shared/editing";
import type {EditingActionId, EditingActionInfo} from "../shared/editing";
import {editorText} from "../shared/text";
import type {EditorArea} from "./area";
import {editorState} from "./state";

const NO_ARGS = Type.Object({}, {additionalProperties: false});
const ARGS: Readonly<Record<NonNullable<EditingActionInfo["args"]>, ReturnType<typeof Type.Object>>> = {
    color: Type.Object({color: Type.Union([Type.String({minLength: 1}), Type.Null()])}, {additionalProperties: false}),
    text: Type.Object({text: Type.String({minLength: 1})}, {additionalProperties: false}),
    align: Type.Object({value: Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right"), Type.Literal("justify")])}, {additionalProperties: false}),
};

const EDIT = editorText("categories.edit");
const VIEW = editorText("categories.view");

const requires = (info: EditingActionInfo): ReadonlyArray<string> => {
    const keys = [editorState.key("writable")];
    if (info.kind === "format") keys.push(editorState.key("canFormat"));
    if (info.kind === "block") keys.push(editorState.key("canConvertBlock"));
    if (info.needsSelection === true) keys.push(editorState.key("hasSelection"));
    return keys;
};

const ACTIONS: ReadonlyArray<readonly [EditingActionId, EditingActionInfo]> = Object.entries(EDITING_ACTIONS) as never;

export const TOGGLE_TOOLBAR_COMMAND = "nbook.view.toggle-editor-toolbar";

export const EDITING_COMMAND_DECLARATIONS: Readonly<Record<string, WrittenCommandDeclaration>> = {
    [TOGGLE_TOOLBAR_COMMAND]: {category: VIEW, description: "Show or hide the toolbar above the Markdown editor.", args: NO_ARGS, effect: "read"},
    ...Object.fromEntries(ACTIONS.map(([action, info]) => [editingCommandId(action), {
    category: EDIT,
    description: `Apply the "${action}" edit in the active Markdown editor.`,
    args: info.args === undefined ? NO_ARGS : ARGS[info.args],
    effect: "write",
    when: {requires: requires(info)},
} satisfies WrittenCommandDeclaration])),
};

export function editingCommands(area: Readonly<ShallowRef<EditorArea | null>>, sources: {readonly toggleToolbar: () => Promise<unknown>}): Record<string, CommandImplementation> {
    const actions = Object.fromEntries(ACTIONS.map(([action]) => [editingCommandId(action), {
        run: (args: unknown) => {
            const editing = area.value?.activeHandle.value?.editing;
            if (editing === undefined) return {ok: false, code: "unavailable", reason: editorText("refusal.editingUnsupported")} as const;
            const result = editing.run(action, args as Readonly<Record<string, unknown>>);
            return result.ok ? {ok: true, value: null} as const : {ok: false, code: "unavailable", reason: result.reason} as const;
        },
    } satisfies CommandImplementation]));
    return {
        ...actions,
        [TOGGLE_TOOLBAR_COMMAND]: {
            run: async () => {
                await sources.toggleToolbar();
                return {ok: true, value: null};
            },
        },
    };
}
