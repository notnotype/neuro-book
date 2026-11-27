/**
 * PanelView（同名 .md，docs/specs/canon/author-ui.md 输出 14）：值卡、选中哪张、流水的标题与各行；点值卡发 select；没有字段时
 * 写一句。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {FieldRow} from "../../rows";
import {canonCatalogs} from "../../text";
import PanelView from "./PanelView.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const card = (path: string, label: string, display: string, extra: Partial<FieldRow> = {}): FieldRow => ({path, label, display, unknown: false, incomplete: false, mark: null, ...extra});

describe("PanelView", () => {
    it("值卡写显示名、标记与值；选中的那张旁边是它的流水；点值卡发 select", async () => {
        const wrapper = mount(PanelView, {props: {
            cards: [card("panel.存款", "存款", "900 元", {mark: "第 2 章改过"}), card("panel.物品", "随身物品", "", {items: ["魔杖"]})],
            selected: "panel.存款",
            ledger: [{key: "init", where: "", what: "最初", result: "1,000 元"}],
        }, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        expect(wrapper.get("[data-card='panel.存款']").text()).toBe("存款第 2 章改过900 元");
        expect(wrapper.get("[data-card='panel.存款']").attributes("aria-pressed")).toBe("true");
        expect(wrapper.get("[data-card='panel.物品']").text()).toBe("随身物品魔杖");
        expect(wrapper.get("h3").text()).toBe("存款的流水");
        expect(wrapper.findAll("[data-origin-row]")).toHaveLength(1);
        await wrapper.get("[data-card='panel.物品']").trigger("click");
        expect(wrapper.emitted("select")).toEqual([["panel.物品"]]);
    });

    it("没有字段时写“还没有数值”", () => {
        const wrapper = mount(PanelView, {props: {cards: []}, global: {provide: provideText(port)}});
        mounted.push(wrapper);
        expect(wrapper.text()).toBe("还没有数值");
    });
});
