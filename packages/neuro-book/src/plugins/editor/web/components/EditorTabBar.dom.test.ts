/**
 * EditorTabBar（同名 .md）：标签的角色与状态、单击激活、双击转正、中键与 Delete 关闭、方向键切换（循环）与 Alt+方向键
 * 移动、固定标签的图钉、同名提示、多行时固定标签单独一行、右键与 Shift+F10 打开菜单。外观与按几何的 ↑/↓ 在 e2e 里验。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import EditorTabBar from "./EditorTabBar.vue";
import type {TabItem} from "./EditorTabBar.vue";

const item = (id: string, label: string, extra: Partial<TabItem> = {}): TabItem => ({id, label, title: `project://${label}`, preview: false, dirty: false, active: false, pinned: false, icon: "markdown", hint: null, ...extra});
const TABS: TabItem[] = [item("t1", "a.md", {dirty: true}), item("t2", "b.md", {preview: true, active: true}), item("t3", "c.md")];

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function bar(tabs: TabItem[] = TABS, wrap = true) {
    const wrapper = mount(EditorTabBar, {props: {tabs, label: "打开的编辑器", closeLabel: (name: string) => `关闭 ${name}`, unpinLabel: (name: string) => `取消固定 ${name}`, unsavedLabel: "未保存", pinnedLabel: "已固定", wrap}, attachTo: document.body});
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
        expect(wrapper.emitted("keep")).toEqual([["t2"]]);
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

    it("固定标签：状态位是图钉，点它取消固定；多行时固定标签单独一行，单行时排在最前；同名提示跟在名字后面", async () => {
        const tabs = [item("p1", "大纲.md", {pinned: true}), item("t1", "README.md", {hint: "notes", active: true}), item("t2", "README.md", {hint: "drafts"})];
        const wrapper = bar(tabs);
        expect(wrapper.findAll("[data-tab-row]").map((row) => row.attributes("data-tab-row"))).toEqual(["pinned", "normal"]);
        expect(wrapper.find("[data-editor-tab-close=\"p1\"]").exists()).toBe(false);
        await wrapper.get("[data-editor-tab-unpin=\"p1\"]").trigger("click");
        expect(wrapper.emitted("unpin")).toEqual([["p1"]]);
        expect(wrapper.get("[data-editor-tab-unpin=\"p1\"]").attributes("aria-label")).toBe("取消固定 大纲.md");
        expect(wrapper.findAll("[data-editor-tab-hint]").map((hint) => hint.text())).toEqual(["notes", "drafts"]);
        // 固定状态读屏器也听得到。
        expect(tab(wrapper, "p1").text()).toBe("大纲.md（已固定）");
        const single = bar(tabs, false);
        expect(single.findAll("[data-tab-row]").map((row) => row.attributes("data-tab-row"))).toEqual(["all"]);
    });

    it("右键与 Shift+F10、菜单键打开这个标签的菜单，不激活它", async () => {
        const wrapper = bar();
        await tab(wrapper, "t3").trigger("contextmenu", {clientX: 40, clientY: 12});
        await tab(wrapper, "t1").trigger("keydown", {key: "F10", shiftKey: true});
        await tab(wrapper, "t1").trigger("keydown", {key: "ContextMenu"});
        expect(wrapper.emitted("menu")?.map(([id]) => id)).toEqual(["t3", "t1", "t1"]);
        expect(wrapper.emitted("menu")?.[0]).toEqual(["t3", 40, 12]);
        expect(wrapper.emitted("activate")).toBeUndefined();
    });
});
