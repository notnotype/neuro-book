/**
 * AgentNotice（同名 .md）：写最近一次的标题与之前的次数；三个按钮与关闭各发各的事件。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import AgentNotice from "./AgentNotice.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe("AgentNotice", () => {
    it("写最近一次的标题，之前改过几次时写出次数；看回执、撤销、看改动记录、关闭各发各的事件", async () => {
        const wrapper = mount(AgentNotice, {props: {title: "给星瑕加别名", earlier: 2}, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        expect(wrapper.text()).toContain("Agent 改了设定：给星瑕加别名（之前还改了 2 次）");
        const buttons = wrapper.findAll("button");
        for (const button of buttons) await button.trigger("click");
        expect(Object.keys(wrapper.emitted())).toEqual(expect.arrayContaining(["receipt", "undo", "revisions", "close"]));
        await wrapper.setProps({earlier: 0});
        expect(wrapper.text()).not.toContain("之前还改了");
    });

    it("最近一次已撤销：同一个按钮写“已撤销”、标成不可用，点了不再发出撤销", async () => {
        const wrapper = mount(AgentNotice, {props: {title: "建校长"}, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        const button = wrapper.get("[data-agent-undo]");
        await wrapper.setProps({undone: true});
        // 还是那一个元素：还原对话框关闭时焦点回到它。
        expect(wrapper.get("[data-agent-undo]").element).toBe(button.element);
        expect(button.text()).toBe("已撤销");
        expect(button.attributes("aria-disabled")).toBe("true");
        await button.trigger("click");
        expect(wrapper.emitted("undo")).toBeUndefined();
    });
});
