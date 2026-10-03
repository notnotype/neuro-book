import {describe, expect, it} from "vitest";
import {createGrid, type GridBranchInput, type GridGestureCommit, type GridNodeInput} from "@notnotype/nb-ui/layout";
import {
    containerAxis,
    containerOrientation,
    effectiveViewMinimumSize,
    VIEW_COLLAPSED_MAIN_SIZE_PX,
    viewContainerGridInput,
    viewContainerModeOf,
    viewLeafId,
    viewSizePatchesOf,
    type ViewContainerGridOptions,
} from "nbook/app/utils/workbench/view-container-layout";
import type {ViewDescriptor} from "nbook/app/utils/workbench/descriptors";
import type {ToolPartId} from "nbook/app/utils/workbench/view-placements";

/**
 * 容器内部单轴布局的纯行为：Part → 轴、可见成员数 → 模板、叶的意图与约束投影、一场手势 → 主轴补丁。
 *
 * 断言的是"投影出来的叶与补丁"，以及"这份投影喂给真实 Grid 原语后确实按意图分配"——
 * 不复述 nb-ui 的分配算法，也不把 single/multiple 的差别寄存在宿主组件里。
 */

const FILES = "nbook.files";
const OUTLINE = "nbook.outline";
const TOOLS = "nbook.tools";

/** nb-ui 的默认收起阈值；产品侧只转交，不复制数值。 */
const COLLAPSE_THRESHOLD = 24;

function viewOf(id: string, overrides: Partial<ViewDescriptor> = {}): ViewDescriptor {
    return {
        id,
        titleKey: `workbench.view.${id}`,
        icon: "i-lucide-file-text",
        container: TOOLS,
        layout: "scroll",
        order: 10,
        canToggleVisibility: true,
        canMoveView: true,
        factoryKey: `nbook.view.${id}`,
        stateScope: "user",
        ...overrides,
    };
}

function optionsOf(overrides: Partial<ViewContainerGridOptions<string>> = {}): ViewContainerGridOptions<string> {
    return {
        containerId: TOOLS,
        partId: "left",
        mode: "multiple",
        members: [
            {ref: FILES, view: viewOf(FILES)},
            {ref: OUTLINE, view: viewOf(OUTLINE)},
        ],
        collapseThreshold: COLLAPSE_THRESHOLD,
        ...overrides,
    };
}

/** 投影必然给出分支；用例里显式失败，而不是把 null 当"没有差别"。 */
function branchOf(node: GridNodeInput<string> | null): GridBranchInput<string> {
    if (node === null || node.kind !== "branch") {
        throw new Error(`期望一棵分支，实际拿到 ${node === null ? "null" : node.kind}`);
    }
    return node;
}

describe("Part → 容器内部的轴", () => {
    it("侧栏上下排、Panel 左右排；轴就是尺寸记录里的字段名", () => {
        expect(["left", "right"].map((part) => containerOrientation(part as ToolPartId))).toEqual(["vertical", "vertical"]);
        expect(containerOrientation("panel")).toBe("horizontal");

        expect(["left", "right"].map((part) => containerAxis(part as ToolPartId))).toEqual(["height", "height"]);
        expect(containerAxis("panel")).toBe("width");
    });

    it("可见成员数决定模板：0 空态、1 single、2 及以上 multiple；非法计数按空态", () => {
        expect([0, 1, 2, 3].map(viewContainerModeOf)).toEqual(["empty", "single", "multiple", "multiple"]);
        expect(viewContainerModeOf(Number.NaN)).toBe("empty");
    });

    it("有效最小尺寸：缺省 64，声明值取大，低于下限的声明抬到收起尺寸 + 1", () => {
        expect(effectiveViewMinimumSize(undefined)).toBe(64);
        expect(effectiveViewMinimumSize(120)).toBe(120);
        expect(effectiveViewMinimumSize(10)).toBe(VIEW_COLLAPSED_MAIN_SIZE_PX + 1);
        expect(effectiveViewMinimumSize(Number.NaN)).toBe(64);
    });
});

