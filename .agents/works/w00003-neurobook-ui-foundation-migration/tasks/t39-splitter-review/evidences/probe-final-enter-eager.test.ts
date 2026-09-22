/**
 * 探针（t39 第三轮）：核 t38 对 F1（Enter 截断顺序）、F2（等值重建不取消）的补修，
 * 并检查补修引入的新交互（非可折叠面板的 Enter、Enter+Arrow 多键序列、sash 几何变化取消）。
 *
 * 运行方式：
 *   cp .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t39-splitter-review/evidences/probe-final-enter-eager.test.ts \
 *      packages/nb-ui/src/components/layout/
 *   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-final-enter-eager.test.ts --disable-console-intercept
 *   跑完删除 packages/nb-ui/src/components/layout/probe-final-enter-eager.test.ts
 */
import {afterEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";
import type {SplitterGestureState} from "./splitter-gesture";

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

const COLLAPSIBLE: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, minSize: 18, collapsible: true},
    {id: "editor", defaultSize: 52, minSize: 30},
    {id: "inspector", defaultSize: 20, minSize: 15},
];

const NO_COLLAPSE: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, minSize: 18},
    {id: "editor", defaultSize: 52, minSize: 30},
    {id: "inspector", defaultSize: 20, minSize: 15},
];

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

function handles(root: VueWrapper): HTMLElement[] {
    return root.findAll("[data-panel-resize-handle-id]").map((node) => node.element as HTMLElement);
}

function sizes(root: VueWrapper): string[] {
    return root.findAll("[data-panel]").map((panel) => panel.attributes("data-panel-size") ?? "?");
}

/** 事件计数按固定键返回，多个断言点需要同一份口径 */
function counts(root: VueWrapper): Record<string, number> {
    return {
        layout: root.emitted("layout")?.length ?? 0,
        start: root.emitted("gesture-start")?.length ?? 0,
        update: root.emitted("gesture-update")?.length ?? 0,
        end: root.emitted("gesture-end")?.length ?? 0,
        cancel: root.emitted("gesture-cancel")?.length ?? 0,
    };
}

function submittedSizes(root: VueWrapper): number[] | undefined {
    const last = root.emitted("gesture-end")?.at(-1)?.[0] as SplitterGestureState | undefined;
    return last?.sizes;
}

async function key(target: HTMLElement, type: "keydown" | "keyup", k: string, cancelable = true): Promise<void> {
    target.dispatchEvent(new KeyboardEvent(type, {key: k, bubbles: true, cancelable}));
    await nextTick();
}

