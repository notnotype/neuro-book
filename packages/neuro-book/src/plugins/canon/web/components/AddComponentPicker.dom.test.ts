/**
 * AddComponentPicker（同名 .md，docs/specs/canon/author-ui.md 输出 38）：不打字时按组列出还没有的（适用的在最前）、打了字只按名字筛并列出
 * 已添加的；方向键、回车、Escape、Tab；选了以后发的事件；点在外面关上。浮层的位置与滚动在 e2e。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import AddComponentPicker from "./AddComponentPicker.vue";
import type {AddComponentGroup, AddComponentItem} from "./add-component-picker";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const item = (value: string, label: string, group: AddComponentGroup, extra: Partial<AddComponentItem> = {}): AddComponentItem => ({value, label, iconClass: "i-lucide-box", group, fits: false, present: false, restore: false, ...extra});
const ITEMS: AddComponentItem[] = [
    item("nbook.canon.person", "人物", "canon", {fits: true, present: true}),
    item("nbook.canon.inventory", "物品栏", "canon"),
    item("nbook.canon.panel", "数值", "canon", {restore: true}),
    item("a.test.badge", "徽章", "other"),
    item("nbook.plot.knowing", "知道什么", "plot", {fits: true}),
    item("nbook.canon.skills", "技能", "canon", {fits: true}),
];

async function open(props: Partial<{items: AddComponentItem[]; kind: string}> = {}) {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const wrapper = mount(AddComponentPicker, {props: {anchor, items: ITEMS, kind: "人物", ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return {wrapper, anchor};
}

/** 浮层里的组：组名与组里各项的名字（选项里的提示另算）。 */
const groups = (): Array<[string, string[]]> => [...document.querySelectorAll<HTMLElement>("[role='listbox'] > [role='group']")].map((group) => [
    document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent?.trim() ?? "",
    [...group.querySelectorAll<HTMLElement>("[role='option']")].map((option) => option.textContent?.replace(/\s+/gu, "") ?? ""),
]);
const options = (): string[] => [...document.querySelectorAll<HTMLElement>("[role='option']")].map((option) => option.textContent?.replace(/\s+/gu, "") ?? "");
const highlighted = (): string => document.querySelector<HTMLElement>("[role='option'][data-highlighted]")?.textContent?.replace(/\s+/gu, "") ?? "";
const search = (): HTMLInputElement => document.querySelector<HTMLInputElement>("[data-suggestion-menu-header] input")!;
const type = async (value: string): Promise<void> => {
    search().value = value;
    search().dispatchEvent(new Event("input"));
    await flushPromises();
};
const key = async (name: string): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true});
    search().dispatchEvent(event);
    await flushPromises();
    return event;
};

describe("AddComponentPicker", () => {
    it("不打字时：适用于这个种类的在最前，其余按设定、剧情、插件分组，组内照给的顺序；已经有的不列，去掉过的写“恢复”；没有种类时没有“适用于”", async () => {
        await open();
        expect(groups()).toEqual([
            ["适用于人物", ["知道什么", "技能"]],
            ["设定", ["物品栏", "恢复“数值”"]],
            ["插件", ["徽章"]],
        ]);
        mounted.pop()!.unmount();
        await open({kind: ""});
        expect(groups().map(([label]) => label)).toEqual(["设定", "剧情", "插件"]);
        expect(groups()[0]![1]).toEqual(["物品栏", "恢复“数值”", "技能"]);
    });

    it("打开时焦点在搜索框、高亮第一项；打字只按名字筛（不分大小写、不管空格），条目上已经有的也列出来、写“已添加”；对不上时写出搜的词", async () => {
        await open();
        expect(document.activeElement).toBe(search());
        expect(highlighted()).toBe("知道什么");
        await type("人 物");
        expect(options()).toEqual(["人物已添加"]);
        expect(highlighted()).toBe("人物已添加");
        await type("龙");
        expect(options()).toEqual([]);
        expect(document.querySelector("[data-suggestion-menu-empty]")?.textContent).toBe("没有叫“龙”的设定组");
    });

    it("上下键在各项之间走、到头绕回，回车选高亮的那项：还没有的发 add，已添加的发 show，之后发 close(true)", async () => {
        const {wrapper} = await open();
        await key("ArrowUp");
        expect(highlighted()).toBe("徽章");
        await key("ArrowDown");
        await key("ArrowDown");
        expect(highlighted()).toBe("技能");
        const enter = await key("Enter");
        expect(enter.defaultPrevented).toBe(true);
        expect(wrapper.emitted("add")).toEqual([["nbook.canon.skills"]]);
        expect(wrapper.emitted("close")).toEqual([[true]]);
        await type("人物");
        await key("Enter");
        expect(wrapper.emitted("show")).toEqual([["nbook.canon.person"]]);
    });

    it("点一项同回车；Escape 发 close(true) 且不往外传，Tab 发 close(false)", async () => {
        const {wrapper} = await open();
        document.querySelectorAll<HTMLElement>("[role='option']")[2]!.click();
        expect(wrapper.emitted("add")).toEqual([["nbook.canon.inventory"]]);
        let outer = 0;
        const listen = (): void => {
            outer += 1;
        };
        document.body.addEventListener("keydown", listen);
        await key("Escape");
        document.body.removeEventListener("keydown", listen);
        expect(outer).toBe(0);
        await key("Tab");
        expect(wrapper.emitted("close")).toEqual([[true], [true], [false]]);
    });

    it("开着时按在浮层与锚以外的地方发 close(false)；按在浮层里、锚上不发；关上以后不再听", async () => {
        const {wrapper, anchor} = await open();
        search().dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        anchor.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        expect(wrapper.emitted("close")).toBeUndefined();
        document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        expect(wrapper.emitted("close")).toEqual([[false]]);
        await wrapper.setProps({anchor: null});
        document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        expect(wrapper.emitted("close")).toEqual([[false]]);
    });
});
