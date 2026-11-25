import {afterEach, beforeEach, describe, expect, it, onTestFinished, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, shallowRef, watch, type MaybeRefOrGetter, type ShallowRef} from "vue";

import NestedGrid from "./NestedGrid.vue";
import {createGrid, type Grid} from "../grid";
import type {GridExtent, GridLayoutResult} from "../grid-types";
import type {GridSwap} from "../grid-swap";
import {useGridHost, type GridHost, type GridHostChange, type GridHostIssue} from "./useGridHost";

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

/** 左列可收起到 0；右列最宽 800：左列收起后它吸收不完，布局给 `unabsorbed-space`，用来看诊断走的是哪个出口。 */
function collapsibleColumns(): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
            {kind: "leaf", id: "right", ref: "right", size: {width: 500, height: 0}, maximumSize: {width: 800, height: 100_000}},
        ],
    }, {sashSize: SASH});
}

/** 左列保留像素 300，右列按比例分、吃掉余下的。 */
function fixedColumns(): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, sizing: "fixed"},
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
    /** `onApplied` 收到的落账，依次。 */
    readonly applied: GridHostChange[];
    /** 和 `applied` 一一对应：`onApplied` 的第二个参数。 */
    readonly befores: GridLayoutResult[];
    /** 和 `applied` 一一对应：`onApplied` 被调的那一刻宿主发布着的布局。 */
    readonly during: GridLayoutResult[];
    readonly issues: GridHostIssue[];
    /** 宿主作用域里一个同步侦听 `host.extent` 看到的值：真实宿主（工作台）就是这样把尺寸转给 store 的。 */
    readonly watched: Array<GridExtent | null>;
};

/** 宿主的选项里测试要换掉的几样；没给的同真实宿主最常见的写法（固定的网格与上下文键）。 */
type HostOverrides = {
    readonly grid?: MaybeRefOrGetter<Grid<string> | null>;
    readonly contextKey?: MaybeRefOrGetter<string>;
    readonly disabled?: MaybeRefOrGetter<boolean>;
    readonly onApplied?: () => void;
};

