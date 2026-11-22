/**
 * Grid 的焦点接线（docs/specs/ui/nested-grid.md 的“Tab 顺序”“移动焦点”）：把 `grid-focus.ts` 的走法接到一个 grid 根上。DOM 序与树序
 * 不一致时才接管 Tab，走出最后一项时把焦点放到边上的哨兵，由浏览器从那里移到 grid 外面，不按 DOM 序回到里面的别的块。
 */

import {onBeforeUnmount, onMounted, ref} from "vue";
import type {Ref} from "vue";

import type {GridLayerItem} from "../grid-rects";
import {entryFocusTarget, moveTab, moveTabFromPress, noteFocus, registerGridFocus} from "./grid-focus";
import type {GridFocusItems, GridFocusStop} from "./grid-focus";
import type {RenderOrder} from "./useRenderOrder";

export function useGridFocus(options: {readonly root: Readonly<Ref<HTMLElement | null>>; readonly layers: Readonly<Ref<ReadonlyArray<GridLayerItem<unknown>>>>; readonly order: RenderOrder}) {
    const {root, layers, order} = options;
    const enterSentinel = ref<HTMLElement | null>(null);
    const exitSentinel = ref<HTMLElement | null>(null);

    function elementOf(key: string): HTMLElement | null {
        // 经 `getRootNode` 取：grid 可能在 Shadow DOM 里。
        return (root.value?.getRootNode() as Document | ShadowRoot | undefined)?.getElementById(order.domIdOf(key)) ?? null;
    }

    const scope: GridFocusItems = {
        items: () => {
            const stops: GridFocusStop[] = [];
            for (const item of layers.value) {
                if (item.kind === "content") {
                    // 活动的内容和它的叶是一站。不活动的停放着，不进来；找不到叶的也是。
                    const stop = stops.at(-1);
                    const element = item.active && item.rect !== null ? elementOf(item.key) : null;
                    if (element !== null && stop !== undefined && stop.leaf) stops[stops.length - 1] = {...stop, elements: [...stop.elements, element]};
                    continue;
                }
                const element = elementOf(item.key);
                if (element !== null) stops.push({elements: [element], leaf: item.kind === "leaf"});
            }
            return stops;
        },
    };

    let release: (() => void) | null = null;
    /** 这一下焦点变化是 Tab 引起的吗：程序 `focus()` 与点击也会从外面进来，那些不能改落点。 */
    let tabPending: 1 | -1 | null = null;
    let tabTimer: ReturnType<typeof setTimeout> | null = null;
    /** 最近一次按下的元素：按在这个 grid 外面时为 null。 */
    let pressed: Element | null = null;

    /**
     * 在 `document` 的冒泡阶段接：别的处理器已经跑完。它们在 keydown 里把焦点还给触发器时，那次 `focusin` 先于这里发生，不会被当成 Tab。`preventDefault` 了的不算。
     * 浏览器的焦点移动是 keydown 的默认动作，在同一个任务里，所以用定时器在任务结束后清：Tab 把焦点送出页面时收不到 keyup。
     */
    const onDocumentKeydown = (event: KeyboardEvent): void => {
        if (event.key !== "Tab" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
        const direction = event.shiftKey ? -1 : 1;
        const host = root.value?.getRootNode() as Document | ShadowRoot | undefined;
        const active = host?.activeElement ?? null;
        const owner = root.value?.ownerDocument;
        if (order.outOfOrder.value && pressed !== null && (active === null || active === owner?.body || active === owner?.documentElement)) {
            if (moveTabFromPress(scope, pressed, direction)) event.preventDefault();
            pressed = null;
            return;
        }
        tabPending = direction;
        if (tabTimer !== null) clearTimeout(tabTimer);
        tabTimer = setTimeout(() => {
            tabPending = null;
            tabTimer = null;
        }, 0);
    };
    const onDocumentPointerdown = (event: PointerEvent): void => {
        pressed = event.target instanceof Element && root.value?.contains(event.target) === true ? event.target : null;
    };
    onMounted(() => {
        if (root.value === null) return;
        release = registerGridFocus(root.value, scope);
        const owner = root.value.ownerDocument;
        owner.addEventListener("keydown", onDocumentKeydown);
        owner.addEventListener("pointerdown", onDocumentPointerdown, true);
    });
    onBeforeUnmount(() => {
        release?.();
        if (tabTimer !== null) clearTimeout(tabTimer);
        const owner = root.value?.ownerDocument;
        owner?.removeEventListener("keydown", onDocumentKeydown);
        owner?.removeEventListener("pointerdown", onDocumentPointerdown, true);
    });

    return {
        enterSentinel,
        exitSentinel,
        onKeydown(event: KeyboardEvent): void {
            if (event.key !== "Tab" || !order.outOfOrder.value) return;
            if (moveTab(event, scope) !== "leave") return;
            (event.shiftKey ? enterSentinel.value : exitSentinel.value)?.focus();
        },
        onFocusin(event: FocusEvent): void {
            const direction = tabPending;
            tabPending = null;
            pressed = null;
            const from = event.relatedTarget;
            const entering = !(from instanceof Node) || root.value?.contains(from) !== true;
            // DOM 序与树序不一致时，浏览器按 DOM 序选了进来的第一个元素，这里改成树序的首或尾。
            if (direction !== null && entering && order.outOfOrder.value) {
                const target = entryFocusTarget(scope, direction);
                if (target !== null && target !== event.target) {
                    target.focus();
                    return;
                }
            }
            noteFocus(scope, event.target);
        },
    };
}
