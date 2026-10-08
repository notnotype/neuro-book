/**
 * 外壳二的受控零件（同名 .md）：活动栏、“移动到”菜单、视图外框。菜单走 nb-ui Dropdown 的真实原语与键盘路径。
 */

import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, onBeforeUnmount} from "vue";

import WorkbenchActivityBar from "./WorkbenchActivityBar.vue";
import WorkbenchMoveViewMenu from "./WorkbenchMoveViewMenu.vue";
import WorkbenchViewSection from "./WorkbenchViewSection.vue";

const wrappers: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) await nextTick();
}

const menuItems = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"));

describe("WorkbenchActivityBar", () => {
    const containers = [{id: "view:a", label: "资源管理器", icon: "i-lucide-files"}, {id: "view:b", label: "搜索", icon: "i-lucide-search"}];

    it("点任何一项都发 select（包括已选中的）；选中标记只在 Sidebar 可见时出现", async () => {
        const wrapper = mount(WorkbenchActivityBar, {props: {label: "活动栏", containers, selected: "view:a", sidebarVisible: true}});
        wrappers.push(wrapper);
        const button = (id: string) => wrapper.get(`[data-activity-container="${id}"]`);
        expect(wrapper.get("nav").attributes("aria-label")).toBe("活动栏");
        expect(button("view:a").attributes("aria-pressed")).toBe("true");
        expect(button("view:b").attributes("aria-pressed")).toBe("false");
        expect(button("view:b").attributes("aria-label")).toBe("搜索");
        await button("view:a").trigger("click");
        await button("view:b").trigger("click");
        expect(wrapper.emitted("select")).toEqual([["view:a"], ["view:b"]]);
        await wrapper.setProps({sidebarVisible: false});
        expect(button("view:a").attributes("aria-pressed")).toBe("false");
    });
});

describe("WorkbenchMoveViewMenu", () => {
    const groups = [
        {label: "侧栏", targets: [{id: "view:b", label: "搜索", icon: "i-lucide-search"}]},
        {label: "面板", targets: [{id: "view:c", label: "终端", icon: "i-lucide-terminal"}]},
    ];
    const base = {label: "移动到", viewId: "a", sourceContainerId: "view:a", groups, resetLabel: "重置位置", identity: "a|view:a|1|single"};

    async function open(wrapper: VueWrapper): Promise<void> {
        const trigger = wrapper.get("[data-move-view]");
        (trigger.element as HTMLButtonElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await flush();
    }

    function click(label: string): void {
        const item = menuItems().find((candidate) => candidate.textContent?.trim().startsWith(label) === true);
        if (item === undefined) throw new Error(`菜单里没有 ${label}`);
        item.click();
    }

    it("一层平铺列出目标，右侧注明 Part；选中后发 move，来源是打开时记下的；重置位置发 reset", async () => {
        const wrapper = mount(WorkbenchMoveViewMenu, {props: base, attachTo: document.body});
        wrappers.push(wrapper);
        await open(wrapper);
        expect(menuItems().map((item) => item.textContent?.replace(/\s+/gu, ""))).toEqual(["搜索侧栏", "终端面板", "重置位置"]);
        click("终端");
        await flush();
        expect(wrapper.emitted("move")).toEqual([[{viewId: "a", sourceContainerId: "view:a", targetContainerId: "view:c"}]]);

        await open(wrapper);
        click("重置位置");
        await flush();
        expect(wrapper.emitted("reset")).toEqual([["a"]]);
    });

    it("菜单开着时身份变了：菜单关闭，不发事件", async () => {
        const wrapper = mount(WorkbenchMoveViewMenu, {props: base, attachTo: document.body});
        wrappers.push(wrapper);
        await open(wrapper);
        expect(menuItems().length).toBeGreaterThan(0);
        await wrapper.setProps({sourceContainerId: "view:b", identity: "a|view:b|1|multiple"});
        await flush();
        expect(menuItems()).toEqual([]);
        expect(wrapper.emitted("move")).toBeUndefined();
    });

    it("没有目标也不能重置：按钮禁用", () => {
        const wrapper = mount(WorkbenchMoveViewMenu, {props: {...base, groups: [], resetLabel: null}});
        wrappers.push(wrapper);
        expect(wrapper.get("[data-move-view]").attributes("disabled")).toBeDefined();
    });
});

describe("WorkbenchViewSection", () => {
    const base = {viewId: "a", title: "资源管理器", icon: "i-lucide-files", axis: "vertical" as const, chrome: true, collapsed: false, layout: "scroll" as const, collapseLabel: "收起视图", expandLabel: "展开视图"};

    it("multiple 有标题行与动作；收起开关发应有的收起值；收起时内容隐藏不卸载；single 没有标题行", async () => {
        let unmounted = 0;
        const Content = defineComponent({setup: () => {
            onBeforeUnmount(() => {
                unmounted += 1;
            });
            return () => h("p", "内容");
        }});
        const wrapper = mount(WorkbenchViewSection, {props: base, slots: {default: () => h(Content), actions: () => h("button", {"data-action": ""}, "动作")}, attachTo: document.body});
        wrappers.push(wrapper);
        expect(wrapper.attributes("aria-label")).toBe("资源管理器");
        expect(wrapper.find("[data-action]").exists()).toBe(true);
        const toggle = wrapper.get("[data-view-toggle]");
        expect(toggle.attributes("aria-expanded")).toBe("true");
        expect(toggle.attributes("aria-label")).toBe("收起视图");
        await toggle.trigger("click");
        expect(wrapper.emitted("toggle-collapsed")).toEqual([[true]]);

        await wrapper.setProps({collapsed: true});
        expect(wrapper.attributes("data-view-collapsed")).toBe("true");
        expect(wrapper.find("p").isVisible()).toBe(false);
        expect(wrapper.get("[data-view-toggle]").attributes("aria-label")).toBe("展开视图");

        // single：没有标题行，收起不生效（宿主给 false，这里即使给 true 也照样显示内容）。
        await wrapper.setProps({chrome: false});
        expect(wrapper.find("header").exists()).toBe(false);
        expect(wrapper.find("p").isVisible()).toBe(true);
        expect(wrapper.attributes("data-view-collapsed")).toBe("false");
        expect(unmounted).toBe(0);
    });
});
