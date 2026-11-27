/**
 * WorkbenchToolStrip（同名 .md）的入口角标（docs/specs/workbench/views.md 输出 17）与侧轨的标记、焦点（docs/specs/ui/workbench-layout.md 输出 50）：
 * 放不下收进“更多”、拖动与指示块要真实布局，在 e2e 里。
 */

import {enableAutoUnmount, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import WorkbenchToolStrip from "./WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripSegment} from "./WorkbenchToolStrip.vue";

const entry = (id: string, label: string, count?: number): ToolStripEntry => ({id, label, icon: "i-lucide-square", tooltip: label, viewId: null, current: false, pressed: false, ...(count === undefined ? {} : {count})});

afterEach(() => {
    document.body.innerHTML = "";
});
// 每条用例挂的组件在清空 body 之前卸载（vitest 的 afterEach 后登记的先跑）：留着的组件里有动画帧回调，等动画帧的用例会让它们在已清空的 body 里重画。
enableAutoUnmount(afterEach);

describe("WorkbenchToolStrip", () => {
    it("入口有计数时图标右上角画角标、读屏名称是“标题 数”；没有计数不画；超过 99 写 99+", () => {
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: [entry("view:bot", "bot", 3), entry("view:files", "文件"), entry("view:mail", "消息", 100)]}, attachTo: document.body});
        expect(wrapper.findAll("[data-tool-entry]").map((button) => button.attributes("aria-label"))).toEqual(["bot 3", "文件", "消息 99+"]);
        expect(wrapper.findAll("[data-tool-count]").map((badge) => [badge.attributes("data-tool-count"), badge.text(), badge.attributes("aria-hidden")])).toEqual([["view:bot", "3", "true"], ["view:mail", "99+", "true"]]);
    });

    it("入口带稳定名 workbench.container 与容器 id，活动栏项带 workbench.activity 与项 id（agent/page-agent.md 输出 6）", () => {
        const items = [
            {id: "acme.settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: null, disabledReason: null},
            {id: "acme.profile", title: "个人资料", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
        ];
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: [entry("acme.project", "项目")], items}, attachTo: document.body});
        const named = (selector: string) => wrapper.findAll(selector).map((element) => [element.attributes("data-nb-target"), element.attributes("data-nb-key")]);
        expect(named("[data-tool-entry]")).toEqual([["workbench.container", "acme.project"]]);
        expect(named("[data-activity-item]")).toEqual([["workbench.activity", "acme.settings"], ["workbench.activity", "acme.profile"]]);
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

    it("项自己处理过的方向键（“更多”的触发器打开菜单）不再挪焦点", async () => {
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: pressedAt(0, ["a", "b"]), items}, attachTo: document.body});
        await nextTick();
        const first = wrapper.get('[data-tool-entry="a"]').element as HTMLElement;
        first.addEventListener("keydown", (event) => event.preventDefault());
        first.focus();
        first.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await nextTick();
        expect(document.activeElement).toBe(first);
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

