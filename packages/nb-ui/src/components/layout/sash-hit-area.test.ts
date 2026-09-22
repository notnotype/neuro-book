import {describe, expect, it} from "vitest";
import {collectSashHits, hitTestSashBand, sashHitMargin, type SashHitTarget, type SashRect} from "./sash-hit-area";

/** 竖线：宽 1px、高 200px，中心在 x。 */
function vertical(id: string, x: number, top = 0, height = 200, order = 0): SashHitTarget {
    return {branchId: id, sashIndex: 0, axis: "width", rect: {left: x - 0.5, top, right: x + 0.5, bottom: top + height}, depth: 0, order, enabled: true};
}

/** 横线：高 1px、宽 200px，中心在 y。 */
function horizontal(id: string, y: number, left = 0, width = 200, order = 0): SashHitTarget {
    return {branchId: id, sashIndex: 0, axis: "height", rect: {left, top: y - 0.5, right: left + width, bottom: y + 0.5}, depth: 0, order, enabled: true};
}

function rect(left: number, top: number, right: number, bottom: number): SashRect {
    return {left, top, right, bottom};
}

describe("分隔线命中：边距与候选", () => {
    it("fine 与 coarse 用同一对常量，coarse 更大", () => {
        expect(sashHitMargin("fine")).toBe(5);
        expect(sashHitMargin("coarse")).toBe(15);
    });

    it("命中带以内为真、以外为假（不要求指针落在 1px 线上）", () => {
        expect(hitTestSashBand({x: 100, y: 50}, rect(99.5, 0, 100.5, 200), 5)).toBe(true);
        expect(hitTestSashBand({x: 104, y: 50}, rect(99.5, 0, 100.5, 200), 5)).toBe(true);
        expect(hitTestSashBand({x: 106, y: 50}, rect(99.5, 0, 100.5, 200), 5)).toBe(false);
        // 超出线段范围（指针在线的延长线上）不算命中
        expect(hitTestSashBand({x: 100, y: 260}, rect(99.5, 0, 100.5, 200), 5)).toBe(false);
    });

    it("同一轴只选中最近的一条，最多一条竖线加一条横线", () => {
        const targets = [vertical("a", 100), vertical("b", 103), horizontal("c", 40)];
        const hits = collectSashHits({x: 101, y: 40}, targets, "fine");
        expect(hits.map((hit) => hit.branchId)).toEqual(["a", "c"]);
    });

    it("T/十字两根都在命中带内时同时可选", () => {
        const targets = [vertical("v", 100, 0, 200), horizontal("h", 100, 0, 200)];
        const hits = collectSashHits({x: 101, y: 99}, targets, "fine");
        expect(hits.map((hit) => hit.branchId).sort()).toEqual(["h", "v"]);
    });

    it("离开线段范围的方向不命中；两个轴都在带内时一起可选", () => {
        const targets = [vertical("v", 100, 0, 50), horizontal("h", 60, 0, 50)];
        expect(collectSashHits({x: 100, y: 300}, targets, "fine")).toEqual([]);
        expect(collectSashHits({x: 70, y: 61}, targets, "fine")).toEqual([]);
        expect(collectSashHits({x: 52, y: 12}, targets, "fine")).toEqual([]);
        const near = collectSashHits({x: 100, y: 50}, [vertical("v", 100, 0, 400), horizontal("h", 50, 0, 400)], "fine");
        expect(near.map((hit) => hit.branchId).sort()).toEqual(["h", "v"]);
    });

    it("禁用或零占用的分隔线不进入候选", () => {
        const disabled = {...vertical("disabled", 100), enabled: false};
        expect(collectSashHits({x: 100, y: 50}, [disabled], "fine")).toEqual([]);
        expect(collectSashHits({x: 100, y: 50}, [{...disabled, enabled: true}], "fine")).toHaveLength(1);
    });

    it("粗指针用更宽的命中带，精细指针不误判", () => {
        const targets = [vertical("v", 100)];
        expect(collectSashHits({x: 112, y: 50}, targets, "fine")).toEqual([]);
        expect(collectSashHits({x: 112, y: 50}, targets, "coarse")).toHaveLength(1);
    });

    it("重合时更内层的实例优先，同深度按稳定顺序", () => {
        const outer = {...vertical("outer", 100), depth: 0, order: 0};
        const inner = {...vertical("inner", 100), depth: 1, order: 1};
        expect(collectSashHits({x: 100, y: 50}, [outer, inner], "fine").map((hit) => hit.branchId)).toEqual(["inner"]);
        const first = {...vertical("first", 100), order: 0};
        const second = {...vertical("second", 100), order: 1};
        expect(collectSashHits({x: 100, y: 50}, [second, first], "fine").map((hit) => hit.branchId)).toEqual(["first"]);
    });
});
