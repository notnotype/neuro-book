/**
 * WorkbenchToolStrip（同名 .md）的入口角标（docs/specs/workbench/views.md 输出 17）与侧轨的标记、焦点（docs/specs/ui/workbench-layout.md 输出 50）：
 * 放不下收进“更多”、拖动与指示块要真实布局，在 e2e 里。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import WorkbenchToolStrip from "./WorkbenchToolStrip.vue";
import type {ToolStripEntry} from "./WorkbenchToolStrip.vue";

const entry = (id: string, label: string, count?: number): ToolStripEntry => ({id, label, icon: "i-lucide-square", tooltip: label, viewId: null, current: false, pressed: false, ...(count === undefined ? {} : {count})});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("WorkbenchToolStrip", () => {
    it("入口有计数时图标右上角画角标、读屏名称是“标题 数”；没有计数不画；超过 99 写 99+", () => {
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: [entry("view:bot", "bot", 3), entry("view:files", "文件"), entry("view:mail", "消息", 100)]}, attachTo: document.body});
        expect(wrapper.findAll("[data-tool-entry]").map((button) => button.attributes("aria-label"))).toEqual(["bot 3", "文件", "消息 99+"]);
        expect(wrapper.findAll("[data-tool-count]").map((badge) => [badge.attributes("data-tool-count"), badge.text(), badge.attributes("aria-hidden")])).toEqual([["view:bot", "3", "true"], ["view:mail", "99+", "true"]]);
    });

    const items = [{id: "settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: null, disabledReason: null}];
    const pressedAt = (index: number, ids: readonly string[]) => ids.map((id, at) => ({...entry(id, id), current: at === index, pressed: at === index}));
    const tabStops = (root: Element): string[] => [...root.querySelectorAll("[data-rail-item]")].filter((element) => element.getAttribute("tabindex") === "0").map((element) => element.getAttribute("data-tool-entry") ?? element.getAttribute("data-activity-item") ?? "?");

    it("侧轨的标记：哪个区域、收着、相连时才有 `data-rail-joined`；全局项只在左轨", () => {
        const left = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: pressedAt(0, ["a"]), items, joined: true}, attachTo: document.body});
        const nav = left.get("nav");
        expect([nav.attributes("data-rail"), nav.attributes("data-rail-state"), nav.attributes("data-rail-joined")]).toEqual(["sidebar", "collapsed", ""]);
        expect(left.findAll("[data-activity-items]")).toHaveLength(1);
        const right = mount(WorkbenchToolStrip, {props: {label: "右栏", moreLabel: "更多", entries: pressedAt(0, ["c"]), items, region: "auxiliarybar"}, attachTo: document.body});
        expect(right.get("nav").attributes("data-rail")).toBe("auxiliarybar");
        expect(right.get("nav").attributes("data-rail-joined")).toBeUndefined();
        expect(right.findAll("[data-activity-items]")).toHaveLength(0);
    });

    it("整条一个 Tab 停靠：按下的入口能 Tab 进来，上下方向键、Home、End 在条里走（入口到底段），走过的那一项成为下次 Tab 进来的", async () => {
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: pressedAt(1, ["a", "b", "c"]), items}, attachTo: document.body});
        await nextTick();
        const nav = wrapper.get("nav").element;
        expect(tabStops(nav)).toEqual(["b"]);
        const button = (id: string) => nav.querySelector<HTMLElement>(`[data-tool-entry="${id}"], [data-activity-item="${id}"]`) as HTMLElement;
        const press = async (key: string) => {
            (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
            await nextTick();
        };
        button("b").focus();
        await press("ArrowDown");
        expect(document.activeElement).toBe(button("c"));
        await press("End");
        expect(document.activeElement).toBe(button("settings"));
        await press("ArrowDown");
        expect(document.activeElement).toBe(button("settings"));
        await press("Home");
        expect(document.activeElement).toBe(button("a"));
        await press("ArrowUp");
        expect(document.activeElement).toBe(button("a"));
        expect(tabStops(nav)).toEqual(["a"]);
    });

    it("条里多出来的项（视图借来的那一段）照 DOM 顺序进同一条；走过的那项没了，Tab 停靠回到按下的入口", async () => {
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "右栏", moreLabel: "更多", entries: pressedAt(0, ["a", "b"]), region: "auxiliarybar"}, attachTo: document.body});
        await nextTick();
        const nav = wrapper.get("nav").element;
        const extra = document.createElement("button");
        extra.setAttribute("data-rail-item", "");
        extra.setAttribute("data-activity-item", "segment");
        nav.append(extra);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(extra.getAttribute("tabindex")).toBe("-1");
        extra.focus();
        expect(tabStops(nav)).toEqual(["segment"]);
        extra.remove();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(tabStops(nav)).toEqual(["a"]);
    });
});
