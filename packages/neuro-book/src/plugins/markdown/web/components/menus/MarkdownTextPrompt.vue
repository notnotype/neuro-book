<script setup lang="ts">
/** 要一段文字的动作（注音、双语）的一行卡片（同名 .md）。 */
import {AnchoredPopover, IconButton, Input} from "@notnotype/nb-ui/components";
import {nextTick, ref, useTemplateRef, watch} from "vue";

import type {PopoverAnchor} from "./selection-anchor";

/** `session`：宿主每打开一次就加一，开着时换到另一段也算；预填相同（同一个读音）时也要重来，所以不按预填的文字判断。 */
const props = defineProps<{open: boolean; session: number; anchor: PopoverAnchor | null; label: string; confirmLabel: string; initial?: string; removeLabel?: string}>();
const emit = defineEmits<{(event: "submit", text: string): void; (event: "cancel"): void; (event: "dismiss"): void; (event: "remove"): void}>();

const value = ref("");
const box = useTemplateRef<HTMLElement>("box");
watch(() => [props.open, props.session] as const, async ([open]) => {
    if (!open) return;
    value.value = props.initial ?? "";
    await nextTick();
    const input = box.value?.querySelector("input");
    if (input === null || input === undefined) return;
    input.focus({preventScroll: true});
    input.setSelectionRange(input.value.length, input.value.length);
}, {flush: "post"});

/** 焦点离开就收起，否则回车会作用到别处的选区。焦点去哪里由用户定，不抢回。 */
function onFocusOut(event: FocusEvent): void {
    if (props.open && !box.value?.contains(event.relatedTarget as Node | null)) emit("dismiss");
}

/** 空的是取消，不是移除（输出 9）。 */
function confirm(): void {
    const text = value.value.trim();
    if (text === "") emit("cancel");
    else emit("submit", text);
}

/** 组字中的回车与 Esc 归输入法（选候选、取消候选）。回车只在输入框里算确定：焦点在按钮上时回车是那个按钮的动作。 */
function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancel");
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        confirm();
    }
}
</script>

<template>
    <AnchoredPopover :open="props.open" :anchor="props.anchor" side="bottom">
        <div ref="box" class="markdown-text-prompt" data-markdown-menu-layer data-markdown-text-prompt @keydown="onKeydown" @focusout="onFocusOut">
            <Input v-model="value" variant="bare" size="sm" class="min-w-0 flex-1" :aria-label="props.label" />
            <IconButton v-if="props.removeLabel !== undefined" size="xs" icon-class="i-lucide-trash-2" :title="props.removeLabel" :aria-label="props.removeLabel" @click="emit('remove')" />
            <IconButton size="xs" icon-class="i-lucide-check" :title="props.confirmLabel" :aria-label="props.confirmLabel" @click="confirm" />
        </div>
    </AnchoredPopover>
</template>

<style scoped>
/* 一行：左边留出与卡片圆角相称的空，右边贴着按钮（w00025 t20 评审板的注音卡片）。 */
.markdown-text-prompt {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 12rem;
    padding: 2px 4px 2px 10px;
}
</style>
