/**
 * 待处理视图要写出剧情变更、核对点的文字与位置、决策的结论（docs/specs/canon/author-ui.md 输出 23）：每个用到的对象读一次
 * `object`，世界变了跟着重读。一页最多读 `NAMED_ENTRIES_MAX` 个（同 `entry-heads.ts`），排在前面的先读：调用方把选中那一条的
 * 详情要的放在最前，再放各行要的；超出的那些行只写种类。
 */

import {computed} from "vue";

import type {ObjectRef} from "@notnotype/nb-canon/schema";

import {NAMED_ENTRIES_MAX} from "./entry-heads";
import {useWorldReads} from "./use-reads";
import type {CanonWorld} from "./world";

/** 读到的对象；没读、还没读到或已不在时为 undefined。 */
export type ObjectHeads = (ref: ObjectRef) => unknown;

const keyOf = (ref: ObjectRef): string => `${ref.kind}:${ref.id}`;

export function useObjectHeads(world: CanonWorld, refs: () => readonly ObjectRef[]): ObjectHeads {
    const inputs = computed(() => {
        const result = new Map<string, {ref: ObjectRef}>();
        for (const ref of refs()) {
            if (result.size >= NAMED_ENTRIES_MAX) break;
            result.set(keyOf(ref), {ref});
        }
        return result;
    });
    const reads = useWorldReads(world, "object", () => inputs.value);
    return (ref) => reads.value.get(keyOf(ref))?.data?.object ?? undefined;
}
