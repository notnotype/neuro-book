<script setup lang="ts">
import {computed, useTemplateRef, watch} from "vue";
import {PopoverContent, PopoverPortal, PopoverRoot} from "reka-ui";

import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {toPopoverReference} from "./popover-anchor";
import type {PopoverReference} from "./popover-anchor";

/**
 * 贴在锚点旁边、不抢焦点的浮层（行为见同名 `.md`）。定位与 `SuggestionMenu` 同一套：虚拟锚点逐帧更新，所以选区的矩形变了
 * 也跟得上。reka 不公开更底层的 Popper 原语，Popover 写死的 `role="dialog"` 等三个属性在挂上后去掉。
 */
const props = withDefaults(defineProps<{
    open: boolean;
    anchor: Element | PopoverReference | null;
    side?: "top" | "bottom";
    sideOffset?: number;
}>(), {
    side: "top",
    sideOffset: 8,
});

defineSlots<{
    default?: () => unknown;
}>();

const {zIndex} = usePopoverLayer();
const reference = computed(() => toPopoverReference(props.anchor));
const visible = computed(() => props.open && reference.value !== undefined);

const content = useTemplateRef<HTMLElement>("content");
watch(content, (element) => {
    for (const name of ["role", "aria-labelledby", "tabindex"]) element?.closest("[data-anchored-popover]")?.removeAttribute(name);
}, {flush: "post"});

const FOCUSABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
function onMousedown(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest(FOCUSABLE) !== null) return;
    event.preventDefault();
}

defineExpose({
    /** 节点是否在浮层里（浮层传送出去了，不在宿主的 DOM 里）。 */
    contains(node: Node | null): boolean {
        const surface = content.value?.closest("[data-anchored-popover]");
        return node !== null && surface !== null && surface !== undefined && surface.contains(node);
    },
});
</script>

<template>
    <PopoverRoot :open="visible" :modal="false">
        <PopoverPortal>
            <PopoverContent
                :reference="reference"
                :side="props.side"
                align="center"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :collision-padding="8"
                update-position-strategy="always"
                class="nb-ui-popover-surface"
                :style="{zIndex}"
                data-anchored-popover
                @open-auto-focus.prevent
                @close-auto-focus.prevent
                @escape-key-down.prevent
                @pointer-down-outside.prevent
                @focus-outside.prevent
                @interact-outside.prevent
                v-bind="{onMousedown}"
            >
                <div ref="content" class="contents">
                    <slot />
                </div>
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
