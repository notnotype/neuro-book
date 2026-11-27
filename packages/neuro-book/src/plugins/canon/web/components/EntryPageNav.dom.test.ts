/**
 * EntryPageNav（同名 .md，docs/specs/canon/author-ui.md 输出 9、38）：两段与分隔、图标与条数、选中；方向键移动并选中；右键与
 * “添加一组设定”发出的事件；读屏的角色。
 */

import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import EntryPageNav from "./EntryPageNav.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});
const ITEMS = [
    {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true},
    {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const},
    {value: "extra:experience", label: "经历", iconClass: "i-lucide-footprints", segment: "view" as const},
    {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 12},
];
const nav = (props: Record<string, unknown> = {}) => {
    const wrapper = mount(EntryPageNav, {props: {items: ITEMS, modelValue: "data:character", tabId: (value: string) => `tab-${value}`, panelId: "panel", ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
};

describe("EntryPageNav", () => {
    it("看法菜单（输出 9、54）：能换看法的行留箭头格、选中的显出；选中的再点发 menu，没选中的点了只是选中；看法名写在标题后、与标题分开", async () => {
        const items = [{...ITEMS[0]!, looks: true}, {value: "data:look", label: "形象", iconClass: "i-lucide-shirt", segment: "own" as const, removable: true, looks: true}, ITEMS[1]!];
        const wrapper = nav({items, menus: true, note: "AI视图"});
        const tabs = () => wrapper.findAll("[role='tab']");
        expect(tabs().map((tab) => tab.find(".entry-page-nav__menu").exists())).toEqual([true, true, false]);
        expect(tabs().slice(0, 2).map((tab) => tab.get(".entry-page-nav__menu").attributes("data-shown") ?? null)).toEqual(["", null]);
        expect(tabs().map((tab) => tab.attributes("aria-haspopup") ?? null)).toEqual(["menu", null, null]);
        // 看法名只写在选中的那一行，标题之外单独一格（标题截断时它留着）。
        expect(tabs().map((tab) => tab.text())).toEqual(["人物，AI视图", "形象", "文字"]);
        expect(tabs()[0]!.get(".entry-page-nav__note").classes()).not.toContain("truncate");
        await tabs()[1]!.trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([["data:look"]]);
        await tabs()[0]!.trigger("click");
        expect(wrapper.emitted("menu")).toEqual([["data:character", tabs()[0]!.element]]);
        await wrapper.setProps({menuOpen: true, note: ""});
        expect(tabs()[0]!.attributes("aria-expanded")).toBe("true");
        expect(tabs()[0]!.text()).toBe("人物");
    });

    it("竖排的 tablist，两段之间一条分隔；每页有图标，条数写在行尾；选中的一页 aria-selected、可以 Tab 到", () => {
        const wrapper = nav();
        const list = wrapper.get("[role='tablist']");
        expect(list.attributes("aria-orientation")).toBe("vertical");
        const tabs = wrapper.findAll("[role='tab']");
        expect(tabs.map((tab) => tab.text().replace(/\s+/gu, ""))).toEqual(["人物", "文字", "经历", "情节12"]);
        expect(tabs.map((tab) => tab.find("[aria-hidden='true']").classes()[0])).toEqual(["i-lucide-user-round", "i-lucide-file-text", "i-lucide-footprints", "i-lucide-git-commit-horizontal"]);
        expect(tabs.map((tab) => [tab.attributes("aria-selected"), tab.attributes("tabindex")])).toEqual([["true", "0"], ["false", "-1"], ["false", "-1"], ["false", "-1"]]);
        expect(tabs[0]!.attributes("aria-controls")).toBe("panel");
        // 分隔在文字与经历之间：画在看法一段的第一页上。
        expect(tabs.map((tab) => tab.attributes("data-segment-start") !== undefined)).toEqual([false, false, true, false]);
    });

    it("点一页、上下方向键、Home 与 End 都发出新的选中，两端绕回", async () => {
        const wrapper = nav({modelValue: "data:character"});
        await wrapper.findAll("[role='tab']")[2]!.trigger("click");
        const list = wrapper.get("[role='tablist']");
        await list.trigger("keydown", {key: "ArrowUp"});
        await list.trigger("keydown", {key: "End"});
        // 焦点跟到新选中的那一页（同横排的 Tabs）：下一次按键落在它上面。
        await nextTick();
        expect((document.activeElement as HTMLElement | null)?.dataset.tabValue).toBe("plot");
        await list.trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["extra:experience"], ["plot"], ["plot"], ["text"]]);
    });

    it("右键一页发 context；可以加时最后是“添加一组设定”，点了发 add-toggle（带这个按钮），浮层开着时 aria-expanded；有原因时不可用、悬停写原因；不能加就不出", async () => {
        const wrapper = nav({canAdd: true});
        await wrapper.findAll("[role='tab']")[1]!.trigger("contextmenu", {clientX: 10, clientY: 20});
        expect(wrapper.emitted("context")).toEqual([["text", {x: 10, y: 20}]]);
        const add = wrapper.get("[data-add-component]");
        // 在 tablist 外面：分页列表里只有分页。
        expect(wrapper.get("[role='tablist']").find("[data-add-component]").exists()).toBe(false);
        expect(add.attributes("aria-expanded")).toBe("false");
        await add.trigger("click");
        expect(wrapper.emitted("add-toggle")).toEqual([[add.element]]);
        await wrapper.setProps({addOpen: true});
        expect(add.attributes("aria-expanded")).toBe("true");
        await wrapper.setProps({addReason: "先不算计划"});
        expect(add.attributes("disabled")).toBeDefined();
        expect(add.attributes("title")).toBe("先不算计划");
        expect(nav().find("[data-add-component]").exists()).toBe(false);
    });
});
