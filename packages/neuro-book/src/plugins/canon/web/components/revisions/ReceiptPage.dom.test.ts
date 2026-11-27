/** ReceiptPage（同名 .md，docs/specs/canon/author-ui.md 输出 20、27、28）与 WorldBanners：各节怎么写、点了发什么、还原按钮什么时候不可用。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ReceiptModel} from "../../receipt";
import {canonCatalogs} from "../../text";
import ReceiptPage from "./ReceiptPage.vue";
import WorldBanners from "../entry-page/WorldBanners.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const global = {provide: provideText(port)};

const model: ReceiptModel = {
    title: "改存款",
    by: "作者",
    time: "2026-11-11 14:03",
    what: "改设定",
    sections: [
        {kind: "create", items: [{key: "c", ref: {kind: "change", id: "ch1"}, name: "领了工资", fields: []}]},
        {kind: "modify", items: [{key: "m", ref: {kind: "entry", id: "xingxia"}, name: "星瑕", fields: [{label: "存款", before: "500 元", after: "800 元"}, {label: "别的设置", before: "", after: "改了"}]}]},
        {kind: "delete", items: [{key: "d", ref: null, name: "一条决定", fields: []}]},
    ],
    impact: ["少了 1 条待处理"],
    reverts: ["r0"],
};

describe("ReceiptPage", () => {
    it("页头写标题与谁、什么时候、种类；各节按新建、修改、删除；修改的字段写改前改后；名字是链接", async () => {
        const wrapper = mount(ReceiptPage, {props: {status: "normal", model, reverted: [{id: "r0", title: "改外观"}]}, global});
        expect(wrapper.get("h1").text()).toBe("改存款");
        expect(wrapper.get("[data-receipt-meta]").text()).toBe("作者 · 2026-11-11 14:03 · 改设定");
        expect(wrapper.findAll("[data-receipt-section] h2").map((title) => title.text())).toEqual(["新建", "修改", "删除"]);
        expect(wrapper.findAll("[data-receipt-field]").map((field) => field.text().replace(/\s+/gu, " "))).toEqual(["500 元 → 800 元", "改了"]);
        expect(wrapper.get("[data-receipt-impact]").text()).toContain("少了 1 条待处理");
        await wrapper.get("[data-receipt-section='modify'] button").trigger("click");
        await wrapper.get("[data-receipt-section='create'] button").trigger("click");
        expect(wrapper.emitted("open")).toEqual([[{kind: "entry", id: "xingxia"}], [{kind: "change", id: "ch1"}]]);
        expect(wrapper.get("[data-receipt-section='delete']").find("button").exists()).toBe(false);
        expect(wrapper.get("[data-receipt-reverted]").text()).toBe("还原的是：改外观");
        await wrapper.get("[data-receipt-reverted] button").trigger("click");
        expect(wrapper.emitted("receipt")).toEqual([["r0"]]);
    });

    it("“还原这次修订”：可用时发 revert；有依赖时写一句；不可用时写原因", async () => {
        const wrapper = mount(ReceiptPage, {props: {status: "normal", model, dependents: 2}, global});
        const revert = () => wrapper.findAll("button").find((button) => button.text() === "还原这次修订")!;
        expect(wrapper.text()).toContain("后面有 2 次改动依赖它");
        await revert().trigger("click");
        expect(wrapper.emitted("revert")).toHaveLength(1);
        await wrapper.setProps({revertBlocked: "调整章序的改动不能还原"});
        expect(revert().attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-revert-blocked]").text()).toBe("调整章序的改动不能还原");
        expect(wrapper.text()).not.toContain("依赖它");
    });

    it("读取中、读取失败、找不到各只有一句", () => {
        expect(mount(ReceiptPage, {props: {status: "loading"}, global}).get("[aria-busy='true']").text()).toBe("读取中…");
        expect(mount(ReceiptPage, {props: {status: "failed"}, global}).get("[role='alert']").text()).toBe("没有读出来");
        const missing = mount(ReceiptPage, {props: {status: "missing"}, global});
        expect(missing.text()).toBe("找不到这次改动");
        expect(missing.find("button").exists()).toBe(false);
    });
});

describe("WorldBanners", () => {
    it("断开时写“世界已断开”与“重试”，只读时写原因；都是 status；都没有时什么也不画", async () => {
        const wrapper = mount(WorldBanners, {props: {disconnected: true, readOnly: "世界只读：日志的版本号重复了"}, global});
        const banners = wrapper.findAll("[role='status']");
        expect(banners.map((banner) => banner.text())).toEqual([expect.stringContaining("世界已断开"), expect.stringContaining("世界只读：日志的版本号重复了")]);
        await wrapper.get("button").trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
        await wrapper.setProps({disconnected: false, readOnly: ""});
        expect(wrapper.find("[role='status']").exists()).toBe(false);
    });
});
