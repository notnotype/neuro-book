import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, shallowRef, type ShallowRef} from "vue";

import NestedGrid from "./NestedGrid.vue";
import {createGrid, type Grid} from "../grid";
import type {GridGestureCommit} from "../grid-gesture";
import type {GridExtent} from "../grid-types";
import type {GridSwap} from "../grid-swap";
import {useGridHost, type GridHost, type GridHostIssue} from "./useGridHost";

/**
 * 宿主接线（Spec `ui/nested-grid` 输出 144 到 146）：宿主只写 `useGridHost` 与 `v-bind="host.bindings.value"`，尺寸来自
 * `NestedGrid` 量的根盒，提交、诊断都经这一包。提交的校验与只发新增的细节由 `useGridLayout.dom.test.ts` 管，这里只验接线。
 *
 * happy-dom 没有布局引擎，按仓库既有做法桩掉 `clientWidth`、`clientHeight` 与 `getBoundingClientRect`；量取、求解、提交走真实实现。
 */

const SASH = 1;
let box: GridExtent = {width: 1000, height: 600};

const wrappers: VueWrapper[] = [];

function twoColumns(options: {leftMinHeight?: number} = {}): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, ...(options.leftMinHeight === undefined ? {} : {minimumSize: {width: 0, height: options.leftMinHeight}})},
            {kind: "leaf", id: "right", ref: "right", size: {width: 500, height: 0}},
        ],
    }, {sashSize: SASH});
}

function pointerEvent(type: string, x: number, y: number): MouseEvent {
    return Object.assign(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0}), {isPrimary: true, pointerId: 1, pointerType: "mouse"});
}

async function settleFrame(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
    await nextTick();
}

beforeEach(() => {
    box = {width: 1000, height: 600};
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => box.width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => box.height);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const sash = this.dataset.sash === "root:0";
        const rect = sash ? {left: 500, top: 0, right: 501, bottom: box.height} : {left: 0, top: 0, right: box.width, bottom: box.height};
        return {...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => ({})} as DOMRect;
    });
});

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

type Harness = {
    readonly wrapper: VueWrapper;
    readonly host: GridHost<string>;
    readonly grid: Grid<string>;
    readonly shown: ShallowRef<boolean>;
    readonly swap: ShallowRef<GridSwap | null>;
    readonly applied: GridGestureCommit[];
    readonly issues: GridHostIssue[];
};

/** 和真实宿主同构：宿主组件里调 `useGridHost`，`NestedGrid` 整包绑上去；`shown` 控制 `NestedGrid` 的条件渲染，宿主自己不卸载。 */
function mountHost(grid: Grid<string> = twoColumns()): Harness {
    const shown = shallowRef(true);
    const swap = shallowRef<GridSwap | null>(null);
    const applied: GridGestureCommit[] = [];
    const issues: GridHostIssue[] = [];
    let host: GridHost<string> | null = null;
    const Host = defineComponent({
        setup() {
            const current = useGridHost<string>({
                grid: shallowRef(grid),
                contextKey: "host-test",
                onApplied: (commit) => void applied.push(commit),
                onIssues: (list) => void issues.push(...list),
            });
            host = current;
            return () => h("div", {style: "height: 100%"}, shown.value ? [h(NestedGrid, {...current.bindings.value, swap: swap.value}, {leaf: (scope: {node: {id: string}}) => h("div", {class: "leaf-body"}, scope.node.id)})] : []);
        },
    });
    const wrapper = mount(Host, {attachTo: document.body});
    wrappers.push(wrapper);
    if (host === null) throw new Error("宿主没有建立");
    return {wrapper, host, grid, shown, swap, applied, issues};
}

describe("useGridHost", () => {
    it("尺寸来自 NestedGrid 量的根盒：挂载后有尺寸、布局与启用；整包绑上去一次拖动就落账（输出 144、145）", async () => {
        const harness = mountHost();
        await nextTick();
        expect(harness.host.extent.value).toEqual({width: 1000, height: 600});
        expect(harness.host.bindings.value.disabled).toBe(false);
        const before = harness.host.layout.value.sizes.left!.width;

        const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
        sash.dispatchEvent(pointerEvent("pointermove", 540.5, 300));
        await settleFrame();
        sash.dispatchEvent(pointerEvent("pointerup", 540.5, 300));
        await nextTick();
        await nextTick();

        expect(harness.applied).toHaveLength(1);
        expect(harness.applied[0]!.contextKey).toBe("host-test");
        expect(harness.host.layout.value.sizes.left!.width - before).toBeCloseTo(40, 6);
    });

    it("NestedGrid 被条件渲染摘掉：宿主的尺寸回到 null，布局为空、停用；再挂回来又有尺寸（输出 144）", async () => {
        const harness = mountHost();
        await nextTick();
        expect(harness.host.extent.value).not.toBeNull();

        harness.shown.value = false;
        await nextTick();
        expect(harness.host.extent.value).toBeNull();
        expect(harness.host.layout.value.sizes).toEqual({});
        expect(harness.host.bindings.value.disabled).toBe(true);

        harness.shown.value = true;
        await nextTick();
        await nextTick();
        expect(harness.host.extent.value).toEqual({width: 1000, height: 600});
        expect(harness.host.bindings.value.disabled).toBe(false);
    });

    it("量到高为 0：布局为空、停用（输出 145、146）", async () => {
        box = {width: 1000, height: 0};
        const harness = mountHost();
        await nextTick();
        expect(harness.host.extent.value).toEqual({width: 1000, height: 0});
        expect(harness.host.layout.value.sizes).toEqual({});
        expect(harness.host.bindings.value.disabled).toBe(true);
    });

    it("诊断一个出口：布局重算的诊断与 NestedGrid 的 issues 事件都到 onIssues（输出 145）", async () => {
        const harness = mountHost(twoColumns({leftMinHeight: 700}));
        await nextTick();
        // 重算这一路：左列的最小高度超过承载盒。
        expect(harness.issues.map((issue) => issue.code)).toContain("over-constrained");

        // 组件这一路：给一个对不上呈现的交换，同时让布局变化；交换不成立只由 NestedGrid 的 `issues` 事件交出来。
        harness.swap.value = {token: 1, leaving: ["hidden"], entering: ["left"], axis: "width", direction: 1, gap: 0};
        harness.grid.resize("left", "width", 50);
        harness.host.invalidate();
        await nextTick();
        expect(harness.issues.map((issue) => issue.code)).toContain("swap-skipped");
    });
});
