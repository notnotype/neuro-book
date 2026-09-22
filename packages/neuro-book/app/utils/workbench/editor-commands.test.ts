import {describe, expect, it, vi} from "vitest";
import {Type, type TSchema} from "typebox";
import {createCommandRegistry, type CommandDescriptor, type CommandResult} from "nbook/app/utils/workbench/commands";
import {registerEditorCommands} from "nbook/app/utils/workbench/editor-commands";
import type {CommandEditorBinding, EditorViewHandle} from "nbook/app/components/editor-workbench/editor-view.types";
import type {ContextValues} from "nbook/app/utils/workbench/context-keys";

const target = {
    workspaceKey: "lab:code-editor-view",
    generation: 3,
    documentId: "lab-doc:lab/command-navigation.txt",
    path: "lab/command-navigation.txt",
};

function value<T>(result: CommandResult<T>): T {
    if (!result.ok) {
        throw new Error(`${result.code}：${result.reason}`);
    }
    return result.value;
}

function harness() {
    let context: ContextValues = {"editor-active": true, "editor-writable": true, "editor-line-navigation": true};
    let binding: CommandEditorBinding | null = null;
    const registry = createCommandRegistry({
        context: () => context,
        agentMode: () => "normal",
        development: false,
        report: () => undefined,
    });
    return {
        registry,
        setContext: (values: ContextValues) => {
            context = values;
        },
        setBinding: (next: CommandEditorBinding | null) => {
            binding = next;
        },
        getActive: () => binding,
    };
}

function handle(overrides: Partial<EditorViewHandle> = {}): EditorViewHandle {
    return {flushPendingChange: () => "settled", focus: () => undefined, ...overrides};
}

