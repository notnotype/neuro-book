/**
 * EntryPage（同名 .md，docs/specs/canon/author-ui.md 输出 6 到 9、27、38）：页头、时间点、分页与插槽；四种状态；未出场、选过的章
 * 不在了的标记、断开的横幅；交互发出的事件。
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
    it("页头是名字、“是谁”、简介与时间点，下面是分页与内容；点“是谁”的链接发 open-entry，切分页发 update:tab", async () => {
        const wrapper = page();
        expect(wrapper.get("h1").text()).toBe("哥哥");
        expect(wrapper.text()).toContain("是谁：星瑕");
        expect(wrapper.text()).toContain("星瑕的另一个身份");
        expect(wrapper.get("[data-position-trigger]").text()).toContain("第 1 章末尾");
        expect(wrapper.findAll("[role='tab']").map((tab) => tab.text().replace(/\s+/gu, ""))).toEqual(["文字", "情节2"]);
        expect(wrapper.get("[role='tabpanel'] [data-content]").text()).toBe("分页内容");
        await wrapper.findAll("header button").find((button) => button.text() === "星瑕")!.trigger("click");
        expect(wrapper.emitted("open-entry")).toEqual([["e1"]]);
        await wrapper.findAll("[role='tab']")[1]!.trigger("click");
        expect(wrapper.emitted("update:tab")).toEqual([["plot"]]);
        expect(wrapper.find("button[aria-label='更多']").exists()).toBe(true);
    });

    it("只有一个位置又没有计划（空作品）时不出时间点；作品里有计划时出", async () => {
        const empty = page({positions: [{value: "initial", label: "故事开始前"}], position: "initial"});
        expect(empty.find("[data-position-picker]").exists()).toBe(false);
        const planned = page({positions: [{value: "initial", label: "故事开始前"}], position: "initial", canPlan: true});
        expect(planned.get("[data-position-trigger]").text()).toContain("故事开始前");
    });

    it("可编辑时名字、简介本身是按钮，点了发出带锚点的 edit-name、edit-summary；没有“改”；没有简介时写“一句话简介”", async () => {
        const wrapper = page({editable: true, summary: ""});
        expect(wrapper.findAll("button").some((button) => button.text() === "改")).toBe(false);
        const name = wrapper.get("[data-edit='entry.name']");
        expect(name.text()).toBe("哥哥");
        await name.trigger("click");
        expect(wrapper.emitted("edit-name")).toEqual([[name.element]]);
        const summary = wrapper.get("[data-edit='entry.summary']");
        expect(summary.text()).toBe("一句话简介");
        await summary.trigger("click");
        expect(wrapper.emitted("edit-summary")).toEqual([[summary.element]]);
    });

    it("添加别名：回车加上；失焦时非空也加上；Escape 放弃，之后的失焦不再加；已有的不再加", async () => {
        const wrapper = page({editable: true, aliases: ["小瑕"]});
        const start = async (): Promise<HTMLInputElement> => {
            await wrapper.findAll("[data-entry-aliases] button").find((button) => button.text() === "添加别名")!.trigger("click");
            return wrapper.get("[data-entry-aliases] input").element as HTMLInputElement;
        };
        let input = await start();
        await wrapper.get("[data-entry-aliases] input").setValue("夜王");
        await wrapper.get("[data-entry-aliases] input").trigger("keydown", {key: "Enter"});
        input = await start();
        await wrapper.get("[data-entry-aliases] input").setValue("哥哥大人");
        await wrapper.get("[data-entry-aliases] input").trigger("blur");
        input = await start();
        await wrapper.get("[data-entry-aliases] input").setValue("不要的");
        await wrapper.get("[data-entry-aliases] input").trigger("keydown", {key: "Escape"});
        input.dispatchEvent(new FocusEvent("blur"));
        await start();
        await wrapper.get("[data-entry-aliases] input").setValue("小瑕");
        await wrapper.get("[data-entry-aliases] input").trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("aliases")).toEqual([[{add: ["夜王"]}], [{add: ["哥哥大人"]}]]);
    });

    it("读取中、读取失败、找不到、已删除各只有一句，没有页头控件与分页", () => {
        expect(page({status: "loading"}).text()).toBe("读取中…");
        expect(page({status: "missing"}).text()).toBe("找不到这个条目");
        expect(page({status: "failed"}).get("[role='alert']").text()).toBe("没有读出来");
        const deleted = page({status: "deleted"});
        expect(deleted.text()).toBe("哥哥这个条目已删除");
        expect(deleted.find("[role='tab']").exists()).toBe(false);
    });

    it("未出场、选过的章不在了写在时间点旁的标记里，不另起一行；断开的“重试”发 retry", async () => {
        expect(page({notAppeared: "第 1 章末尾"}).get("[data-position-picker]").text()).toContain("到第 1 章末尾还没出场");
        expect(page({positionGone: true}).get("[data-position-picker]").text()).toContain("原来选的那一章已经不在了");
        const wrapper = page({disconnected: true});
        expect(wrapper.get("[role='status']").text()).toContain("世界已断开");
        await wrapper.findAll("button").find((button) => button.text() === "重试")!.trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
    });
});
