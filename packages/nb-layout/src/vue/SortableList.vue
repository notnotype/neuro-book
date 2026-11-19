<script setup lang="ts">
/**
 * 分组的竖排列表，能拖动或用键盘排序、可以跨组（docs/specs/ui/sortable-list.md，见同名 .md）。手势、判定、预览与播报都在
 * `useSortable`；这里只按预览摆放：分区头、行与空分区的占位平铺在同一个 `TransitionGroup` 里，跨组换序时元素不重建，分区头跟着滑。
 */
import {computed, ref, useId} from "vue";
import type {VNodeChild} from "vue";

import type {SortableMove} from "./useSortable";
import {useSortable} from "./useSortable";
import {useLayoutText} from "./layout-text";

const props = withDefaults(defineProps<{
    /** 分区与它们的项（按呈现顺序）。受控：放下后由调用方改了再交回来。 */
    sections: readonly {readonly id: string; readonly title: string; readonly keys: readonly string[]}[];
    /** 一项的名字：把手的可访问名与播报用。 */
    label: (key: string) => string;
    disabled?: boolean;
    /**
     * 放下且位置变了才调，一场至多一次；返回 Promise 时，放下后的次序留到它 settle。是属性不是事件（要拿到返回值），模板里照常写
     * `@move`：Vue 把它编成 `onMove` 这个键。
     */
    onMove?: (move: SortableMove) => void | PromiseLike<unknown>;
}>(), {disabled: false, onMove: undefined});

defineSlots<{
    /** 一行除把手以外的内容。 */
    item(props: {itemKey: string; held: boolean; section: string}): VNodeChild;
    /** 分区头的内容；缺省写标题。 */
    head?(props: {section: string; title: string}): VNodeChild;
}>();

const t = useLayoutText();
const root = ref<HTMLElement | null>(null);
const instance = useId();
const titleOf = (id: string): string => props.sections.find((section) => section.id === id)?.title ?? id;
const headId = (section: string): string => `${instance}-head-${section}`;

const {preview, held, announcement} = useSortable({
    root,
    sections: () => props.sections.map((section) => ({id: section.id, keys: section.keys})),
    disabled: () => props.disabled,
    label: (key) => props.label(key),
    sectionLabel: titleOf,
    onMove: (move) => props.onMove?.(move),
});

type Entry =
    | {readonly kind: "head"; readonly key: string; readonly section: string}
    | {readonly kind: "placeholder"; readonly key: string; readonly section: string}
    | {readonly kind: "item"; readonly key: string; readonly section: string; readonly itemKey: string};

const entries = computed<Entry[]>(() => preview.value.flatMap((section): Entry[] => [
    {kind: "head", key: `head:${section.id}`, section: section.id},
    ...(section.keys.length === 0
        ? [{kind: "placeholder", key: `empty:${section.id}`, section: section.id} as const]
        : section.keys.map((itemKey) => ({kind: "item", key: `item:${itemKey}`, section: section.id, itemKey} as const))),
]));
</script>

<template>
    <div ref="root" class="nb-sortable-list" :class="{'is-dragging': held !== null, 'is-disabled': props.disabled}" data-sortable-list>
        <TransitionGroup tag="div" class="nb-sortable-list__flow" move-class="nb-sortable-list__moving">
            <div
                v-for="entry in entries"
                :key="entry.key"
                :class="{
                    'nb-sortable-list__head': entry.kind === 'head',
                    'nb-sortable-list__placeholder': entry.kind === 'placeholder',
                    'nb-sortable-list__row': entry.kind === 'item',
                    'is-held': entry.kind === 'item' && held === entry.itemKey,
                }"
                :data-sortable-section="entry.section"
                :data-sortable-head="entry.kind === 'head' ? '' : undefined"
                :data-sortable-placeholder="entry.kind === 'placeholder' ? '' : undefined"
                :data-sortable-key="entry.kind === 'item' ? entry.itemKey : undefined"
                :id="entry.kind === 'head' ? headId(entry.section) : undefined"
            >
                <template v-if="entry.kind === 'head'">
                    <slot name="head" :section="entry.section" :title="titleOf(entry.section)">
                        <span class="nb-sortable-list__title" role="heading" aria-level="4">{{ titleOf(entry.section) }}</span>
                    </slot>
                </template>
                <template v-else-if="entry.kind === 'placeholder'">{{ t("sortable.placeholder") }}</template>
                <template v-else>
                    <span class="nb-sortable-list__handle-box">
                        <button
                            type="button"
                            class="nb-sortable-list__handle nb-layout-focus-ring"
                            :aria-label="t('sortable.handle', {name: props.label(entry.itemKey)})"
                            :aria-describedby="headId(entry.section)"
                            :title="t('sortable.hint')"
                            :disabled="props.disabled"
                            data-sortable-handle
                        >
                            <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true">
                                <circle cx="2" cy="2" r="1.1" /><circle cx="6" cy="2" r="1.1" />
                                <circle cx="2" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" />
                                <circle cx="2" cy="10" r="1.1" /><circle cx="6" cy="10" r="1.1" />
                            </svg>
                        </button>
                    </span>
                    <div class="nb-sortable-list__content">
                        <slot name="item" :item-key="entry.itemKey" :held="held === entry.itemKey" :section="entry.section" />
                    </div>
                </template>
            </div>
        </TransitionGroup>
        <span class="nb-sortable-list__status" role="status">{{ announcement }}</span>
    </div>
