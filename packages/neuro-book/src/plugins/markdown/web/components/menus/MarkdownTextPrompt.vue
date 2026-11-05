<script setup lang="ts">
/** 要一段文字的动作（注音、双语）的输入弹层（同名 .md）。 */
import {AnchoredPopover, Input} from "@notnotype/nb-ui/components";
import {nextTick, ref, useTemplateRef, watch} from "vue";

import type {PopoverAnchor} from "./selection-anchor";

const props = defineProps<{open: boolean; anchor: PopoverAnchor | null; label: string}>();
const emit = defineEmits<{(event: "submit", text: string): void; (event: "cancel"): void}>();

const value = ref("");
const box = useTemplateRef<HTMLElement>("box");
watch(() => props.open, async (open) => {
    if (!open) return;
    value.value = "";
    await nextTick();
    box.value?.querySelector("input")?.focus({preventScroll: true});
}, {flush: "post"});

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
        <div ref="box" class="w-56 p-1.5" data-markdown-menu-layer @keydown="onKeydown">
            <Input v-model="value" size="sm" :aria-label="props.label" />
        </div>
    </AnchoredPopover>
</template>