describe("单轴 Grid 投影", () => {
    it("空容器不建树：宿主画空态，不建一条没有叶的分支", () => {
        expect(viewContainerGridInput(optionsOf({mode: "empty", members: []}))).toBeNull();
        expect(viewContainerGridInput(optionsOf({members: []}))).toBeNull();
    });

    it("上下排：叶的主轴是 height（意图、约束都在这一轴），交叉轴不设限由宿主填满", () => {
        const branch = branchOf(viewContainerGridInput(optionsOf()));

        expect(branch.id).toBe("container:nbook.tools");
        expect(branch.orientation).toBe("vertical");
        expect(branch.children.map((child) => child.id)).toEqual(["view:nbook.files", "view:nbook.outline"]);
        expect(branch.children[0]).toEqual({
            kind: "leaf",
            id: "view:nbook.files",
            ref: FILES,
            size: {width: 0, height: 240},
            minimumSize: {width: 0, height: 64},
            // 交叉轴的 max 不是 0：一个 0 会把内容区压成空洞，`layout()` 也会把它报成 0 宽。
            maximumSize: {width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER},
            sizing: "weight",
            collapse: {
                collapsedSize: VIEW_COLLAPSED_MAIN_SIZE_PX,
                restoreSize: 240,
                collapseThreshold: COLLAPSE_THRESHOLD,
                expandThreshold: COLLAPSE_THRESHOLD,
                collapsed: false,
            },
        });
    });

    it("左右排：意图与约束只在 width 上；已保存的 height 不会被换算成宽度", () => {
        const branch = branchOf(viewContainerGridInput(optionsOf({
            partId: "panel",
            members: [
                {ref: FILES, view: viewOf(FILES, {weight: 2}), size: {height: 500, width: 320}},
                {ref: OUTLINE, view: viewOf(OUTLINE, {weight: 1}), size: {height: 500}},
            ],
        })));

        expect(branch.orientation).toBe("horizontal");
        expect(branch.children[0]).toMatchObject({size: {width: 320, height: 0}, minimumSize: {width: 64}});
        // 只有 height 意图时缺省是 `240 * weight`（= 240），不是把 500 当宽度。
        expect(branch.children[1]).toMatchObject({size: {width: 240, height: 0}});
    });

    it("缺省意图是 240 * weight；weight 非正有限按 1，已保存意图夹进有效范围", () => {
        const branch = branchOf(viewContainerGridInput(optionsOf({
            members: [
                {ref: FILES, view: viewOf(FILES, {weight: 0.5})},
                {ref: OUTLINE, view: viewOf(OUTLINE, {weight: 0, minimumSize: {height: 120}, maximumSize: {height: 900}}), size: {height: 4_000}},
            ],
        })));

        expect(branch.children[0]).toMatchObject({size: {width: 0, height: 120}, minimumSize: {height: 64}});
        expect(branch.children[1]).toMatchObject({
            size: {width: 0, height: 900},
            minimumSize: {height: 120},
            maximumSize: {height: 900},
        });
    });

    it("single 不装收起策略：一个叶填满内容区，收起意图不参与几何", () => {
        const branch = branchOf(viewContainerGridInput(optionsOf({
            mode: "single",
            members: [{ref: FILES, view: viewOf(FILES), collapsed: true}],
        })));

        expect(branch.children).toHaveLength(1);
        expect("collapse" in branch.children[0]!).toBe(false);
    });

    it("multiple 的收起叶是刚性 32px：只有目标叶收起，其它兄弟各自保持", () => {
        const branch = branchOf(viewContainerGridInput(optionsOf({
            members: [
                {ref: FILES, view: viewOf(FILES), collapsed: true},
                {ref: OUTLINE, view: viewOf(OUTLINE), size: {height: 320}},
            ],
        })));

        expect(branch.children[0]).toMatchObject({collapse: {collapsedSize: 32, restoreSize: 240, collapsed: true}});
        expect(branch.children[1]).toMatchObject({collapse: {collapsedSize: 32, restoreSize: 320, collapsed: false}});
    });

    it("投影喂给真实 Grid 原语：上下排按意图分高、交叉轴填满、single 填满且没有分隔条", () => {
        const linear = createGrid(viewContainerGridInput(optionsOf())!, {sashSize: 1});
        const layout = linear.layout({width: 400, height: 800});

        const first = layout.sizes[viewLeafId(FILES)]!;
        const second = layout.sizes[viewLeafId(OUTLINE)]!;
        expect(first.height).toBeCloseTo(399.5, 6);
        expect(second.height).toBeCloseTo(399.5, 6);
        expect(first.width).toBe(400);
        expect(layout.sashSizes["container:nbook.tools"]).toEqual([1]);
        expect(layout.issues).toEqual([]);

        const single = createGrid(viewContainerGridInput(optionsOf({
            mode: "single",
            members: [{ref: FILES, view: viewOf(FILES)}],
        }))!, {sashSize: 1});
        const singleLayout = single.layout({width: 400, height: 800});

        expect(singleLayout.sizes[viewLeafId(FILES)]).toEqual({width: 400, height: 800});
        expect(singleLayout.sashSizes["container:nbook.tools"]).toEqual([]);
    });
});

