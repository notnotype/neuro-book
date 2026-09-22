import {describe, expect, it} from "vitest";
import {createGrid} from "./grid";
import {branchSashPanels, type SashPanel} from "./grid-geometry";
import {sashCollapsePolicy, solveSashCollapse, solveSashDrag, type SashDragResult, type SashDragSnapState} from "./sash-drag";
import type {GridBranchInput, GridLeafInput} from "./grid-types";

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

function fixed(id: string, minimum: number, maximum = UNBOUNDED): SashPanel {
    return {id, size: minimum, minimum, maximum, sizing: "fixed"};
}

function weight(id: string, minimum = 0, maximum = UNBOUNDED): SashPanel {
    return {id, size: minimum, minimum, maximum, sizing: "weight"};
}

/** 侧栏（可收起）+ 编辑区 + 右栏：外壳主行的真实形状。 */
function shellPanels(leftWidth = 340, rightWidth = 400): SashPanel[] {
    return [
        {
            ...fixed("left", 280, 560),
            size: leftWidth,
            collapse: sashCollapsePolicy({collapsedSize: 0, restoreSize: leftWidth, collapsed: false}),
        },
        weight("center", 120),
        {...fixed("right", 320, 900), size: rightWidth},
    ];
}

/** 按一次拖动过程求解：从按下开始逐帧推进，返回最后一帧。 */
function drag(panels: readonly SashPanel[], baseline: readonly number[], sashIndex: number, deltas: readonly number[]): SashDragResult {
    let state: SashDragSnapState | null = null;
    let last: SashDragResult | null = null;
    for (const delta of deltas) {
        last = solveSashDrag({panels, baselinePx: baseline, sashIndex, deltaPx: delta, snapState: state});
        if (last === null) {
            throw new Error("求解返回 null");
        }
        state = last.snapState;
    }
    if (!last) {
        throw new Error("拖动没有帧");
    }
    return last;
}

describe("拖动求解：直接相邻与传播", () => {
    it("位移只改变分隔条两侧，总量守恒", () => {
        const panels = [fixed("a", 100, 500), fixed("b", 100, 500)];
        const result = drag(panels, [300, 500], 0, [40]);
        expect(result.sizesPx).toEqual([340, 460]);
        expect(result.active).toEqual(["a", "b"]);
        expect(result.compensated).toEqual([]);
    });

    it("近端触界后由远端兄弟补偿，未变化的相邻面板不冒充主动字段", () => {
        const panels = [fixed("a", 100, 400), fixed("b", 100, 300), fixed("c", 100, 500)];
        const result = drag(panels, [200, 300, 300], 1, [80]);
        expect(result.sizesPx).toEqual([280, 300, 220]);
        expect(result.active).toEqual(["c"]);
        expect(result.compensated).toEqual(["a"]);
    });

    it("消费不掉的位移不采用（两侧容量都用尽）", () => {
        const panels = [fixed("a", 100, 200), fixed("b", 100, 200)];
        expect(drag(panels, [200, 200], 0, [200]).sizesPx).toEqual([200, 200]);
        expect(drag(panels, [200, 200], 0, [-200]).sizesPx).toEqual([200, 200]);
    });

    it("相邻候选触界未变化时不冒充主动字段", () => {
        const panels = [fixed("a", 100, 200), fixed("b", 100, 500)];
        const result = drag(panels, [200, 400], 0, [50]);
        expect(result.sizesPx).toEqual([200, 400]);
        expect(result.active).toEqual([]);
    });

    it("非法输入不产生手势", () => {
        expect(solveSashDrag({panels: [fixed("a", 0)], baselinePx: [100], sashIndex: 0, deltaPx: 10})).toBeNull();
        expect(solveSashDrag({panels: [fixed("a", 0), fixed("b", 0)], baselinePx: [100, 100], sashIndex: 1, deltaPx: 10})).toBeNull();
        expect(solveSashDrag({panels: [fixed("a", 0), fixed("b", 0)], baselinePx: [100, Number.NaN], sashIndex: 0, deltaPx: 10})).toBeNull();
    });
});

