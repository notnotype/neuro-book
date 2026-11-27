/**
 * 设定组的两种看法（ComponentAgentView、ComponentRawView，同名 .md，docs/specs/canon/author-ui.md 输出 54）：AI视图把给模型的字原样摆出、
 * 头一行写在看的位置、读取中与读失败；原始视图的初值、变更、空的与各自读取中的写法，“再显示”与“重试”。接到条目页上的读取在 entry-page.dom.test。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import ComponentAgentView from "./ComponentAgentView.vue";
import ComponentRawView from "./ComponentRawView.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const RAW = {initial: {type: "nbook.canon.panel", fields: {存款: 1000}} as unknown, changes: [{id: "c1", text: "领了工资", patches: [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: 3000}]}] as readonly unknown[], total: 1, remaining: 0, initialLoading: false, changesLoading: false, failed: null as string | null};

async function agentView(props: {text: string; position: string; loading?: boolean; failed?: string | null}): Promise<VueWrapper> {
    const wrapper = mount(ComponentAgentView, {props, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}
async function rawView(props: typeof RAW): Promise<VueWrapper> {
    const wrapper = mount(ComponentRawView, {props, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

describe("ComponentAgentView", () => {
    it("头一行写在看的位置，下面原样摆出给模型的那段字（保留换行）", async () => {
        const wrapper = await agentView({text: "【数值】（设定组 panel）\n- 存款 = 900｜数｜单位 元", position: "第 2 章末尾"});
        expect(wrapper.text()).toContain("在看：第 2 章末尾");
        expect(wrapper.get("[data-agent-text]").element.textContent).toBe("【数值】（设定组 panel）\n- 存款 = 900｜数｜单位 元");
    });

    it("写那段字要用的东西还在读时写“读取中”、不出字；读失败写原因，点“重试”发 retry", async () => {
        const wrapper = await agentView({text: "", position: "第 2 章末尾", loading: true});
        expect(wrapper.text()).toContain("读取中");
        expect(wrapper.find("[data-agent-text]").exists()).toBe(false);
        await wrapper.setProps({loading: false, failed: "世界已断开"});
        expect(wrapper.get("[role='alert']").text()).toContain("没有读出来：世界已断开");
        expect(wrapper.find("[data-agent-text]").exists()).toBe(false);
        await wrapper.get("[role='alert'] button").trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
    });
});

describe("ComponentRawView", () => {
    it("头一行写明是存下来的原样、不随“在看”变；初值与变更各一节，摊开存下来的原样；变更一节的标题写总条数", async () => {
        const wrapper = await rawView(RAW);
        expect(wrapper.get("[data-raw-head]").text()).toBe("存下来的原样，不随“在看”变");
        expect(wrapper.get("[data-raw-initial]").text()).toContain("初值");
        expect(wrapper.get("[data-raw-initial]").text()).toContain("1000");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("剧情变更（1 条）");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("领了工资");
        expect(wrapper.find("[data-raw-more]").exists()).toBe(false);
    });

    it("初值里没有这一组、没有变更：各写一行；还有没读的出“再显示”，最多 20 条，点了发 more", async () => {
        const wrapper = await rawView({...RAW, initial: undefined, changes: [], total: 0});
        expect(wrapper.get("[data-raw-initial]").text()).toContain("初值里没有这组设定");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("没有剧情变更改过这组设定");
        await wrapper.setProps({changes: RAW.changes, total: 45, remaining: 44});
        expect(wrapper.get("[data-raw-more]").text()).toBe("再显示 20 条");
        await wrapper.get("[data-raw-more]").trigger("click");
        expect(wrapper.emitted("more")).toHaveLength(1);
    });

    it("两节各按自己的读取写“读取中”：变更先回来时初值一节仍是读取中，不写“初值里没有”；读失败写原因，点“重试”发 retry", async () => {
        const wrapper = await rawView({...RAW, initial: undefined, changes: [], total: 0, initialLoading: true, changesLoading: true});
        expect(wrapper.get("[data-raw-initial]").text()).toContain("读取中");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("读取中");
        await wrapper.setProps({changes: RAW.changes, total: 1, changesLoading: false});
        expect(wrapper.get("[data-raw-initial]").text()).toContain("读取中");
        expect(wrapper.get("[data-raw-initial]").text()).not.toContain("初值里没有这组设定");
        expect(wrapper.get("[data-raw-changes]").text()).toContain("领了工资");
        await wrapper.setProps({initialLoading: false, failed: "世界已断开"});
        expect(wrapper.get("[role='alert']").text()).toContain("没有读出来：世界已断开");
        await wrapper.get("[role='alert'] button").trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
    });
});