/** 只替代测量：组宽 1000px、每条 sash 1px 宽且互不重叠 */
function stubLayoutMetrics(root: VueWrapper): void {
    const metrics = new Map<Element, DOMRect>();
    metrics.set(root.find("[data-panel-group]").element, {
        x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}),
    } as DOMRect);
    handles(root).forEach((sash, index) => {
        metrics.set(sash, {
            x: 400 + index * 200, y: 0, top: 0, left: 400 + index * 200, right: 401 + index * 200,
            bottom: 600, width: 1, height: 600, toJSON: () => ({}),
        } as DOMRect);
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        return metrics.get(this) ?? ({width: 0, height: 0} as DOMRect);
    });
}

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("探针 F1：Enter 截断顺序", () => {
    it("P1 disabled + 可取消 Enter：不改几何、不发 layout、不发手势", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, disabled: true});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const before = sizes(wrapper);
        const beforeCounts = counts(wrapper);

        await key(handle, "keydown", "Enter");

        console.log("P1 sizes", JSON.stringify(before), "->", JSON.stringify(sizes(wrapper)),
            "counts", JSON.stringify(counts(wrapper)));
        expect(sizes(wrapper)).toEqual(before);
        expect(counts(wrapper)).toEqual(beforeCounts);
    });

    it("P2 disabled + 不可取消 Enter：上游旧路径仍会折叠且不发 layout（判别力来源）", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, disabled: true});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const before = sizes(wrapper);

        await key(handle, "keydown", "Enter", false);

        console.log("P2 sizes", JSON.stringify(before), "->", JSON.stringify(sizes(wrapper)),
            "counts", JSON.stringify(counts(wrapper)));
        expect(true).toBe(true);
    });

    it("P3 零像素 sash + 可取消 Enter：不改几何、不发 layout", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, sashSizes: [0]});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const before = sizes(wrapper);
        const beforeCounts = counts(wrapper);

        await key(handle, "keydown", "Enter");

        console.log("P3 tabindex", handle.getAttribute("tabindex"),
            "sizes", JSON.stringify(before), "->", JSON.stringify(sizes(wrapper)),
            "counts", JSON.stringify(counts(wrapper)));
        expect(sizes(wrapper)).toEqual(before);
        expect(counts(wrapper)).toEqual(beforeCounts);
    });

    it("P4 可折叠面板 Enter 折叠后再 Enter 恢复：两次提交，DOM 与 layout 一致", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const handle = handles(wrapper)[0]!;

        await key(handle, "keydown", "Enter");
        await key(handle, "keyup", "Enter");
        console.log("P4 after collapse dom", JSON.stringify(sizes(wrapper)),
            "layout", JSON.stringify(wrapper.emitted("layout")?.at(-1)?.[0]),
            "end", JSON.stringify(submittedSizes(wrapper)));

        await key(handle, "keydown", "Enter");
        await key(handle, "keyup", "Enter");
        console.log("P4 after expand dom", JSON.stringify(sizes(wrapper)),
            "counts", JSON.stringify(counts(wrapper)));

        expect(counts(wrapper).start).toBe(2);
        expect(counts(wrapper).end).toBe(2);
        expect(counts(wrapper).cancel).toBe(0);
        expect(submittedSizes(wrapper)?.map((value) => value.toFixed(1))).toEqual(sizes(wrapper));
    });

    it("P5 非可折叠面板 Enter：不发 layout、不改几何", async () => {
        const wrapper = mountSplitter({panels: NO_COLLAPSE});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const before = sizes(wrapper);
        const beforeCounts = counts(wrapper);

        await key(handle, "keydown", "Enter");
        await key(handle, "keyup", "Enter");

        console.log("P5 sizes", JSON.stringify(before), "->", JSON.stringify(sizes(wrapper)),
            "counts", JSON.stringify(counts(wrapper)), "before", JSON.stringify(beforeCounts),
            "cancel", JSON.stringify(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]));
        expect(sizes(wrapper)).toEqual(before);
        expect(counts(wrapper).layout).toBe(beforeCounts.layout);
    });

    it("P6 Enter repeat + Arrow 多键序列：一次提交，DOM 与提交尺寸一致", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const handle = handles(wrapper)[0]!;

        await key(handle, "keydown", "Enter");
        await key(handle, "keydown", "Enter");
        await key(handle, "keydown", "ArrowRight");
        await key(handle, "keyup", "ArrowRight");
        await key(handle, "keyup", "Enter");

        console.log("P6 counts", JSON.stringify(counts(wrapper)),
            "dom", JSON.stringify(sizes(wrapper)),
            "layout", JSON.stringify(wrapper.emitted("layout")?.at(-1)?.[0]),
            "end", JSON.stringify(submittedSizes(wrapper)));
        expect(counts(wrapper).start).toBe(1);
        expect(counts(wrapper).end).toBe(1);
        expect(counts(wrapper).cancel).toBe(0);
        expect(submittedSizes(wrapper)?.map((value) => value.toFixed(1))).toEqual(sizes(wrapper));
    });

    it("P10 Arrow 之后按 Enter（未松开）：不出现「DOM 变了但没有 layout」的旧路径", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const step = (label: string): void => {
            const lastLayout = wrapper.emitted("layout")?.at(-1)?.[0] as number[] | undefined;
            console.log("P10", label, "dom", JSON.stringify(sizes(wrapper)),
                "layout", JSON.stringify(lastLayout), "counts", JSON.stringify(counts(wrapper)));
            expect(lastLayout?.map((value) => value.toFixed(1))).toEqual(sizes(wrapper));
        };

        await key(handle, "keydown", "ArrowRight");
        step("after Arrow");
        await key(handle, "keydown", "Enter");
        step("after Enter");
        await key(handle, "keyup", "ArrowRight");
        step("after keyup");
        expect(submittedSizes(wrapper)?.map((value) => value.toFixed(1))).toEqual(sizes(wrapper));
    });

    it("P11 第二条 sash 的 Enter 折叠其左侧面板并提交该边界", async () => {
        const wrapper = mountSplitter({
            panels: [COLLAPSIBLE[0]!, {...COLLAPSIBLE[1]!, collapsible: true}, COLLAPSIBLE[2]!],
        });
        await nextTick();
        const handle = handles(wrapper)[1]!;

        await key(handle, "keydown", "Enter");
        await key(handle, "keyup", "Enter");

        console.log("P11 dom", JSON.stringify(sizes(wrapper)),
            "end", JSON.stringify(wrapper.emitted("gesture-end")?.at(-1)?.[0]),
            "counts", JSON.stringify(counts(wrapper)));
        expect(counts(wrapper).end).toBe(1);
        expect(submittedSizes(wrapper)?.map((value) => value.toFixed(1))).toEqual(sizes(wrapper));
        expect((wrapper.emitted("gesture-end")?.at(-1)?.[0] as SplitterGestureState).sash).toBe("editor~inspector");
    });
});

