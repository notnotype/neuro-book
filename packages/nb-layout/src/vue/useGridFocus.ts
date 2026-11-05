/**
 * Grid 的焦点接线（docs/specs/ui/nested-grid.md 的“Tab 顺序”“移动焦点”）：把 `grid-focus.ts` 的走法接到一个 grid 根上。DOM 序与树序
 * 不一致时才接管 Tab，走出最后一项时把焦点放到边上的哨兵，由浏览器从那里移到 grid 外面，不按 DOM 序回到里面的别的块。
 */

import {onBeforeUnmount, onMounted, ref} from "vue";
import type {Ref} from "vue";

import type {GridPlacement} from "../grid-rects";
import {moveTab, noteFocus, registerGridFocus} from "./grid-focus";
import type {GridFocusItems} from "./grid-focus";
import type {RenderOrder} from "./useRenderOrder";

export function useGridFocus(options: {readonly root: Readonly<Ref<HTMLElement | null>>; readonly placement: Readonly<Ref<GridPlacement<unknown> | null>>; readonly order: RenderOrder}) {
    const {root, placement, order} = options;
    const enterSentinel = ref<HTMLElement | null>(null);
    const exitSentinel = ref<HTMLElement | null>(null);

    const scope: GridFocusItems = {
        items: () => (placement.value?.items ?? []).flatMap((item) => {
            // 经 `getRootNode` 取：grid 可能在 Shadow DOM 里。
            const element = (root.value?.getRootNode() as Document | ShadowRoot | undefined)?.getElementById(order.domIdOf(item.key));
            return element == null ? [] : [{element, leaf: item.kind === "leaf"}];
        }),
    };

    let release: (() => void) | null = null;
    onMounted(() => {
        if (root.value !== null) release = registerGridFocus(root.value, scope);
    });
    onBeforeUnmount(() => release?.());

    return {
        enterSentinel,
        exitSentinel,
        onKeydown(event: KeyboardEvent): void {
            if (event.key !== "Tab" || !order.outOfOrder.value) return;
            if (moveTab(event, scope) !== "leave") return;
            (event.shiftKey ? enterSentinel.value : exitSentinel.value)?.focus();
        },
        onFocusin(event: FocusEvent): void {
            noteFocus(scope, event.target);
        },
    };
}