describe("一场手势 → 主轴补丁", () => {
    function commitOf(active: readonly string[], collapsed: Record<string, boolean> = {}): GridGestureCommit {
        return {
            sessionId: "session-1",
            contextKey: "surface-1",
            source: "pointer",
            revision: 2,
            extent: {width: 400, height: 800},
            changes: [{
                branchId: "container:nbook.tools",
                axis: "height",
                baseline: {[viewLeafId(FILES)]: 400, [viewLeafId(OUTLINE)]: 400},
                target: {[viewLeafId(FILES)]: 320, [viewLeafId(OUTLINE)]: 480},
                extent: {width: 400, height: 800},
                active,
                compensated: [],
                collapsed,
            }],
        };
    }

    it("只写主动叶的当前轴：被补偿的邻居、single 的测量值都不进补丁", () => {
        const options = optionsOf({members: [
            {ref: FILES, view: viewOf(FILES), size: {height: 400}},
            {ref: OUTLINE, view: viewOf(OUTLINE), size: {height: 400}},
        ]});
        const patches = viewSizePatchesOf({
            layout: options,
            commit: commitOf([viewLeafId(FILES)]),
            applied: {ok: true, intents: {[viewLeafId(FILES)]: {width: 0, height: 320}}, collapsed: {}},
        });

        expect(patches).toEqual([{viewId: FILES, height: 320}]);
        expect("width" in patches[0]!).toBe(false);

        expect(viewSizePatchesOf({
            layout: optionsOf({mode: "single", members: [{ref: FILES, view: viewOf(FILES)}]}),
            commit: commitOf([viewLeafId(FILES)]),
            applied: {ok: true, intents: {[viewLeafId(FILES)]: {width: 0, height: 320}}, collapsed: {}},
        })).toEqual([]);
    });

    it("收起变化折成 collapsed，意图没变就不写尺寸字段", () => {
        const patches = viewSizePatchesOf({
            layout: optionsOf(),
            commit: commitOf([viewLeafId(FILES)], {[viewLeafId(FILES)]: true}),
            applied: {ok: true, intents: {[viewLeafId(FILES)]: {width: 0, height: 240}}, collapsed: {[viewLeafId(FILES)]: true}},
        });

        expect(patches).toEqual([{viewId: FILES, collapsed: true}]);
    });

    it("等效意图没有真实变化：不产生补丁，也不产生空壳补丁", () => {
        const patches = viewSizePatchesOf({
            layout: optionsOf(),
            commit: commitOf([viewLeafId(FILES)]),
            applied: {ok: true, intents: {[viewLeafId(FILES)]: {width: 0, height: 240}}, collapsed: {}},
        });

        expect(patches).toEqual([]);
    });

    it("左右排的补丁写 width；不认识的叶 id 被忽略", () => {
        const patches = viewSizePatchesOf({
            layout: optionsOf({partId: "panel"}),
            commit: commitOf([viewLeafId(FILES), "view:nbook.ghost"]),
            applied: {ok: true, intents: {[viewLeafId(FILES)]: {width: 480, height: 0}}, collapsed: {}},
        });

        expect(patches).toEqual([{viewId: FILES, width: 480}]);
    });
});
