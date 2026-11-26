/**
 * PositionPicker（同名 .md，docs/specs/canon/author-ui.md 输出 7、8）：菜单是各位置的单选与“算上计划中的情节”的勾选（作品里有计划
 * 时才有）；选了发什么；标记一格同时只写一样，“算上计划 ×”点了回到实际；不能换时都不可用。菜单是弹出层，这里看交给它的项、
 * 直接发它选中后的事件；菜单本身的键盘与关闭在 nb-ui。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {DropdownMenu} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import PositionPicker from "./PositionPicker.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});
const POSITIONS = [{value: "initial", label: "最初"}, {value: "1:start", label: "第 1 章开头"}, {value: "1:end", label: "第 1 章末尾"}];
const picker = (props: Record<string, unknown> = {}) => {
    const wrapper = mount(PositionPicker, {props: {positions: POSITIONS, position: "1:end", ...props}, global: {provide: provideText(port)}});
    mounted.push(wrapper);
    return wrapper;
};
const itemsOf = (wrapper: ReturnType<typeof picker>): DropdownMenuItemData[] => wrapper.findComponent(DropdownMenu).props("items") as DropdownMenuItemData[];

describe("PositionPicker", () => {
    it("按钮写当前位置；菜单是同一组的单选、勾着当前的；作品里没有计划时没有勾选项", () => {
        const wrapper = picker();
        expect(wrapper.get("[data-position-trigger]").text()).toBe("第 1 章末尾");
        const items = itemsOf(wrapper);
        expect(items.map((item) => [item.label, item.type, item.checked])).toEqual([["最初", "radio", false], ["第 1 章开头", "radio", false], ["第 1 章末尾", "radio", true]]);
        expect(new Set(items.map((item) => item.group))).toEqual(new Set(["position"]));
    });

    it("选一个位置发 update:position；有计划时最下面是勾选项，点了取反发 update:planned", async () => {
        const wrapper = picker({canPlan: true});
        const items = itemsOf(wrapper);
        expect(items.at(-1)).toMatchObject({label: "算上计划中的情节", type: "checkbox", checked: false});
        wrapper.findComponent(DropdownMenu).vm.$emit("select", items[0]!.id);
        wrapper.findComponent(DropdownMenu).vm.$emit("select", items.at(-1)!.id);
        expect(wrapper.emitted("update:position")).toEqual([["initial"]]);
        expect(wrapper.emitted("update:planned")).toEqual([[true]]);
    });

    it("标记一格只写一样：算上计划优先，点 × 回到实际；其次是那一章不在了、还没出场", async () => {
        const wrapper = picker({canPlan: true, planned: true, positionGone: true, notAppeared: true});
        expect(wrapper.text()).toContain("算上计划");
        expect(wrapper.text()).not.toContain("不在了");
        await wrapper.get("[data-planned-mark]").trigger("click");
        expect(wrapper.emitted("update:planned")).toEqual([[false]]);
        await wrapper.setProps({planned: false});
        expect(wrapper.text()).toContain("原来选的那一章已经不在了");
        await wrapper.setProps({positionGone: false});
        expect(wrapper.get("[data-not-appeared]").text()).toBe("这时还没出场");
    });

    it("不能换时（有没提交的主文字）按钮、菜单与标记都不可用，悬停写原因", () => {
        const wrapper = picker({canPlan: true, planned: true, locked: "先提交或放弃正在写的主文字"});
        expect(wrapper.get("[data-position-trigger]").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-position-trigger]").attributes("title")).toBe("先提交或放弃正在写的主文字");
        expect(wrapper.findComponent(DropdownMenu).props("disabled")).toBe(true);
        expect(wrapper.get("[data-planned-mark]").attributes("disabled")).toBeDefined();
    });
});
