/**
 * FieldTable（同名 .md，docs/specs/canon/author-ui.md 输出 12、13）：显示名、值、标记；未知与不完整用警告色；列表字段一行一个
 * 元素；点值发 value，展开着的那一行下面是来历插槽；语义档的各句与“还没归纳”。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {FieldRow} from "../rows";
import {canonCatalogs} from "../text";
import FieldTable from "./FieldTable.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const row = (path: string, label: string, display: string, extra: Partial<FieldRow> = {}): FieldRow => ({path, label, display, unknown: false, incomplete: false, mark: null, ...extra});

describe("FieldTable", () => {
    it("每行写显示名、值与标记；未知、不完整用警告色；列表字段列出各元素；值按钮的可读名是“显示名：值”", () => {
        const wrapper = mount(FieldTable, {props: {rows: [
            row("p.存款", "存款", "900 元", {mark: "第 2 章改过"}),
            row("p.状态", "状态", "未知", {unknown: true}),
            row("p.魔力", "魔力", "3,110", {incomplete: true}),
            row("p.物品", "随身物品", "", {items: ["魔杖", "旧书"]}),
        ]}, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        expect(wrapper.get("[data-field='p.存款']").text()).toBe("存款900 元第 2 章改过");
        expect(wrapper.get("[data-field='p.状态'] button").classes()).toContain("text-[var(--status-warning)]");
        expect(wrapper.get("[data-field='p.魔力']").text()).toContain("不完整");
        expect(wrapper.get("[data-field='p.物品'] button").findAll("span").map((item) => item.text())).toEqual(["魔杖", "旧书"]);
        expect(wrapper.get("[data-field='p.存款'] button").attributes("aria-label")).toBe("存款：900 元");
    });

    it("点值发 value；展开着的那一行 aria-expanded，下面是来历插槽", async () => {
        const wrapper = mount(FieldTable, {
            props: {rows: [row("p.存款", "存款", "900 元"), row("p.工资", "工资", "3,000")], open: "p.存款"},
            slots: {origin: ({path}: {path: string}) => h("p", {"data-slot": ""}, `来历 ${path}`)},
            global: {provide: provideText(port)},
        });
        mounted.push(wrapper);
        expect(wrapper.get("[data-field='p.存款'] button").attributes("aria-expanded")).toBe("true");
        expect(wrapper.get("[data-field='p.存款'] [data-slot]").text()).toBe("来历 p.存款");
        expect(wrapper.find("[data-field='p.工资'] [data-slot]").exists()).toBe(false);
        await wrapper.get("[data-field='p.工资'] button").trigger("click");
        expect(wrapper.emitted("value")).toEqual([["p.工资"]]);
    });

    it("语义档的各句带位置，未归纳时最后写“还没归纳”；没有字段时写一句", () => {
        const wrapper = mount(FieldTable, {props: {rows: [row("c.态度", "现在的态度", "提防", {notes: [{where: "第 1 章", text: "起点：提防"}, {where: "第 2 章", text: "被救了一次"}], notReduced: true})]}, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        expect(wrapper.findAll("[data-field='c.态度'] li").map((item) => item.text())).toEqual(["第 1 章起点：提防", "第 2 章被救了一次", "还没归纳"]);
        const empty = mount(FieldTable, {props: {rows: []}, global: {provide: provideText(port)}});
        mounted.push(empty);
        expect(empty.text()).toBe("这个分页还没有字段");
    });

    it("“改”按钮：只在可改的行上、与值并列；点了发 edit；不可用时禁用并写原因", async () => {
        const rows = [row("p.存款", "存款", "900 元", {editable: true}), row("p.物品", "随身物品", "", {items: ["魔杖"]})];
        const wrapper = mount(FieldTable, {props: {rows, editing: true}, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        expect(wrapper.findAll("[data-edit]").map((button) => button.attributes("data-edit"))).toEqual(["p.存款"]);
        expect(wrapper.get("[data-edit='p.存款']").attributes("aria-label")).toBe("改存款");
        await wrapper.get("[data-edit='p.存款']").trigger("click");
        expect(wrapper.emitted("edit")).toEqual([["p.存款"]]);
        await wrapper.setProps({editReason: "先不算计划"});
        expect(wrapper.get("[data-edit='p.存款']").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-edit='p.存款']").attributes("title")).toBe("先不算计划");
    });
});
