/**
 * EntryTree（同名 .md，docs/specs/canon/author-ui.md 输出 2、5）：分组行、次级色与说明、“再显示”、展开了还没读到的一层、
 * 点了发什么事件。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import EntryTree from "./EntryTree.vue";
import type {EntryTreeItem, EntryTreeLayer} from "./entry-tree";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const item = (id: string, name: string, extra: Partial<EntryTreeItem> = {}): EntryTreeItem => ({id, name, folder: "", hasChildren: false, appeared: true, deleted: false, ...extra});
const layer = (items: EntryTreeItem[], remaining = 0, loading = false): EntryTreeLayer => ({items, remaining, loading});

function tree(layers: Record<string, EntryTreeLayer>, expanded: string[] = [], selected?: string) {
    const wrapper = mount(EntryTree, {props: {layers, expanded, ...(selected === undefined ? {} : {selected})}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    const rows = () => wrapper.findAll("[role='treeitem']").map((row) => ({id: row.attributes("data-tree-id"), text: row.text()}));
    const row = (id: string) => wrapper.get(`[data-tree-id="${id}"]`);
    return {wrapper, rows, row};
}

describe("EntryTree", () => {
    it("根下按分组插分组行，分组按第一个条目出现的先后；没有分组的留在原位；一层没列完时末尾是“再显示”", () => {
        const {rows} = tree({"": layer([item("a", "星瑕", {folder: "人物"}), item("p", "联邦"), item("b", "白灵", {folder: "人物"}), item("c", "学院", {folder: "地点"})], 3)}, ["folder:人物", "folder:地点"]);
        expect(rows()).toEqual([
            {id: "folder:人物", text: "人物"},
            {id: "a", text: "星瑕"},
            {id: "b", text: "白灵"},
            {id: "p", text: "联邦"},
            {id: "folder:地点", text: "地点"},
            {id: "c", text: "学院"},
            {id: "more:", text: "再显示（还有 3 项）"},
        ]);
    });

    it("没出场的名字用次级色、后面写“未出场”；已删除的写“已删除”", () => {
        const {row} = tree({"": layer([item("a", "星瑕"), item("b", "哥哥", {appeared: false}), item("c", "旧人", {deleted: true, appeared: false})])});
        expect(row("a").text()).toBe("星瑕");
        expect(row("b").text()).toBe("哥哥未出场");
        expect(row("b").find(".truncate").classes()).toContain("text-[var(--text-muted)]");
        expect(row("c").text()).toBe("旧人已删除");
    });

    it("展开了还没读到的一层下面是“读取中…”；读到以后是那一层的条目与它的“再显示”", async () => {
        const {rows, wrapper} = tree({"": layer([item("a", "星瑕", {hasChildren: true})])}, ["a"]);
        expect(rows()).toEqual([{id: "a", text: "星瑕"}, {id: "loading:a", text: "读取中…"}]);
        await wrapper.setProps({layers: {"": layer([item("a", "星瑕", {hasChildren: true})]), a: layer([item("b", "哥哥")], 2)}});
        expect(rows()).toEqual([{id: "a", text: "星瑕"}, {id: "b", text: "哥哥"}, {id: "more:a", text: "再显示（还有 2 项）"}]);
    });

    it("点条目发 open；点“再显示”发 more（根是 null）；点分组与“读取中”什么也不打开", async () => {
        const {row, wrapper} = tree({"": layer([item("a", "星瑕", {folder: "人物", hasChildren: true})], 1), a: layer([], 0, true)}, ["folder:人物", "a"]);
        await row("a").trigger("click");
        await row("more:").trigger("click");
        await row("folder:人物").trigger("click");
        await row("loading:a").trigger("click");
        expect(wrapper.emitted("open")).toEqual([["a"]]);
        expect(wrapper.emitted("more")).toEqual([[null]]);
    });

    it("根这一层还没读到时只有“读取中…”；读到了一项也没有时是“还没有条目”", async () => {
        const {wrapper} = tree({});
        expect(wrapper.text()).toBe("读取中…");
        await wrapper.setProps({layers: {"": layer([])}});
        expect(wrapper.text()).toBe("还没有条目");
    });

    it("可以新建时，空着是带两个新建按钮的空状态：新建人物发 create-person，新建条目发 create(null)；不能写时按钮禁用、写原因", async () => {
        const {wrapper} = tree({"": layer([])});
        await wrapper.setProps({creatable: true});
        const empty = wrapper.get("[data-entries-empty]");
        expect(empty.text()).toContain("还没有设定");
        const buttons = empty.findAll("button");
        expect(buttons.map((button) => button.text())).toEqual(["新建人物", "新建条目"]);
        await buttons[0]!.trigger("click");
        await buttons[1]!.trigger("click");
        expect(wrapper.emitted("create-person")).toHaveLength(1);
        expect(wrapper.emitted("create")).toEqual([[null]]);
        await wrapper.setProps({blockedReason: "世界只读"});
        const blocked = wrapper.get("[data-entries-empty]").findAll("button");
        expect(blocked.every((button) => (button.element as HTMLButtonElement).disabled && button.attributes("title") === "世界只读")).toBe(true);
        // “人物”这个种类没登记时只有“新建条目”。
        await wrapper.setProps({blockedReason: "", createPerson: false});
        expect(wrapper.get("[data-entries-empty]").findAll("button").map((button) => button.text())).toEqual(["新建条目"]);
    });

    it("世界断开时树上面一条横幅与“重试”，树照常显示；点“重试”发 retry", async () => {
        const wrapper = mount(EntryTree, {props: {layers: {"": layer([item("a", "星瑕")])}, expanded: [], disconnected: true}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(wrapper);
        expect(wrapper.get("[role='status']").text()).toContain("世界已断开");
        expect(wrapper.find("[data-tree-id='a']").exists()).toBe(true);
        await wrapper.get("button").trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
    });

    it("选中项由宿主给", () => {
        const {row} = tree({"": layer([item("a", "星瑕"), item("b", "白灵")])}, [], "b");
        expect(row("b").attributes("aria-selected")).toBe("true");
        expect(row("a").attributes("aria-selected")).toBe("false");
    });

    it("creatable 时右键一行有“在它下面新建”，选了发 create（右键分组是根这一层）；不是 creatable 时没有菜单", async () => {
        const plain = tree({"": layer([item("a", "星瑕", {folder: "人物"})])}, ["folder:人物"]);
        await plain.row("a").trigger("contextmenu");
        expect(document.body.textContent).not.toContain("在它下面新建");
        plain.wrapper.unmount();

        const wrapper = mount(EntryTree, {props: {layers: {"": layer([item("a", "星瑕", {folder: "人物"})])}, expanded: ["folder:人物"], creatable: true}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(wrapper);
        const choose = async (id: string): Promise<void> => {
            await wrapper.get(`[data-tree-id="${id}"]`).trigger("contextmenu");
            await wrapper.vm.$nextTick();
            const entry = [...document.body.querySelectorAll("[role='menuitem']")].find((node) => node.textContent?.includes("在它下面新建")) as HTMLElement;
            entry.click();
            await wrapper.vm.$nextTick();
        };
        await choose("a");
        await choose("folder:人物");
        expect(wrapper.emitted("create")).toEqual([["a"], [null]]);
    });
});
