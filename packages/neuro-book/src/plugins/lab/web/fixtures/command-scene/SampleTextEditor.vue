<script setup lang="ts">
/**
 * 命令场景的样板编辑器：用 nb-ui 的多行输入框实现命令需要的那几样编辑器能力（聚焦、撤销、重做、行号跳转），
 * 让编辑器命令与面板的行号模式有真实的作用对象。不是产品编辑器：Monaco 随第 5 步的编辑器插件迁入后，
 * 命令场景改用真实编辑器。
 *
 * 撤销栈自己维护：浏览器原生的输入框撤销没有可调用的接口（`execCommand` 已废弃）。输入即时交给宿主，
 * 没有缓冲，所以 `flushPendingChange` 是空操作。
 */
import {FormTextarea} from "@notnotype/nb-ui/components";
import {onMounted, ref} from "vue";

import type {CommandEditorHandle} from "./editor-binding";

const props = defineProps<{
    /** 初始正文；挂载后由本组件持有，换文档时由父组件按新的 key 重建。 */
    initialText: string;
    readonly: boolean;
    label: string;
}>();

const emit = defineEmits<{
    (event: "ready", handle: CommandEditorHandle): void;
    (event: "change", text: string): void;
    (event: "focus", focused: boolean): void;
}>();

const text = ref(props.initialText);
const field = ref<{$el: HTMLTextAreaElement} | null>(null);
/** 撤销栈：每次输入后的全文快照；`cursor` 指向当前状态。 */
const history = [props.initialText];
let cursor = 0;

function element(): HTMLTextAreaElement | null {
    return field.value?.$el ?? null;
}

function apply(next: string): void {
    text.value = next;
    emit("change", next);
}

function onInput(next: string): void {
    // 正文没变的 input 不是一次编辑（实测 Playwright 的 fill 会连发多次同样的正文），不进撤销栈，
    // 否则撤销只退回到同样的正文。
    if (next === text.value) return;
    history.splice(cursor + 1, history.length, next);
    cursor = history.length - 1;
    apply(next);
}

function lineCount(): number {
    return text.value.split("\n").length;
}

/** 把光标放到第 `line` 行行首并滚到可见处。 */
function revealLine(line: number): {ok: true; value: {line: number}} | {ok: false; reason: string} {
    const textarea = element();
    if (textarea === null) return {ok: false, reason: "编辑器尚未就绪"};
    const offset = text.value.split("\n").slice(0, line - 1).reduce((sum, row) => sum + row.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2);
    return {ok: true, value: {line}};
}

const handle: CommandEditorHandle = {
    focus: () => element()?.focus(),
    undo: () => {
        if (cursor === 0) return;
        cursor -= 1;
        apply(history[cursor] as string);
    },
    redo: () => {
        if (cursor === history.length - 1) return;
        cursor += 1;
        apply(history[cursor] as string);
    },
    flushPendingChange: () => undefined,
    navigation: {getLineCount: lineCount, revealLine},
};

onMounted(() => emit("ready", handle));
</script>

<template>
    <FormTextarea
        ref="field"
        :model-value="text"
        :readonly="props.readonly"
        :rows="16"
        :aria-label="props.label"
        class="h-full w-full resize-none font-mono text-[var(--text-sm)] leading-[1.6]"
        data-lab-sample-editor
        @update:model-value="onInput"
        @focus="emit('focus', true)"
        @blur="emit('focus', false)"
    />
</template>