describe("拖动求解：收起与恢复", () => {
    it("在最小尺寸附近只停在最小值，不触发收起", () => {
        const panels = shellPanels();
        const result = drag(panels, [340, 740, 400], 0, [-50]);
        expect(result.sizesPx[0]).toBeCloseTo(290, 6);
        expect(result.collapsed).toEqual({});
    });

    it("低于 minimum − 24 才吸附到 collapsedSize，恰好等于阈值仍停在最小值", () => {
        const panels = shellPanels();
        const atThreshold = drag(panels, [340, 740, 400], 0, [-84]);
        expect(atThreshold.sizesPx).toEqual([280, 800, 400]);
        expect(atThreshold.collapsed).toEqual({});

        const collapsed = drag(panels, [340, 740, 400], 0, [-85]);
        expect(collapsed.sizesPx).toEqual([0, 1080, 400]);
        expect(collapsed.collapsed).toEqual({left: true});
        expect(collapsed.active).toContain("left");
        expect(collapsed.sizesPx.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1480, 6);
    });

    it("收起后继续向内拖动不再移动，也不重复吸附", () => {
        const panels = shellPanels();
        const result = drag(panels, [340, 740, 400], 0, [-85, -100, -140]);
        expect(result.sizesPx).toEqual([0, 1080, 400]);
        expect(result.collapsed).toEqual({left: true});
    });

    it("收起后向外不到 max(minimum, collapsedSize + 24) 时保持收起", () => {
        const panels = shellPanels();
        const result = drag(panels, [340, 740, 400], 0, [-85, -61]);
        expect(result.sizesPx).toEqual([0, 1080, 400]);
        expect(result.collapsed).toEqual({left: true});
    });

    it("回到恢复门槛后按理想边界展开，不跳回记忆尺寸", () => {
        const panels = shellPanels();
        const result = drag(panels, [340, 740, 400], 0, [-85, -60]);
        // 记忆尺寸是 340、恢复门槛是 minimum 280：展开到指针位置 280，而不是记忆的 340。
        expect(result.sizesPx).toEqual([280, 800, 400]);
        // 手势内收起又展开，净变化为零：不产生收起写入。
        expect(result.collapsed).toEqual({});
    });

    it("展开后继续拖动保持绝对跟随：位移始终从按下基线起算", () => {
        const panels = shellPanels();
        expect(drag(panels, [340, 740, 400], 0, [-85, -60, -40]).sizesPx).toEqual([300, 780, 400]);
        expect(drag(panels, [340, 740, 400], 0, [-85, -60, 60]).sizesPx).toEqual([400, 680, 400]);
    });

    it("过冲后回到同一个指针位置，结果与全新拖动逐值一致（无重锚）", () => {
        const panels = shellPanels();
        const baseline = [340, 740, 400];
        const overshoot = [-150, -260, -85, -20, 40];
        for (const delta of [-260, -85, -60, -40, 0, 40]) {
            const fresh = drag(panels, baseline, 0, [delta]);
            const replayed = drag(panels, baseline, 0, [...overshoot, delta]);
            expect(replayed.sizesPx, `delta ${delta}`).toEqual(fresh.sizesPx);
            expect(replayed.collapsed, `delta ${delta}`).toEqual(fresh.collapsed);
        }
    });

    it("手势开始前已收起的侧栏，向外拖到 max(minimum, collapsedSize + 24) 才恢复", () => {
        const panels = shellPanels();
        panels[0] = {...panels[0]!, size: 0, collapse: sashCollapsePolicy({collapsedSize: 0, restoreSize: 340, collapsed: true})};
        const staying = drag(panels, [0, 1080, 400], 0, [279]);
        expect(staying.sizesPx).toEqual([0, 1080, 400]);
        expect(staying.collapsed).toEqual({});

        const restored = drag(panels, [0, 1080, 400], 0, [280]);
        expect(restored.sizesPx).toEqual([280, 800, 400]);
        expect(restored.collapsed).toEqual({left: false});
    });

    it("容量不足时保持收起并给出诊断", () => {
        const panels = [
            {
                ...fixed("left", 280, 560),
                size: 0,
                collapse: sashCollapsePolicy({collapsedSize: 0, restoreSize: 340, collapsed: true}),
            },
            {...fixed("right", 320, 320), size: 320},
        ];
        const result = solveSashDrag({panels, baselinePx: [0, 320], sashIndex: 0, deltaPx: 300});
        expect(result?.sizesPx).toEqual([0, 320]);
        expect(result?.issues.join()).toContain("恢复空间不足");
        expect(result?.collapsed).toEqual({});
    });

    it("收起后的空间没有可吸收的边界时保持展开并给出诊断", () => {
        const panels: SashPanel[] = [
            {...fixed("a", 150, 365), size: 300, collapse: sashCollapsePolicy({collapsedSize: 32, restoreSize: 300})},
            {...fixed("b", 32, 32), size: 32},
        ];
        const result = drag(panels, [300, 32], 0, [-200]);
        // 兄弟刚性地只占 32：收起 a 释放的 268 无处可去，整组拒绝而不是产出不守恒几何。
        expect(result.sizesPx).toEqual([300, 32]);
        expect(result.collapsed).toEqual({});
        expect(result.issues.join()).toContain("没有可吸收的边界");
    });

    it("有效范围装不下总量（窄容器已降级）时保持基线并说明原因", () => {
        const panels = [fixed("a", 300, 500), fixed("b", 300, 500)];
        const result = solveSashDrag({panels, baselinePx: [250, 250], sashIndex: 0, deltaPx: 40});
        // 两个面板的下限合计 600 > 总量 500：任何结果都不可能在满足 bounds 的同时守恒。
        expect(result?.sizesPx).toEqual([250, 250]);
        expect(result?.active).toEqual([]);
        expect(result?.issues.join()).toContain("装不下分支总量");
    });

    it("收起的 Section 保留 32px 标题行，展开用理想边界而不是记忆高度", () => {
        const outline: SashPanel = {
            ...weight("outline", 96),
            size: 220,
            collapse: sashCollapsePolicy({collapsedSize: 32, restoreSize: 220, collapsed: false}),
        };
        const panels = [outline, weight("files", 96)];
        const collapsedResult = drag(panels, [220, 380], 0, [-160]);
        expect(collapsedResult.sizesPx).toEqual([32, 568]);
        expect(collapsedResult.collapsed).toEqual({outline: true});
        // 恢复门槛是 max(96, 32 + 24) = 96：差 4px 仍收起，到门槛才展开到指针位置。
        expect(drag(panels, [220, 380], 0, [-160, -128]).sizesPx).toEqual([32, 568]);
        expect(drag(panels, [220, 380], 0, [-160, -124]).sizesPx).toEqual([96, 504]);
    });

    it("三叶混合：本场已收起的兄弟保持刚性，中间叶收起再展开逐叶合法且总量守恒", () => {
        const outer: SashPanel = {
            ...fixed("outer", 64, 400),
            size: 32,
            collapse: sashCollapsePolicy({collapsedSize: 32, restoreSize: 220, collapsed: true}),
        };
        const middle: SashPanel = {
            ...fixed("middle", 64, 400),
            size: 200,
            collapse: sashCollapsePolicy({collapsedSize: 32, restoreSize: 200}),
        };
        const tail = weight("tail", 0);
        const panels = [outer, middle, tail];
        const baseline = [32, 200, 400];
        const total = baseline.reduce((sum, value) => sum + value, 0);

        const collapsed = drag(panels, baseline, 1, [-220]);
        expect(collapsed.sizesPx).toEqual([32, 32, 568]);
        expect(collapsed.collapsed).toEqual({middle: true});
        expect(collapsed.sizesPx.reduce((sum, value) => sum + value, 0)).toBeCloseTo(total, 6);
        // 未操作的兄弟不被动过：已收起的 outer 始终是 32。
        expect(collapsed.sizesPx[0]).toBe(32);

        const expanded = drag(panels, baseline, 1, [-220, -90]);
        expect(expanded.sizesPx).toEqual([32, 110, 490]);
        expect(expanded.collapsed).toEqual({});
        expect(expanded.sizesPx.reduce((sum, value) => sum + value, 0)).toBeCloseTo(total, 6);
        expect(expanded.sizesPx[0]).toBe(32);
    });

    it("显式折叠只改目标面板：展开的兄弟保持原尺寸，不被别人的收起范围挤空", () => {
        const first: SashPanel = {...fixed("first", 64, 320), size: 200, collapse: sashCollapsePolicy({collapsedSize: 0, restoreSize: 200})};
        const second: SashPanel = {...fixed("second", 64, 320), size: 200, collapse: sashCollapsePolicy({collapsedSize: 0, restoreSize: 200})};
        const result = solveSashCollapse({
            panels: [first, second, weight("tail", 0)],
            sizesPx: [200, 200, 400],
            sashIndex: 1,
            index: 1,
            collapsed: true,
        });

        expect(result?.sizesPx).toEqual([200, 0, 600]);
        expect(result?.collapsed).toEqual({second: true});
        expect(result?.issues).toEqual([]);
    });
});

