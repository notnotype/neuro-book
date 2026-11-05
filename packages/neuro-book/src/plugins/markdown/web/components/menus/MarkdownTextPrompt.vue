<script setup lang="ts">
/** 要一段文字的动作（注音、双语）的输入弹层（同名 .md）。 */
import {AnchoredPopover, Input} from "@notnotype/nb-ui/components";
import {nextTick, ref, useTemplateRef, watch} from "vue";

import type {PopoverAnchor} from "./selection-anchor";

const props = defineProps<{open: boolean; anchor: PopoverAnchor | null; label: string}>();
const emit = defineEmits<{(event: "submit", text: string): void; (event: "cancel"): void; (event: "dismiss"): void}>();

const value = ref("");
const box = useTemplateRef<HTMLElement>("box");
watch(() => props.open, async (open) => {
    if (!open) return;
    value.value = "";
    await nextTick();
    box.value?.querySelector("input")?.focus({preventScroll: true});
}, {flush: "post"});

/** 焦点离开就收起，否则回车会作用到别处的选区。焦点去哪里由用户定，不抢回。 */
function onFocusOut(event: FocusEvent): void {
    if (props.open && !box.value?.contains(event.relatedTarget as Node | null)) emit("dismiss");
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancel");
    } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const text = value.value.trim();
        if (text === "") emit("cancel");
        else emit("submit", text);
    }
}
</script>

<template>
    <AnchoredPopover :open="props.open" :anchor="props.anchor" side="bottom">
        <div ref="box" class="w-56 p-1.5" data-markdown-menu-layer @keydown="onKeydown" @focusout="onFocusOut">
            <Input v-model="value" size="sm" :aria-label="props.label" />
        </div>
    </AnchoredPopover>
</template>
