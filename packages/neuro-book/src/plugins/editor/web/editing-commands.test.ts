/** 编辑命令（docs/specs/workbench/markdown-editing.md 的命令表）：声明都被命令表接受，公开键都已声明，执行经活动控件的 `editing`。 */
import {shallowRef} from "@vue/reactivity";
import {describe, expect, it} from "vitest";

import {commandDeclarationProblems} from "nbook/plugins/commands/shared/registry";

import {EDITING_ACTIONS, editingCommandId} from "../shared/editing";
import type {EditingActionId, EditorEditing} from "../shared/editing";
import type {EditorArea} from "./area";
import {EDITING_COMMAND_DECLARATIONS, editingCommands} from "./editing-commands";
import {editorState} from "./state";

const ids = Object.keys(EDITING_ACTIONS) as EditingActionId[];

function areaWith(editing: EditorEditing | undefined) {
    return shallowRef({activeHandle: {value: {editing}}} as unknown as EditorArea);
}

describe("编辑命令", () => {
    it("每条声明都被命令表接受", () => {
        for (const id of ids) {
            const commandId = editingCommandId(id);
            expect(commandDeclarationProblems(commandId, "nbook.editor", EDITING_COMMAND_DECLARATIONS[commandId])).toEqual([]);
        }
    });

    it("`when` 引用的键都已声明，勾选状态的键也都已声明", () => {
        const declared = new Set<string>((Object.keys(editorState.declarations) as Array<keyof typeof editorState.declarations>).map((name) => editorState.key(name)));
        for (const declaration of Object.values(EDITING_COMMAND_DECLARATIONS)) {
            for (const key of declaration.when?.requires ?? []) expect(declared.has(key), key).toBe(true);
        }
        for (const info of Object.values(EDITING_ACTIONS)) {
            if ("format" in info) expect(declared.has(`nbook.editor/${info.format}`), info.format).toBe(true);
        }
    });

    it("带参数的动作才要参数，其余可以从命令面板执行", () => {
        for (const id of ids) {
            const properties = (EDITING_COMMAND_DECLARATIONS[editingCommandId(id)]?.args as {properties?: object} | undefined)?.properties ?? {};
            expect(Object.keys(properties).length > 0, id).toBe("args" in EDITING_ACTIONS[id]);
        }
    });

    it("执行转给活动控件，控件拒绝时是 unavailable 与原因", async () => {
        const calls: Array<[string, unknown]> = [];
        let accept = true;
        const editing = {
            run: (action: string, args: unknown) => {
                calls.push([action, args]);
                return accept ? {ok: true} : {ok: false, reason: "不行"};
            },
        } as unknown as EditorEditing;
        const commands = editingCommands(areaWith(editing));
        expect(await commands["nbook.edit.bold"]?.run({})).toEqual({ok: true, value: null});
        expect(calls).toEqual([["bold", {}]]);
        accept = false;
        expect(await commands["nbook.edit.bold"]?.run({})).toEqual({ok: false, code: "unavailable", reason: "不行"});
    });

    it("活动控件没有编辑动作（例如源码编辑器）时 unavailable，不静默成功", async () => {
        const result = await editingCommands(areaWith(undefined))["nbook.edit.bold"]?.run({});
        expect(result).toMatchObject({ok: false, code: "unavailable"});
    });
});
