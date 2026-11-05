/**
 * 渲染序列与 DOM id（docs/specs/ui/nested-grid.md 的“按矩形摆放”“读屏顺序”）：叶与分隔线按什么次序进 DOM。
 *
 * 序列由上一轮的算出来（`stableOrder`：还在的保持相对次序，新的紧接在树序的前一项之后），所以要记状态；并且必须在 `computed` 里
 * 同步算，不能放进 watch：外壳在下一个 tick 就按 `data-leaf-content` 找 Teleport 的目标，新叶的外框必须在同一轮渲染里出来。
 * `computed` 只在依赖变了才重算，每轮只算一次，所以“上一轮”不会漂移；不要在它之外再读 `renderedKeys`。
 */

import {computed} from "vue";
import type {ComputedRef, Ref} from "vue";

import {stableOrder} from "../grid-motion";
import type {GridPlacement, GridPlacementItem} from "../grid-rects";

export interface RenderOrder {
    readonly items: ComputedRef<ReadonlyArray<GridPlacementItem<unknown>>>;
    /** DOM 序与树序不一致（叶换了位置）：Tab 由布局层接管，读屏顺序靠 `aria-owns`。一致时全是浏览器的原生行为。 */
    readonly outOfOrder: ComputedRef<boolean>;
    readonly ariaOwns: ComputedRef<string | undefined>;
    /** 叶外框与分隔线的 DOM id：节点 id 可以含空格，`aria-owns`、`aria-controls` 按空白切分，所以用不透明的串。 */
    domIdOf(key: string): string;
}

export function useRenderOrder(placement: Readonly<Ref<GridPlacement<unknown> | null>>, instanceId: string): RenderOrder {
    let renderedKeys: string[] = [];
    const domIds = new Map<string, string>();
    let nextDomId = 0;

    function domIdOf(key: string): string {
        let id = domIds.get(key);
        if (id === undefined) {
            nextDomId += 1;
            id = `${instanceId}-${nextDomId}`;
            domIds.set(key, id);
        }
        return id;
    }

    const items = computed<ReadonlyArray<GridPlacementItem<unknown>>>(() => {
        const tree = placement.value?.items ?? [];
        const byKey = new Map(tree.map((item) => [item.key, item]));
        renderedKeys = stableOrder(renderedKeys, tree.map((item) => item.key));
        // 不再用的 id 清掉：编辑组反复开关时不让表只增不减。
        for (const key of domIds.keys()) {
            if (!byKey.has(key)) domIds.delete(key);
        }
        return renderedKeys.map((key) => byKey.get(key) as GridPlacementItem<unknown>);
    });

    const outOfOrder = computed(() => {
        const tree = placement.value?.items ?? [];
        return items.value.some((item, index) => item.key !== tree[index]?.key);
    });
    const ariaOwns = computed(() => (outOfOrder.value ? (placement.value?.items ?? []).map((item) => domIdOf(item.key)).join(" ") : undefined));

    return {items, outOfOrder, ariaOwns, domIdOf};
}
