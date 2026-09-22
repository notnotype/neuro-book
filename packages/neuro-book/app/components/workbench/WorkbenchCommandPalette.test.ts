// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick} from "vue";
import {Type} from "typebox";
import WorkbenchCommandPalette from "nbook/app/components/workbench/WorkbenchCommandPalette.vue";
import {provideWorkbenchCommands, type WorkbenchCommandsHost} from "nbook/app/composables/useWorkbenchCommands";
import type {CommandEditorBinding} from "nbook/app/components/editor-workbench/editor-view.types";

const target = {workspaceKey: "lab:code-editor-view", generation: 1, documentId: "lab-doc:lab/command-navigation.txt", path: "lab/command-navigation.txt"};

const TITLES: Record<string, string> = {
    "workbenchCommands.focus": "聚焦编辑器",
    "workbenchCommands.undo": "撤销",
    "workbenchCommands.redo": "重做",
    "workbenchCommands.goToLine": "跳转到行",
    "workbenchCommands.openCommands": "命令面板",
    "workbenchCommands.openLine": "跳转到行…",
    "workbenchCommands.category.edit": "编辑",
    "workbenchCommands.palette.title": "命令面板",
    "workbenchCommands.palette.placeholder": "输入命令",
    "workbenchCommands.palette.empty": "没有匹配的命令",
    "workbenchCommands.palette.linePrompt": "输入行号（1–{max}）",
    "workbenchCommands.palette.goToLine": "跳转到第 {line} 行",
    "workbenchCommands.palette.lineInvalid": "行号无效：{text}",
    "workbenchCommands.palette.lineOutOfRange": "行号超出范围：{line}（共 {total} 行）",
    "workbenchCommands.palette.noEditor": "没有活动编辑器",
    "workbenchCommands.palette.editorGone": "原编辑器已关闭或切换",
    "workbenchCommands.palette.lineUnsupported": "当前编辑器不支持行号跳转",
    "workbenchCommands.palette.editorNotReady": "编辑器尚未就绪",
};

function titleOf(key: string, params?: Record<string, unknown>): string {
    const template = TITLES[key] ?? key;
    return params === undefined
        ? template
        : template.replace(/\{(\w+)\}/gu, (_match, name: string) => String(params[name] ?? ""));
}

/** 只保留面板真正依赖的受控面：props 进、事件出；portal 与焦点行为由 QuickInput 自己负责。 */
const QuickInputStub = defineComponent({
    name: "QuickInput",
    props: {
        open: Boolean,
        query: {type: String, default: ""},
        items: {type: Array, default: () => []},
        activeId: {type: String, default: null},
        title: {type: String, default: ""},
        placeholder: {type: String, default: ""},
        emptyText: {type: String, default: ""},
        focusRequest: {type: Number, default: 0},
        restoreFocus: {type: Boolean, default: true},
    },
    emits: ["update:open", "update:query", "update:active-id", "accept", "closed"],
    setup(props, {emit}) {
        return () => h("div", {"data-stub-open": String(props.open)}, [
            h("span", {"data-stub-title": ""}, props.title),
            h("span", {"data-stub-empty": ""}, props.emptyText),
            h("span", {"data-stub-items": ""}, (props.items as {id: string}[]).map((item) => item.id).join(",")),
            h("button", {"data-stub-close": "", onClick: () => emit("update:open", false)}, "close"),
            h("button", {"data-stub-closed": "", onClick: () => emit("closed")}, "closed"),
        ]);
    },
});

function harness() {
    let host!: WorkbenchCommandsHost;
    const wrapper = mount(defineComponent({
        setup() {
            host = provideWorkbenchCommands({development: false, report: () => undefined});
            return () => h(WorkbenchCommandPalette, {host, titleOf});
        },
    }), {global: {stubs: {QuickInput: QuickInputStub}}});
    return {host, wrapper, stub: wrapper.findComponent(QuickInputStub)};
}

function noArguments() {
    return Type.Object({}, {additionalProperties: false});
}

function editorBinding(overrides: Partial<CommandEditorBinding> = {}): CommandEditorBinding {
    return {
        target,
        handle: {
            flushPendingChange: () => "settled",
            focus: () => undefined,
            navigation: {getLineCount: () => 60, revealLine: (line: number) => ({ok: true, value: {line}})},
        },
        readonly: false,
        ...overrides,
    };
}

