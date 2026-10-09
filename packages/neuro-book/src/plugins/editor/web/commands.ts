/**
 * 编辑器的命令（docs/specs/workbench/editor.md 的命令表，docs/specs/workbench/commands.md 的第一批编辑器命令）：作用于
 * 活动编辑组的活动标签。编辑器区还没建立时为 `unavailable`，不静默成功。键位不写进声明：由编辑器区在自己有焦点时
 * 处理并执行同一条命令，命令面板里这些命令始终可选。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import type {ShallowRef} from "@vue/reactivity";

import type {CommandDeclaration, CommandImplementation, CommandResult} from "nbook/plugins/commands/shared/contracts";

import type {ActionResult, EditorArea} from "./area";
import {editorState} from "./state";

export const OPEN_COMMAND = "nbook.editor.open";
export const SAVE_COMMAND = "nbook.editor.save";
export const SAVE_ALL_COMMAND = "nbook.editor.save-all";
export const REVERT_COMMAND = "nbook.editor.revert";
export const CLOSE_COMMAND = "nbook.editor.close";
export const CLOSE_OTHERS_COMMAND = "nbook.editor.close-others";
export const SPLIT_RIGHT_COMMAND = "nbook.editor.split-right";
export const SPLIT_DOWN_COMMAND = "nbook.editor.split-down";
export const REOPEN_WITH_COMMAND = "nbook.editor.reopen-with";
export const FOCUS_COMMAND = "nbook.editor.focus";
export const UNDO_COMMAND = "nbook.edit.undo";
export const REDO_COMMAND = "nbook.edit.redo";
export const GO_TO_LINE_COMMAND = "nbook.editor.go-to-line";

const EDITOR = {"zh-CN": "编辑器", "en-US": "Editor"};
const EDIT = {"zh-CN": "编辑", "en-US": "Edit"};
const NO_ARGS = Type.Object({}, {additionalProperties: false});
const when = (...names: ReadonlyArray<keyof typeof editorState.declarations & string>) => ({requires: names.map((name) => editorState.key(name))});
const title = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});

const OPEN_ARGS = Type.Object({
    address: Type.String(),
    mode: Type.Union([Type.Literal("preview"), Type.Literal("permanent")]),
    editor: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("code")])),
}, {additionalProperties: false});

/** 不给 `editor` 时换成另一种（命令面板里不必手写参数）。 */
const REOPEN_ARGS = Type.Object({editor: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("code")]))}, {additionalProperties: false});

const GO_TO_LINE_ARGS = Type.Object({
    target: Type.Object({
        workspaceKey: Type.String(),
        generation: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
        documentId: Type.String(),
        path: Type.String(),
    }, {additionalProperties: false}),
    line: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
}, {additionalProperties: false});

