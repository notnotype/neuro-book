/** 固定工具栏（docs/specs/workbench/markdown-editing.md 输出 1、5）：真实组件，动作与菜单用记录调用的实现。 */
import {mount} from "@vue/test-utils";
import {computed, ref} from "vue";
import {describe, expect, it} from "vitest";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import MarkdownToolbar from "./MarkdownToolbar.vue";

function fixture(options: {readonly?: boolean; linkActive?: boolean; bold?: boolean; contributed?: boolean} = {}) {
    const runs: unknown[] = [];
    const editing: EditorEditing = {
        run: () => true,
        active: (action) => (action === "bold" && options.bold === true) || (action === "link" && options.linkActive === true),
        enabled: () => true,
        hasSelection: computed(() => false),
    };
    const entry = {id: "test.item", command: "test.command", args: {}, context: "resource", label: "插件动作", enabled: true, reason: null, shortcut: null, checked: null, icon: "i-lucide-sparkles", placement: "inline"} as const;
    const menus: EditorMenus = {
        title: (action) => action,
        label: (key) => key,
        shortcut: () => null,
        matches: () => false,
        has: () => false,
        run: (action, args) => runs.push(["run", action, args]),
        execute: (command) => runs.push(["execute", command]),
        contributed: () => (options.contributed === true ? [[entry]] : []),
        runContributed: (point, id) => runs.push(["contributed", point, id]),
        toolbarVisible: ref(true),
        toolbarPlacement: ref("full"),
        commentMargin: ref(false),
        keyLabel: (keybinding) => keybinding,
        notify: () => undefined,
        reportError: () => undefined,
    };
    const wrapper = mount(MarkdownToolbar, {props: {editing, menus, readonly: options.readonly === true}, attachTo: document.body});
    const button = (name: string) => wrapper.find(`button[aria-label="${name}"], button[title="${name}"]`);
    return {wrapper, runs, button};
}

describe("MarkdownToolbar", () => {
    it("点按钮执行对应的命令", async () => {
        const {runs, button} = fixture();
        await button("bold").trigger("click");
        await button("undo").trigger("click");
        expect(runs).toEqual([["run", "bold", undefined], ["execute", "nbook.edit.undo"]]);
    });

    it("勾选状态来自自己控件的 editing", () => {
        const {button} = fixture({bold: true});
        expect(button("bold").attributes("aria-pressed")).toBe("true");
        expect(button("italic").attributes("aria-pressed")).toBe("false");
    });

    it("只读时按钮全部置灰", () => {
        const {button} = fixture({readonly: true});
        expect(button("bold").attributes("disabled")).toBeDefined();
        expect(button("bullet-list").attributes("disabled")).toBeDefined();
    });

    it("链接、图片按钮在文字颜色之后、列表之前（输出 1）；点了发 prompt 让菜单层开卡片，不直接执行命令", async () => {
        const {wrapper, runs, button} = fixture();
        const titles = wrapper.findAll("button").map((found) => found.attributes("title") ?? "");
        expect(titles.indexOf("link")).toBeGreaterThan(titles.indexOf("highlight"));
        expect(titles.indexOf("image")).toBe(titles.indexOf("link") + 1);
        expect(titles.indexOf("bullet-list")).toBeGreaterThan(titles.indexOf("image"));
        await button("link").trigger("click");
        await button("image").trigger("click");
        expect(wrapper.emitted("prompt")).toEqual([["link"], ["image"]]);
        expect(runs).toEqual([]);
    });

    it("光标在链接里时链接按钮是按下的；只读时链接、图片按钮置灰", () => {
        expect(fixture({linkActive: true}).button("link").attributes("aria-pressed")).toBe("true");
        expect(fixture().button("link").attributes("aria-pressed")).toBe("false");
        const {button} = fixture({readonly: true});
        expect(button("link").attributes("disabled")).toBeDefined();
        expect(button("image").attributes("disabled")).toBeDefined();
    });

    it("贡献的 inline 项排在内置按钮之后，点了走贡献项的路径", async () => {
        const {runs, button, wrapper} = fixture({contributed: true});
        const titles = wrapper.findAll("button").map((found) => found.attributes("title") ?? "");
        expect(titles.indexOf("插件动作")).toBeGreaterThan(titles.indexOf("clear-format"));
        await button("插件动作").trigger("click");
        expect(runs).toEqual([["contributed", "editor.toolbar", "test.item"]]);
    });

    it("按下不夺走焦点", () => {
        const {wrapper} = fixture();
        const event = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        wrapper.find("button").element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});
