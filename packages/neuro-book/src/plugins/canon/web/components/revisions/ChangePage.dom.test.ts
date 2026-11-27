/** ChangePage（同名 .md，docs/specs/canon/author-ui.md 输出 21、30）：各块怎么写、点了发什么，写不了时“改”不可用。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ChangeModel} from "../../change";
import {canonCatalogs} from "../../text";
import ChangePage from "./ChangePage.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const global = {provide: provideText(port)};

const model: ChangeModel = {
    text: "被扒手偷了",
    place: "第 3 章",
    kind: "已写",
    status: "held",
    statusText: "待定",
    heldReason: "待定：与设定冲突。和第 2 章的余额对不上",
    undoneReason: "",
    quotes: [{key: "t1", quote: "钱包不见了", source: "第 3 章正文", chapter: "3"}, {key: "t2", quote: "大概三百", source: "细纲", chapter: null}],
    involved: [{id: "xingxia", name: "星瑕"}],
    patches: [
        {index: 0, line: "星瑕的存款 −300", basis: {text: "估计：大概三百", estimate: true}, editable: true, label: "星瑕的存款"},
        {index: 1, line: "星瑕的样子 → 狼狈", editable: false, label: "星瑕的样子"},
    ],
};

const words = (element: Element): string => [...element.querySelectorAll("*")].filter((node) => node.children.length === 0).map((node) => node.textContent?.trim() ?? "").filter((part) => part !== "").join(" ");

describe("ChangePage", () => {
    it("页头、待定的原因、原句与出处、涉及的条目、每一处改动；点了各发什么", async () => {
        const wrapper = mount(ChangePage, {props: {status: "normal", model}, global});
        expect(wrapper.get("h1").text()).toBe("被扒手偷了");
        expect(words(wrapper.get("[data-change-meta]").element)).toBe("第 3 章 · 已写 · 待定");
        expect(wrapper.get("[data-change-held]").text()).toContain("待定：与设定冲突。和第 2 章的余额对不上");
        expect(wrapper.findAll("[data-change-quote]").map((quote) => words(quote.element))).toEqual(["“钱包不见了” 第 3 章正文 打开这一章", "“大概三百” 细纲"]);
        expect(wrapper.findAll("[data-change-patch]").map((row) => words(row.element))).toEqual(["星瑕的存款 −300 依据：估计：大概三百 改", "星瑕的样子 → 狼狈"]);
        expect(wrapper.get("[data-change-patch] .text-\\[var\\(--status-warning\\)\\]").text()).toBe("依据：估计：大概三百");

        await wrapper.get("[data-change-quote] button").trigger("click");
        await wrapper.get("[data-change-involved] button").trigger("click");
        await wrapper.get("[data-edit-patch='0']").trigger("click");
        await wrapper.findAll("button").find((button) => button.text() === "改成生效")!.trigger("click");
        expect(wrapper.emitted("open-chapter")).toEqual([["3"]]);
        expect(wrapper.emitted("open-entry")).toEqual([["xingxia"]]);
        expect(wrapper.emitted("edit")).toEqual([[0]]);
        expect(wrapper.emitted("activate")).toHaveLength(1);
    });

    it("“改成生效”的确认：预览一句一行，原因是 alert；没有预览时确认不可用", async () => {
        const wrapper = mount(ChangePage, {props: {status: "normal", model, activation: {preview: ["星瑕的存款：2,700 → 2,400"], previewing: false, error: "", recheck: false, saving: false, locked: false}}, global});
        const confirm = () => wrapper.get("[data-change-activation]").findAll("button").find((button) => button.text() === "改成生效")!;
        expect(wrapper.get("[data-change-activation]").text()).toContain("星瑕的存款：2,700 → 2,400");
        await confirm().trigger("click");
        await wrapper.get("[data-change-activation]").findAll("button").find((button) => button.text() === "取消")!.trigger("click");
        expect(wrapper.emitted("activation-save")).toHaveLength(1);
        expect(wrapper.emitted("activation-cancel")).toHaveLength(1);
        await wrapper.setProps({activation: {preview: null, previewing: false, error: "没有通过检查：和第 2 章的余额对不上", recheck: false, saving: false, locked: true}});
        expect(confirm().attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-change-activation] [role='alert']").text()).toBe("没有通过检查：和第 2 章的余额对不上");
    });

    it("写不了时“改”与“改成生效”不可用，悬停写原因；没找到章节文件时写一句；找不到这条情节", () => {
        const wrapper = mount(ChangePage, {props: {status: "normal", model, blocked: "世界已断开", chapterMissing: "3"}, global});
        expect(wrapper.get("[data-edit-patch='0']").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-edit-patch='0']").attributes("title")).toBe("世界已断开");
        expect(wrapper.findAll("button").find((button) => button.text() === "改成生效")!.attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-change-quote] [role='alert']").text()).toBe("没找到这一章的文件");
        expect(mount(ChangePage, {props: {status: "missing"}, global}).text()).toBe("找不到这条情节");
    });
});
