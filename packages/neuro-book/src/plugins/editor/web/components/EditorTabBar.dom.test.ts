/**
 * EditorTabBar（同名 .md）：标签的角色与状态、单击激活、双击转正、中键与 Delete 关闭、方向键切换（循环）与 Alt+方向键
 * 移动。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import EditorTabBar from "./EditorTabBar.vue";
import type {TabItem} from "./EditorTabBar.vue";

const TABS: TabItem[] = [
    {id: "t1", label: "a.md", title: "project://a.md", preview: false, dirty: true, active: false},
    {id: "t2", label: "b.md", title: "project://b.md", preview: true, dirty: false, active: true},
    {id: "t3", label: "c.md", title: "project://c.md", preview: false, dirty: false, active: false},
];

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function bar() {
    const wrapper = mount(EditorTabBar, {props: {tabs: TABS, label: "打开的编辑器", closeLabel: (name: string) => `关闭 ${name}`, unsavedLabel: "未保存"}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

const tab = (wrapper: ReturnType<typeof bar>, id: string) => wrapper.get(`[data-editor-tab="${id}"]`);

describe("EditorTabBar", () => {
    it("tablist 与 tab 的角色；只有活动标签在 Tab 顺序里；preview 与未保存标出", () => {
        const wrapper = bar();
        expect(wrapper.get("[role=tablist]").attributes("aria-label")).toBe("打开的编辑器");
        expect(TABS.map((item) => tab(wrapper, item.id).attributes("aria-selected"))).toEqual(["false", "true", "false"]);
        expect(TABS.map((item) => tab(wrapper, item.id).attributes("tabindex"))).toEqual(["-1", "0", "-1"]);
        expect(tab(wrapper, "t2").attributes("data-editor-tab-preview")).toBeDefined();
        expect(tab(wrapper, "t1").text()).toBe("a.md（未保存）");
        expect(wrapper.get("[data-editor-tab-close=\"t1\"]").attributes("aria-label")).toBe("关闭 a.md");
    });

    it("单击激活、双击转正、点关闭按钮与中键关闭", async () => {
        const wrapper = bar();
        await tab(wrapper, "t1").trigger("click");
        await tab(wrapper, "t2").trigger("dblclick");
        await wrapper.get("[data-editor-tab-close=\"t3\"]").trigger("click");
        await tab(wrapper, "t1").trigger("auxclick", {button: 1});
        expect(wrapper.emitted("activate")).toEqual([["t1"]]);
        expect(wrapper.emitted("pin")).toEqual([["t2"]]);
        expect(wrapper.emitted("close")).toEqual([["t3"], ["t1"]]);
    });

    it("方向键循环切换并激活，Home/End 到首末，Delete 关闭，Alt+方向键移动", async () => {
        const wrapper = bar();
        await tab(wrapper, "t2").trigger("keydown", {key: "ArrowRight"});
        await tab(wrapper, "t3").trigger("keydown", {key: "ArrowRight"});
        await tab(wrapper, "t1").trigger("keydown", {key: "ArrowLeft"});
        await tab(wrapper, "t2").trigger("keydown", {key: "Home"});
        await tab(wrapper, "t2").trigger("keydown", {key: "End"});
        expect(wrapper.emitted("activate")).toEqual([["t3"], ["t1"], ["t3"], ["t1"], ["t3"]]);
        await tab(wrapper, "t2").trigger("keydown", {key: "Delete"});
        expect(wrapper.emitted("close")).toEqual([["t2"]]);
        await tab(wrapper, "t2").trigger("keydown", {key: "ArrowLeft", altKey: true});
        expect(wrapper.emitted("move")).toEqual([["t2", -1]]);
    });
});
