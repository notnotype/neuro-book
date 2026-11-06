/**
 * 叶的停放（docs/specs/ui/nested-grid.md 的“停放”）：矩形降到零时内容不跟着降，保持最后一个非零尺寸，重新有尺寸时不用重排，滚动也不会
 * 被滚动锚定改写。只有“曾经有过尺寸、现在是零”才算停放：第一帧还没量到不算，那时加 `inert` 会让 `onMounted` 里的 `focus()` 静默失败。
 */

import {shallowRef} from "vue";

import type {GridLeafPlacement, GridPlacementItem} from "../grid-rects";
import type {GridExtent} from "../grid-types";

export function useLeafParking() {
    const parked = shallowRef<ReadonlySet<string>>(new Set());
    const lastSizes = new Map<string, GridExtent>();

    /** 布局变了（渲染之前调）。`previewing` 是手势预览进行中。 */
    function update(items: ReadonlyArray<GridPlacementItem<unknown>>, previewing: boolean): void {
        const alive = new Set<string>();
        const zero = new Set<string>();
        for (const item of items) {
            if (item.kind !== "leaf") continue;
            alive.add(item.node.id);
            if (item.rect.width > 0 && item.rect.height > 0) lastSizes.set(item.node.id, {width: item.rect.width, height: item.rect.height});
            else if (lastSizes.has(item.node.id)) zero.add(item.node.id);
        }
        for (const id of lastSizes.keys()) {
            if (!alive.has(id)) lastSizes.delete(id);
        }
        if (!previewing) {
            parked.value = zero;
            return;
        }
        // 预览不会把内容停放：往零拖时要等落账，拖过阈值又拖回来内容不闪，焦点也不丢。但从零往外拉时内容在拖动中就要出现。
        const still = [...parked.value].filter((id) => zero.has(id));
        if (still.length !== parked.value.size) parked.value = new Set(still);
    }

    /** 内容容器的尺寸：外框的目标矩形；矩形是零时用最后的非零尺寸。 */
    function contentSize(item: GridLeafPlacement<unknown>): GridExtent {
        return item.rect.width > 0 && item.rect.height > 0 ? item.rect : (lastSizes.get(item.node.id) ?? item.rect);
    }

    return {parked, update, contentSize};
}
