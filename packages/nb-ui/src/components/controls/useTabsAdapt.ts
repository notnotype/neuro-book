/**
 * 标签条的宽度适配（`overflow="adapt"`，Tabs.md）：按测量层的实测宽度与标签带的可用宽度求这一档。`Tabs` 与 nb-layout 的 `TabStrip` 共用。
 *
 * 测量层要给三种标记：`data-measure-tab`（完整标题的每个标签，与 `items` 同序）、`data-measure-icon`（只留图标的标签）、`data-measure-more`（“更多”）。
 */
import {nextTick, onBeforeUnmount, onMounted, shallowRef, watch} from "vue";
import type {Ref, ShallowRef} from "vue";

import {adaptTabs} from "./tabs-adapt";
import type {TabsAdaptState} from "./tabs-adapt";

export interface TabsAdaptOptions {
    enabled(): boolean;
    items(): ReadonlyArray<{readonly value: string; readonly hasIcon: boolean}>;
    selected(): string;
    maxItemWidth(): number;
    /** 测量层要重新渲染的东西（标签、“更多”的文字、尺寸）：变了之后等它渲染完再量。 */
    remeasureOn(): unknown;
    readonly root: Readonly<Ref<HTMLElement | null>>;
    readonly layer: Readonly<Ref<HTMLElement | null>>;
    readonly list: Readonly<Ref<HTMLElement | null>>;
}

export function useTabsAdapt(options: TabsAdaptOptions): Readonly<ShallowRef<TabsAdaptState>> {
    const adapt = shallowRef<TabsAdaptState>({level: 0, hidden: new Set()});

    /** 量不到（还没挂上、不可见）时保持原状。 */
    function measure(): void {
        const root = options.root.value;
        const layer = options.layer.value;
        const list = options.list.value;
        if (!options.enabled() || root === null || layer === null || list === null) return;
        const items = options.items();
        const natural = Array.from(layer.querySelectorAll<HTMLElement>("[data-measure-tab]"), (element) => element.getBoundingClientRect().width);
        const available = root.clientWidth;
        if (available <= 0 || natural.length !== items.length) return;
        adapt.value = adaptTabs({
            items,
            natural,
            iconOnly: layer.querySelector<HTMLElement>("[data-measure-icon]")?.getBoundingClientRect().width ?? 0,
            more: layer.querySelector<HTMLElement>("[data-measure-more]")?.getBoundingClientRect().width ?? 0,
            gap: Number.parseFloat(getComputedStyle(list).columnGap) || 0,
            available,
            maxItemWidth: options.maxItemWidth(),
            selected: options.selected(),
        }, adapt.value);
    }

    let observer: ResizeObserver | null = null;
    onMounted(() => {
        if (typeof ResizeObserver === "function") observer = new ResizeObserver(() => measure());
        watch([options.root, options.layer], ([root, layer], _previous, onCleanup) => {
            if (observer === null || root === null || layer === null) return;
            observer.observe(root);
            observer.observe(layer);
            onCleanup(() => observer?.disconnect());
            measure();
        }, {immediate: true});
    });
    onBeforeUnmount(() => observer?.disconnect());
    // 选中项变了：在渲染之前重排（被收起来的那个要换出来），键盘移动后的焦点才能落到它上面。
    watch(options.selected, () => measure());
    watch(options.remeasureOn, () => void nextTick(measure));
    return adapt;
}
