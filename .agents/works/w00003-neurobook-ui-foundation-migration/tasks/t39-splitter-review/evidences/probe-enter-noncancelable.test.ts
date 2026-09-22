/**
 * 探针：用组件用例当前的事件形态（不可取消的 KeyboardEvent）跑 Enter 序列，
 * 对比「提交载荷」与「DOM 真实几何」，验证 splitter.test.ts 的 Enter 用例是否能区分拦截成败。
 *
 * 运行方式：
 *   cp .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t39-splitter-review/evidences/probe-enter-noncancelable.test.ts packages/nb-ui/src/components/layout/
 *   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-enter-noncancelable.test.ts --disable-console-intercept
 *   跑完删除 packages/nb-ui/src/components/layout/probe-enter-noncancelable.test.ts
 */
import {afterEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

const PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, minSize: 18, collapsible: true},
    {id: "editor", defaultSize: 52, minSize: 30},
    {id: "inspector", defaultSize: 20, minSize: 15},
];

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("探针：不可取消事件下的 Enter 提交与 DOM", () => {
    it("提交载荷与 data-panel-size 是否一致", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        containers.push(container);
        const wrapper = mount(Splitter, {attachTo: container, props: {panels: PANELS}});
        wrappers.push(wrapper);
        await nextTick();

        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;
        const handle = wrapper.find("[data-panel-resize-handle-id]").element as HTMLElement;
        // 组件用例 pressAdjustKey 的事件形态：可取消位缺省为 false
        for (const type of ["keydown", "keydown", "keyup"] as const) {
            handle.dispatchEvent(new KeyboardEvent(type, {key: "Enter", bubbles: true}));
            await nextTick();
        }

        const dom = wrapper.findAll("[data-panel]").map((panel) => panel.attributes("data-panel-size"));
        const payload = (wrapper.emitted("gesture-end")?.[0]?.[0] as {sizes: number[]} | undefined)?.sizes;
        console.log("P9 layout +" + ((wrapper.emitted("layout")?.length ?? 0) - layoutsBefore),
            "| end payload", JSON.stringify(payload), "| dom", JSON.stringify(dom));
        expect(true).toBe(true);
    });
});