describe("WorkbenchCommandPalette", () => {
    it("候选只含 human!=false 且 when 满足的命令", async () => {
        const app = harness();
        app.host.registry.registerCommand({
            id: "nbook.edit.undo",
            titleKey: "workbenchCommands.undo",
            description: "undo",
            argsSchema: noArguments(),
            effect: "write",
            when: {requires: ["editor-active", "editor-writable"]},
            run: () => ({ok: true, value: null}),
        });
        app.host.registry.registerCommand({
            id: "nbook.quick-open.open-commands",
            titleKey: "workbenchCommands.openCommands",
            description: "palette",
            argsSchema: noArguments(),
            effect: "read",
            expose: {human: false},
            run: () => ({ok: true, value: null}),
        });

        app.host.openPalette("commands");
        await nextTick();
        expect(app.stub.get("[data-stub-items]").text()).toBe("");

        app.host.activeEditor.value = editorBinding();
        await nextTick();
        expect(app.stub.get("[data-stub-items]").text()).toBe("nbook.edit.undo");
        expect(app.stub.get("[data-stub-title]").text()).toBe("命令面板");
        app.wrapper.unmount();
    });

    it("accept 关闭面板、closed 之后才执行一次；重复 accept 忽略", async () => {
        const app = harness();
        const run = vi.fn(() => ({ok: true, value: null}) as const);
        app.host.registry.registerCommand({
            id: "nbook.edit.undo",
            titleKey: "workbenchCommands.undo",
            description: "undo",
            argsSchema: noArguments(),
            effect: "write",
            run,
        });
        app.host.activeEditor.value = editorBinding();
        app.host.openPalette("commands");

        app.stub.vm.$emit("accept", "nbook.edit.undo");
        app.stub.vm.$emit("accept", "nbook.edit.undo");
        await nextTick();

        expect(app.host.palette.open.value).toBe(false);
        expect(app.stub.get("[data-stub-open]").attributes("data-stub-open")).toBe("false");
        expect(run).not.toHaveBeenCalled();

        app.stub.vm.$emit("closed");
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        app.wrapper.unmount();
    });

    it("行号模式：非法输入不产生候选并显示原因，合法输入执行 go-to-line", async () => {
        const app = harness();
        const goToLine = vi.fn(() => ({ok: true, value: {line: 15}}) as const);
        app.host.registry.registerCommand({
            id: "nbook.editor.go-to-line",
            titleKey: "workbenchCommands.goToLine",
            description: "go to line",
            argsSchema: Type.Object({
                target: Type.Object({
                    workspaceKey: Type.String(),
                    generation: Type.Integer({minimum: 1}),
                    documentId: Type.String(),
                    path: Type.String(),
                }, {additionalProperties: false}),
                line: Type.Integer({minimum: 1}),
            }, {additionalProperties: false}),
            effect: "read",
            run: goToLine,
        });
        app.host.activeEditor.value = editorBinding();
        app.host.openPalette("commands");

        app.host.openPalette("line");
        await nextTick();
        expect(app.host.palette.query.value).toBe(":");
        expect(app.stub.get("[data-stub-empty]").text()).toBe("输入行号（1–60）");

        app.host.palette.query.value = ":0";
        await nextTick();
        expect(app.stub.get("[data-stub-items]").text()).toBe("");
        expect(app.stub.get("[data-stub-empty]").text()).toContain("行号无效");

        app.host.palette.query.value = ":61";
        await nextTick();
        expect(app.stub.get("[data-stub-items]").text()).toBe("");
        expect(app.stub.get("[data-stub-empty]").text()).toContain("超出范围");

        app.host.palette.query.value = ":15";
        await nextTick();
        expect(app.stub.get("[data-stub-items]").text()).toBe("quick-open:line");

        app.stub.vm.$emit("accept", "quick-open:line");
        await nextTick();
        app.stub.vm.$emit("closed");
        await vi.waitFor(() => expect(goToLine).toHaveBeenCalledTimes(1));
        expect(goToLine).toHaveBeenCalledWith({target, line: 15});
        app.wrapper.unmount();
    });

    it("关闭期间文档换代：这次选择作废，不执行", async () => {
        const app = harness();
        const run = vi.fn(() => ({ok: true, value: null}) as const);
        app.host.registry.registerCommand({
            id: "nbook.edit.undo",
            titleKey: "workbenchCommands.undo",
            description: "undo",
            argsSchema: noArguments(),
            effect: "write",
            run,
        });
        app.host.activeEditor.value = editorBinding();
        app.host.openPalette("commands");

        app.stub.vm.$emit("accept", "nbook.edit.undo");
        await nextTick();
        app.host.activeEditor.value = editorBinding({target: {...target, generation: 2}});
        app.stub.vm.$emit("closed");
        await nextTick();

        expect(run).not.toHaveBeenCalled();
        app.wrapper.unmount();
    });

    it("open-line 是同层切换：面板不关、查询原位改成 `:`；成功执行更新 MRU", async () => {
        const app = harness();
        app.host.registry.registerCommand({
            id: "nbook.quick-open.open-line",
            titleKey: "workbenchCommands.openLine",
            description: "line mode",
            argsSchema: noArguments(),
            effect: "read",
            when: {requires: ["editor-line-navigation"]},
            run: () => {
                app.host.openPalette("line");
                return {ok: true, value: null};
            },
        });
        app.host.activeEditor.value = editorBinding();
        app.host.openPalette("commands");
        await nextTick();

        app.stub.vm.$emit("accept", "nbook.quick-open.open-line");
        await vi.waitFor(() => expect(app.host.palette.query.value).toBe(":"));
        expect(app.host.palette.open.value).toBe(true);
        await vi.waitFor(() => expect(app.host.recentCommandIds.value).toEqual(["nbook.quick-open.open-line"]));
        app.wrapper.unmount();
    });

    it("失败的面板选中项不写入 MRU", async () => {
        const app = harness();
        app.host.registry.registerCommand({
            id: "nbook.edit.undo",
            titleKey: "workbenchCommands.undo",
            description: "undo",
            argsSchema: noArguments(),
            effect: "write",
            run: () => ({ok: false, code: "unavailable", reason: "不行"}),
        });
        app.host.activeEditor.value = editorBinding();
        app.host.openPalette("commands");

        app.stub.vm.$emit("accept", "nbook.edit.undo");
        await nextTick();
        app.stub.vm.$emit("closed");
        await nextTick();

        expect(app.host.recentCommandIds.value).toEqual([]);
        app.wrapper.unmount();
    });
});