/** 左栏 280 / 右栏 308 的记忆尺寸：两侧外栏同形，用同一组帧做镜像对照。 */
const LEFT_MEMORY = 280;
const RIGHT_MEMORY = 308;
const STACK_MEMORY = 224;
const SIDE_MIN = 260;
const SIDE_MAX = 365;

/** 三兄弟：两侧外栏可收起（同一份策略），中间是吸收余量的兄弟。 */
function collapsibleSidePanels(collapsedSide: "left" | "right" | null = null): SashPanel[] {
    const outer = (id: string, memory: number): SashPanel => ({
        ...fixed(id, SIDE_MIN, SIDE_MAX),
        size: memory,
        collapse: sashCollapsePolicy({
            collapsedSize: 0,
            restoreSize: memory,
            collapsed: id === collapsedSide,
        }),
    });
    return [outer("left", LEFT_MEMORY), weight("stack", 0), outer("right", RIGHT_MEMORY)];
}

/**
 * 宿主投影形状的三兄弟：`branchSashPanels` 交给拖动求解器的就是这些面板，
 * 记忆尺寸放在节点的展开意图与收起策略上，基线取该树在当前容器里的呈现 px。
 */
function projectedSidePanels(
    collapsedSide: "left" | "right",
    memories: {left?: number; right?: number} = {},
): {panels: SashPanel[]; baseline: number[]} {
    const memoryOf = (id: "left" | "right"): number => memories[id] ?? (id === "left" ? LEFT_MEMORY : RIGHT_MEMORY);
    const leaf = (id: "left" | "stack" | "right", sizing: "fixed" | "weight", size: number): GridLeafInput<string> => ({
        kind: "leaf",
        id,
        ref: id,
        size: {width: size, height: 0},
        minimumSize: {width: sizing === "fixed" ? SIDE_MIN : 0, height: 0},
        maximumSize: {width: sizing === "fixed" ? SIDE_MAX : UNBOUNDED, height: UNBOUNDED},
        sizing,
        ...(sizing === "fixed"
            ? {
                collapse: {
                    collapsedSize: 0,
                    restoreSize: size,
                    collapseThreshold: 24,
                    expandThreshold: 24,
                    collapsed: id === collapsedSide,
                },
            }
            : {}),
    });
    const tree: GridBranchInput<string> = {
        kind: "branch",
        id: "body",
        orientation: "horizontal",
        size: {width: 840, height: 600},
        minimumSize: {width: 0, height: 0},
        maximumSize: {width: UNBOUNDED, height: UNBOUNDED},
        children: [leaf("left", "fixed", memoryOf("left")), leaf("stack", "weight", STACK_MEMORY), leaf("right", "fixed", memoryOf("right"))],
    };
    const grid = createGrid<string>(tree);
    const body = grid.find("body");
    if (body?.kind !== "branch") {
        throw new Error("测试树应当有 body 分支");
    }
    const layout = grid.layout({width: 840, height: 600});
    return {
        panels: branchSashPanels(body, 1),
        baseline: body.children.map((child) => Math.max(0, layout.sizes[child.id]?.width ?? 0)),
    };
}

