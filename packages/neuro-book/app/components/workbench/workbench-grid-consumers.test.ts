// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, nextTick, ref} from "vue";
import {createGrid, GridRenderer, type GridBranchChange, type GridExtent, type GridGestureCommit, type GridLayoutResult, type GridNode} from "@notnotype/nb-ui/layout";
import WorkbenchSpike from "nbook/app/components/workbench-spike/WorkbenchSpike.vue";

/**
 * GridRenderer 的两个真实消费者的接线：Spike（实体的分区验证台）与通用原语本身。
 *
 * 外壳（`WorkbenchShell`）的会话接线、槽位生命周期与手势提交在 `WorkbenchShell.test.ts` 与
 * `WorkbenchShellLayout.test.ts` 里验证；这里不重复。
 *
 * 落账口径：受控 Splitter 不再自己开始手势（只剩注册 sash 到外层 scope），一次手势只有一条路——
 * 渲染层 `onGestureCommit` 的同步 ack 收 `GridGestureCommit`（px 批量），逐分支百分比事件已退役。
 */
const SplitterStub = defineComponent({
    name: "Splitter",
    props: ["branchId", "direction", "panels", "sashSizes", "sizesPx", "disabled"],
    template: "<div><slot v-for='panel in panels' :name='`panel-${panel.id}`'/></div>",
});

const wrappers: VueWrapper[] = [];

function sizeOf(layout: GridLayoutResult, id: string): GridExtent {
    const size = layout.sizes[id];
    if (!size) throw new Error(`测试布局缺少节点：${id}`);
    return size;
}

/** 根 GridRenderer：Spike 的递归层现在是私有子组件，公开的只有最外层这一个 scope。 */
function rootRenderer(wrapper: VueWrapper) {
    const renderer = wrapper.findComponent(GridRenderer);
    if (!renderer.exists()) throw new Error("需要 GridRenderer");
    return renderer;
}

/** 树里的某个分支（诊断与断言用）。 */
function branchOf(tree: GridNode<unknown> | null, branchId: string): Extract<GridNode<unknown>, {kind: "branch"}> | null {
    if (tree === null) {
        return null;
    }
    if (tree.kind === "branch" && tree.id === branchId) {
        return tree;
    }
    if (tree.kind !== "branch") {
        return null;
    }
    for (const child of tree.children) {
        const hit = branchOf(child, branchId);
        if (hit !== null) {
            return hit;
        }
    }
    return null;
}

/** 一场手势的 px 提交：`baseline` 取当前呈现，`target` 显式给出。 */
function gestureCommit(
    branchId: string,
    children: readonly GridNode<unknown>[],
    layout: GridLayoutResult,
    axis: "width" | "height",
    target: Record<string, number>,
    active: readonly string[],
    extent: GridExtent,
    overrides: {contextKey?: string; revision?: number; sessionId?: string} = {},
): GridGestureCommit {
    const baseline: Record<string, number> = {};
    for (const child of children) {
        baseline[child.id] = layout.sizes[child.id]?.[axis] ?? 0;
    }
    const change: GridBranchChange = {branchId, axis, baseline, target, extent, active, compensated: [], collapsed: {}};
    return {
        sessionId: overrides.sessionId ?? "session-1",
        contextKey: overrides.contextKey ?? "",
        source: "pointer",
        revision: overrides.revision ?? 0,
        extent,
        changes: [change],
    };
}

beforeEach(() => {
    vi.stubGlobal("useWindowSize", () => ({width: ref(1000)}));
    vi.stubGlobal("useI18n", () => ({
        t: (key: string, params?: {diagnosis?: string}) => (params?.diagnosis ? `${key}:${params.diagnosis}` : key),
    }));
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});

afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("工作台真实组件的 grid 消费", () => {
    it.each([
        {orientation: "horizontal", sashSize: 0},
        {orientation: "horizontal", sashSize: 1},
        {orientation: "vertical", sashSize: 0},
        {orientation: "vertical", sashSize: 1},
    ] as const)("$orientation 两叶 max100 在 500px 容器保留留白，sash=$sashSize", async ({orientation, sashSize}) => {
        const horizontal = orientation === "horizontal";
        const container = horizontal ? {width: 500, height: 300} : {width: 300, height: 500};
        const maximumSize = horizontal ? {width: 100, height: 150} : {width: 150, height: 100};
        const grid = createGrid({kind: "branch", id: "root", orientation, children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 100, height: 100}, maximumSize},
            {kind: "leaf", id: "b", ref: "b", size: {width: 100, height: 100}, maximumSize},
        ]}, {sashSize});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const layout = grid.layout(container);
        // 两叶都触顶：各自 100px，剩下的空间留白（不填满超过 max）。
        expect(layout.sizes.root).toEqual(horizontal ? {width: 200 + sashSize, height: 150} : {width: 150, height: 200 + sashSize});
        expect(layout.issues.join()).toContain("未被任何子节点吸收");
        const wrapper = mount(GridRenderer, {
            props: {node: root, layout},
            global: {stubs: {Splitter: SplitterStub}},
        });
        wrappers.push(wrapper);
        const splitter = wrapper.findComponent(SplitterStub);
        // 面板配置与受控尺寸都是 CSS px：sashes 仍是每条边界的 px 占用（0 = 不可交互接缝）。
        expect(splitter.props("sashSizes")).toEqual([sashSize]);
        expect(splitter.props("sizesPx")).toEqual([100, 100]);
        expect(splitter.props("panels")).toMatchObject([
            {id: "a", defaultSizePx: 100, maxSizePx: 100, sizing: "weight"},
            {id: "b", defaultSizePx: 100, maxSizePx: 100, sizing: "weight"},
        ]);
        // 容器变窄后重新消费原语尺寸，不能把首次触顶的 100px 固化为渲染尺寸。
        const narrowed = grid.layout(horizontal ? {width: 150, height: 300} : {width: 300, height: 150});
        await wrapper.setProps({layout: narrowed});
        const narrow = horizontal
            ? [sizeOf(narrowed, "a").width, sizeOf(narrowed, "b").width]
            : [sizeOf(narrowed, "a").height, sizeOf(narrowed, "b").height];
        expect(splitter.props("sizesPx")).toEqual(narrow);
        expect(narrow[0]! + narrow[1]!).toBeCloseTo(horizontal ? 150 - sashSize : 150 - sashSize);
    });

    it("Spike 的可见树带当前约束，一次 px 批量提交只落账一次、整批不合法整批不改", async () => {
        const wrapper = mount(WorkbenchSpike, {global: {stubs: {Splitter: SplitterStub, WorkbenchSurface: true, DiagnosticsRail: true}}});
        wrappers.push(wrapper);
        await nextTick();
        const renderer = rootRenderer(wrapper);
        const root = renderer.props("node") as GridNode<unknown>;
        const main = branchOf(root, "main");
        if (main === null) throw new Error("需要主分支");
        const sidebarLeft = main.children.find((child) => child.id === "sidebar-left");
        expect(sidebarLeft?.kind === "leaf" ? sidebarLeft.minimumSize.width : null).toBe(180);
        const accept = renderer.props("onGestureCommit") as (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
        expect(typeof accept).toBe("function");
        const before = renderer.props("layout") as GridLayoutResult;
        const extent = {width: 1000, height: 900};
        const targetCenter = sizeOf(before, "center").width - 20;
        const targetRight = sizeOf(before, "sidebar-right").width + 20;
        const target = {
            activity: sizeOf(before, "activity").width,
            "sidebar-left": sizeOf(before, "sidebar-left").width,
            center: targetCenter,
            "sidebar-right": targetRight,
        };
        const commit = gestureCommit("main", main.children, before, "width", target, ["center", "sidebar-right"], extent);

        expect(accept(commit)).toEqual({ok: true});
        await nextTick();
        const after = renderer.props("layout") as GridLayoutResult;
        expect(sizeOf(after, "sidebar-right").width).toBeCloseTo(targetRight);
        expect(sizeOf(after, "center").width).toBeCloseTo(targetCenter);
        expect(branchOf(renderer.props("node") as GridNode<unknown>, "main")?.children.map((child) => child.id)).toContain("sidebar-left");

        // 整批不改：同一批里第二项不守恒时，第一项的尺寸也不落账。
        const held = renderer.props("layout") as GridLayoutResult;
        const moving = {
            ...target,
            "sidebar-left": sizeOf(held, "sidebar-left").width + 22,
            center: sizeOf(held, "center").width - 22,
        };
        const rejected = accept({
            ...commit,
            sessionId: "session-2",
            changes: [
                {...commit.changes[0]!, baseline: {...target}, target: moving},
                {...commit.changes[0]!, baseline: {...target}, target: {...target, center: targetCenter - 10}},
            ],
        });
        expect(rejected).toMatchObject({ok: false});
        const unchanged = renderer.props("layout") as GridLayoutResult;
        expect(sizeOf(unchanged, "center").width).toBeCloseTo(targetCenter);
        expect(sizeOf(unchanged, "sidebar-left").width).toBeCloseTo(target["sidebar-left"]);
    });

    it("分支把约束投影成 px 面板：不可行的提交整批拒绝，可行的一次落账", async () => {
        const grid = createGrid({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, minimumSize: {width: 200, height: 0}, maximumSize: {width: 500, height: 0}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}, minimumSize: {width: 200, height: 0}, maximumSize: {width: 500, height: 0}},
        ]}, {sashSize: 1});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const extent = {width: 601, height: 100};
        const layout = grid.layout(extent);
        const accept = vi.fn((commit: GridGestureCommit) => {
            const resized = grid.resizeBranches(commit.changes);
            return resized.ok ? {ok: true as const} : {ok: false as const, reason: resized.reason};
        });
        const wrapper = mount(GridRenderer, {
            props: {node: root, layout, onGestureCommit: accept},
            global: {stubs: {Splitter: SplitterStub}},
        });
        wrappers.push(wrapper);
        const splitter = wrapper.findComponent(SplitterStub);
        expect(splitter.props("sashSizes")).toEqual([1]);
        expect(splitter.props("sizesPx")).toEqual([300, 300]);
        // 面板交的是布局求过值的**有效**区间 px：a 最多长到「容器 − 兄弟下限」= 400，不是声明的 500。
        expect(splitter.props("panels")).toMatchObject([
            {id: "a", defaultSizePx: 300, minSizePx: 200, maxSizePx: 400, sizing: "weight"},
            {id: "b", defaultSizePx: 300, minSizePx: 200, maxSizePx: 400, sizing: "weight"},
        ]);

        // 越界目标（a 超过 max、b 低于 min）：整批拒绝，原树不动。
        const refused = accept(gestureCommit("root", root.children, layout, "width", {a: 600, b: 0}, ["a", "b"], extent));
        expect(refused).toMatchObject({ok: false});
        expect(accept).toHaveBeenCalledTimes(1);
        expect(sizeOf(grid.layout(extent), "a").width).toBeCloseTo(300);

        // 可行目标：一次提交一次落账，呈现真的前进（不靠重挂、不做百分比往返）。
        const accepted = accept(gestureCommit("root", root.children, layout, "width", {a: 250, b: 350}, ["a", "b"], extent, {sessionId: "session-2"}));
        expect(accepted).toEqual({ok: true});
        expect(accept).toHaveBeenCalledTimes(2);
        const presented = grid.layout(extent);
        expect(sizeOf(presented, "a").width).toBeCloseTo(250);
        expect(sizeOf(presented, "b").width).toBeCloseTo(350);
    });

});