describe("探针 F2：等值重建", () => {
    it("P7 指针拖动中模板每次渲染生成新数组字面量：不取消", async () => {
        const Host = defineComponent({
            props: {tick: {type: Number, default: 0}},
            render() {
                return h(Splitter, {
                    panels: [
                        {id: "outline", defaultSize: 28},
                        {id: "editor", defaultSize: 52},
                        {id: "inspector", defaultSize: 20},
                    ],
                });
            },
        });
        const host = mount(Host, {attachTo: attachContainer()});
        wrappers.push(host);
        await nextTick();
        const inner = host.findComponent(Splitter);
        stubLayoutMetrics(inner);
        const sash = handles(inner)[0]!;

        sash.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: 400, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 420, clientY: 10}));
        await host.setProps({tick: 1});
        await nextTick();
        await host.setProps({tick: 2});
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 440, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: 440, clientY: 10}));
        await nextTick();

        console.log("P7 counts", JSON.stringify(counts(inner)), "dom", JSON.stringify(sizes(inner)));
        expect(counts(inner).cancel).toBe(0);
        expect(counts(inner).end).toBe(1);
    });

    it("P8 键盘手势中等值重建不取消，值变化取消", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, sashSizes: [7, 1]});
        await nextTick();
        const handle = handles(wrapper)[0]!;

        await key(handle, "keydown", "ArrowRight");
        await wrapper.setProps({panels: COLLAPSIBLE.map((panel) => ({...panel}))});
        await nextTick();
        console.log("P8 after equal rebuild", JSON.stringify(counts(wrapper)));

        await wrapper.setProps({panels: COLLAPSIBLE.map((panel) => ({...panel, maxSize: 40}))});
        await nextTick();
        console.log("P8 after value change", JSON.stringify(counts(wrapper)),
            JSON.stringify(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]));
        expect(counts(wrapper).cancel).toBe(1);
    });

    it("P9 指针拖动中 sashSizes 值变化：取消且不提交", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, sashSizes: [7, 1]});
        await nextTick();
        stubLayoutMetrics(wrapper);
        const sash = handles(wrapper)[0]!;

        sash.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: 400, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 420, clientY: 10}));
        await wrapper.setProps({sashSizes: [7, 8]});
        await nextTick();
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: 420, clientY: 10}));
        await nextTick();

        console.log("P9 counts", JSON.stringify(counts(wrapper)),
            JSON.stringify(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]));
        expect(counts(wrapper).cancel).toBe(1);
        expect(counts(wrapper).end).toBe(0);
    });
});
