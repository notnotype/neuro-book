/**
 * 交换（docs/specs/ui/nested-grid.md 输出 61，时序见“状态与转换”的“时序与寿命”第 4 条）在 `NestedGrid` 里的呈现：哪些项在带上、各是换上来的还是离开的、
 * 静止的底、裁切窗，以及宿主给的交换只在 `token` 变了的那一轮刷新里有效的“记下与取用”。
 *
 * 这里只放函数与 computed：监听 `props.swap` 的 watcher 仍在 `NestedGrid` 里创建（`flush: "sync"`，位置在 `motion` 之后、布局变化的 watcher 之前），
 * 它调 `offerSwap`；取用 `takeSwap` 在布局变化的 watcher 里。把 watcher 搬出去会改变它们与 `motion.update` 的先后。
 */
import {computed, nextTick, type Ref} from "vue";

import type {GridLayerItem, GridRect} from "../grid-rects";
import {swapSides, swapWindowClip, type GridSwap, type GridSwapBand} from "../grid-swap";
import {gridRectStyle} from "./useContentLayer";

export function useGridSwap(band: Readonly<Ref<GridSwapBand | null>>) {
    /**
     * 交换进行中每一项在带上是换上来的还是离开的（`data-swap`）。叶与内容项按它们的叶属于哪一组认，所以交换开始之后才挂上来的内容项也裁在窗里；
     * 分隔线按组里记下的键认。
     */
    const swapSide = computed(() => {
        const current = band.value;
        const leaves = new Map<string, "in" | "out">();
        current?.groups.forEach((group, index) => {
            for (const leaf of group.leaves) leaves.set(leaf, index === current.target ? "in" : "out");
        });
        return {leaves, keys: swapSides(current)};
    });
    function swapSideOf(item: GridLayerItem<unknown>): "in" | "out" | undefined {
        if (item.kind === "leaf") return swapSide.value.leaves.get(item.node.id);
        if (item.kind === "content") return swapSide.value.leaves.get(item.leaf);
        return swapSide.value.keys.get(item.key);
    }
    /** 静止的底（`swap-backdrop`）：交换进行中才有。 */
    const swapBackdrop = computed(() => {
        const current = band.value;
        if (current === null) return null;
        const {outer, window} = current;
        const inset = [window.y - outer.y, outer.x + outer.width - (window.x + window.width), outer.y + outer.height - (window.y + window.height), window.x - outer.x] as const;
        return {style: gridRectStyle(outer), inset, radius: current.radius};
    });
    /** 这一刻在交换里的叶（节点 id，含离开的）：过渡结束就空了。 */
    const swappingLeaves = computed<ReadonlySet<string>>(() => new Set(swapSide.value.leaves.keys()));
    /** 带上的项按裁切窗裁：窗在网格里不动，每一帧的裁切跟着元素此刻的矩形，和 `left`/`top` 同一段过渡。 */
    function swapClipStyle(item: GridLayerItem<unknown>, rect: GridRect): Record<string, string> {
        const current = band.value;
        return current === null || swapSideOf(item) === undefined ? {} : {clipPath: swapWindowClip(current, rect)};
    }

    /**
     * 宿主给的交换只在 `token` 变了的那一轮刷新里有效：在属性写进来的那一刻（同步）记下，布局变化的 watcher 用掉它；这一轮没有布局变化
     * （点了没有改变布局、提交被拒）时 `nextTick` 作废，不留给后面不相干的布局变化。宿主在同一个同步段里给交换、提交布局，两者在同一轮刷新里到。
     */
    let freshSwap: GridSwap | null = null;
    /** `token` 变了时调：记下宿主此刻给的交换（可能是 `null`，等于清掉）。 */
    function offerSwap(swap: GridSwap | null): void {
        freshSwap = swap;
        if (swap === null) return;
        void nextTick(() => {
            if (freshSwap === swap) freshSwap = null;
        });
    }
    function takeSwap(): GridSwap | null {
        const swap = freshSwap;
        freshSwap = null;
        return swap;
    }

    return {swapSide, swapSideOf, swapBackdrop, swappingLeaves, swapClipStyle, offerSwap, takeSwap};
}
