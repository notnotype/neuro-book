/**
 * 探针：Enter repeat、Arrow→Enter、Enter→Arrow 与 Escape 之后的上游事件，核对门禁 4
 * （「不能重新落入 Reka 不发 layout 的旧路径」）与「取消后后续事件不能提交」。
 *
 * 运行方式：
 *   cp .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t39-splitter-review/evidences/probe-key-sequences.test.ts \
 *      packages/nb-ui/src/components/layout/
 *   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-key-sequences.test.ts --disable-console-intercept
 *   跑完删除 packages/nb-ui/src/components/layout/probe-key-sequences.test.ts
 */
import {afterEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

const COLLAPSIBLE: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, minSize: 18, collapsible: true},
    {id: "editor", defaultSize: 52, minSize: 30},
    {id: "inspector", defaultSize: 20, minSize: 15},
];

function rect(left: number, width: number): DOMRect {
    return {
        x: left, y: 0, top: 0, left, right: left + width, bottom: 600,
        width, height: 600, toJSON: () => ({}),
    } as DOMRect;
}

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

function mountSplitter(props: Record<string, unknown>): VueWrapper {
    const wrapper = mount(Splitter, {attachTo: attachContainer(), props});
    wrappers.push(wrapper);
    return wrapper;
}

function handles(wrapper: VueWrapper): HTMLElement[] {
    return wrapper.findAll("[data-panel-resize-handle-id]").map((node) => node.element as HTMLElement);
}

function sizes(wrapper: VueWrapper): string[] {
    return wrapper.findAll("[data-panel]").map((panel) => panel.attributes("data-panel-size") ?? "?");
}

async function key(handle: HTMLElement, type: "keydown" | "keyup", name: string): Promise<void> {
    handle.dispatchEvent(new KeyboardEvent(type, {key: name, bubbles: true, cancelable: true}));
    await nextTick();
}

function report(label: string, wrapper: VueWrapper, layoutsBefore: number): void {
    console.log(label,
        "| layout +" + ((wrapper.emitted("layout")?.length ?? 0) - layoutsBefore),
        "| sizes " + JSON.stringify(sizes(wrapper)),
        "| start " + (wrapper.emitted("gesture-start")?.length ?? 0),
        "| update " + (wrapper.emitted("gesture-update")?.length ?? 0),
        "| end " + (wrapper.emitted("gesture-end")?.length ?? 0),
        "| cancel " + JSON.stringify(wrapper.emitted("gesture-cancel")));
}

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("探针：多键序列", () => {
    it("Enter 连发三次 + keyup", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;
        const handle = handles(wrapper)[0]!;

        await key(handle, "keydown", "Enter");
        console.log("P4 dom after kd1", JSON.stringify(sizes(wrapper)), "layout +" + ((wrapper.emitted("layout")?.length ?? 0) - layoutsBefore));
        await key(handle, "keydown", "Enter");
        console.log("P4 dom after kd2", JSON.stringify(sizes(wrapper)), "layout +" + ((wrapper.emitted("layout")?.length ?? 0) - layoutsBefore));
        await key(handle, "keydown", "Enter");
        console.log("P4 dom after kd3", JSON.stringify(sizes(wrapper)), "layout +" + ((wrapper.emitted("layout")?.length ?? 0) - layoutsBefore));
        await key(handle, "keyup", "Enter");

        report("P4 enter-repeat", wrapper, layoutsBefore);
        expect(true).toBe(true);
    });

    it("Arrow→Enter（先按方向键再按 Enter）", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;
        const handle = handles(wrapper)[0]!;

        await key(handle, "keydown", "ArrowRight");
        await key(handle, "keydown", "Enter");
        await key(handle, "keyup", "ArrowRight");

        report("P5 arrow-then-enter", wrapper, layoutsBefore);
        expect(true).toBe(true);
    });

    it("Enter→Arrow（折叠后继续方向键）", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;
        const handle = handles(wrapper)[0]!;

        await key(handle, "keydown", "Enter");
        await key(handle, "keydown", "ArrowRight");
        await key(handle, "keyup", "Enter");
        await key(handle, "keyup", "ArrowRight");

        report("P6 enter-then-arrow", wrapper, layoutsBefore);
        expect(true).toBe(true);
    });

    it("Escape 取消后 Reka 继续派发的 move/mouseup 不能提交", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const group = wrapper.find("[data-panel-group]").element;
        const metrics = new Map<Element, DOMRect>();
        metrics.set(group, rect(0, 1000));
        handles(wrapper).forEach((sash, index) => metrics.set(sash, rect(400 + index * 200, 1)));
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            return metrics.get(this) ?? rect(0, 0);
        });
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;

        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: 400, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 450, clientY: 10}));
        await nextTick();
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", cancelable: true}));
        await nextTick();
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 500, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: 500, clientY: 10}));
        await nextTick();

        report("P7 escape-then-late-events", wrapper, layoutsBefore);
        expect(true).toBe(true);
    });

    it("零 sash 后邻接边界仍能找到正确相邻面板（第二个 sash 拖动）", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, sashSizes: [0, 1]});
        await nextTick();
        const group = wrapper.find("[data-panel-group]").element;
        const metrics = new Map<Element, DOMRect>();
        metrics.set(group, rect(0, 1000));
        handles(wrapper).forEach((sash, index) => metrics.set(sash, rect(400 + index * 200, index === 0 ? 0 : 1)));
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            return metrics.get(this) ?? rect(0, 0);
        });

        const second = handles(wrapper)[1]!;
        second.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: 600, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 620, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: 620, clientY: 10}));
        await nextTick();

        console.log("P8 zero-neighbor end", JSON.stringify(wrapper.emitted("gesture-end")));
        expect(true).toBe(true);
    });
});
