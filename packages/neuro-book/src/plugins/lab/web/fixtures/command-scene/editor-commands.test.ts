/** 编辑器的四条命令（workbench.commands 第一批）：真实的命令表，编辑器句柄按合同只实现被调用的方法。 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import type {ContextValues} from "nbook/plugins/commands/shared/context-keys";
import type {CommandResult} from "nbook/plugins/commands/shared/contracts";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";

import type {CommandEditorBinding, CommandEditorHandle, EditorLineNavigation} from "./editor-binding";
import {registerEditorCommands} from "./editor-commands";
import {LAB_CONTEXT_KEYS} from "./lab-context-keys";

const target = {workspaceKey: "lab", generation: 3, documentId: "lab-doc:navigation", path: "lab/navigation.txt"};

function value<T>(result: CommandResult<T>): T {
    if (!result.ok) throw new Error(`${result.code}：${result.reason}`);
    return result.value;
}

function harness() {
    let context: ContextValues = {"editor-active": true, "editor-writable": true, "editor-line-navigation": true};
    let binding: CommandEditorBinding | null = null;
    const registry = createCommandRegistry({contextKeys: contextTable(LAB_CONTEXT_KEYS, () => context), report: () => undefined});
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

function handle(overrides: Partial<CommandEditorHandle> = {}): CommandEditorHandle {
    return {flushPendingChange: () => undefined, focus: () => undefined, ...overrides};
}

/** 记下跳转的行；行数固定为 total。 */
function navigation(total: number | null): EditorLineNavigation & {revealed: number[]} {
    const revealed: number[] = [];
    return {revealed, getLineCount: () => total, revealLine: (line) => {
        revealed.push(line);
        return {ok: true, value: {line}};
    }};
}