/** 两侧外栏在 `[left, stack, right]` 里的下标、记忆尺寸与向外方向（与主轴位移同号）。 */
function sideShape(side: "left" | "right"): {sashIndex: number; index: number; memory: number; outward: number} {
    return side === "left"
        ? {sashIndex: 0, index: 0, memory: LEFT_MEMORY, outward: 1}
        : {sashIndex: 1, index: 2, memory: RIGHT_MEMORY, outward: -1};
}

describe("拖动求解：两侧外栏的收起与恢复", () => {
    it("右侧外栏拖到零再拉回：展开到指针位置，余量兄弟吸收差额", () => {
        const panels = collapsibleSidePanels();
        const baseline = [LEFT_MEMORY, STACK_MEMORY, RIGHT_MEMORY];
        const collapsed = drag(panels, baseline, 1, [84]);
        expect(collapsed.sizesPx).toEqual([LEFT_MEMORY, 532, 0]);
        expect(collapsed.collapsed).toEqual({right: true});

        // 记忆尺寸是 308、恢复门槛是 minimum 260：展开后是指针位置 284，不是记忆的 308。
        const restored = drag(panels, baseline, 1, [84, 24]);
        expect(restored.sizesPx).toEqual([LEFT_MEMORY, 248, 284]);
        expect(restored.collapsed).toEqual({});
        expect(restored.sizesPx[1]).toBeGreaterThan(0);
        expect(restored.sizesPx.reduce((sum, value) => sum + value, 0)).toBeCloseTo(baseline.reduce((sum, value) => sum + value, 0), 6);
    });

    it("左侧外栏用镜像的同一规则：收起后同样展开到指针位置", () => {
        const panels = collapsibleSidePanels();
        const baseline = [LEFT_MEMORY, STACK_MEMORY, RIGHT_MEMORY];
        const collapsed = drag(panels, baseline, 0, [-84]);
        expect(collapsed.sizesPx).toEqual([0, 504, RIGHT_MEMORY]);
        expect(collapsed.collapsed).toEqual({left: true});

        // 记忆尺寸是 280，向外 20px 落到自己的 minimum 260：展开到指针位置。
        const restored = drag(panels, baseline, 0, [-84, -20]);
        expect(restored.sizesPx).toEqual([SIDE_MIN, 244, RIGHT_MEMORY]);
        expect(restored.collapsed).toEqual({});
        expect(restored.sizesPx[1]).toBeGreaterThan(0);
    });

    it("手势开始前已收起的两侧外栏：到 minimum 才展开，展开后不跳回记忆尺寸", () => {
        for (const side of ["left", "right"] as const) {
            const {sashIndex, index, memory, outward} = sideShape(side);
            const baseline = [LEFT_MEMORY, STACK_MEMORY, RIGHT_MEMORY];
            baseline[index] = 0;
            baseline[1] += memory;

            const staying = drag(collapsibleSidePanels(side), baseline, sashIndex, [outward * (SIDE_MIN - 1)]);
            expect(staying.sizesPx[index], side).toBe(0);
            expect(staying.collapsed, side).toEqual({});

            const restored = drag(collapsibleSidePanels(side), baseline, sashIndex, [outward * SIDE_MIN]);
            expect(restored.sizesPx[index], side).toBe(SIDE_MIN);
            expect(restored.collapsed, side).toEqual({[side]: false});
            expect(restored.sizesPx[1], side).toBeGreaterThan(0);
        }
    });

    it("收起投影交给求解器的面板仍带展开声明的 min/max：两侧镜像一致", () => {
        const outcomes = (["left", "right"] as const).map((side) => {
            const {sashIndex, index, outward} = sideShape(side);
            const {panels, baseline} = projectedSidePanels(side, {left: SIDE_MIN, right: SIDE_MIN});

            const staying = drag(panels, baseline, sashIndex, [outward * (SIDE_MIN - 1)]);
            expect(staying.sizesPx, side).toEqual(baseline);
            expect(staying.collapsed, side).toEqual({});

            const restored = drag(panels, baseline, sashIndex, [outward * SIDE_MIN]);
            expect(restored.sizesPx[index], side).toBe(SIDE_MIN);
            expect(restored.collapsed, side).toEqual({[side]: false});
            return restored.sizesPx.join(",");
        });
        // 两侧同形：镜像位移必须得到镜像几何。
        expect(outcomes[1]!.split(",").reverse().join(",")).toBe(outcomes[0]);
    });

    it("显式恢复（Enter / Section 按钮）用记忆尺寸，与拖动的指针位置分工不同", () => {
        const outcomes = (["left", "right"] as const).map((side) => {
            const {sashIndex, index, memory} = sideShape(side);
            const {panels, baseline} = projectedSidePanels(side);
            const result = solveSashCollapse({panels, sizesPx: baseline, sashIndex, index, collapsed: false});
            expect(result?.collapsed, side).toEqual({[side]: false});
            expect(result?.sizesPx[index], side).toBe(memory);
            expect(result?.sizesPx[1], side).toBeGreaterThan(0);
            return result?.sizesPx.join(",") ?? "";
        });
        // 两侧同形：同一份恢复用例必须得到同一份几何。
        expect(outcomes[0]).toBe(outcomes[1]);
    });

    it("显式恢复的记忆尺寸超过自身上限时按上限恢复，不吃掉兄弟", () => {
        const {panels, baseline} = projectedSidePanels("right", {right: SIDE_MAX + 55});
        const result = solveSashCollapse({panels, sizesPx: baseline, sashIndex: 1, index: 2, collapsed: false});
        expect(result?.sizesPx[2]).toBe(SIDE_MAX);
        expect(result?.sizesPx[0]).toBe(LEFT_MEMORY);
        expect(result?.sizesPx[1]).toBeGreaterThan(0);
    });
});