describe("registerEditorCommands", () => {
    it("一次注册四条命令，when / effect / 暴露与分类按合同", () => {
        const app = harness();
        const release = value(registerEditorCommands(app.registry, app.getActive));

        expect(app.registry.getAllCommands().map((command) => command.id)).toEqual([
            "nbook.editor.focus",
            "nbook.edit.undo",
            "nbook.edit.redo",
            "nbook.editor.go-to-line",
        ]);
        expect(value(app.registry.getCommand("nbook.editor.focus"))).toMatchObject({
            categoryKey: "workbenchCommands.category.editor",
            effect: "read",
            when: {requires: ["editor-active"]},
            expose: {agent: "auto"},
        });
        expect(value(app.registry.getCommand("nbook.edit.undo"))).toMatchObject({
            categoryKey: "workbenchCommands.category.edit",
            effect: "write",
            when: {requires: ["editor-active", "editor-writable"]},
            expose: {agent: "confirm"},
        });
        expect(value(app.registry.getCommand("nbook.edit.redo"))).toMatchObject({
            effect: "write",
            expose: {agent: "never"},
        });
        expect(value(app.registry.getCommand("nbook.editor.go-to-line"))).toMatchObject({
            effect: "read",
            when: {requires: ["editor-active", "editor-line-navigation"]},
            expose: {agent: "auto"},
        });

        release();
        expect(app.registry.getAllCommands()).toEqual([]);
    });

    it("中途失败先释放已注册项再返回失败", () => {
        const app = harness();
        const existing: CommandDescriptor<TSchema, unknown> = {
            id: "nbook.editor.focus",
            titleKey: "workbenchCommands.focus",
            description: "already here",
            argsSchema: Type.Object({}, {additionalProperties: false}),
            effect: "read",
            run: () => ({ok: true, value: null}),
        };
        app.registry.registerCommand(existing);

        const result = registerEditorCommands(app.registry, app.getActive);

        expect(result.ok).toBe(false);
        expect(result.ok ? "" : result.code).toBe("invalid-args");
        // 已注册的 focus 仍是原来那条，而它后面的三条没有留下半截注册。
        expect(app.registry.getAllCommands().map((command) => command.id)).toEqual(["nbook.editor.focus"]);
        expect(value(app.registry.getCommand("nbook.editor.focus")).description).toBe("already here");
    });

    it("focus 交给当前句柄；没有活动句柄时返回 unavailable", async () => {
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));

        await expect(app.registry.executeCommand("nbook.editor.focus")).resolves.toMatchObject({ok: false, code: "unavailable"});

        const focus = vi.fn();
        app.setBinding({target, handle: handle({focus}), readonly: false});
        await expect(app.registry.executeCommand("nbook.editor.focus")).resolves.toEqual({ok: true, value: null});
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it("undo / redo 前后各冲刷一次待结算输入", async () => {
        const calls: string[] = [];
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({
            target,
            handle: handle({
                flushPendingChange: () => {
                    calls.push("flush");
                    return "settled";
                },
                undo: () => calls.push("undo"),
                redo: () => calls.push("redo"),
            }),
            readonly: false,
        });

        await expect(app.registry.executeCommand("nbook.edit.undo")).resolves.toEqual({ok: true, value: null});
        await expect(app.registry.executeCommand("nbook.edit.redo")).resolves.toEqual({ok: true, value: null});
        expect(calls).toEqual(["flush", "undo", "flush", "flush", "redo", "flush"]);
    });

    it("句柄缺少撤销 / 重做方法时返回 unavailable，不把 optional-call 当成功", async () => {
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({
            target,
            handle: {flushPendingChange: () => "settled", focus: () => undefined},
            readonly: false,
        });

        await expect(app.registry.executeCommand("nbook.edit.undo")).resolves.toMatchObject({ok: false, code: "unavailable"});
        await expect(app.registry.executeCommand("nbook.edit.redo")).resolves.toMatchObject({ok: false, code: "unavailable"});
    });

    it("只读文档：undo / redo 被拒，行导航仍可用", async () => {
        const revealLine = vi.fn((line: number) => ({ok: true as const, value: {line}}));
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        app.setContext({"editor-active": true, "editor-writable": false, "editor-line-navigation": true});
        app.setBinding({
            target,
            handle: handle({
                undo: () => undefined,
                navigation: {getLineCount: () => 60, revealLine},
            }),
            readonly: true,
        });

        await expect(app.registry.executeCommand("nbook.edit.undo")).resolves.toMatchObject({ok: false, code: "unavailable"});
        await expect(app.registry.executeCommand("nbook.edit.redo")).resolves.toMatchObject({ok: false, code: "unavailable"});
        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {target, line: 15})).resolves.toEqual({
            ok: true,
            value: {line: 15},
        });
        expect(revealLine).toHaveBeenCalledWith(15);
    });

    it("go-to-line：目标换代返回 stale-target，越界与未就绪映射到结构失败", async () => {
        const revealLine = vi.fn((line: number) => ({ok: true as const, value: {line}}));
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({
            target,
            handle: handle({navigation: {getLineCount: () => 60, revealLine}}),
            readonly: false,
        });

        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {
            target: {...target, generation: 2},
            line: 15,
        })).resolves.toMatchObject({ok: false, code: "stale-target"});
        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {target, line: 61})).resolves.toMatchObject({
            ok: false,
            code: "invalid-args",
        });
        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {target, line: 0})).resolves.toMatchObject({
            ok: false,
            code: "invalid-args",
        });
        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {target, line: 1.5})).resolves.toMatchObject({
            ok: false,
            code: "invalid-args",
        });
        expect(revealLine).not.toHaveBeenCalled();

        app.setBinding({target, handle: handle(), readonly: false});
        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {target, line: 15})).resolves.toMatchObject({
            ok: false,
            code: "unavailable",
        });

        app.setBinding({
            target,
            handle: handle({navigation: {getLineCount: () => null, revealLine}}),
            readonly: false,
        });
        await expect(app.registry.executeCommand("nbook.editor.go-to-line", {target, line: 15})).resolves.toMatchObject({
            ok: false,
            code: "unavailable",
        });
    });

    it("go-to-line 用 schema 校验 target 四字段与正 safe integer", async () => {
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({
            target,
            handle: handle({navigation: {getLineCount: () => 60, revealLine: (line: number) => ({ok: true, value: {line}})}}),
            readonly: false,
        });

        for (const args of [
            {target, line: 1, extra: true},
            {target: {...target, generation: 0}, line: 1},
            {target: {...target, path: undefined}, line: 1},
            {target, line: Number.MAX_SAFE_INTEGER + 1},
        ]) {
            await expect(app.registry.executeCommand("nbook.editor.go-to-line", args)).resolves.toMatchObject({
                ok: false,
                code: "invalid-args",
            });
        }
    });
});
