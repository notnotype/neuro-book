/**
 * WorkbenchShellLayout 不需要真实布局的部分（同名 .md）：七个插槽各挂载一次、停放不卸载、呈现事实。happy-dom 不计算盒
 * 尺寸（测得的容器为 0×0，按紧凑呈现），几何、拖动、键盘、焦点与真实宽度下的往返由 `e2e/workbench-shell.e2e.ts`
 * 在 Lab 场景里覆盖。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, onBeforeUnmount, onMounted} from "vue";

import type {PanelState} from "../shell/panel-state";
import {SHELL_PART_IDS, SHELL_SIZE_DEFAULTS} from "../shell/sizes";
import type {ShellLayoutFacts, ShellPartId} from "../shell/sizes";
import WorkbenchShellLayout from "./WorkbenchShellLayout.vue";

const PANEL: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};

/** 每个 Part 的样例内容：记下挂载与卸载次数。 */
function counters() {
    const mounted: Partial<Record<ShellPartId, number>> = {};
    const unmounted: Partial<Record<ShellPartId, number>> = {};
    const part = (id: ShellPartId) => defineComponent({
        setup() {
            onMounted(() => {
                mounted[id] = (mounted[id] ?? 0) + 1;
            });
            onBeforeUnmount(() => {
                unmounted[id] = (unmounted[id] ?? 0) + 1;
            });
            return () => h("div", {"data-sample": id}, id);
        },
    });
    // 组件定义每个 Part 只建一次：插槽函数每次渲染都新建定义的话，Vue 会当成换了组件而重挂。
    const components = Object.fromEntries(SHELL_PART_IDS.map((id) => [id, part(id)]));
    const slots = Object.fromEntries(SHELL_PART_IDS.map((id) => [id, () => h(components[id]!)]));
    return {mounted, unmounted, slots};
}

const settle = async (): Promise<void> => {
    for (let index = 0; index < 4; index += 1) await nextTick();
};

let unmount: (() => void) | null = null;

afterEach(() => {
    unmount?.();
    unmount = null;
});

function render(panel: PanelState = PANEL) {
    const count = counters();
    const wrapper = mount(WorkbenchShellLayout, {props: {sizes: SHELL_SIZE_DEFAULTS, panel, contextKey: "c"}, slots: count.slots, attachTo: document.body});
    unmount = () => wrapper.unmount();
    const parked = (id: ShellPartId): boolean => wrapper.find(`[data-sample="${id}"]`).element.closest("[data-shell-parking]") !== null;
    return {wrapper, count, parked};
}

describe("WorkbenchShellLayout", () => {
    it("七个插槽各挂载一次，放进同名 Part 的落点；根带外壳标记与呈现模式", async () => {
        const {wrapper, count, parked} = render();
        await settle();
        expect(count.mounted).toEqual(Object.fromEntries(SHELL_PART_IDS.map((id) => [id, 1])));
        for (const id of SHELL_PART_IDS) {
            expect(parked(id), id).toBe(false);
            expect(wrapper.find(`[data-sample="${id}"]`).element.closest(`[data-leaf="${id}"]`), id).not.toBeNull();
        }
        expect(wrapper.attributes("data-workbench-shell")).toBeDefined();
        expect(wrapper.attributes("data-shell-layout")).toBe("compact");
    });

    it("隐藏面板与 Part：内容进停放区（不可交互、不进读屏），不卸载；再显示时搬回；换位置不重挂编辑器", async () => {
        const {wrapper, count, parked} = render();
        await settle();
        await wrapper.setProps({panel: {...PANEL, hidden: true}, hiddenParts: ["sidebar"]});
        await settle();
        expect(parked("panel")).toBe(true);
        expect(parked("sidebar")).toBe(true);
        const parking = wrapper.find("[data-shell-parking]");
        expect(parking.attributes("inert")).toBeDefined();
        expect(parking.attributes("aria-hidden")).toBe("true");

        await wrapper.setProps({panel: {...PANEL, position: "left"}, hiddenParts: []});
        await settle();
        expect(parked("panel")).toBe(false);
        expect(parked("sidebar")).toBe(false);
        expect(count.mounted).toEqual(Object.fromEntries(SHELL_PART_IDS.map((id) => [id, 1])));
        expect(count.unmounted).toEqual({});
    });

    it("呈现事实在测得容器后发出，同样的事实不重复发；面板槽在呈现为标题头时拿到 collapsed", async () => {
        const facts: ShellLayoutFacts[] = [];
        const collapsed: boolean[] = [];
        const wrapper = mount(WorkbenchShellLayout, {
            props: {sizes: SHELL_SIZE_DEFAULTS, panel: {...PANEL, collapsed: true}, contextKey: "c", onLayout: (next: ShellLayoutFacts) => facts.push(next)},
            slots: {panel: (props: {collapsed: boolean}) => {
                collapsed.push(props.collapsed);
                return h("div");
            }},
            attachTo: document.body,
        });
        unmount = () => wrapper.unmount();
        await settle();
        expect(facts).toHaveLength(1);
        expect(facts[0]).toMatchObject({mode: "compact", effectivePanel: {position: "bottom", alignment: "justify", collapsed: true, maximized: false}});
        await wrapper.setProps({sizes: {...SHELL_SIZE_DEFAULTS, sidebarWidth: 300}});
        await settle();
        expect(facts).toHaveLength(1);
        expect(collapsed.at(-1)).toBe(true);
    });
});
