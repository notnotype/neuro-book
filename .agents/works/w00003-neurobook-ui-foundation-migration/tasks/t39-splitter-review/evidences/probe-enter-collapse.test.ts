// t39 审查探针 A/B：Enter（Reka 折叠）是否为宿主可见的几何变化。
// 复现：把本文件复制到 packages/nb-ui/src/components/layout/ 后运行
//   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-enter-collapse.test.ts --disable-console-intercept
// 观察点：Enter 后 DOM flexGrow 变了，但 layout 事件没有再发；之后拖动拿到的 baseline 是折叠前的旧尺寸。
import {afterEach, describe, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";

const GROUP_WIDTH = 1000;
const SASH_LEFT = (index: number): number => 400 + index * 200;

const PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, collapsible: true, minSize: 10},
    {id: "editor", defaultSize: 52},
    {id: "inspector", defaultSize: 20, collapsible: true, minSize: 10},
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

function layouts(wrapper: VueWrapper): unknown[] {
    return (wrapper.emitted("layout") ?? []).map((args) => args[0]);
}

function flexGrow(wrapper: VueWrapper): string[] {
    return wrapper.findAll("[data-panel]").map((panel) => (panel.element as HTMLElement).style.flexGrow);
}

afterEach(() => {
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("探针 A/B：Enter 折叠", () => {
    it("A：Enter 改变几何但不发 layout、不发手势", async () => {
        const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        console.log("A before", JSON.stringify({layout: layouts(wrapper), flex: flexGrow(wrapper)}));
        handles(wrapper)[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await nextTick();
        await nextTick();
        console.log("A after layouts", JSON.stringify(layouts(wrapper)));
        console.log("A after flex", JSON.stringify(flexGrow(wrapper)));
        console.log("A gesture", JSON.stringify({
            start: wrapper.emitted("gesture-start")?.length ?? 0,
            end: wrapper.emitted("gesture-end")?.length ?? 0,
            cancel: wrapper.emitted("gesture-cancel")?.length ?? 0,
        }));
    });

    it("B：Enter 之后再拖动，baseline 与屏幕几何不一致", async () => {
        const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        stubLayoutMetrics(wrapper);
        handles(wrapper)[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await nextTick();
        console.log("B flex after enter", JSON.stringify(flexGrow(wrapper)));

        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 30, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX + 30, clientY: 10}));
        await nextTick();

        console.log("B start", JSON.stringify(wrapper.emitted("gesture-start")?.at(-1)?.[0]));
        console.log("B end", JSON.stringify(wrapper.emitted("gesture-end")?.at(-1)?.[0]));
        console.log("B layouts", JSON.stringify(layouts(wrapper)));
        console.log("B flex", JSON.stringify(flexGrow(wrapper)));
    });
});
