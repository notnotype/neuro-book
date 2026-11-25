import {describe, expect, it} from "bun:test";
import {
    allocateSashPanels,
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

function collapsed(id: string, collapsedSize: number, minimum: number, size = minimum): SashPanel {
    return {
        id,
        size,
        minimum,
        maximum: UNBOUNDED,
        sizing: "fixed",
        collapse: {collapsedSize, collapseThreshold: 24, expandThreshold: 24, collapsed: true},
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

    // 分配降级的诊断由 `allocateAxis` 带上分支与轴发出，见 grid.test.ts 的“诊断”一组。
    it("预算不足时 fixed 先按可缩量压到最小，weight 仍拿到自己的下限", () => {
        const sizes = allocateSashPanels([
            panel("left", 340, 280, 560, "fixed"),
            panel("editor", 1, 200),
            panel("right", 400, 320, 700, "fixed"),
        ], 900);
        expect(sizes[0]! + sizes[2]!).toBeCloseTo(700, 6);
        expect(sizes[0]!).toBeLessThan(340);
        expect(sizes[0]!).toBeGreaterThanOrEqual(280);
        expect(sizes[2]!).toBeGreaterThanOrEqual(320);
        expect(sizes[1]).toBeCloseTo(200, 6);
    });

    it("最小尺寸合计超过可用量时按最小值比例降级", () => {
        const sizes = allocateSashPanels([
            panel("left", 340, 280, 560, "fixed"),
            panel("editor", 1, 200),
            panel("right", 400, 320, 700, "fixed"),
        ], 700);
        expect(sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(700, 6);
        expect(sizes[1]).toBeCloseTo(200 * 700 / 800, 6);
    });

    it("没有 weight 面板时余量留白，不越权填满 fixed", () => {
        const sizes = allocateSashPanels([
            panel("left", 300, 100, 500, "fixed"),
            panel("right", 400, 100, 500, "fixed"),
        ], 1000);
        expect(sizes).toEqual([300, 400]);
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
        expect(sashPanelBounds(collapsed("left", 0, 280))).toEqual({low: 0, high: 0});
    });

    it("收起的 0 占用不会把兄弟的最小尺寸撑开", () => {
        const sizes = allocateSashPanels([
            collapsed("left", 0, 280),
            panel("editor", 1, 120),
        ], 400);
        expect(sizes).toEqual([0, 400]);
    });

    it("Section 式的 32px 收起保留标题行占用", () => {
        const sizes = allocateSashPanels([
            collapsed("outline", 32, 96),
            panel("files", 1, 96),
        ], 600);
        expect(sizes).toEqual([32, 568]);
    });
});

describe("标了刚性的面板", () => {
    const rigid = (id: string, size: number, minimum = 0, maximum = UNBOUNDED): SashPanel => ({...panel(id, size, minimum, maximum, "fixed"), rigid: true});

    it("范围是夹进声明最小与最大的意图；按比例分的标了不起作用", () => {
        expect(sashPanelBounds(rigid("bar", 48))).toEqual({low: 48, high: 48});
        expect(sashPanelBounds(rigid("bar", 500, 100, 300))).toEqual({low: 300, high: 300});
        expect(sashPanelBounds({...panel("share", 1, 50, 400), rigid: true})).toEqual({low: 50, high: 400});
    });

    it("空间够时和保留像素的一样取意图，余量给按比例分的", () => {
        expect(allocateSashPanels([rigid("bar", 48), panel("editor", 1, 100)], 600)).toEqual([48, 552]);
    });

    it("最小值之和放不下：先按比例压别的，刚性的最后才让", () => {
        expect(allocateSashPanels([panel("a", 1, 400), rigid("bar", 300), panel("b", 1, 200)], 600)).toEqual([200, 300, 100]);
    });

    it("刚性的之和也放不下：只在刚性的之间按比例压，别的为 0", () => {
        expect(allocateSashPanels([rigid("top", 300), panel("a", 1, 100), rigid("bottom", 100)], 200)).toEqual([150, 0, 50]);
    });
});
