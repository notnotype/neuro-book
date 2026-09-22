// t39 审查探针 I/J：pointercancel 取消手势后，Reka 的全局指针状态未复位。
// 复现：复制到 packages/nb-ui/src/components/layout/ 后运行
//   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-pointercancel-arm.test.ts --disable-console-intercept
// I：同一 realm 内新挂载的实例无法再开始指针拖动。
// J：取消后「不按任何键」移动鼠标仍会改变布局，且没有任何手势事件（无提交）。
import {afterEach, describe, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";

const GROUP_WIDTH = 1000;
const SASH_LEFT = (index: number): number => 400 + index * 200;

const PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28},
    {id: "editor", defaultSize: 52},
    {id: "inspector", defaultSize: 20},
];

const containers: HTMLElement[] = [];

function rect(left: number, width: number): DOMRect {
    return {
        x: left, y: 0, top: 0, left, right: left + width, bottom: 600, width, height: 600,
        toJSON: () => ({}),
    } as DOMRect;
}

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

function handles(wrapper: VueWrapper): HTMLElement[] {
    return wrapper.findAll("[data-panel-resize-handle-id]").map((handle) => handle.element as HTMLElement);
}

function stubLayoutMetrics(wrapper: VueWrapper): void {
    const metrics = new Map<Element, DOMRect>();
    metrics.set(wrapper.find("[data-panel-group]").element, rect(0, GROUP_WIDTH));
    handles(wrapper).forEach((sash, index) => metrics.set(sash, rect(SASH_LEFT(index), 1)));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        return metrics.get(this) ?? rect(0, 0);
    });
}

function summary(wrapper: VueWrapper): Record<string, unknown> {
    return {
        layouts: (wrapper.emitted("layout") ?? []).map((args) => args[0]),
        start: wrapper.emitted("gesture-start")?.length ?? 0,
        update: wrapper.emitted("gesture-update")?.length ?? 0,
        end: wrapper.emitted("gesture-end")?.length ?? 0,
        cancel: wrapper.emitted("gesture-cancel")?.length ?? 0,
    };
}

afterEach(() => {
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("探针 I：取消后上游指针状态泄漏", () => {
    it("基线：无前置用例时指针拖动产生提交", async () => {
        const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        stubLayoutMetrics(wrapper);
        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX + 20, clientY: 10}));
        await nextTick();
        console.log("I baseline drag", JSON.stringify(summary(wrapper)));
    });

    it("pointercancel 收口后（未发 mouseup），新挂载的实例是否还能拖动", async () => {
        const first = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        stubLayoutMetrics(first);
        const startX = SASH_LEFT(0);
        handles(first)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));
        window.dispatchEvent(new Event("pointercancel"));
        await nextTick();
        console.log("I first after pointercancel", JSON.stringify(summary(first)));

        const second = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        stubLayoutMetrics(second);
        console.log("I second handle count", handles(second).length);
        handles(second)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX + 20, clientY: 10}));
        await nextTick();
        console.log("I second drag", JSON.stringify(summary(second)));
    });
});

describe("探针 J：pointercancel 后未按下的鼠标移动", () => {
    it("取消手势后仅移动鼠标是否还会改布局", async () => {
        const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        stubLayoutMetrics(wrapper);
        const startX = SASH_LEFT(0);

        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 10, clientY: 10}));
        window.dispatchEvent(new Event("pointercancel"));
        await nextTick();
        console.log("J after cancel", JSON.stringify(summary(wrapper)));

        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 80, clientY: 10}));
        await nextTick();
        console.log("J after buttonless move", JSON.stringify(summary(wrapper)));

        window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX + 80, clientY: 10}));
        await nextTick();
        console.log("J after mouseup", JSON.stringify(summary(wrapper)));
    });
});
