/**
 * “待处理”视图（docs/specs/canon/author-ui.md 输出 23）随窗口的状态：选中哪一条、哪几组展开着。视图停放、卸载再挂上时还在。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

export type PendingGroup = "pending" | "hints" | "handled";

export interface PendingViewState {
    /** 选中的那一条的键（`pending.ts` 的 `pendingKey`）；没有选中为 null。 */
    readonly selected: ShallowRef<string | null>;
    /** 下一次读到“待处理”一组时选中它的第一条：第一次打开视图与 `nbook.canon.show-pending` 之后为真。 */
    readonly pickFirst: ShallowRef<boolean>;
    readonly expanded: ShallowRef<readonly PendingGroup[]>;
}

export function pendingViewState(): PendingViewState {
    return {selected: shallowRef(null), pickFirst: shallowRef(true), expanded: shallowRef(["pending"])};
}

/** `nbook.canon.show-pending`：选回“待处理”的第一条（输出 25 的状态栏条目点的就是它）。 */
export function pickFirstPending(state: PendingViewState): void {
    state.pickFirst.value = true;
}
