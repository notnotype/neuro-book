import {afterEach, beforeEach, describe, expect, it, onTestFinished, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, effectScope, h, nextTick, ref, shallowRef, type Ref, type ShallowRef} from "vue";
import NestedGrid from "./NestedGrid.vue";
import {createGrid, type Grid, type GridLayoutResult} from "../grid";
import type {GridGestureCommit} from "../grid-gesture";
import type {GridExtent, GridIssue, GridLayoutCommitResult} from "../grid-types";
import {EMPTY_GRID_LAYOUT, useGridLayout, type GridHostChange, type GridLayoutHost} from "./useGridLayout";

/**
 * 宿主装配的行为用例：真手势端到端接纳一次；冻结事实（上下文 / 版本 / 容器尺寸）一旦过期整次拒绝。
 *
 * happy-dom 没有布局引擎（矩形全为 0，命中判定会落空），所以按仓库既有做法桩掉 `clientWidth`/
 * `clientHeight` 与 `getBoundingClientRect`；命中、求解、提交仍走真实实现。真实浏览器几何由 Lab 验收。
 */

const CONTAINER: GridExtent = {width: 1000, height: 600};
const SASH = 1;
/** 根分隔条：x = 500.5、通高。 */
const SASH_RECT = {left: 500, top: 0, right: 501, bottom: CONTAINER.height};

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];
const scopes: Array<{stop(): void}> = [];

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

function domRect(rect: {left: number; top: number; right: number; bottom: number}): DOMRect {
    return {
        ...rect,
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        toJSON: () => ({}),
    } as DOMRect;
}

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return domRect(this.dataset.sash === "root:0" ? SASH_RECT : {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
    });
});

afterEach(() => {
    for (const scope of scopes.splice(0)) {
        scope.stop();
    }
    for (const wrapper of wrappers.splice(0)) {
        if (wrapper.exists()) wrapper.unmount();
    }
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

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
    return Object.assign(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0}), {
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
    });
}

async function settleFrame(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
    await nextTick();
}

type Harness = {
    readonly wrapper: VueWrapper;
    readonly grid: Ref<Grid<string> | null>;
    readonly extent: ShallowRef<GridExtent | null>;
    readonly context: Ref<string>;
    /** `onApplied` 每次收到的第一个参数：这次落账是哪一种。 */
    readonly applied: GridHostChange[];
    /** `onApplied` 每次收到的第二个参数：落账之前发布的布局。 */
    readonly befores: GridLayoutResult[];
    /** `onApplied` 被调的那一刻宿主发布着的布局。 */
    readonly duringApplied: GridLayoutResult[];
    readonly commits: GridGestureCommit[];
    readonly issues: GridIssue[];
    readonly host: GridLayoutHost<string>;
    /** 用当前发布几何拼一份「会话结束时给出的冻结事实」。 */
    frozen(): GridGestureCommit;
};

