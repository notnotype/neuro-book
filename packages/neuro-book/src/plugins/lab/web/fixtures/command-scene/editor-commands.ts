/**
 * 编辑器的四条命令（workbench.commands 第一批）：把聚焦、撤销、重做、跳转到行交给当前活动编辑器的句柄。
 *
 * 编辑器插件（第 5 步）就绪前只在 Lab 命令场景的本地命令表里登记，届时随编辑器插件迁走、改经贡献点提交。
 * 处理函数执行时才问 `getActive()`：登记时捕获句柄，文档换代后命令仍会操作旧实例。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {CommandDeclaration, CommandResult, Release} from "nbook/plugins/commands/shared/contracts";
import type {CommandRegistry} from "nbook/plugins/commands/shared/registry";

import {matchesEditorDocument} from "./editor-binding";
import type {CommandEditorBinding} from "./editor-binding";

/** 登记方：编辑器插件迁入前由 Lab 代为登记。 */
const SOURCE = "nbook.lab";
const NO_ARGS = Type.Object({}, {additionalProperties: false});

/** 行号与代次都是正 safe integer：越界在 schema 层就被拒，不落到编辑器。 */
const GO_TO_LINE_ARGS = Type.Object({
    target: Type.Object({
        workspaceKey: Type.String(),
        generation: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
        documentId: Type.String(),
        path: Type.String(),
    }, {additionalProperties: false}),
    line: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
}, {additionalProperties: false});

const EDITOR = {"zh-CN": "编辑器", "en-US": "Editor"};
const EDIT = {"zh-CN": "编辑", "en-US": "Edit"};

type Definition = Readonly<{id: string; declaration: CommandDeclaration; run: (args: unknown) => CommandResult<unknown>}>;

/** 写入类动作前后各交出一次缓冲输入：宿主立刻看到撤销后的正文，而不是等编辑器自己的防抖。 */
function editAction(binding: CommandEditorBinding, action: () => void): CommandResult<unknown> {
    binding.handle.flushPendingChange();
    action();
    binding.handle.flushPendingChange();
    return {ok: true, value: null};
}

function definitions(getActive: () => CommandEditorBinding | null): Definition[] {
    return [
        {
            id: "nbook.editor.focus",
            declaration: {title: {"zh-CN": "聚焦编辑器", "en-US": "Focus Editor"}, category: EDITOR, description: "Focus the active editor.", args: NO_ARGS, effect: "read", when: {requires: ["editor-active"]}, expose: {agent: "auto"}},
            run: () => {
                const handle = getActive()?.handle;
                if (handle?.focus === undefined) return {ok: false, code: "unavailable", reason: "当前没有可聚焦的编辑器"};
                handle.focus();
                return {ok: true, value: null};
            },
        },
        {
            id: "nbook.edit.undo",
            declaration: {title: {"zh-CN": "撤销", "en-US": "Undo"}, category: EDIT, description: "Undo the latest edit in the active editor.", args: NO_ARGS, effect: "write", when: {requires: ["editor-active", "editor-writable"]}, expose: {agent: "confirm"}},
            run: () => {
                const binding = getActive();
                const undo = binding?.handle.undo;
                if (binding === null || undo === undefined) return {ok: false, code: "unavailable", reason: "当前编辑器不支持撤销"};
                return editAction(binding, () => undo.call(binding.handle));
            },
        },
        {
            id: "nbook.edit.redo",
            declaration: {title: {"zh-CN": "重做", "en-US": "Redo"}, category: EDIT, description: "Redo the latest undone edit in the active editor.", args: NO_ARGS, effect: "write", when: {requires: ["editor-active", "editor-writable"]}, expose: {agent: "never"}},
            run: () => {
                const binding = getActive();
                const redo = binding?.handle.redo;
                if (binding === null || redo === undefined) return {ok: false, code: "unavailable", reason: "当前编辑器不支持重做"};
                return editAction(binding, () => redo.call(binding.handle));
            },
        },
        {
            id: "nbook.editor.go-to-line",
            declaration: {
                title: {"zh-CN": "跳转到行", "en-US": "Go to Line"},
                category: EDITOR,
                description: "Move the caret to a one-based line in the specified active document.",
                args: GO_TO_LINE_ARGS,
                effect: "read",
                when: {requires: ["editor-active", "editor-line-navigation"]},
                // 参数由面板的 `:N` 合成，不在候选里摆一个要手写 JSON 的半成品动作。
                expose: {human: false, agent: "auto"},
            },
            run: (args) => {
                const {target, line} = args as Static<typeof GO_TO_LINE_ARGS>;
                const binding = getActive();
                if (binding === null) return {ok: false, code: "unavailable", reason: "当前没有活动编辑器"};
                if (!matchesEditorDocument(target, binding.target)) return {ok: false, code: "stale-target", reason: "目标编辑器已关闭或切换"};
                const navigation = binding.handle.navigation;
                if (navigation === undefined) return {ok: false, code: "unavailable", reason: "当前编辑器不支持行号跳转"};
                const total = navigation.getLineCount();
                if (total === null) return {ok: false, code: "unavailable", reason: "编辑器尚未就绪"};
                if (line > total) return {ok: false, code: "invalid-args", reason: `行号超出范围：${line}（共 ${total} 行）`};
                const revealed = navigation.revealLine(line);
                return revealed.ok ? {ok: true, value: revealed.value} : {ok: false, code: "unavailable", reason: revealed.reason};
            },
        },
    ];
}

/** 一次登记四条命令；任何一条失败就撤掉已登记的再报告，不留登记了一半的命令表。 */
export function registerEditorCommands(registry: CommandRegistry, getActive: () => CommandEditorBinding | null): CommandResult<Release> {
    const registered: Release[] = [];
    for (const definition of definitions(getActive)) {
        const result = registry.register({...definition, source: SOURCE});
        if (!result.ok) {
            for (const release of registered) release();
            return {ok: false, code: "invalid-args", reason: `编辑器命令登记失败：${definition.id}：${result.reason}`};
        }
        registered.push(result.value);
    }
    return {ok: true, value: () => {
        for (const release of registered.splice(0)) release();
    }};
}