/** 和真实宿主同构：宿主组件里调 `useGridHost`，`NestedGrid` 整包绑上去；`shown` 控制 `NestedGrid` 的条件渲染，宿主自己不卸载。 */
function mountHost(grid: Grid<string> = twoColumns(), overrides: HostOverrides = {}): Harness {
    const shown = shallowRef(true);
    const swap = shallowRef<GridSwap | null>(null);
    const applied: GridHostChange[] = [];
    const befores: GridLayoutResult[] = [];
    const during: GridLayoutResult[] = [];
    const issues: GridHostIssue[] = [];
    const watched: Array<GridExtent | null> = [];
    let host: GridHost<string> | null = null;
    const Host = defineComponent({
        setup() {
            const current = useGridHost<string>({
                grid: overrides.grid ?? shallowRef(grid),
                contextKey: overrides.contextKey ?? "host-test",
                ...(overrides.disabled === undefined ? {} : {disabled: overrides.disabled}),
                onApplied: (change, before) => {
                    applied.push(change);
                    befores.push(before);
                    during.push(current.layout.value);
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
    return {wrapper, host, grid, shown, swap, applied, befores, during, issues, watched};
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
        expect(harness.applied[0]).toMatchObject({kind: "gesture", commit: {contextKey: "host-test"}, collapsed: {}});
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
        const presented = harness.grid.layout(box).sizes;
        const baseline = {left: presented.left!.width, right: presented.right!.width};
        expect(harness.grid.resizeBranches([{branchId: "root", axis: "width", baseline, target: {left: baseline.left + 50, right: baseline.right - 50}}]).ok).toBe(true);
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

    it("`onApplied` 每次抛出都发一条 `notify-failed`（输出 140）：不按只发新增去重", async () => {
        const harness = mountHost(twoColumns(), {onApplied: () => {
            throw new Error("宿主存盘失败");
        }});
        await nextTick();
        await dragSash(harness);
        await dragSash(harness);
        expect(harness.applied).toHaveLength(2);
        expect(harness.issues.filter((issue) => issue.code === "notify-failed")).toHaveLength(2);
    });

    it("预览布局自己的诊断不经通知，松手落账后的布局重算照常发（输出 140）", async () => {
        // 右边一列里一行两块保留像素的叶，合计正好是右列的宽：发布时没有诊断；拖窄右列，预览布局里这一行就装不下了。
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 598, height: 0}, sizing: "fixed"},
                {kind: "branch", id: "right", orientation: "vertical", size: {width: 401, height: 0}, children: [
                    {kind: "branch", id: "row", orientation: "horizontal", size: {width: 0, height: 300}, children: [
                        {kind: "leaf", id: "p", ref: "p", size: {width: 200, height: 0}, sizing: "fixed"},
                        {kind: "leaf", id: "q", ref: "q", size: {width: 200, height: 0}, sizing: "fixed"},
                    ]},
                    {kind: "leaf", id: "bottom", ref: "bottom", size: {width: 0, height: 299}},
                ]},
            ],
        }, {sashSize: SASH});
        const harness = mountHost(grid);
        await nextTick();
        expect(harness.issues).toEqual([]);
        const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
        sash.dispatchEvent(pointerEvent("pointermove", 540.5, 300));
        await settleFrame();
        const preview = harness.wrapper.findComponent(NestedGrid).emitted("gesture-update")?.at(-1)?.[0] as {layout: {issues: readonly {code: string; params?: Record<string, unknown>}[]}};
        const previewIssues = preview.layout.issues.filter((issue) => issue.params?.id === "row");
        expect(previewIssues.length).toBeGreaterThan(0);
        expect(harness.issues).toEqual([]);

        sash.dispatchEvent(pointerEvent("pointerup", 540.5, 300));
        await nextTick();
        expect(harness.applied).toHaveLength(1);
        expect(harness.issues.map((issue) => `${issue.code}/${String(issue.params?.cause)}/${String(issue.params?.id)}`)).toEqual(previewIssues.map((issue) => `${issue.code}/${String(issue.params?.cause)}/${String(issue.params?.id)}`));
    });

    it("经 useGridHost 接线时，拖动中承载盒的尺寸变了：进行中的手势取消（context-changed），不提交（输出 40）", async () => {
        class ResizeObserverProbe {
            static instances: ResizeObserverProbe[] = [];
            constructor(private readonly callback: ResizeObserverCallback) {
                ResizeObserverProbe.instances.push(this);
            }
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
            trigger(): void {
                this.callback([], this as unknown as ResizeObserver);
            }
        }
        // test-lint-allow module-mock: happy-dom 的 ResizeObserver 不会回调；替身在尺寸变了之后回调，同 NestedGrid.dom.test.ts 输出 144 那条
        vi.stubGlobal("ResizeObserver", ResizeObserverProbe);
        onTestFinished(() => void vi.unstubAllGlobals());
        const harness = mountHost();
        await nextTick();
        const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
        sash.dispatchEvent(pointerEvent("pointermove", 540.5, 300));
        await settleFrame();
        const grid = harness.wrapper.findComponent(NestedGrid);
        expect(grid.emitted("gesture-update")).toBeDefined();

        box = {width: 900, height: 600};
        for (const probe of ResizeObserverProbe.instances) probe.trigger();
        await nextTick();
        expect(harness.host.extent.value).toEqual({width: 900, height: 600});
        expect(grid.emitted("gesture-cancel")?.map((event) => (event[0] as {reason: string}).reason)).toEqual(["context-changed"]);
        sash.dispatchEvent(pointerEvent("pointerup", 540.5, 300));
        await nextTick();
        expect(grid.emitted("gesture-end")).toBeUndefined();
        expect(harness.applied).toEqual([]);
    });

    it("`host.setCollapsed`：标记变了才重发布局（版本递增、诊断经 `onIssues`）并通知一次 `onApplied`；没变时版本不变、不通知（输出 149、150、170）", async () => {
        const grid = collapsibleColumns();
        const harness = mountHost(grid);
        await nextTick();
        const revision = harness.host.revision.value;
        const published = harness.host.layout.value;

        const result = harness.host.setCollapsed("left", true);
        expect(result).toMatchObject({ok: true, changed: true, collapse: {collapsed: true}});
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.host.layout.value.sizes.left!.width).toBe(0);
        expect(harness.issues.map((issue) => issue.code)).toContain("unabsorbed-space");
        // 通知带这次的结果与翻了的标记；`before` 是调用之前发布的那份，`onApplied` 被调时宿主已经发布了之后的。
        expect(harness.applied).toEqual([{kind: "collapse", id: "left", result, collapsed: {left: true}}]);
        expect(harness.befores).toEqual([published]);
        expect(harness.befores[0]).toBe(published);
        expect(harness.during[0]).toBe(harness.host.layout.value);

        expect(harness.host.setCollapsed("left", true)).toMatchObject({ok: true, changed: false});
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.applied).toHaveLength(1);
    });

    it("`host.setCollapsed` 只改了锁：`changed` 为真、照样通知，`collapsed` 是空的（输出 168、170）", async () => {
        const harness = mountHost(collapsibleColumns());
        await nextTick();
        const revision = harness.host.revision.value;

        const result = harness.host.setCollapsed("left", false, {locked: true});
        expect(result).toMatchObject({ok: true, changed: true, collapse: {collapsed: false, locked: true}});
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.applied).toEqual([{kind: "collapse", id: "left", result, collapsed: {}}]);

        // 标记与锁一起变：`collapsed` 只列标记。
        harness.host.setCollapsed("left", true, {locked: false});
        expect(harness.applied.at(-1)).toMatchObject({kind: "collapse", id: "left", result: {collapse: {collapsed: true}}, collapsed: {left: true}});
        expect(harness.grid.find("left")?.collapse).not.toHaveProperty("locked");
    });

    it("`host.setSize`：意图变了才重发布局并通知 `onApplied`（`kind: \"size\"`、`collapsed` 为空），没变时版本不变、不通知（输出 171、170）", async () => {
        const harness = mountHost(fixedColumns());
        await nextTick();
        const revision = harness.host.revision.value;
        const published = harness.host.layout.value;
        expect(published.sizes.left!.width).toBe(300);

        const result = harness.host.setSize("left", 250);
        expect(result).toMatchObject({ok: true, changed: true, size: 250});
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.host.layout.value.sizes.left!.width).toBe(250);
        expect(harness.applied).toEqual([{kind: "size", id: "left", result, collapsed: {}}]);
        expect(harness.befores[0]).toBe(published);
        expect(harness.during[0]).toBe(harness.host.layout.value);

        expect(harness.host.setSize("left", 250)).toMatchObject({ok: true, changed: false, size: 250});
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.applied).toHaveLength(1);

        // 失败不改树、不通知：按比例分的节点没有像素意图可设。
        expect(harness.host.setSize("right", 100)).toMatchObject({ok: false, code: "wrong-sizing"});
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.applied).toHaveLength(1);
    });

    it("`host.setSize` 没有网格时 `not-ready`，版本不变（输出 171）", async () => {
        const harness = mountHost(fixedColumns(), {grid: () => null});
        await nextTick();
        const revision = harness.host.revision.value;
        expect(harness.host.setSize("left", 250)).toMatchObject({ok: false, code: "not-ready", params: {missing: "grid"}});
        expect(harness.host.revision.value).toBe(revision);
        expect(harness.applied).toEqual([]);
    });

    it("`host.setCollapsed` 之后 `onApplied` 抛出：落账照样算数，`onIssues` 收到 `notify-failed`，异常不冒到调用方（输出 170、140）", async () => {
        const harness = mountHost(collapsibleColumns(), {onApplied: () => {
            throw new Error("宿主存盘失败");
        }});
        await nextTick();
        expect(harness.host.setCollapsed("left", true)).toMatchObject({ok: true, changed: true});
        expect(harness.applied).toHaveLength(1);
        expect(harness.host.layout.value.sizes.left!.width).toBe(0);
        expect(harness.issues.filter((issue) => issue.code === "notify-failed")).toHaveLength(1);
    });

    it("宿主直接改 `grid.*` 再 `invalidate()`：布局重发，不通知 `onApplied`（输出 170）", async () => {
        const grid = collapsibleColumns();
        const harness = mountHost(grid);
        await nextTick();
        const revision = harness.host.revision.value;
        expect(harness.host.layout.value.sizes.left!.width).toBeGreaterThan(0);

        expect(grid.setCollapsed("left", true)).toMatchObject({ok: true, changed: true});
        harness.host.invalidate();
        // 先确认这次确实落进了宿主发布的布局，再断言没有通知。
        expect(harness.host.revision.value).toBe(revision + 1);
        expect(harness.host.layout.value.sizes.left!.width).toBe(0);
        expect(harness.applied).toEqual([]);
    });

    it("`host.setCollapsed` 没有网格时 `not-ready`，版本不变（输出 149）", async () => {
        const harness = mountHost(twoColumns(), {grid: () => null});
        await nextTick();
        const revision = harness.host.revision.value;
        expect(harness.host.setCollapsed("left", true)).toMatchObject({ok: false, code: "not-ready", params: {missing: "grid"}});
        expect(harness.host.revision.value).toBe(revision);
    });
});