/** 与真实宿主同构：`useGridLayout` 提供几何，渲染层独占会话，宿主只接一次提交。 */
function mountHost(options: {grid?: Grid<string>; throwOnIssues?: () => boolean; throwOnApplied?: boolean} = {}): Harness {
    const scope = effectScope();
    scopes.push(scope);
    const grid = ref<Grid<string> | null>(options.grid ?? twoColumns());
    const extent = shallowRef<GridExtent | null>({...CONTAINER});
    const context = ref("workbench-a");
    const applied: GridHostChange[] = [];
    const befores: GridLayoutResult[] = [];
    const duringApplied: GridLayoutResult[] = [];
    const commits: GridGestureCommit[] = [];
    const issues: GridIssue[] = [];

    const host = scope.run(() => useGridLayout<string>({
        grid,
        extent,
        contextKey: () => context.value,
        onApplied: (change, before) => {
            applied.push(change);
            befores.push(before);
            duringApplied.push(host!.layout.value);
            if (options.throwOnApplied === true) {
                throw new Error("host onApplied threw");
            }
        },
        onIssues: (list) => {
            issues.push(...list);
            if (options.throwOnIssues?.() === true) {
                throw new Error("host onIssues threw");
            }
        },
    }));
    if (host === undefined) {
        throw new Error("组合式函数没有在作用域内建立");
    }

    const HarnessComponent = defineComponent({
        name: "GridLayoutHostHarness",
        setup() {
            return () => h(NestedGrid, {
                node: host.node.value,
                layout: host.layout.value,
                contextKey: context.value,
                revision: host.revision.value,
                onGestureCommit: (commit: GridGestureCommit) => {
                    commits.push(commit);
                    return host.onGestureCommit(commit);
                },
            }, {
                leaf: (leafScope: {node: {id: string}}) => h("div", {class: "leaf-body"}, leafScope.node.id),
                empty: () => h("div", {class: "empty-body"}, "empty"),
            });
        },
    });

    const wrapper = mount(HarnessComponent, {attachTo: attachContainer()});
    wrappers.push(wrapper);
    return {
        wrapper,
        grid,
        extent,
        context,
        applied,
        befores,
        duringApplied,
        commits,
        issues,
        host,
        frozen: () => {
            const published = host.layout.value;
            const left = published.sizes.left!.width;
            const right = published.sizes.right!.width;
            return {
                sessionId: "session",
                contextKey: context.value,
                source: "pointer",
                revision: host.revision.value,
                extent: {...CONTAINER},
                changes: [{
                    branchId: "root",
                    axis: "width",
                    baseline: {left, right},
                    target: {left: left + 10, right: right - 10},
                    extent: {...CONTAINER},
                    active: ["left", "right"],
                    compensated: [],
                    collapsed: {},
                }],
            };
        },
    };
}

