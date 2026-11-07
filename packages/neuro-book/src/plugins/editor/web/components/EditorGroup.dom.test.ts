/**
 * EditorGroup（同名 .md）：内容层里每个标签一块（docs/specs/workbench/editor.md 术语“视图”）。编辑器区是真实的，文件客户端是与真实 Files 对过契约的内存适配器
 * （Lab 的 `memory-files.ts`）；控件是记下属性的替身：这里看的是谁挂控件、给它什么，控件自己的行为由 `MarkdownControl.dom.test.ts` 与 e2e 看。
 */

import {mount} from "@vue/test-utils";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {defineComponent, h, nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {createEditorArea} from "../area";
import {editorCatalogs} from "../text";
import EditorGroup from "./EditorGroup.vue";

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** 记下收到的属性，把标签写在 DOM 上。 */
const Control = defineComponent({
    props: {binding: {type: Object, default: null}, host: {type: Object, required: true}, readonly: {type: Boolean, required: true}, visible: {type: Boolean, required: true}, label: {type: String, required: true}},
    setup: (props) => () => h("div", {"data-stub-control": props.label, "data-visible": String(props.visible), "data-readonly": String(props.readonly), "data-bound": String(props.binding !== null)}),
});

function scene() {
    const memory = createMemoryFiles({project: [["a.md", "甲\n"], ["b.md", "乙\n"], ["c.md", "丙\n"]], user: []});
    const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
    cleanups.push(() => memory.dispose(), () => area.dispose());
    const show = (tabId: string | null) => {
        const wrapper = mount(EditorGroup, {props: {area, groupId: area.groups.activeGroup.value, tabId, control: () => ({kind: "ready" as const, component: Control})}, attachTo: document.body, global: {provide: {[TEXT_PORT_KEY as symbol]: text.port}}});
        cleanups.push(() => wrapper.unmount());
        return wrapper;
    };
    return {area, show};
}

describe("EditorGroup：一个标签的内容", () => {
    it("组此刻显示的那块才有组的标记、面包屑与状态；别的标签只留控件，隐藏", async () => {
        const {area, show} = scene();
        const opened = area.open("project://a.md", {mode: "permanent"});
        const hidden = opened.ok ? opened.tabId : "";
        const next = area.open("project://b.md", {mode: "permanent"});
        const shown = next.ok ? next.tabId : "";
        const [back, front] = [show(hidden), show(shown)];
        await waitUntil("控件拿到绑定", () => back.find("[data-bound=\"true\"]").exists() && front.find("[data-bound=\"true\"]").exists());
        expect(front.attributes("data-editor-group")).toBe(area.groups.activeGroup.value);
        expect(back.attributes("data-editor-group")).toBeUndefined();
        expect(front.find("[data-editor-breadcrumbs]").exists()).toBe(true);
        expect(back.find("[data-editor-breadcrumbs]").exists()).toBe(false);
        expect(front.get("[data-stub-control]").attributes("data-visible")).toBe("true");
        expect(back.get("[data-stub-control]").attributes("data-visible")).toBe("false");

        // 切过去：两块互换，控件都不重建。
        const backControl = back.get("[data-stub-control]").element;
        area.activate(hidden);
        await nextTick();
        expect(back.attributes("data-editor-group")).toBe(area.groups.activeGroup.value);
        expect(front.attributes("data-editor-group")).toBeUndefined();
        expect(back.get("[data-stub-control]").element).toBe(backControl);
        expect(back.get("[data-stub-control]").attributes("data-visible")).toBe("true");
    });

    it("实时布局预览把它画在别的组上：组级的读取还按它真正所在的组，读不到那边的文档", async () => {
        const {area} = scene();
        const opened = area.open("project://a.md", {mode: "permanent"});
        const own = area.groups.activeGroup.value;
        const tabId = opened.ok ? opened.tabId : "";
        expect(area.split("right")).toEqual({ok: true});
        const elsewhere = area.groups.activeGroup.value;
        area.open("project://b.md", {mode: "permanent", group: elsewhere});
        const text = createHostTextEngine({locale: "zh-CN", strict: true});
        text.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
        const wrapper = mount(EditorGroup, {props: {area, groupId: elsewhere, tabId, control: () => ({kind: "ready" as const, component: Control})}, attachTo: document.body, global: {provide: {[TEXT_PORT_KEY as symbol]: text.port}}});
        cleanups.push(() => wrapper.unmount());
        await waitUntil("控件拿到绑定", () => wrapper.find("[data-bound=\"true\"]").exists());
        expect(wrapper.attributes("data-editor-group")).toBe(own);
        expect(wrapper.get("[data-editor-breadcrumbs]").text()).toContain("a.md");
    });

    it("空的编辑组：标记与空态都在，没有控件", () => {
        const {area, show} = scene();
        const wrapper = show(null);
        expect(wrapper.attributes("data-editor-group")).toBe(area.groups.activeGroup.value);
        expect(wrapper.find("[data-editor-empty]").exists()).toBe(true);
        expect(wrapper.find("[data-stub-control]").exists()).toBe(false);
    });

    it("标签关闭：控件卸载时撤回句柄不报错，这块内容不再画控件", async () => {
        const {area, show} = scene();
        area.open("project://a.md", {mode: "permanent"});
        const opened = area.open("project://b.md", {mode: "permanent"});
        const tabId = opened.ok ? opened.tabId : "";
        const wrapper = show(tabId);
        await waitUntil("控件挂上", () => wrapper.find("[data-stub-control]").exists());
        expect(await area.close(tabId)).toBe("closed");
        await nextTick();
        expect(wrapper.find("[data-stub-control]").exists()).toBe(false);
    });

    it("不活动的页面标签不渲染页面", async () => {
        const {area, show} = scene();
        const page = area.openPage("nbook.test/page");
        const pageTab = page.ok ? page.tabId : "";
        area.open("project://a.md", {mode: "permanent"});
        const wrapper = show(pageTab);
        await nextTick();
        expect(wrapper.find("[data-editor-page]").exists()).toBe(false);
        area.activate(pageTab);
        await nextTick();
        expect(wrapper.find("[data-editor-page]").exists()).toBe(true);
    });
});
