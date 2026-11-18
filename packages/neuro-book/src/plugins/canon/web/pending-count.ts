/**
 * 状态栏“待处理 N”与公开状态 `nbook.canon/hasPending`（docs/specs/canon/author-ui.md 输出 25）：N 是缺省位置、实际模式下
 * “待处理”一组的条数。读 `pending` 的第一页（一条）取各组的总数；位置与模式都不传，用内核的缺省，待处理视图同样不传，所以
 * 两处的数一样。状态栏一直在，这个读取随窗口一直占着，窗口停止时释放。
 */

import {computed} from "vue";
import type {ComputedRef} from "vue";

import type {CanonWorld} from "./world";

export interface PendingCount {
    /** 世界还没读到、读失败过且从没读到时为 null。 */
    readonly count: ComputedRef<number | null>;
    release(): void;
}

export function createPendingCount(world: CanonWorld | null): PendingCount {
    if (world === null) return {count: computed(() => null), release: () => undefined};
    const handle = world.list("pending", {group: "pending"}, 1);
    return {
        count: computed(() => handle.state.value.data?.counts.pending ?? null),
        release: () => handle.release(),
    };
}
