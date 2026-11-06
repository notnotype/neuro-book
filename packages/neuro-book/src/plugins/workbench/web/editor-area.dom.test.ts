/**
 * 编辑器槽里挂的组件（WorkbenchShell.md 的“编辑器”、docs/specs/ui/workbench-shell.md 的“页面自己加载首屏、自己标画出”）：
 * 提供者的组件加载期间编辑组里是带 aria-busy 的“正在加载编辑器”，加载完换成提供者的组件；加载失败写出原因、不再带 aria-busy。
 * 外壳给组的属性只到提供者的组件上。区级组件没有地方显示这些，什么都不画；提供者只加载一次。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";
import type {Component} from "vue";

import type {EditorAreaParts} from "./contracts";
import {workbenchTestText} from "../testing/text";
import {mountEditorArea} from "./editor-area";
import type {EditorAreaProvider} from "./editor-area";

/** 由测试决定何时完成的加载。 */
function deferredProvider(): {readonly provider: EditorAreaProvider; readonly loads: () => number; resolve(component: Component): void; reject(error: Error): void} {
    const settle: {resolve: (parts: EditorAreaParts) => void; reject: (error: Error) => void} = {resolve: () => undefined, reject: () => undefined};
    const promise = new Promise<EditorAreaParts>((resolve, reject) => Object.assign(settle, {resolve, reject}));
    let loads = 0;
    return {
        provider: {id: "test.area", load: () => {
            loads += 1;
            return promise;
        }},
        loads: () => loads,
        resolve: (component) => settle.resolve({host: Host, group: component}),
        reject: (error) => settle.reject(error),
    };
}

const Host = defineComponent({name: "TestHost", setup: () => () => h("div", {"data-test-host": ""})});

const Editor = defineComponent({
    name: "TestEditor",
    props: {context: {type: Object, required: true}},
    setup: () => () => h("div", {"data-test-editor": ""}),
});

/** 像外壳那样挂进槽里：带 `context` 与槽的标记；加载失败经应用的错误处理报上来。 */
function mountSlot(provider: EditorAreaProvider) {
    const errors: unknown[] = [];
    const {host, group} = mountEditorArea(provider, workbenchTestText("zh-CN"));
    const wrapper = mount(defineComponent({setup: () => () => [h(host), h(group, {"context": {visible: true}, "panelId": "g0", "data-workbench-editor-area": ""}), h(group, {"context": {visible: true}, "panelId": "g1"})]}), {
        global: {config: {errorHandler: (error) => errors.push(error)}},
    });
    return {wrapper, errors};
}

describe("编辑器槽的组件", () => {
    it("加载期间是带 aria-busy 的“正在加载编辑器”，外壳给的属性不落到占位上；加载完换成提供者的组件，aria-busy 撤掉", async () => {
        const area = deferredProvider();
        const {wrapper} = mountSlot(area.provider);
        await flushPromises();
        const loading = wrapper.findAll("[aria-busy=\"true\"]")[0]!;
        expect(loading.attributes("role")).toBe("status");
        expect(loading.text()).toBe("正在加载编辑器…");
        expect(loading.attributes("context")).toBeUndefined();
        expect(wrapper.find("[data-workbench-editor-area]").exists()).toBe(false);

        area.resolve(Editor);
        await flushPromises();
        expect(wrapper.find("[aria-busy]").exists()).toBe(false);
        expect(wrapper.findAll("[data-test-editor]")).toHaveLength(2);
        expect(wrapper.get("[data-test-editor]").attributes("data-workbench-editor-area")).toBe("");
        expect(wrapper.find("[data-test-host]").exists()).toBe(true);
        expect(area.loads()).toBe(1);
    });

    it("加载失败：写出原因（role=alert），不再带 aria-busy；错误交给应用的错误处理", async () => {
        const area = deferredProvider();
        const {wrapper, errors} = mountSlot(area.provider);
        await flushPromises();
        area.reject(new Error("chunk 404"));
        await flushPromises();
        expect(wrapper.find("[aria-busy]").exists()).toBe(false);
        expect(wrapper.findAll("[role=\"alert\"]").map((alert) => alert.text())).toEqual(["编辑器加载失败：chunk 404", "编辑器加载失败：chunk 404"]);
        expect(wrapper.find("[context]").exists()).toBe(false);
        // 区级组件和两块编辑组共用一次加载，各报一次。
        expect(errors).toEqual([new Error("chunk 404"), new Error("chunk 404"), new Error("chunk 404")]);
    });
});