describe("useGridLayout 与渲染层的真实提交", () => {
    it("指针拖动一次：整批落账、发布新几何、只通知一次", async () => {
        const harness = mountHost();
        await nextTick();

        const before = harness.host.layout.value;
        expect(before.sizes.left!.width).toBeCloseTo(374.625, 6);
        const revisionBefore = harness.host.revision.value;

        const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
        sash.dispatchEvent(pointerEvent("pointermove", 540.5, 300));
        await settleFrame();
        sash.dispatchEvent(pointerEvent("pointerup", 540.5, 300));
        await nextTick();
        await nextTick();

        expect(harness.commits).toHaveLength(1);
        expect(harness.applied).toHaveLength(1);
        // 手势落账：带这次的提交、`resizeBranches` 的结果，`collapsed` 就是结果里的那份（这次没翻任何标记）。
        const applied = harness.applied[0]!;
        expect(applied).toEqual({kind: "gesture", commit: harness.commits[0], result: expect.objectContaining({ok: true}), collapsed: {}});
        expect(applied.kind === "gesture" && applied.commit).toBe(harness.commits[0]);
        expect(applied.kind === "gesture" && applied.collapsed === applied.result.collapsed).toBe(true);
        const after = harness.host.layout.value;
        expect(after.sizes.left!.width - before.sizes.left!.width).toBeCloseTo(40, 6);
        expect(after.sizes.right!.width - before.sizes.right!.width).toBeCloseTo(-40, 6);
        expect(harness.host.revision.value).toBeGreaterThan(revisionBefore);
    });

    it("`onApplied` 的 `before` 是提交之前发布的布局，不是之后的（Spec 输出 150）", async () => {
        const harness = mountHost();
        await nextTick();
        const published = harness.host.layout.value;
        expect(harness.host.onGestureCommit(harness.frozen())).toEqual({ok: true});
        expect(harness.befores).toHaveLength(1);
        expect(harness.befores[0]).toBe(published);
        expect(harness.host.layout.value).not.toBe(published);
        expect(harness.host.layout.value.sizes.left!.width - harness.befores[0]!.sizes.left!.width).toBeCloseTo(10, 6);
        // `onApplied` 被调时宿主已经发布了提交之后的布局。
        expect(harness.duringApplied[0]).toBe(harness.host.layout.value);
    });

    it("上下文已切换的提交整次拒绝，几何与版本不动", async () => {
        const harness = mountHost();
        await nextTick();
        const before = harness.host.layout.value;
        const frozen = harness.frozen();

        harness.context.value = "workbench-b";
        await nextTick();
        const settledLayout = harness.host.layout.value;
        const settledRevision = harness.host.revision.value;

        const outcome = harness.host.onGestureCommit({...frozen, contextKey: "workbench-a"});

        expect(outcome).toMatchObject({ok: false, code: "stale-context", params: {expected: "workbench-b", actual: "workbench-a"}});
        expect(harness.host.layout.value).toBe(settledLayout);
        expect(harness.host.revision.value).toBe(settledRevision);
        expect(harness.host.layout.value.sizes.left!.width).toBeCloseTo(before.sizes.left!.width, 6);
        expect(harness.applied).toEqual([]);
    });

    it("版本或容器尺寸过期同样拒绝，不落账", async () => {
        const harness = mountHost();
        await nextTick();

        const current = harness.host.revision.value;
        expect(harness.host.onGestureCommit({...harness.frozen(), revision: current - 1}))
            .toMatchObject({ok: false, code: "stale-revision", params: {expected: current, actual: current - 1}});
        const stale = harness.host.onGestureCommit({...harness.frozen(), extent: {width: 999, height: 600}});
        expect(stale.ok === false ? [stale.code, stale.params] : null).toEqual(["stale-size", undefined]);
        // 冻结的事实都对上、落账时结构操作拒绝：原样转交它的码。
        const frozen = harness.frozen();
        const change = frozen.changes[0]!;
        expect(harness.host.onGestureCommit({...frozen, changes: [{...change, baseline: {left: 1, right: change.baseline.right! + change.baseline.left! - 1}}]}))
            .toMatchObject({ok: false, code: "stale-baseline", params: {id: "root"}});
        expect(harness.applied).toEqual([]);
    });

    it("窄窗口逐像素重算：持续的诊断只通知一次；消失再出现再通知；隐藏再显示不重发；换上下文再通知；换 grid 实例不再通知（Spec 输出 140）", async () => {
        const make = (): Grid<string> => createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, minimumSize: {width: 600, height: 0}},
                {kind: "leaf", id: "right", ref: "right", size: {width: 500, height: 0}, minimumSize: {width: 300, height: 0}},
            ],
        }, {sashSize: SASH});
        const harness = mountHost({grid: make()});
        await nextTick();
        expect(harness.issues).toEqual([]);
        const resize = async (extent: GridExtent | null): Promise<void> => {
            harness.extent.value = extent;
            await nextTick();
        };

        await resize({width: 800, height: 600});
        const first = harness.issues.length;
        // 先确认真的发了：最小值合计超出与两片叶各自的 leaf-min。
        expect(harness.issues.map((issue) => [issue.params?.cause, issue.params?.id])).toEqual([["min-total", "root"], ["leaf-min", "left"], ["leaf-min", "right"]]);
        for (const width of [799, 798, 790, 750]) await resize({width, height: 600});
        expect(harness.issues).toHaveLength(first);
        expect(harness.host.layout.value.issues).toHaveLength(first);

        await resize({...CONTAINER});
        expect(harness.issues).toHaveLength(first);
        await resize({width: 800, height: 600});
        expect(harness.issues).toHaveLength(first * 2);

        await resize(null);
        await resize({width: 800, height: 600});
        expect(harness.issues).toHaveLength(first * 2);

        harness.context.value = "workbench-b";
        await nextTick();
        expect(harness.issues).toHaveLength(first * 3);

        harness.grid.value = make();
        await nextTick();
        expect(harness.issues).toHaveLength(first * 3);
    });

    it("提交落账之后通知宿主时它抛出：提交仍算落账、新布局已发布，异常不冒到手势那边（Spec 输出 140）", async () => {
        // 左叶的最小高度大于容器：每次重算都有一条 leaf-min，落账后的那次重算也会通知。
        let throwing = false;
        const harness = mountHost({grid: twoColumns({leftMinHeight: 700}), throwOnIssues: () => throwing});
        await nextTick();
        expect(harness.issues.some((issue) => issue.code === "over-constrained")).toBe(true);
        const before = harness.host.layout.value;
        const revisionBefore = harness.host.revision.value;

        // 只发新增：持续的 leaf-min 不会再通知。换上下文（`watch` 还没跑）再提交，落账后的那次重算按新上下文清空键集，交出这条。
        harness.context.value = "workbench-b";
        throwing = true;
        const issuesBefore = harness.issues.length;
        expect(harness.host.onGestureCommit(harness.frozen())).toEqual({ok: true});
        expect(harness.issues.length).toBeGreaterThan(issuesBefore);
        expect(harness.host.layout.value).not.toBe(before);
        expect(harness.host.revision.value).toBeGreaterThan(revisionBefore);
        expect(harness.applied).toHaveLength(1);
    });

    it("onApplied 抛出、通知 notify-failed 时宿主的 onIssues 也抛出：提交仍算落账", async () => {
        let throwing = false;
        const harness = mountHost({throwOnIssues: () => throwing, throwOnApplied: true});
        await nextTick();
        throwing = true;
        expect(harness.host.onGestureCommit(harness.frozen())).toEqual({ok: true});
        expect(harness.issues.map((issue) => issue.code)).toEqual(["notify-failed"]);
    });

    it("落账之后的通知抛出时，库接住的异常交 reportError；没有 reportError 时交 console.error（Spec 输出 140）", async () => {
        const reported: unknown[] = [];
        // test-lint-allow module-mock: 浏览器标准的全局错误报告入口，happy-dom 没有；只在这一条里装上看它收到什么
        vi.stubGlobal("reportError", (error: unknown) => void reported.push(error));
        onTestFinished(() => void vi.unstubAllGlobals());
        let throwing = false;
        const harness = mountHost({throwOnIssues: () => throwing, throwOnApplied: true});
        await nextTick();
        throwing = true;
        expect(harness.host.onGestureCommit(harness.frozen())).toEqual({ok: true});
        expect(reported.map((error) => String(error))).toEqual(["Error: host onIssues threw"]);
        vi.unstubAllGlobals();

        expect(typeof (globalThis as {reportError?: unknown}).reportError).not.toBe("function");
        // test-lint-allow spy: 断言库把接住的异常交给 console.error，同时收走输出
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(harness.host.onGestureCommit(harness.frozen())).toEqual({ok: true});
        expect(logged.mock.calls.map((call) => String(call[0]))).toEqual(["Error: host onIssues threw"]);
    });

    it("缺网格或缺承载盒时发布空布局并拒绝提交", async () => {
        const harness = mountHost();
        await nextTick();
        expect(harness.host.layout.value.sizes.left).toBeDefined();
        const frozen = harness.frozen();

        harness.extent.value = null;
        await nextTick();
        expect(harness.host.layout.value).toBe(EMPTY_GRID_LAYOUT);
        const rejected: GridLayoutCommitResult = harness.host.onGestureCommit(frozen);
        expect(rejected).toMatchObject({ok: false, code: "not-ready", params: {missing: "host-size"}});

        harness.extent.value = {...CONTAINER};
        await nextTick();
        expect(harness.host.layout.value.sizes.left).toBeDefined();
        const revisionBefore = harness.host.revision.value;
        harness.grid.value = null;
        await nextTick();
        expect(harness.host.layout.value).toBe(EMPTY_GRID_LAYOUT);
        expect(harness.host.revision.value).toBeGreaterThan(revisionBefore);
        expect(harness.host.onGestureCommit(frozen)).toMatchObject({ok: false, code: "not-ready", params: {missing: "grid"}});
    });

    it("结构变更后 invalidate 才重新读取同一实例的树", async () => {
        const harness = mountHost();
        await nextTick();
        const revisionBefore = harness.host.revision.value;
        const grid = harness.grid.value!;

        expect(grid.splitLeaf("right", {
            branchId: "right-split",
            orientation: "vertical",
            side: "after",
            ratio: 0.5,
            leaf: {kind: "leaf", id: "extra", ref: "extra"},
        })).toEqual({ok: true});

        // 同一 Grid 实例原地改树：引用不变，只有 invalidate 能让宿主看到新结构。
        expect(harness.host.revision.value).toBe(revisionBefore);
        harness.host.invalidate();
        await nextTick();
        expect(harness.host.revision.value).toBeGreaterThan(revisionBefore);
        expect(harness.wrapper.find('[data-sash="right-split:0"]').exists()).toBe(true);
        expect(harness.wrapper.find('[data-leaf="extra"]').exists()).toBe(true);
    });
});
