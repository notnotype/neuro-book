/**
 * WorkbenchRegionStrip（同名 .md）：一个容器一个入口，按下态写在 `aria-pressed`；点、Enter 发 `select`；右键与菜单键发 `context-menu`；
 * 并进来的头画在默认插槽里；入口这一片不是拖动源（docs/specs/ui/workbench-layout.md 输出 47）。放不下时收进“更多”要真实宽度，在 Lab 的 e2e 里量。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import WorkbenchRegionStrip from "./WorkbenchRegionStrip.vue";
import type {RegionStripEntry} from "./WorkbenchRegionStrip.vue";

const entry = (id: string, label: string, pressed = false): RegionStripEntry => ({id, label, icon: "i-lucide-square", tooltip: label, current: pressed, pressed});
const ENTRIES = [entry("view:chat", "对话", true), entry("view:outline", "大纲")];

function mountStrip(variant: "icons" | "titles", slot?: () => unknown) {
    return mount(WorkbenchRegionStrip, {
        props: {region: variant === "icons" ? "auxiliarybar" : "panel", label: "视图容器", moreLabel: "更多", entries: ENTRIES, variant},
        slots: slot === undefined ? {} : {default: slot},
        attachTo: document.body,
    });
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("WorkbenchRegionStrip", () => {
    it("一个容器一个入口，是一组带按下态的按钮；图标入口的名称是容器名称，标题入口写出名称", () => {
        const icons = mountStrip("icons");
        expect(icons.get("[data-region-strip]").attributes("data-region-strip")).toBe("auxiliarybar");
        expect(icons.get("[role='group']").attributes("aria-label")).toBe("视图容器");
        const buttons = icons.findAll("[data-region-entry]");
        expect(buttons.map((button) => [button.attributes("data-region-entry"), button.attributes("aria-label"), button.attributes("aria-pressed")])).toEqual([
            ["view:chat", "对话", "true"],
            ["view:outline", "大纲", "false"],
        ]);
        const titles = mountStrip("titles");
        expect(titles.findAll("[data-region-entry]").map((button) => button.text())).toEqual(["对话", "大纲"]);
        expect(titles.find("[data-region-entry]").attributes("aria-label")).toBeUndefined();
    });

    it("点入口发 select；入口不是拖动源（没有活动栏入口的 data-tool-entry）", async () => {
        const wrapper = mountStrip("icons");
        await wrapper.findAll("[data-region-entry]")[1]!.trigger("click");
        expect(wrapper.emitted("select")).toEqual([["view:outline"]]);
        expect(wrapper.find("[data-tool-entry]").exists()).toBe(false);
    });

    it("右键发 context-menu 带指针坐标；菜单键没有可靠坐标时开在入口下面", async () => {
        const wrapper = mountStrip("titles");
        const button = wrapper.get("[data-region-entry='view:chat']");
        await button.trigger("contextmenu", {clientX: 40, clientY: 12, button: 2});
        await button.trigger("contextmenu", {clientX: 0, clientY: 0, button: 0});
        const rect = button.element.getBoundingClientRect();
        expect(wrapper.emitted("context-menu")).toEqual([
            ["view:chat", {x: 40, y: 12}],
            ["view:chat", {x: rect.left, y: rect.bottom}],
        ]);
    });

    it("并进来的头画在入口后面", () => {
        const wrapper = mountStrip("icons", () => h("header", {"data-panel-head": "section:chat"}, "对话"));
        const head = wrapper.get("[data-panel-head]");
        expect(head.element.closest(".workbench-region-strip__head")).not.toBeNull();
        expect(wrapper.get("[role='group']").element.compareDocumentPosition(head.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
