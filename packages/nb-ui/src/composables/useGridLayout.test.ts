import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, effectScope, h, nextTick, ref, shallowRef, type Ref, type ShallowRef} from "vue";
import GridRenderer from "../components/layout/GridRenderer.vue";
import {createGrid, type Grid, type GridLayoutResult} from "../components/layout/grid";
import type {GridGestureCommit} from "../components/layout/grid-gesture";
import type {GridExtent} from "../components/layout/grid-types";
import {EMPTY_GRID_LAYOUT, useGridLayout, type GridLayoutCommitResult, type GridLayoutHost} from "./useGridLayout";

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

function twoColumns(): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}},
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
    readonly applied: GridGestureCommit[];
    readonly commits: GridGestureCommit[];
    readonly issues: string[];
    readonly host: GridLayoutHost<string>;
    /** 用当前发布几何拼一份「会话结束时给出的冻结事实」。 */
    frozen(): GridGestureCommit;
};

/** 与真实宿主同构：`useGridLayout` 提供几何，渲染层独占会话，宿主只接一次提交。 */
function mountHost(): Harness {
    const scope = effectScope();
    scopes.push(scope);
    const grid = ref<Grid<string> | null>(twoColumns());
    const extent = shallowRef<GridExtent | null>({...CONTAINER});
    const context = ref("workbench-a");
    const applied: GridGestureCommit[] = [];
    const commits: GridGestureCommit[] = [];
    const issues: string[] = [];

    const host = scope.run(() => useGridLayout<string>({
        grid,
        extent,
        contextKey: () => context.value,
        onApplied: (commit) => {
            applied.push(commit);
        },
        onIssues: (list) => {
            issues.push(...list);
        },
    }));
    if (host === undefined) {
        throw new Error("组合式函数没有在作用域内建立");
    }

    const HarnessComponent = defineComponent({
        name: "GridLayoutHostHarness",
        setup() {
            return () => h(GridRenderer, {
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
        expect(harness.applied[0]).toBe(harness.commits[0]);
        const after = harness.host.layout.value;
        expect(after.sizes.left!.width - before.sizes.left!.width).toBeCloseTo(40, 6);
        expect(after.sizes.right!.width - before.sizes.right!.width).toBeCloseTo(-40, 6);
        expect(harness.host.revision.value).toBeGreaterThan(revisionBefore);
        expect(harness.issues.filter((issue) => issue.includes("没有发布匹配布局"))).toEqual([]);
    });

    it("上下文已切换的提交整次拒绝，几何与版本不动", async () => {
        const harness = mountHost();
        await nextTick();
        const before = harness.host.layout.value;
        const revisionBefore = harness.host.revision.value;
        const frozen = harness.frozen();

        harness.context.value = "workbench-b";
        await nextTick();
        const settledLayout = harness.host.layout.value;
        const settledRevision = harness.host.revision.value;

        const outcome = harness.host.onGestureCommit({...frozen, contextKey: "workbench-a"});

        expect(outcome).toEqual({ok: false, reason: expect.stringContaining("工作面已切换")});
        expect(harness.host.layout.value).toBe(settledLayout);
        expect(harness.host.revision.value).toBe(settledRevision);
        expect(harness.host.layout.value.sizes.left!.width).toBeCloseTo(before.sizes.left!.width, 6);
        expect(harness.applied).toEqual([]);
    });

    it("版本或容器尺寸过期同样拒绝，不落账", async () => {
        const harness = mountHost();
        await nextTick();

        expect(harness.host.onGestureCommit({...harness.frozen(), revision: harness.host.revision.value - 1}))
            .toEqual({ok: false, reason: expect.stringContaining("布局已变化")});
        expect(harness.host.onGestureCommit({...harness.frozen(), extent: {width: 999, height: 600}}))
            .toEqual({ok: false, reason: expect.stringContaining("容器尺寸已变化")});
        expect(harness.applied).toEqual([]);
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
        expect(rejected).toEqual({ok: false, reason: expect.stringContaining("承载盒尺寸不可用")});

        harness.extent.value = {...CONTAINER};
        await nextTick();
        expect(harness.host.layout.value.sizes.left).toBeDefined();
        const revisionBefore = harness.host.revision.value;
        harness.grid.value = null;
        await nextTick();
        expect(harness.host.layout.value).toBe(EMPTY_GRID_LAYOUT);
        expect(harness.host.revision.value).toBeGreaterThan(revisionBefore);
        expect(harness.host.onGestureCommit(frozen)).toEqual({ok: false, reason: expect.stringContaining("网格尚未就绪")});
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
        expect(harness.wrapper.find('[data-splitter="right-split"]').exists()).toBe(true);
        expect(harness.wrapper.find('[data-leaf="extra"]').exists()).toBe(true);
    });
});