</template>

<style scoped>
/* 定位元素：行、分区头与占位的 offsetParent 都是它，判定按相对它的布局量（useSortable 的约定）。 */
.nb-sortable-list {
    position: relative;
}

.nb-sortable-list__flow {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.nb-sortable-list__head {
    padding: 0 4px 2px;
    color: var(--nb-layout-text-muted, GrayText);
    font-size: var(--nb-layout-text-xs, 12px);
    font-weight: 600;
}

/* 第二个起的分区头与上一组隔开。 */
.nb-sortable-list__head:not(:first-child) {
    padding-top: 14px;
}

.nb-sortable-list__placeholder {
    padding: 6px 10px;
    border-radius: var(--nb-layout-radius-control, 6px);
    color: var(--nb-layout-text-muted, GrayText);
    font-size: var(--nb-layout-text-xs, 12px);
}

.nb-sortable-list__row {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--nb-layout-radius-control, 6px);
    cursor: grab;
    user-select: none;
    transition: background-color var(--nb-layout-motion-fast, 120ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
}

.nb-sortable-list__row:hover {
    background: var(--nb-layout-bg-hover, color-mix(in srgb, CanvasText 6%, transparent));
}

.nb-sortable-list.is-disabled .nb-sortable-list__row {
    cursor: default;
}

/* 拖动中别的行不显示悬停底；拿起的行底不透明、盖在邻居上，不参与换位过渡（过渡的 transform 会让它先滑回空位再跳到指针下）。 */
.nb-sortable-list.is-dragging .nb-sortable-list__row:not(.is-held):hover {
    background: transparent;
}

.nb-sortable-list.is-dragging,
.nb-sortable-list.is-dragging .nb-sortable-list__row {
    cursor: grabbing;
}

.nb-sortable-list__row.is-held {
    z-index: 1;
    background: var(--nb-layout-bg-panel, Canvas);
    box-shadow: var(--nb-layout-sortable-held-shadow, 0 0 0 1px var(--nb-layout-divider, color-mix(in srgb, CanvasText 15%, transparent)), 0 4px 12px color-mix(in srgb, var(--nb-layout-shadow-color, #000) 14%, transparent));
    transform: none !important;
}

.nb-sortable-list__moving {
    transition: transform var(--nb-layout-motion-move, 280ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
}

/* 把手对齐行内容的第一行：盒子高 `--nb-layout-sortable-first-line`（缺省是行自己的 1lh），宿主的第一行行高不同时设它。 */
.nb-sortable-list__handle-box {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    height: var(--nb-layout-sortable-first-line, 1lh);
}

.nb-sortable-list__handle {
    display: inline-flex;
    width: 14px;
    height: 20px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--nb-layout-text-muted, GrayText);
    fill: currentColor;
    cursor: grab;
    /* 触摸只从把手起拖：行的别处留给页面滚动。 */
    touch-action: none;
}

.nb-sortable-list__handle:disabled {
    cursor: default;
    opacity: 0.5;
}

.nb-sortable-list__content {
    min-width: 0;
    flex: 1 1 auto;
}

.nb-sortable-list__status {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
