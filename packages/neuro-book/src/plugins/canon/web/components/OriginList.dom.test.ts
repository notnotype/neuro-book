/**
 * OriginList（同名 .md，docs/specs/canon/author-ui.md 输出 11、14）：各行的位置、依据与变化量，估计的依据用警告色，“改这一笔”
 * “再显示更早的”“重试”发什么事件，没有行时的“读取中”。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {OriginRow} from "../rows";
import {canonCatalogs} from "../text";
import OriginList from "./OriginList.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const rows: OriginRow[] = [
    {key: "p2", where: "第 2 章", what: "买了书", basis: {text: "估计：书大概三百", estimate: true}, delta: "−300", result: "900 元", change: "c2"},
    {key: "k1", where: "第 1 章", what: "核对：正文写 1,200，对得上", result: "", check: "ok"},
    {key: "init", where: "", what: "最初", result: "1,000 元"},
];

function list(props: Record<string, unknown>) {
    const wrapper = mount(OriginList, {props: {rows, ...props}, global: {provide: provideText(port)}});
    mounted.push(wrapper);
    return wrapper;
}

describe("OriginList", () => {
    it("一步一项、没有表头；变化与结果前有只给读屏的“变化”“结果”；初值一项写“最初”一次；估计的依据用警告色；只有变更给出的行有“改这一笔”，点了发 change", async () => {
        const wrapper = list({caption: "存款是怎么来的"});
        expect(wrapper.text()).toContain("存款是怎么来的");
        expect(wrapper.text()).not.toContain("发生了什么");
        const lines = wrapper.findAll("[data-origin-row]");
        expect(lines).toHaveLength(3);
        expect(lines[0]!.text()).toBe("第 2 章变化−300结果900 元改这一笔买了书估计：书大概三百");
        expect(lines[2]!.text()).toBe("最初结果1,000 元");
        expect(lines[0]!.find(".text-\\[var\\(--status-warning\\)\\]").text()).toBe("估计：书大概三百");
        expect(lines.map((line) => line.findAll("button").length)).toEqual([1, 0, 0]);
        await lines[0]!.get("button").trigger("click");
        expect(wrapper.emitted("change")).toEqual([["c2"]]);
    });

    it("还有没读的步时末尾是“再显示更早的”，点了发 more", async () => {
        const wrapper = list({remaining: 29});
        const more = wrapper.findAll("button").find((button) => button.text() === "再显示更早的（还有 29 步）")!;
        await more.trigger("click");
        expect(wrapper.emitted("more")).toHaveLength(1);
    });

    it("读取失败时写原因与“重试”，读到过的行留着；没有行时是“读取中…”", async () => {
        const failed = list({failed: true, reason: "项目实例正在停止"});
        expect(failed.get("[role='alert']").text()).toContain("来历没有读出来项目实例正在停止");
        expect(failed.findAll("[data-origin-row]")).toHaveLength(3);
        await failed.get("[role='alert'] button").trigger("click");
        expect(failed.emitted("retry")).toHaveLength(1);
        expect(list({rows: [], loading: true}).text()).toBe("读取中…");
    });
});
