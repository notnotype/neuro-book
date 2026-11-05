import {describe, expect, it} from "vitest";

import {createGrid} from "../grid";
import {placeGrid} from "../grid-rects";
import type {GridPlacementItem} from "../grid-rects";
import type {GridNodeInput} from "../grid-types";
import {useLeafParking} from "./useLeafParking";

/** 叶的停放（docs/specs/ui/nested-grid.md 的“停放”）：判定不碰布局，直接喂摆放结果。 */

const leaf = (id: string, width: number): GridNodeInput<string> => ({kind: "leaf", id, ref: id, size: {width, height: 0}});

function place(widths: Record<string, number>): GridPlacementItem<unknown>[] {
    const extent = {width: 700, height: 300};
    const root: GridNodeInput<string> = {kind: "branch", id: "root", orientation: "horizontal", children: Object.entries(widths).map(([id, width]) => leaf(id, width))};
    const grid = createGrid<string>(root, {sashSize: 1});
    const layout = grid.layout(extent);
    // 把想要零宽的叶压成零：布局会给最小尺寸，直接改结果。
    const sizes = {...layout.sizes};
    for (const [id, width] of Object.entries(widths)) if (width === 0) sizes[id] = {width: 0, height: 300};
    return [...placeGrid(grid.root()!, {...layout, sizes}, extent, 1).items];
}

const leafOf = (items: GridPlacementItem<unknown>[], id: string) => {
    const found = items.find((item) => item.kind === "leaf" && item.node.id === id);
    if (found?.kind !== "leaf") throw new Error(`没有叶 ${id}`);
    return found;
};

describe("useLeafParking", () => {
    it("曾经有过尺寸、现在是零：停放，内容保持最后的尺寸", () => {
        const parking = useLeafParking();
        parking.update(place({a: 300, b: 300}), false);
        expect(parking.parked.value.size).toBe(0);
        const zeroed = place({a: 300, b: 0});
        parking.update(zeroed, false);
        expect([...parking.parked.value]).toEqual(["b"]);
        expect(parking.contentSize(leafOf(zeroed, "b")).width).toBeGreaterThan(0);
    });

    it("第一帧还没量到尺寸：不算停放（加 inert 会让 onMounted 里的 focus() 静默失败）", () => {
        const parking = useLeafParking();
        parking.update(place({a: 0, b: 0}), false);
        expect(parking.parked.value.size).toBe(0);
    });

    it("预览中拖到零：不停放，落账才停放；拖回来内容不闪", () => {
        const parking = useLeafParking();
        parking.update(place({a: 300, b: 300}), false);
        parking.update(place({a: 300, b: 0}), true);
        expect(parking.parked.value.size).toBe(0);
        parking.update(place({a: 300, b: 0}), false);
        expect([...parking.parked.value]).toEqual(["b"]);
    });

    it("已停放的叶在预览中从零拉出：内容在拖动中就解除停放", () => {
        const parking = useLeafParking();
        parking.update(place({a: 300, b: 300}), false);
        parking.update(place({a: 300, b: 0}), false);
        expect(parking.parked.value.size).toBe(1);
        parking.update(place({a: 200, b: 100}), true);
        expect(parking.parked.value.size).toBe(0);
    });

    it("叶关闭后清掉它的尺寸记录", () => {
        const parking = useLeafParking();
        parking.update(place({a: 300, b: 300}), false);
        parking.update(place({a: 600}), false);
        const gone = place({a: 300, b: 0});
        expect(parking.contentSize(leafOf(gone, "b")).width).toBe(0);
    });
});
