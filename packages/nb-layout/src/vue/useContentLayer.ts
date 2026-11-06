/**
 * 内容层（docs/specs/ui/nested-grid.md 的“内容层”）：内容项的矩形、停放与尺寸。每项是外层（按矩形摆放、裁切）加内层（尺寸规则同叶的内容），`NestedGrid` 只管把它们画出来。
 *
 * 停放的判定和 `useLeafParking` 是一件事的两层：叶降到零由它判，这里只加内容自己的情况（不活动、叶找不到、面板收成标题行时叶还有高度而内容是零）。
 */

import {computed, shallowRef} from "vue";
import type {Ref} from "vue";

import {placeContents} from "../grid-rects";
import type {GridContentInput, GridContentPlacement, GridPlacementItem, GridRect} from "../grid-rects";
import type {GridExtent} from "../grid-types";

export function gridRectStyle(rect: GridRect): Record<string, string> {
    return {transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.width}px`, height: `${rect.height}px`};
}

const hasSize = (rect: GridRect): boolean => rect.width > 0 && rect.height > 0;

export function useContentLayer(options: {
    readonly contents: () => ReadonlyArray<GridContentInput>;
    readonly items: () => ReadonlyArray<GridPlacementItem<unknown>>;
    readonly dpr: Readonly<Ref<number>>;
    readonly parkedLeaves: Readonly<Ref<ReadonlySet<string>>>;
    readonly growing: Readonly<Ref<ReadonlyMap<string, GridRect>>>;
    readonly following: Readonly<Ref<ReadonlySet<string>>>;
    /** 手势预览进行中：预览不会把内容停放，往零拖时要等落账。 */
    readonly previewing: () => boolean;
    /** 量到容器了吗。第一帧还没量到时矩形都是零，这不算停放：那时加 `inert` 会让 `onMounted` 里的 `focus()` 静默失败。 */
    readonly measured: () => boolean;
    /** 这个内容项此刻含焦点吗。 */
    readonly holdsFocus: (key: string) => boolean;
    readonly onParked: (contentKey: string) => void;
}) {
    const placements = computed(() => placeContents(options.items(), options.contents(), options.dpr.value));
    /** 最后的矩形与非零尺寸：停放时保持，重新有尺寸时不用重排；叶暂时找不到时外层也留在原处。 */
    const memory = new Map<string, {rect: GridRect; size: GridExtent}>();
    const zero = shallowRef<ReadonlySet<string>>(new Set());
    const parkedBefore = new Set<string>();

    function isParked(item: GridContentPlacement): boolean {
        return !item.active || item.rect === null || options.parkedLeaves.value.has(item.leaf) || zero.value.has(item.key);
    }

    /** 布局变了（渲染之前调，DOM 还没变，焦点还在里面）。 */
    function update(): void {
        const isZero = (item: GridContentPlacement): boolean => item.rect !== null && !hasSize(item.rect) && (memory.has(item.key) || options.measured());
        // 从零往外拉时内容在拖动中就要出现，所以预览里只会变少。
        zero.value = new Set(placements.value.filter((item) => isZero(item) && (!options.previewing() || zero.value.has(item.key))).map((item) => item.key));
        const alive = new Set<string>();
        for (const item of placements.value) {
            alive.add(item.key);
            const parked = isParked(item);
            if (parked && !parkedBefore.has(item.key)) {
                parkedBefore.add(item.key);
                if (options.holdsFocus(item.key)) options.onParked(item.contentKey);
            } else if (!parked) {
                parkedBefore.delete(item.key);
            }
            // 没活动过的标签也记一次：它藏着的时候不跟着实时尺寸重排。
            if (item.rect !== null && hasSize(item.rect) && (!parked || !memory.has(item.key))) memory.set(item.key, {rect: item.rect, size: {width: item.rect.width, height: item.rect.height}});
        }
        for (const key of memory.keys()) {
            if (!alive.has(key)) memory.delete(key);
        }
        for (const key of parkedBefore) {
            if (!alive.has(key)) parkedBefore.delete(key);
        }
    }

    function frameStyle(item: GridContentPlacement): Record<string, string> {
        const rect = options.growing.value.get(item.key) ?? item.rect ?? memory.get(item.key)?.rect ?? {x: 0, y: 0, width: 0, height: 0};
        return {...gridRectStyle(rect), ...(isParked(item) ? {visibility: "hidden"} : {})};
    }

    /** 跟外框的是 100%；否则是最终尺寸，停放时是最后的非零尺寸。 */
    function bodyStyle(item: GridContentPlacement): Record<string, string> {
        if (options.following.value.has(item.key)) return {width: "100%", height: "100%"};
        const rect = item.rect;
        const size = !isParked(item) && rect !== null && hasSize(rect) ? rect : (memory.get(item.key)?.size ?? rect ?? {width: 0, height: 0});
        return {width: `${size.width}px`, height: `${size.height}px`};
    }

    return {placements, isParked, update, frameStyle, bodyStyle};
}
