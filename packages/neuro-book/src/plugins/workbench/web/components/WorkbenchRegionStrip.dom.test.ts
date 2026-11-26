/**
 * WorkbenchRegionStrip（同名 .md）：一个容器一个入口，按下态写在 `aria-pressed`；点、Enter 发 `select`；右键与菜单键发 `context-menu`；
 * 并进来的头画在默认插槽里；入口是拖动源，拖动中画占位与并入的高亮（docs/specs/ui/workbench-layout.md 输出 45 到 47）。放不下时收进“更多”要真实宽度，在 Lab 的 e2e 里量；拖放本身在 e2e 里。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import WorkbenchRegionStrip from "./WorkbenchRegionStrip.vue";
import type {RegionStripEntry} from "./WorkbenchRegionStrip.vue";

const entry = (id: string, label: string, pressed = false, viewId: string | null = id.slice("view:".length)): RegionStripEntry => ({id, label, icon: "i-lucide-square", tooltip: label, viewId, current: pressed, pressed});
const ENTRIES = [entry("view:chat", "对话", true), entry("custom:notes", "笔记", false, null)];

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
            ["custom:notes", "笔记", "false"],
        ]);
        const titles = mountStrip("titles");
        expect(titles.findAll("[data-region-entry]").map((button) => button.text())).toEqual(["对话", "笔记"]);
        expect(titles.find("[data-region-entry]").attributes("aria-label")).toBeUndefined();
    });

    it("入口带稳定名 workbench.container 与容器 id（agent/page-agent.md 输出 6）", () => {
        const strip = mountStrip("icons");
        expect(strip.findAll("[data-region-entry]").map((button) => [button.attributes("data-nb-target"), button.attributes("data-nb-key")])).toEqual([
            ["workbench.container", "view:chat"],
            ["workbench.container", "custom:notes"],
        ]);
    });

    it("计数（views.md 输出 17）：标题入口写在标题后，图标入口画在右上角；读屏名称都是“标题 数”，超过 99 写 99+", () => {
        const counted = [{...entry("view:notes", "通知", true), count: 2}, entry("view:tasks", "后台任务"), {...entry("view:mail", "消息"), count: 120}];
        const titles = mount(WorkbenchRegionStrip, {props: {region: "panel", label: "视图容器", moreLabel: "更多", entries: counted, variant: "titles"}, attachTo: document.body});
        expect(titles.findAll("[data-region-entry]").map((button) => button.text())).toEqual(["通知 2", "后台任务", "消息 99+"]);
        expect(titles.find("[data-tool-count]").exists()).toBe(false);
        const icons = mount(WorkbenchRegionStrip, {props: {region: "auxiliarybar", label: "视图容器", moreLabel: "更多", entries: counted, variant: "icons"}, attachTo: document.body});
        expect(icons.findAll("[data-region-entry]").map((button) => button.attributes("aria-label"))).toEqual(["通知 2", "后台任务", "消息 99+"]);
        expect(icons.findAll("[data-tool-count]").map((badge) => [badge.attributes("data-tool-count"), badge.text()])).toEqual([["view:notes", "2"], ["view:mail", "99+"]]);
    });

    it("点入口发 select；入口是拖动源，同活动栏：只含一个视图的写着它的视图，含几个视图的拖的是容器（输出 46）", async () => {
        const wrapper = mountStrip("icons");
        await wrapper.findAll("[data-region-entry]")[1]!.trigger("click");
        expect(wrapper.emitted("select")).toEqual([["custom:notes"]]);
        expect(wrapper.findAll("[data-tool-entry]").map((button) => [button.attributes("data-tool-entry"), button.attributes("data-tool-view")])).toEqual([["view:chat", "chat"], ["custom:notes", undefined]]);
    });

    it("拖动中：被拖的入口留着位置、不进可访问树，拖着的视图放下会并进的入口带并入的高亮", () => {
        const wrapper = mount(WorkbenchRegionStrip, {props: {region: "panel", label: "视图容器", moreLabel: "更多", entries: ENTRIES, variant: "titles", placeholder: "view:chat", highlighted: "custom:notes"}, attachTo: document.body});
        expect(wrapper.get("[data-tool-entry='view:chat']").element.closest("[data-entry-frame]")?.getAttribute("aria-hidden")).toBe("true");
        expect(wrapper.get("[data-tool-entry='custom:notes']").attributes("data-tool-merge")).toBe("");
        expect(wrapper.findAll("[data-tool-merge]")).toHaveLength(1);
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