describe("WorkbenchToolStrip 的视图段（docs/specs/ui/workbench-layout.md 输出 50）", () => {
    const labels = {expand: "展开", collapse: "收起", tooNarrow: "窗口太窄", handle: "调整侧轨宽度"};
    const segment = (overrides: Partial<ToolStripSegment> = {}): ToolStripSegment => ({expanded: false, tooNarrow: false, loading: false, width: 260, bounds: {minimum: 200, maximum: 420, width: 260}, revision: 1, handleDisabled: false, labels, ...overrides});
    const mountRail = (value: ToolStripSegment | null) => mount(WorkbenchToolStrip, {props: {label: "右栏的侧轨", moreLabel: "更多", entries: [{...entry("view:m", "消息"), current: true, pressed: true}], region: "auxiliarybar", segment: value}, attachTo: document.body});

    it("有视图段：画出 main 与 foot（拒收区）并交给宿主、展开按钮；收着与展开、太窄的说法；没有视图段时这些都没有，交回 null", async () => {
        const wrapper = mountRail(segment());
        await nextTick();
        const main = wrapper.get('[data-rail-segment="main"]').element;
        const foot = wrapper.get('[data-rail-segment="foot"]').element;
        expect([main.hasAttribute("data-drop-refuse"), foot.hasAttribute("data-drop-refuse")]).toEqual([true, true]);
        expect(wrapper.emitted("segment-elements")?.at(-1)).toEqual([main, foot]);
        const expand = wrapper.get("[data-rail-expand]");
        expect([expand.attributes("aria-expanded"), expand.attributes("aria-label")]).toEqual(["false", "展开"]);
        expect(wrapper.get("nav").attributes("data-rail-state")).toBe("collapsed");
        expect(wrapper.find("[data-rail-handle]").exists()).toBe(false);
        await expand.trigger("click");
        expect(wrapper.emitted("toggle-segment")).toHaveLength(1);

        await wrapper.setProps({segment: segment({expanded: true})});
        expect(wrapper.get("nav").attributes("data-rail-state")).toBe("expanded");
        // 名称不随状态变，状态只在 `aria-expanded`；悬停写这一下会做什么（收起）。
        expect([wrapper.get("[data-rail-expand]").attributes("aria-expanded"), wrapper.get("[data-rail-expand]").attributes("aria-label")]).toEqual(["true", "展开"]);
        expect(wrapper.get("[data-rail-handle]").attributes()).toMatchObject({"role": "separator", "aria-valuenow": "260", "aria-valuemin": "200", "aria-valuemax": "420", "aria-label": "调整侧轨宽度"});

        await wrapper.setProps({segment: segment({tooNarrow: true})});
        expect(wrapper.get("[data-rail-expand]").attributes()).toMatchObject({"aria-expanded": "false", "aria-label": "展开", "aria-description": "窗口太窄", "data-rail-too-narrow": ""});
        await wrapper.setProps({segment: segment({loading: true})});
        expect(wrapper.find("[data-rail-segment='main'] [data-rail-loading]").exists()).toBe(true);

        await wrapper.setProps({segment: null});
        await nextTick();
        expect(wrapper.find("[data-rail-segment]").exists()).toBe(false);
        expect(wrapper.find("[data-rail-expand]").exists()).toBe(false);
        expect(wrapper.emitted("segment-elements")?.at(-1)).toEqual([null, null]);
    });

    it("轨宽手柄的键盘：右轨往左（ArrowLeft）变宽，每次 10；Home 与双击回缺省；到了上限不再提交；最大化时没有手柄", async () => {
        const wrapper = mountRail(segment({expanded: true, width: 300}));
        const handle = wrapper.get("[data-rail-handle]");
        await handle.trigger("keydown", {key: "ArrowLeft"});
        await handle.trigger("keydown", {key: "ArrowRight"});
        await handle.trigger("keydown", {key: "Home"});
        await handle.trigger("dblclick");
        expect(wrapper.emitted("segment-width-commit")).toEqual([[310], [290], [260], [260]]);
        await wrapper.setProps({segment: segment({expanded: true, width: 420})});
        await wrapper.get("[data-rail-handle]").trigger("keydown", {key: "ArrowLeft"});
        expect(wrapper.emitted("segment-width-commit")).toHaveLength(4);
        await wrapper.setProps({segment: segment({expanded: true, handleDisabled: true})});
        expect(wrapper.find("[data-rail-handle]").exists()).toBe(false);
    });

    it("轨宽手柄的指针：按下拿到焦点，拖动只发预览、触界即停，松手提交一次；Esc 整场取消、撤回预览、不提交", async () => {
        const wrapper = mountRail(segment({expanded: true, width: 300}));
        const element = wrapper.get("[data-rail-handle]").element as HTMLElement;
        const pointer = (type: string, clientX: number) => element.dispatchEvent(new PointerEvent(type, {pointerId: 1, button: 0, clientX, bubbles: true, cancelable: true}));
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        pointer("pointerdown", 500);
        expect(document.activeElement).toBe(element);
        // 右轨的手柄在左边：往左 40 是变宽 40；再往左拖过上限 420 停在 420。
        pointer("pointermove", 460);
        await frame();
        pointer("pointermove", 300);
        await frame();
        expect(wrapper.emitted("segment-width-preview")?.map(([width]) => width)).toEqual([340, 420]);
        expect(element.getAttribute("aria-valuenow")).toBe("420");
        pointer("pointerup", 300);
        expect(wrapper.emitted("segment-width-commit")).toEqual([[420]]);
        expect(wrapper.emitted("segment-width-preview")?.at(-1)).toEqual([null]);

        pointer("pointerdown", 500);
        pointer("pointermove", 450);
        await frame();
        element.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        pointer("pointerup", 450);
        expect(wrapper.emitted("segment-width-commit")).toHaveLength(1);
        expect(wrapper.emitted("segment-width-preview")?.at(-1)).toEqual([null]);
    });

    it("焦点在视图段里、视图段被收起：焦点所在的项还在就留着；被视图拆掉了交给展开按钮", async () => {
        const wrapper = mountRail(segment({expanded: true}));
        await nextTick();
        const main = wrapper.get('[data-rail-segment="main"]').element;
        const kept = document.createElement("button");
        main.append(kept);
        kept.focus();
        await wrapper.setProps({segment: segment({expanded: false})});
        await nextTick();
        expect(document.activeElement).toBe(kept);

        await wrapper.setProps({segment: segment({expanded: true})});
        const list = document.createElement("button");
        main.append(list);
        list.focus();
        // 视图收起时拆掉展开的列表：和这次更新同一轮。
        const props = wrapper.setProps({segment: segment({expanded: false})});
        list.remove();
        await props;
        await nextTick();
        expect(document.activeElement).toBe(wrapper.get("[data-rail-expand]").element);
    });
});