export const EDITOR_COMMAND_DECLARATIONS: Readonly<Record<string, CommandDeclaration>> = {
    [OPEN_COMMAND]: {title: title("打开文件", "Open File"), category: EDITOR, description: "Open a resource address in the active editor group; preview tabs are replaced by the next preview open.", args: OPEN_ARGS, effect: "read", expose: {human: false, agent: "auto"}},
    [SAVE_COMMAND]: {title: title("保存", "Save"), category: EDITOR, description: "Save the active document against its disk baseline; a changed disk is reported as a conflict, never overwritten.", args: NO_ARGS, effect: "write", when: when("dirty"), expose: {agent: "confirm"}},
    [SAVE_ALL_COMMAND]: {title: title("全部保存", "Save All"), category: EDITOR, description: "Save every open document with unsaved changes.", args: NO_ARGS, effect: "write", expose: {agent: "confirm"}},
    [REVERT_COMMAND]: {title: title("还原为磁盘版本", "Revert to Disk Version"), category: EDITOR, description: "Discard the active document's unsaved changes and reload it from disk.", args: NO_ARGS, effect: "write", when: when("active"), expose: {agent: "never", hints: {destructive: true}}},
    [CLOSE_COMMAND]: {title: title("关闭编辑器", "Close Editor"), category: EDITOR, description: "Close the active tab; asks first when its document has unsaved changes.", args: NO_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [CLOSE_OTHERS_COMMAND]: {title: title("关闭其它编辑器", "Close Other Editors"), category: EDITOR, description: "Close the other tabs in the active group.", args: NO_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [SPLIT_RIGHT_COMMAND]: {title: title("向右拆分编辑器", "Split Editor Right"), category: EDITOR, description: "Open the active document in a new group to the right.", args: NO_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [SPLIT_DOWN_COMMAND]: {title: title("向下拆分编辑器", "Split Editor Down"), category: EDITOR, description: "Open the active document in a new group below.", args: NO_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [REOPEN_WITH_COMMAND]: {title: title("用其它编辑器重新打开", "Reopen Editor With"), category: EDITOR, description: "Reopen the active tab with the Markdown or the source editor; without an editor, switch to the other one.", args: REOPEN_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [FOCUS_COMMAND]: {title: title("聚焦编辑器", "Focus Editor"), category: EDITOR, description: "Focus the active editor.", args: NO_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [UNDO_COMMAND]: {title: title("撤销", "Undo"), category: EDIT, description: "Undo the latest edit in the active editor.", args: NO_ARGS, effect: "write", when: when("active", "writable"), expose: {agent: "confirm"}},
    [REDO_COMMAND]: {title: title("重做", "Redo"), category: EDIT, description: "Redo the latest undone edit in the active editor.", args: NO_ARGS, effect: "write", when: when("active", "writable"), expose: {agent: "never"}},
    // 参数由面板的 `:N` 合成，不在候选里摆一个要手写 JSON 的半成品动作。
    [GO_TO_LINE_COMMAND]: {title: title("跳转到行", "Go to Line"), category: EDITOR, description: "Move the caret to a one-based line in the specified active document.", args: GO_TO_LINE_ARGS, effect: "read", when: when("active", "lineNavigation"), expose: {human: false, agent: "auto"}},
};

const unavailable = (reason: string): CommandResult<unknown> => ({ok: false, code: "unavailable", reason});
const fromAction = (result: ActionResult): CommandResult<unknown> => (result.ok ? {ok: true, value: null} : unavailable(result.reason));

/** 命令的实现：执行时才问编辑器区，不在登记时捕获。 */
export function editorCommands(area: Readonly<ShallowRef<EditorArea | null>>): Record<string, CommandImplementation> {
    const run = (action: (current: EditorArea, args: unknown) => CommandResult<unknown> | Promise<CommandResult<unknown>>): CommandImplementation => ({
        run: (args) => {
            const current = area.value;
            if (current === null) return unavailable("编辑器尚未就绪");
            return action(current, args);
        },
    });
    /** 写入类动作前后各交出一次缓冲输入：文档立刻看到撤销后的正文，而不是等编辑器自己的防抖。 */
    const edit = (current: EditorArea, name: "undo" | "redo"): CommandResult<unknown> => {
        const handle = current.activeHandle.value;
        const method = handle?.[name];
        if (handle === null || method === undefined) return unavailable(name === "undo" ? "当前编辑器不支持撤销" : "当前编辑器不支持重做");
        handle.flushPendingChange();
        method.call(handle);
        handle.flushPendingChange();
        return {ok: true, value: null};
    };
    return {
        [OPEN_COMMAND]: run((current, args) => {
            const {address, mode, editor} = args as Static<typeof OPEN_ARGS>;
            return fromAction(current.open(address, editor === undefined ? {mode} : {mode, editor}));
        }),
        [SAVE_COMMAND]: run(async (current) => fromAction(await current.save())),
        [SAVE_ALL_COMMAND]: run(async (current) => fromAction(await current.saveAll())),
        [REVERT_COMMAND]: run(async (current) => fromAction(await current.revert())),
        [CLOSE_COMMAND]: run(async (current) => {
            const tab = current.groups.activeTab();
            if (tab === null) return unavailable("没有活动标签");
            return (await current.close(tab.id)) === "closed" ? {ok: true, value: null} : unavailable("用户取消了关闭");
        }),
        [CLOSE_OTHERS_COMMAND]: run(async (current) => {
            const tab = current.groups.activeTab();
            if (tab === null) return unavailable("没有活动标签");
            await current.closeOthers(tab.id);
            return {ok: true, value: null};
        }),
        [SPLIT_RIGHT_COMMAND]: run((current) => fromAction(current.split("right"))),
        [SPLIT_DOWN_COMMAND]: run((current) => fromAction(current.split("down"))),
        [REOPEN_WITH_COMMAND]: run((current, args) => {
            const chosen = (args as Static<typeof REOPEN_ARGS>).editor;
            const tab = current.groups.activeTab();
            if (tab === null) return unavailable("没有活动标签");
            return fromAction(current.reopenWith(chosen ?? (tab.editor === "markdown" ? "code" : "markdown")));
        }),
        [FOCUS_COMMAND]: run((current) => {
            const handle = current.activeHandle.value;
            if (handle === null) return unavailable("当前没有可聚焦的编辑器");
            handle.focus();
            return {ok: true, value: null};
        }),
        [UNDO_COMMAND]: run((current) => edit(current, "undo")),
        [REDO_COMMAND]: run((current) => edit(current, "redo")),
        [GO_TO_LINE_COMMAND]: run((current, args) => {
            const {target, line} = args as Static<typeof GO_TO_LINE_ARGS>;
            const document = current.activeDocument.value;
            const handle = current.activeHandle.value;
            if (document === null || handle === null) return unavailable("当前没有活动编辑器");
            const active = document.target.value;
            if (active.workspaceKey !== target.workspaceKey || active.generation !== target.generation || active.documentId !== target.documentId || active.path !== target.path) return {ok: false, code: "stale-target", reason: "目标编辑器已关闭或切换"};
            const navigation = handle.navigation;
            if (navigation === undefined) return unavailable("当前编辑器不支持行号跳转");
            const total = navigation.getLineCount();
            if (total === null) return unavailable("编辑器尚未就绪");
            if (line > total) return {ok: false, code: "invalid-args", reason: `行号超出范围：${String(line)}（共 ${String(total)} 行）`};
            const revealed = navigation.revealLine(line);
            return revealed.ok ? {ok: true, value: revealed.value} : unavailable(revealed.reason);
        }),
    };
}
