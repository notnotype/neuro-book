/**
 * WorkbenchTitleBar（同名 .md）：菜单选择发 run（禁用项不发）、搜索、布局按钮、项目切换；F10 聚焦菜单入口，菜单关着时
 * Escape 把焦点还给之前的位置。真实的 nb-ui 菜单组件；浮层与键盘漫游在真实 Chrome 里由 `e2e/workbench-shell.e2e.ts` 验收。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {nextTick} from "vue";

import type {MenuGroup} from "../titlebar/menu-model";
import WorkbenchTitleBar from "./WorkbenchTitleBar.vue";

const menus: MenuGroup[] = [
    {id: "edit", label: "编辑", sections: [[
        {id: "nbook.edit.undo", command: "nbook.edit.undo", args: {}, label: "撤销", enabled: true, reason: null, shortcut: null, checked: null},
        {id: "nbook.edit.redo", command: "nbook.edit.redo", args: {}, label: "重做", enabled: false, reason: "没有活动的编辑器", shortcut: null, checked: null},
    ]]},
    {id: "view", label: "视图", sections: [[{id: "nbook.view.set-part-hidden sidebar", command: "nbook.view.set-part-hidden", args: {part: "sidebar"}, label: "侧栏", enabled: true, reason: null, shortcut: null, checked: true}]]},
];
const layout = {sidebar: {pressed: true, disabled: false}, panel: {pressed: false, disabled: false}, auxiliarybar: {pressed: false, disabled: true}};

function mountBar(project: string | null = "雾港") {
    return mount(WorkbenchTitleBar, {props: {locale: "zh-CN", project, menus, searchShortcut: "Ctrl+Shift+P", layout, items: []}, attachTo: document.body});
}

describe("WorkbenchTitleBar", () => {
    it("搜索按钮名字带快捷键并发 search；布局按钮带按下态与禁用，点击发 toggle-part", async () => {
        const wrapper = mountBar();
        const search = wrapper.get("[data-titlebar-search]");
        expect(search.attributes("aria-label")).toBe("搜索命令（Ctrl+Shift+P）");
        await search.trigger("click");
        expect(wrapper.emitted("search")).toHaveLength(1);
        expect(wrapper.get('[data-titlebar-layout="sidebar"]').attributes("aria-pressed")).toBe("true");
        expect(wrapper.get('[data-titlebar-layout="panel"]').attributes("aria-pressed")).toBe("false");
        expect(wrapper.get('[data-titlebar-layout="auxiliarybar"]').attributes("disabled")).toBeDefined();
        await wrapper.get('[data-titlebar-layout="panel"]').trigger("click");
        expect(wrapper.emitted("toggle-part")).toEqual([["panel"]]);
        wrapper.unmount();
    });

    it("没有项目时项目切换直接发 open-project", async () => {
        const wrapper = mountBar(null);
        await wrapper.get("[data-titlebar-project]").trigger("click");
        expect(wrapper.emitted("open-project")).toHaveLength(1);
        wrapper.unmount();
    });

    it("F10 聚焦第一组菜单；菜单关着时 Escape 把焦点还给按 F10 之前的元素；Alt 与别的键一起按不算", async () => {
        const outside = document.createElement("button");
        document.body.append(outside);
        outside.focus();
        const wrapper = mountBar();
        window.dispatchEvent(new KeyboardEvent("keydown", {key: "F10", bubbles: true}));
        await nextTick();
        expect(document.activeElement?.textContent?.trim()).toBe("编辑");
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await nextTick();
        await nextTick();
        expect(document.activeElement).toBe(outside);

        window.dispatchEvent(new KeyboardEvent("keydown", {key: "Alt", altKey: true, bubbles: true}));
        window.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp", altKey: true, bubbles: true}));
        window.dispatchEvent(new KeyboardEvent("keyup", {key: "Alt", bubbles: true}));
        expect(document.activeElement).toBe(outside);
        window.dispatchEvent(new KeyboardEvent("keydown", {key: "Alt", altKey: true, bubbles: true}));
        window.dispatchEvent(new KeyboardEvent("keyup", {key: "Alt", bubbles: true}));
        expect(document.activeElement?.textContent?.trim()).toBe("编辑");
        wrapper.unmount();
        outside.remove();
    });
});
