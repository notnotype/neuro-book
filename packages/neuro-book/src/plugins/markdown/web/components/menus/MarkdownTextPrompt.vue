<script setup lang="ts">
/** 要一段文字的动作（注音、双语、链接）的一行卡片（同名 .md）。 */
import {AnchoredPopover, IconButton, Input} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, useTemplateRef, watch} from "vue";

import type {PopoverAnchor} from "./selection-anchor";

/** `session`：宿主每打开一次就加一，开着时换到另一段也算；预填相同（同一个读音）时也要重来，所以不按预填的文字判断。 */
const props = defineProps<{
    open: boolean;
    session: number;
    anchor: PopoverAnchor | null;
    label: string;
    confirmLabel: string;
    initial?: string;
    removeLabel?: string;
    /** “移除”按钮的图标；缺省是垃圾桶（移除注音），去掉链接用断开的链环。 */
    removeIcon?: string;
    /** 宽到放得下一个网址（链接卡片）；窄屏夹在窗口内。 */
    wide?: boolean;
    /** 输入框与确认都不能用，只剩“移除”（碰到的几条链接地址不同时，输出 52）。 */
    locked?: boolean;
    /** 这段文字能不能确认（链接地址的方案检查）；不能时确认按钮置灰、回车不提交。空文字不看它：空的是取消。 */
    accepts?: (text: string) => boolean;
}>();
const emit = defineEmits<{(event: "submit", text: string): void; (event: "cancel"): void; (event: "dismiss"): void; (event: "remove"): void}>();

const value = ref("");
const box = useTemplateRef<HTMLElement>("box");
const acceptable = computed(() => {
    const text = value.value.trim();
    return props.locked !== true && (text === "" || props.accepts === undefined || props.accepts(text));
});
watch(() => [props.open, props.session] as const, async ([open]) => {
    if (!open) return;
    value.value = props.initial ?? "";
    await nextTick();
    const input = box.value?.querySelector<HTMLInputElement>("input:not(:disabled)");
    if (input !== null && input !== undefined) {
        input.focus({preventScroll: true});
        input.setSelectionRange(input.value.length, input.value.length);
        return;
    }
    // 输入框不能用（只剩“移除”）：焦点也要进卡片，否则它既收不起来、也收不到 Esc。
    box.value?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({preventScroll: true});
}, {flush: "post"});

/** 焦点离开就收起，否则回车会作用到别处的选区。焦点去哪里由用户定，不抢回。 */
function onFocusOut(event: FocusEvent): void {
    if (props.open && !box.value?.contains(event.relatedTarget as Node | null)) emit("dismiss");
}

/** 空的是取消，不是移除（输出 9）。 */
function confirm(): void {
    if (!acceptable.value) return;
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
        <div ref="box" class="markdown-text-prompt" :class="{'markdown-text-prompt--wide': props.wide === true}" data-markdown-menu-layer data-markdown-text-prompt @keydown="onKeydown" @focusout="onFocusOut">
            <Input v-model="value" variant="bare" size="sm" class="min-w-0 flex-1" :aria-label="props.label" :disabled="props.locked === true" :invalid="props.locked !== true && !acceptable" />
            <IconButton v-if="props.removeLabel !== undefined" size="xs" :icon-class="props.removeIcon ?? 'i-lucide-trash-2'" :title="props.removeLabel" :aria-label="props.removeLabel" @click="emit('remove')" />
            <IconButton size="xs" icon-class="i-lucide-check" :title="props.confirmLabel" :aria-label="props.confirmLabel" :disabled="!acceptable" @click="confirm" />
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

/* 链接地址：放得下一个常见的网址，窄屏夹在窗口内（输出 52）。 */
.markdown-text-prompt--wide {
    width: min(26rem, calc(100vw - 32px));
}
</style>
