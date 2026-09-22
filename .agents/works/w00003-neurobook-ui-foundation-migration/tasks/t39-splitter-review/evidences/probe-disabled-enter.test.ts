/**
 * 探针：禁用状态与零像素 sash 下，Reka 组级 Enter 监听是否仍折叠面板（且不发 layout / 手势）。
 *
 * 运行方式：
 *   cp .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t39-splitter-review/evidences/probe-disabled-enter.test.ts \
 *      packages/nb-ui/src/components/layout/
 *   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-disabled-enter.test.ts --disable-console-intercept
 *   跑完删除 packages/nb-ui/src/components/layout/probe-disabled-enter.test.ts
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

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("探针：disabled / 零 sash 下的 Enter", () => {
    it("disabled=true 时按 Enter 的布局、layout 与手势事件", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, disabled: true});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const before = sizes(wrapper);
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;

        console.log("P2 disabled tabindex", handle.getAttribute("tabindex"), "data-disabled", handle.hasAttribute("data-disabled"));
        handle.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await nextTick();

        console.log("P2 sizes before", JSON.stringify(before), "after", JSON.stringify(sizes(wrapper)));
        console.log("P2 layout delta", (wrapper.emitted("layout")?.length ?? 0) - layoutsBefore);
        console.log("P2 gesture start", wrapper.emitted("gesture-start")?.length ?? 0,
            "update", wrapper.emitted("gesture-update")?.length ?? 0,
            "end", wrapper.emitted("gesture-end")?.length ?? 0,
            "cancel", wrapper.emitted("gesture-cancel")?.length ?? 0);

        expect(true).toBe(true);
    });

    it("sashSizes=0 时按 Enter 的行为（合成 keydown，模拟焦点已在 sash 上）", async () => {
        const wrapper = mountSplitter({panels: COLLAPSIBLE, sashSizes: [0]});
        await nextTick();
        const handle = handles(wrapper)[0]!;
        const before = sizes(wrapper);
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;

        console.log("P3 zero tabindex", handle.getAttribute("tabindex"), "data-disabled", handle.hasAttribute("data-disabled"));
        handle.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await nextTick();

        console.log("P3 sizes before", JSON.stringify(before), "after", JSON.stringify(sizes(wrapper)));
        console.log("P3 layout delta", (wrapper.emitted("layout")?.length ?? 0) - layoutsBefore);
        console.log("P3 gesture", wrapper.emitted("gesture-start")?.length ?? 0,
            wrapper.emitted("gesture-end")?.length ?? 0,
            wrapper.emitted("gesture-cancel")?.length ?? 0);

        expect(true).toBe(true);
    });
});
