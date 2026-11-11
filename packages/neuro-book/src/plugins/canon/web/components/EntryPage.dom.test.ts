/**
 * EntryPage（同名 .md，docs/specs/canon/author-ui.md 输出 6 到 9、27）：页头、位置选择、分页与插槽；四种状态；未出场、选过的章
 * 不在了、断开的横幅；交互发出的事件。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import EntryPage from "./EntryPage.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const base = {
    status: "normal" as const,
    name: "哥哥",
    summary: "星瑕的另一个身份",
    sameAs: {id: "e1", name: "星瑕"},
    positions: [{value: "initial", label: "初值"}, {value: "1:end", label: "第 1 章末尾"}],
    position: "1:end",
    tabs: [{value: "text", label: "文字"}, {value: "plot", label: "情节", count: 2}],
    tab: "text",
};

function page(props: Record<string, unknown> = {}) {
    const wrapper = mount(EntryPage, {props: {...base, ...props}, slots: {default: "<p data-content>分页内容</p>"}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

describe("EntryPage", () => {
    it("页头是名字、“是谁”、简介、位置与“按计划”，下面是分页与内容；点“是谁”的链接发 open-entry，切分页发 update:tab", async () => {
        const wrapper = page();
        expect(wrapper.get("h1").text()).toBe("哥哥");
        expect(wrapper.text()).toContain("是谁：星瑕");
        expect(wrapper.text()).toContain("星瑕的另一个身份");
        expect(wrapper.get("[role='combobox']").text()).toContain("第 1 章末尾");
        expect(wrapper.findAll("[role='tab']").map((tab) => tab.text().replace(/\s+/gu, ""))).toEqual(["文字", "情节2"]);
        expect(wrapper.get("[role='tabpanel'] [data-content]").text()).toBe("分页内容");
        await wrapper.findAll("header button").find((button) => button.text() === "星瑕")!.trigger("click");
        expect(wrapper.emitted("open-entry")).toEqual([["e1"]]);
        await wrapper.findAll("[role='tab']")[1]!.trigger("click");
        expect(wrapper.emitted("update:tab")).toEqual([["plot"]]);
        await wrapper.get("[role='switch']").trigger("click");
        expect(wrapper.emitted("update:planned")).toEqual([[true]]);
    });

    it("读取中、读取失败、找不到、已删除各只有一句，没有页头控件与分页", () => {
        expect(page({status: "loading"}).text()).toBe("读取中…");
        expect(page({status: "missing"}).text()).toBe("找不到这个条目");
        expect(page({status: "failed"}).get("[role='alert']").text()).toBe("没有读出来");
        const deleted = page({status: "deleted"});
        expect(deleted.text()).toBe("哥哥这个条目已删除");
        expect(deleted.find("[role='tab']").exists()).toBe(false);
    });

    it("未出场、选过的章不在了、断开：各一行说明；断开的“重试”发 retry", async () => {
        const wrapper = page({notAppeared: "第 1 章末尾", positionGone: true, disconnected: true});
        expect(wrapper.text()).toContain("在第 1 章末尾还没出场");
        expect(wrapper.text()).toContain("原来选的那一章已经不在了");
        expect(wrapper.get("[role='status']").text()).toContain("世界已断开");
        await wrapper.findAll("button").find((button) => button.text() === "重试")!.trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
    });
});
