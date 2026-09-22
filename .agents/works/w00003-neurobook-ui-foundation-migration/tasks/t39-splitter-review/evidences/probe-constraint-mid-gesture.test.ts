// t39 审查探针 D：手势进行中程序收紧同组约束，程序布局是否被并入 gesture-end。
// 复现：复制到 packages/nb-ui/src/components/layout/ 后运行
//   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-constraint-mid-gesture.test.ts --disable-console-intercept
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
        layout: (wrapper.emitted("layout") ?? []).map((args) => args[0]).at(-1),
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

describe("探针 D：手势期间程序改约束", () => {
    it("中途收紧同组 maxSize 后松开指针，提交里是否混入程序布局", async () => {
        const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
        await nextTick();
        stubLayoutMetrics(wrapper);
        const startX = SASH_LEFT(0);

        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));
        await nextTick();
        console.log("mousemove+20", JSON.stringify(summary(wrapper)));

        await wrapper.setProps({panels: [PANELS[0]!, {...PANELS[1]!, maxSize: 40}, PANELS[2]!]});
        await nextTick();
        console.log("setProps(maxSize=40)", JSON.stringify(summary(wrapper)));

        window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX + 20, clientY: 10}));
        await nextTick();
        console.log("mouseup", JSON.stringify(summary(wrapper)));
        console.log("end payload", JSON.stringify(wrapper.emitted("gesture-end")?.at(-1)?.[0]));
    });
});
