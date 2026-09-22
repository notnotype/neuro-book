/**
 * 编辑器域的 L1 命令：把「聚焦 / 撤销 / 重做 / 跳转到行」路由到当前活动编辑器句柄。
 *
 * 处理器执行时才问 `getActive()`——注册时捕获句柄会让命令在文档换代后仍操作旧实例。
 * 标准编辑动作只把工作交给已验证的句柄：宿主负责挂上/摘下句柄，命令不自己找编辑器。
 */
import {Type, type TSchema} from "typebox";
import type {CommandDescriptor, CommandRegistry, CommandResult, Release} from "nbook/app/utils/workbench/commands";
import {matchesEditorDocument, type CommandEditorBinding} from "nbook/app/components/editor-workbench/editor-view.types";

const NO_ARGUMENTS = Type.Object({}, {additionalProperties: false});

/** 行号与 generation 都是正 safe integer：越界在 schema 层就被拒，不落到 Monaco。 */
const GO_TO_LINE_ARGUMENTS = Type.Object({
    target: Type.Object({
        workspaceKey: Type.String(),
        generation: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
        documentId: Type.String(),
        path: Type.String(),
    }, {additionalProperties: false}),
    line: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
}, {additionalProperties: false});

/**
 * 一次注册四条标准编辑命令；任何一条失败就先把已注册的撤掉再回报失败，
 * 不留「注册了一半」的注册表。
 */
export function registerEditorCommands(
    registry: CommandRegistry,
    getActive: () => CommandEditorBinding | null,
): CommandResult<Release> {
    const registered: Release[] = [];

    const focus: CommandDescriptor<typeof NO_ARGUMENTS, null> = {
        id: "nbook.editor.focus",
        titleKey: "workbenchCommands.focus",
        description: "Focus the active editor.",
        categoryKey: "workbenchCommands.category.editor",
        argsSchema: NO_ARGUMENTS,
        effect: "read",
        when: {requires: ["editor-active"]},
        expose: {agent: "auto"},
        run: () => {
            const binding = getActive();
            if (!binding || typeof binding.handle.focus !== "function") {
                return {ok: false, code: "unavailable", reason: "当前没有可聚焦的编辑器"};
            }
            binding.handle.focus();
            return {ok: true, value: null};
        },
    };

    const undo: CommandDescriptor<typeof NO_ARGUMENTS, null> = {
        id: "nbook.edit.undo",
        titleKey: "workbenchCommands.undo",
        description: "Undo the latest edit in the active editor.",
        categoryKey: "workbenchCommands.category.edit",
        argsSchema: NO_ARGUMENTS,
        effect: "write",
        when: {requires: ["editor-active", "editor-writable"]},
        expose: {agent: "confirm"},
        run: () => {
            const binding = getActive();
            if (!binding || typeof binding.handle.undo !== "function") {
                return {ok: false, code: "unavailable", reason: "当前编辑器不支持撤销"};
            }
            // 前后各结算一次待结算输入：宿主能立刻看到撤销后的正文，而不是等防抖窗口。
            binding.handle.flushPendingChange();
            binding.handle.undo();
            binding.handle.flushPendingChange();
            return {ok: true, value: null};
        },
    };

    const redo: CommandDescriptor<typeof NO_ARGUMENTS, null> = {
        id: "nbook.edit.redo",
        titleKey: "workbenchCommands.redo",
        description: "Redo the latest undone edit in the active editor.",
        categoryKey: "workbenchCommands.category.edit",
        argsSchema: NO_ARGUMENTS,
        effect: "write",
        when: {requires: ["editor-active", "editor-writable"]},
        expose: {agent: "never"},
        run: () => {
            const binding = getActive();
            if (!binding || typeof binding.handle.redo !== "function") {
                return {ok: false, code: "unavailable", reason: "当前编辑器不支持重做"};
            }
            binding.handle.flushPendingChange();
            binding.handle.redo();
            binding.handle.flushPendingChange();
            return {ok: true, value: null};
        },
    };

    const goToLine: CommandDescriptor<typeof GO_TO_LINE_ARGUMENTS, {line: number}> = {
        id: "nbook.editor.go-to-line",
        titleKey: "workbenchCommands.goToLine",
        description: "Move the caret to a one-based line in the specified active document.",
        categoryKey: "workbenchCommands.category.editor",
        argsSchema: GO_TO_LINE_ARGUMENTS,
        effect: "read",
        when: {requires: ["editor-active", "editor-line-navigation"]},
        // 参数由面板的 `:N` 输入合成，不在候选里暴露需要手写 JSON 的半成品动作
        expose: {human: false, agent: "auto"},
        run: (args) => {
            const binding = getActive();
            if (!binding) {
                return {ok: false, code: "unavailable", reason: "当前没有活动编辑器"};
            }
            if (!matchesEditorDocument(args.target, binding.target)) {
                return {ok: false, code: "stale-target", reason: "目标编辑器已关闭或切换"};
            }
            const navigation = binding.handle.navigation;
            if (!navigation) {
                return {ok: false, code: "unavailable", reason: "当前编辑器不支持行号跳转"};
            }
            const total = navigation.getLineCount();
            if (total === null) {
                return {ok: false, code: "unavailable", reason: "编辑器尚未就绪"};
            }
            if (args.line > total) {
                return {ok: false, code: "invalid-args", reason: `行号超出范围：${args.line}（共 ${total} 行）`};
            }
            const revealed = navigation.revealLine(args.line);
            if (!revealed.ok) {
                return {ok: false, code: "unavailable", reason: revealed.reason};
            }
            return {ok: true, value: {line: revealed.value.line}};
        },
    };

    const step = <S extends TSchema, R>(descriptor: CommandDescriptor<S, R>): string | null => {
        const result = registry.registerCommand(descriptor);
        if (!result.ok) {
            return `${descriptor.id}：${result.reason}`;
        }
        registered.push(result.value);
        return null;
    };

    const failure = step(focus) ?? step(undo) ?? step(redo) ?? step(goToLine);
    if (failure !== null) {
        for (const release of registered) {
            release();
        }
        return {ok: false, code: "invalid-args", reason: `编辑命令注册失败：${failure}`};
    }

    return {
        ok: true,
        value: () => {
            for (const release of registered.splice(0)) {
                release();
            }
        },
    };
}
