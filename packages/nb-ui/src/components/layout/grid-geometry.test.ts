import {describe, expect, it} from "vitest";
import {
    allocateSashPanels,
    collapsePolicyProblem,
    sashPanelBounds,
    type SashPanel,
} from "./grid-geometry";

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

function panel(
    id: string,
    size: number,
    minimum = 0,
    maximum = UNBOUNDED,
    sizing: "weight" | "fixed" = "weight",
): SashPanel {
    return {id, size, minimum, maximum, sizing};
}

function collapsed(id: string, collapsedSize: number, restoreSize: number, minimum: number, size = minimum): SashPanel {
    return {
        id,
        size,
        minimum,
        maximum: UNBOUNDED,
        sizing: "fixed",
        collapse: {collapsedSize, restoreSize, collapseThreshold: 24, expandThreshold: 24, collapsed: true},
    };
}

describe("唯一空间分配：fixed 与 weight", () => {
    it("全部 weight 时按意向比例分完可用空间", () => {
        const sizes = allocateSashPanels([panel("a", 1), panel("b", 2), panel("c", 1)], 400);
        expect(sizes).toEqual([100, 200, 100]);
    });

    it("fixed 面板保留像素目标，余量全部给 weight 面板", () => {
        const sizes = allocateSashPanels([
            panel("left", 340, 280, 560, "fixed"),
            panel("editor", 1, 120),
            panel("right", 400, 320, 700, "fixed"),
        ], 1480);
        expect(sizes).toEqual([340, 740, 400]);
    });

    it("预算不足时 fixed 先按可缩量压到最小，weight 仍拿到自己的下限", () => {
        const issues: string[] = [];
        const sizes = allocateSashPanels([
            panel("left", 340, 280, 560, "fixed"),
            panel("editor", 1, 200),
            panel("right", 400, 320, 700, "fixed"),
        ], 900, issues);
        expect(sizes[0]! + sizes[2]!).toBeCloseTo(700, 6);
        expect(sizes[0]!).toBeLessThan(340);
        expect(sizes[0]!).toBeGreaterThanOrEqual(280);
        expect(sizes[2]!).toBeGreaterThanOrEqual(320);
        expect(sizes[1]).toBeCloseTo(200, 6);
        expect(issues.join()).toContain("装不下固定尺寸");
    });

    it("最小尺寸合计超过可用量时按最小值比例降级", () => {
        const issues: string[] = [];
        const sizes = allocateSashPanels([
            panel("left", 340, 280, 560, "fixed"),
            panel("editor", 1, 200),
            panel("right", 400, 320, 700, "fixed"),
        ], 700, issues);
        expect(sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(700, 6);
        expect(sizes[1]).toBeCloseTo(200 * 700 / 800, 6);
        expect(issues.join()).toContain("约束不可满足");
    });

    it("没有 weight 面板时余量留白，不越权填满 fixed", () => {
        const issues: string[] = [];
        const sizes = allocateSashPanels([
            panel("left", 300, 100, 500, "fixed"),
            panel("right", 400, 100, 500, "fixed"),
        ], 1000, issues);
        expect(sizes).toEqual([300, 400]);
        expect(issues.join()).toContain("剩余");
    });

    it("超过 fixed 上限的可用空间同样留白", () => {
        const sizes = allocateSashPanels([
            panel("left", 600, 100, 500, "fixed"),
            panel("editor", 1, 120),
        ], 700);
        expect(sizes).toEqual([500, 200]);
    });

    it("空集合与零可用量都返回有限结果", () => {
        expect(allocateSashPanels([], 400)).toEqual([]);
        expect(allocateSashPanels([panel("a", 1), panel("b", 1)], 0)).toEqual([0, 0]);
    });
});

describe("收起面板的刚性范围", () => {
    it("收起面板沿主轴是 [collapsedSize, collapsedSize]，不受展开最小值约束", () => {
        expect(sashPanelBounds(collapsed("left", 0, 340, 280))).toEqual({low: 0, high: 0});
    });

    it("收起的 0 占用不会把兄弟的最小尺寸撑开", () => {
        const sizes = allocateSashPanels([
            collapsed("left", 0, 340, 280),
            panel("editor", 1, 120),
        ], 400);
        expect(sizes).toEqual([0, 400]);
    });

    it("Section 式的 32px 收起保留标题行占用", () => {
        const sizes = allocateSashPanels([
            collapsed("outline", 32, 220, 96),
            panel("files", 1, 96),
        ], 600);
        expect(sizes).toEqual([32, 568]);
    });

    it("收起策略的尺寸必须小于展开最小值", () => {
        const base = {collapsedSize: 0, restoreSize: 340, collapseThreshold: 24, expandThreshold: 24, collapsed: true};
        expect(collapsePolicyProblem(base, 280)).toBeNull();
        expect(collapsePolicyProblem({...base, collapsedSize: 280}, 280)).toContain("必须小于");
        expect(collapsePolicyProblem({...base, restoreSize: Number.NaN}, 280)).toContain("有限");
    });
});