describe("registerEditorCommands", () => {
    it("一次登记四条命令，when、effect、暴露与分类按合同；释放后全部离开", () => {
        const app = harness();
        const release = value(registerEditorCommands(app.registry, app.getActive));
        expect(app.registry.list().map((command) => command.id)).toEqual(["nbook.editor.focus", "nbook.edit.undo", "nbook.edit.redo", "nbook.editor.go-to-line"]);
        expect(value(app.registry.get("nbook.editor.focus"))).toMatchObject({category: {"zh-CN": "编辑器"}, effect: "read", when: {requires: ["editor-active"]}, expose: {agent: "auto"}});
        expect(value(app.registry.get("nbook.edit.undo"))).toMatchObject({category: {"zh-CN": "编辑"}, effect: "write", when: {requires: ["editor-active", "editor-writable"]}, expose: {agent: "confirm"}});
        expect(value(app.registry.get("nbook.edit.redo"))).toMatchObject({effect: "write", expose: {agent: "never"}});
        expect(value(app.registry.get("nbook.editor.go-to-line"))).toMatchObject({effect: "read", when: {requires: ["editor-active", "editor-line-navigation"]}, expose: {human: false, agent: "auto"}});
        release();
        expect(app.registry.list()).toEqual([]);
    });

    it("中途登记失败：先撤掉已登记的再报告，命令表里只剩原来的那条", () => {
        const app = harness();
        value(app.registry.register({
            id: "nbook.edit.redo",
            source: "nbook.test",
            declaration: {title: {"zh-CN": "已有", "en-US": "Existing"}, description: "already here", args: Type.Object({}, {additionalProperties: false}), effect: "read"},
            run: () => ({ok: true, value: null}),
        }));
        const result = registerEditorCommands(app.registry, app.getActive);
        expect(result.ok ? "" : result.code).toBe("invalid-args");
        expect(app.registry.list().map((command) => [command.id, command.description])).toEqual([["nbook.edit.redo", "already here"]]);
    });

    it("聚焦交给当前句柄；没有活动编辑器时得到 unavailable", async () => {
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        expect(await app.registry.execute("nbook.editor.focus")).toMatchObject({ok: false, code: "unavailable"});
        let focused = 0;
        app.setBinding({target, handle: handle({focus: () => {
            focused += 1;
        }}), readonly: false});
        expect(await app.registry.execute("nbook.editor.focus")).toEqual({ok: true, value: null});
        expect(focused).toBe(1);
    });

    it("撤销与重做前后各交出一次缓冲输入；句柄没有对应方法时得到 unavailable", async () => {
        const app = harness();
        const calls: string[] = [];
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({target, handle: handle({flushPendingChange: () => calls.push("flush"), undo: () => calls.push("undo"), redo: () => calls.push("redo")}), readonly: false});
        expect(await app.registry.execute("nbook.edit.undo")).toEqual({ok: true, value: null});
        expect(await app.registry.execute("nbook.edit.redo")).toEqual({ok: true, value: null});
        expect(calls).toEqual(["flush", "undo", "flush", "flush", "redo", "flush"]);

        app.setBinding({target, handle: handle(), readonly: false});
        expect(await app.registry.execute("nbook.edit.undo")).toMatchObject({ok: false, code: "unavailable"});
        expect(await app.registry.execute("nbook.edit.redo")).toMatchObject({ok: false, code: "unavailable"});
    });

    it("只读文档：撤销与重做不可用，跳转到行照常", async () => {
        const app = harness();
        const lines = navigation(60);
        value(registerEditorCommands(app.registry, app.getActive));
        app.setContext({"editor-active": true, "editor-writable": false, "editor-line-navigation": true});
        app.setBinding({target, handle: handle({undo: () => undefined, navigation: lines}), readonly: true});
        expect(await app.registry.execute("nbook.edit.undo")).toMatchObject({ok: false, code: "unavailable"});
        expect(await app.registry.execute("nbook.edit.redo")).toMatchObject({ok: false, code: "unavailable"});
        expect(await app.registry.execute("nbook.editor.go-to-line", {target, line: 15})).toEqual({ok: true, value: {line: 15}});
        expect(lines.revealed).toEqual([15]);
    });

    it("跳转到行：目标换代得到 stale-target，越界得到 invalid-args，不支持或未就绪得到 unavailable", async () => {
        const app = harness();
        const lines = navigation(60);
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({target, handle: handle({navigation: lines}), readonly: false});
        expect(await app.registry.execute("nbook.editor.go-to-line", {target: {...target, generation: 2}, line: 15})).toMatchObject({ok: false, code: "stale-target"});
        expect(await app.registry.execute("nbook.editor.go-to-line", {target, line: 61})).toMatchObject({ok: false, code: "invalid-args"});
        expect(lines.revealed).toEqual([]);

        app.setBinding({target, handle: handle(), readonly: false});
        expect(await app.registry.execute("nbook.editor.go-to-line", {target, line: 15})).toMatchObject({ok: false, code: "unavailable"});
        app.setBinding({target, handle: handle({navigation: navigation(null)}), readonly: false});
        expect(await app.registry.execute("nbook.editor.go-to-line", {target, line: 15})).toMatchObject({ok: false, code: "unavailable"});
    });

    it("跳转到行的参数按 schema 严格校验：多余字段、代次为 0、缺字段、非整数、超出 safe integer", async () => {
        const app = harness();
        value(registerEditorCommands(app.registry, app.getActive));
        app.setBinding({target, handle: handle({navigation: navigation(60)}), readonly: false});
        for (const args of [
            {target, line: 1, extra: true},
            {target: {...target, generation: 0}, line: 1},
            {target: {workspaceKey: "lab", generation: 3, documentId: "lab-doc:navigation"}, line: 1},
            {target, line: 1.5},
            {target, line: 0},
            {target, line: Number.MAX_SAFE_INTEGER + 1},
        ]) {
            expect(await app.registry.execute("nbook.editor.go-to-line", args)).toMatchObject({ok: false, code: "invalid-args"});
        }
    });
});
