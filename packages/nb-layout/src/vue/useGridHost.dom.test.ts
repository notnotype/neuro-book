import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, shallowRef, watch, type MaybeRefOrGetter, type ShallowRef} from "vue";

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
    /** 宿主作用域里一个同步侦听 `host.extent` 看到的值：真实宿主（工作台）就是这样把尺寸转给 store 的。 */
    readonly watched: Array<GridExtent | null>;
};

/** 宿主的选项里测试要换掉的几样；没给的同真实宿主最常见的写法（固定的网格与上下文键）。 */
type HostOverrides = {
    readonly grid?: MaybeRefOrGetter<Grid<string>>;
    readonly contextKey?: MaybeRefOrGetter<string>;
    readonly disabled?: MaybeRefOrGetter<boolean>;
    readonly onApplied?: () => void;
};

/** 和真实宿主同构：宿主组件里调 `useGridHost`，`NestedGrid` 整包绑上去；`shown` 控制 `NestedGrid` 的条件渲染，宿主自己不卸载。 */
function mountHost(grid: Grid<string> = twoColumns(), overrides: HostOverrides = {}): Harness {
    const shown = shallowRef(true);
    const swap = shallowRef<GridSwap | null>(null);
    const applied: GridGestureCommit[] = [];
    const issues: GridHostIssue[] = [];
    const watched: Array<GridExtent | null> = [];
    let host: GridHost<string> | null = null;
    const Host = defineComponent({
        setup() {
            const current = useGridHost<string>({
                grid: overrides.grid ?? shallowRef(grid),
                contextKey: overrides.contextKey ?? "host-test",
                ...(overrides.disabled === undefined ? {} : {disabled: overrides.disabled}),
                onApplied: (commit) => {
                    applied.push(commit);
                    overrides.onApplied?.();
                },
                onIssues: (list) => void issues.push(...list),
            });
            host = current;
            watch(current.extent, (extent) => void watched.push(extent), {flush: "sync"});
            return () => h("div", {style: "height: 100%"}, shown.value ? [h(NestedGrid, {...current.bindings.value, swap: swap.value}, {leaf: (scope: {node: {id: string}}) => h("div", {class: "leaf-body"}, scope.node.id)})] : []);
        },
    });
    const wrapper = mount(Host, {attachTo: document.body});
    wrappers.push(wrapper);
    if (host === null) throw new Error("宿主没有建立");
    return {wrapper, host, grid, shown, swap, applied, issues, watched};
}

/** 在左右两列之间的分隔条上往右拖 40px 并松手，等提交落账。 */
async function dragSash(harness: Harness): Promise<void> {
    const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
    sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
    sash.dispatchEvent(pointerEvent("pointermove", 540.5, 300));
    await settleFrame();
    sash.dispatchEvent(pointerEvent("pointerup", 540.5, 300));
    await nextTick();
    await nextTick();
}

describe("useGridHost", () => {
    it("尺寸来自 NestedGrid 量的根盒：挂载后有尺寸、布局与启用；整包绑上去一次拖动就落账（输出 144、145）", async () => {
        const harness = mountHost();
        await nextTick();
        expect(harness.host.extent.value).toEqual({width: 1000, height: 600});
        expect(harness.host.bindings.value.disabled).toBe(false);
        const before = harness.host.layout.value.sizes.left!.width;

        await dragSash(harness);

        expect(harness.applied).toHaveLength(1);
        expect(harness.applied[0]!.contextKey).toBe("host-test");
        expect(harness.host.layout.value.sizes.left!.width - before).toBeCloseTo(40, 6);
    });

    it("NestedGrid 被条件渲染摘掉：宿主的尺寸回到 null，布局为空、停用；再挂回来又有尺寸；宿主整个卸载时尺寸不变（输出 144）", async () => {
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

        // 宿主自己整个卸载：宿主作用域里的侦听先停，`NestedGrid` 卸载前发的 null 到不了它（模板上的监听照样收到）。
        const seenBefore = harness.watched.length;
        harness.wrapper.unmount();
        expect(harness.watched).toHaveLength(seenBefore);
        expect(harness.watched.at(-1)).toEqual({width: 1000, height: 600});
    });

    it.each([
        ["高为 0", {width: 1000, height: 0}],
        ["宽为 0", {width: 0, height: 600}],
    ])("量到%s：布局为空、手势停用，叶照常挂着（输出 145、146）", async (_label, zero) => {
        box = zero;
        const harness = mountHost();
        await nextTick();
        expect(harness.host.extent.value).toEqual(zero);
        expect(harness.host.layout.value.sizes).toEqual({});
        expect(harness.host.bindings.value.disabled).toBe(true);
        expect(harness.wrapper.findAll(".leaf-body").map((leaf) => leaf.text())).toEqual(["left", "right"]);
        // 分隔条还画着，但停用：手势起不来，键盘也不停在它上面。
        const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        expect(sash.getAttribute("aria-disabled")).toBe("true");
        expect(sash.getAttribute("tabindex")).toBe("-1");
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

    it("选项收 getter：`disabled` 跟着变；`contextKey` 换了，旧上下文的提交按 `stale-context` 拒绝（输出 145）", async () => {
        const off = shallowRef(false);
        const key = shallowRef("first");
        const harness = mountHost(twoColumns(), {disabled: () => off.value, contextKey: () => key.value});
        await nextTick();
        expect(harness.host.bindings.value.disabled).toBe(false);
        off.value = true;
        expect(harness.host.bindings.value.disabled).toBe(true);
        off.value = false;

        const stale = {sessionId: "old", contextKey: "first", source: "pointer", revision: harness.host.revision.value, extent: {width: 1000, height: 600}, changes: []} as const;
        key.value = "second";
        await nextTick();
        expect(harness.host.bindings.value.contextKey).toBe("second");
        expect(harness.host.bindings.value.onGestureCommit(stale)).toMatchObject({ok: false, code: "stale-context"});
    });

    it("`grid` 换了实例：布局按新网格重算（输出 145）", async () => {
        const grid = shallowRef(twoColumns());
        const harness = mountHost(grid.value, {grid});
        await nextTick();
        const before = harness.host.layout.value.sizes.left!.width;
        grid.value = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 100, height: 0}},
                {kind: "leaf", id: "right", ref: "right", size: {width: 700, height: 0}},
            ],
        }, {sashSize: SASH});
        await nextTick();
        expect(harness.host.layout.value.sizes.left!.width).toBeLessThan(before);
    });

    it("`onApplied` 抛出：提交照样落账，`onIssues` 收到 `notify-failed`（输出 145）", async () => {
        const harness = mountHost(twoColumns(), {onApplied: () => {
            throw new Error("宿主存盘失败");
        }});
        await nextTick();
        const before = harness.host.layout.value.sizes.left!.width;
        await dragSash(harness);
        expect(harness.applied).toHaveLength(1);
        expect(harness.host.layout.value.sizes.left!.width - before).toBeCloseTo(40, 6);
        expect(harness.issues.map((issue) => issue.code)).toContain("notify-failed");
    });
});
