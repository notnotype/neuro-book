/**
 * 拿起的内容项（`lifted`）不能卸载：宿主的预览常把它从 `contents` 里摘掉（来源收起），这时沿用拿起那一刻的那一项（叶是来源原来的叶、不活动；
 * 之后的预览把它摆到别的叶上也不改记下的这一项：那块叶可能已经不在了），
 * 实例留着，矩形照旧由 `placeLifted` 写；`lifted` 变回 null 之后按新的 `contents` 处理（Spec `ui/nested-grid` 的 `lifted`）。
 *
 * 返回的 computed **在读取时更新**“上一轮的 `contents`”与记下的那一项，所以只能有一个读者（`NestedGrid` 交给 `useContentLayer` 的那一路），
 * 且每轮刷新只读一次：多一个读者或读两次，上一轮的记录就被本轮覆盖，拿起项的留住就丢了。要记上一轮的 `contents`：
 * 拿起和摘掉常在同一个同步段里，第一次读到 `lifted` 时这一轮已经没有它了。
 * 它不并进 `useContentLayer` 的 `placements`：那个 computed 还依赖几何与离开项，“上一轮”的含义会跟着变。
 */
import {computed, type ComputedRef} from "vue";

import type {GridContentInput} from "../grid-rects";

export function useHeldLifted(options: {
    contents: () => ReadonlyArray<GridContentInput>;
    lifted: () => {readonly key: string} | null | undefined;
}): ComputedRef<ReadonlyArray<GridContentInput>> {
    let previousContents: ReadonlyArray<GridContentInput> = [];
    let heldLifted: GridContentInput | null = null;
    return computed<ReadonlyArray<GridContentInput>>(() => {
        const items = options.contents();
        const lifted = options.lifted();
        const before = previousContents;
        previousContents = items;
        if (lifted == null) {
            heldLifted = null;
            return items;
        }
        const present = items.find((item) => item.key === lifted.key);
        if (present !== undefined) {
            if (heldLifted?.key !== lifted.key) heldLifted = present;
            return items;
        }
        if (heldLifted?.key !== lifted.key) heldLifted = before.find((item) => item.key === lifted.key) ?? null;
        return heldLifted === null ? items : [...items, {...heldLifted, insetTop: 0, active: false}];
    });
}
