// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";
import {Type} from "typebox";
import {provideWorkbenchCommands, useWorkbenchCommands, type WorkbenchCommandsHost} from "nbook/app/composables/useWorkbenchCommands";
import type {CommandEditorBinding} from "nbook/app/components/editor-workbench/editor-view.types";

const target = {workspaceKey: "lab:code-editor-view", generation: 1, documentId: "lab-doc:a.txt", path: "lab/a.txt"};

function binding(overrides: Partial<CommandEditorBinding> = {}): CommandEditorBinding {
    return {target, handle: {flushPendingChange: () => "settled", focus: () => undefined}, readonly: false, ...overrides};
}

/** 每挂一个测试组件就多一个宿主实例；宿主只在 setup 里 provide。 */
function mountHost(): {host: WorkbenchCommandsHost; wrapper: ReturnType<typeof mount>} {
    let host!: WorkbenchCommandsHost;
    const wrapper = mount(defineComponent({
        setup() {
            host = provideWorkbenchCommands({development: false, report: () => undefined});
            return () => h("div");
        },
    }));
    return {host, wrapper};
}

describe("useWorkbenchCommands", () => {
    it("缺提供方时抛出明确错误", () => {
        expect(() => useWorkbenchCommands()).toThrowError("Workbench Commands 尚未由宿主提供。");
    });

    it("两个宿主实例不共享 registry / context / MRU", async () => {
        const first = mountHost();
        const second = mountHost();

        expect(first.host.registry).not.toBe(second.host.registry);
        expect(first.host.context.value).not.toBe(second.host.context.value);

        first.host.registry.registerCommand({
            id: "nbook.quick-open.open",
            titleKey: "workbenchCommands.open",
            description: "open",
            argsSchema: Type.Object({}, {additionalProperties: false}),
            effect: "read",
            run: () => ({ok: true, value: null}),
        });
        first.host.recentCommandIds.value = ["nbook.quick-open.open"];

        expect(first.host.registry.getAllCommands()).toHaveLength(1);
        expect(second.host.registry.getAllCommands()).toEqual([]);
        expect(second.host.recentCommandIds.value).toEqual([]);
        expect(first.host.revision.value).toBe(1);
        expect(second.host.revision.value).toBe(0);

        first.wrapper.unmount();
        second.wrapper.unmount();
    });

    it("编辑器能力键由 activeEditor 派生，panel 打开时 editor-focus 不被冻结", () => {
        const {host, wrapper} = mountHost();

        expect(host.context.value).toMatchObject({
            "editor-active": false,
            "editor-writable": false,
            "editor-line-navigation": false,
        });

        host.context.value = {...host.context.value, "editor-focus": true};
        host.activeEditor.value = binding({handle: {
            flushPendingChange: () => "settled",
            focus: () => undefined,
            navigation: {
                getLineCount: () => 60,
                revealLine: (line: number) => ({ok: true, value: {line}}),
            },
        }});

        expect(host.context.value).toMatchObject({
            "editor-active": true,
            "editor-writable": true,
            "editor-line-navigation": true,
            "editor-focus": true,
        });

        host.openPalette("commands");
        expect(host.context.value["quick-open-visible"]).toBe(true);
        expect(host.context.value["editor-focus"]).toBe(true);

        wrapper.unmount();
    });

    it("面板：首次打开捕获目标副本，已打开时命令模式只加 focusRequest，line 模式原位改 query", () => {
        const {host, wrapper} = mountHost();
        host.activeEditor.value = binding();

        host.openPalette("commands");
        expect(host.palette.open.value).toBe(true);
        expect(host.palette.query.value).toBe(">");
        expect(host.palette.target.value).toEqual(target);
        expect(host.palette.target.value).not.toBe(host.activeEditor.value!.target);
        expect(host.palette.focusRequest.value).toBe(0);

        host.palette.query.value = ":15";
        host.openPalette("commands");
        expect(host.palette.query.value).toBe(":15");
        expect(host.palette.focusRequest.value).toBe(1);
        expect(host.palette.target.value).toEqual(target);

        host.openPalette("line");
        expect(host.palette.query.value).toBe(":");
        expect(host.palette.open.value).toBe(true);
        expect(host.palette.target.value).toEqual(target);

        host.closePalette();
        expect(host.palette.open.value).toBe(false);
        expect(host.palette.target.value).toBeNull();
        expect(host.context.value["quick-open-visible"]).toBe(false);

        wrapper.unmount();
    });

    it("generation 每个宿主从 1 单调递增", () => {
        const first = mountHost();
        const second = mountHost();

        expect([first.host.allocateEditorGeneration(), first.host.allocateEditorGeneration()]).toEqual([1, 2]);
        expect(second.host.allocateEditorGeneration()).toBe(1);

        first.wrapper.unmount();
        second.wrapper.unmount();
    });

    it("宿主卸载释放活动编辑器与面板状态", () => {
        const {host, wrapper} = mountHost();
        host.activeEditor.value = binding();
        host.openPalette("commands");

        wrapper.unmount();

        expect(host.activeEditor.value).toBeNull();
        expect(host.palette.open.value).toBe(false);
        expect(host.palette.target.value).toBeNull();
        expect(host.context.value).toMatchObject({
            "editor-active": false,
            "editor-writable": false,
            "editor-line-navigation": false,
            "quick-open-visible": false,
        });
    });
});
