<script setup lang="ts">
import {computed, useSlots} from "vue";

import {useUiText} from "../../text-port";

export type CodeBlockLine = {text: string; tone?: "added" | "removed" | "muted"};

const props = withDefaults(defineProps<{
    lines: CodeBlockLine[];
    label?: string;
    startLine?: number | null;
    truncated?: boolean;
    /** 没有行时显示的文字。 */
    emptyText?: string;
    /** `truncated` 时块底显示的说明。 */
    truncatedText?: string;
    /** 滚动区的最大高度（CSS 长度）。 */
    maxHeight?: string;
}>(), {
    label: "",
    startLine: null,
    truncated: false,
    maxHeight: "280px",
});

defineSlots<{
    /** 标题行右侧的操作，例如复制按钮。 */
    actions?: () => unknown;
}>();

const slots = useSlots();
const hasHeader = computed(() => props.label !== "" || slots.actions !== undefined);

const text = useUiText();
const emptyLabel = computed(() => props.emptyText ?? text("codeBlock.empty"));
const truncatedLabel = computed(() => props.truncatedText ?? text("codeBlock.truncated"));

const MARKS = {added: "+", removed: "-", muted: " "} as const;
</script>

<template>
    <div class="nb-code-block">
        <div v-if="hasHeader" class="nb-code-block__header" :data-has-actions="slots.actions !== undefined ? '' : undefined">
            <p class="nb-code-block__label" :title="props.label || undefined">{{ props.label }}</p>
            <div v-if="slots.actions" class="nb-code-block__actions"><slot name="actions" /></div>
        </div>
        <div class="nb-code-block__scroll" :style="{maxHeight: props.maxHeight}">
            <p v-if="props.lines.length === 0" class="nb-code-block__empty">{{ emptyLabel }}</p>
            <div
                v-for="(line, index) in props.lines"
                v-else
                :key="index"
                class="nb-code-block__line"
                :data-tone="line.tone"
            >
                <span v-if="props.startLine !== null" class="nb-code-block__number">{{ props.startLine + index }}</span>
                <span v-if="line.tone === 'added' || line.tone === 'removed'" class="nb-code-block__mark" aria-hidden="true">{{ MARKS[line.tone] }}</span>
                <span class="nb-code-block__text">{{ line.text }}</span>
            </div>
        </div>
        <p v-if="props.truncated" class="nb-code-block__note">{{ truncatedLabel }}</p>
    </div>
</template>

<style scoped>
.nb-code-block {
    min-width: 0;
    overflow: hidden;
    border: var(--border-w, 1px) solid var(--divider);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-size: var(--text-2xs);
}

.nb-code-block__label,
.nb-code-block__note,
.nb-code-block__empty {
    padding: 3px 8px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nb-code-block__header {
    display: flex;
    align-items: center;
    border-bottom: var(--border-w, 1px) solid var(--divider);
}

.nb-code-block__label {
    flex: 1 1 auto;
    min-width: 0;
}

/* 有操作时标题行要放下 sm 按钮：按钮贴右，四周留 2px，焦点光晕不被根节点的 overflow 裁掉。 */
.nb-code-block__header[data-has-actions] {
    padding: 2px;
}

/* 减去标题行的 2px，标题仍与下面各行的文字左对齐（行的左内边距是 8px）。 */
.nb-code-block__header[data-has-actions] .nb-code-block__label {
    padding-left: 6px;
}

.nb-code-block__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
}

.nb-code-block__note {
    border-top: var(--border-w, 1px) solid var(--divider);
}

/* 长行不折行，在块内横向滚动，不撑宽外层。最大高度来自 maxHeight（内联样式）。
   外层可能是 select-none（通知卡片），原文要能选中复制，所以这里显式 select-text。 */
.nb-code-block__scroll {
    overflow: auto;
    user-select: text;
    padding: 4px 0;
    font-family: var(--font-mono);
    line-height: 1.6;
}

/* 每行是一个块：选中多行时浏览器按块插入换行，粘出来的与原文一致。空行靠 min-height 占住行高，不写空格。 */
.nb-code-block__line {
    display: flex;
    width: max-content;
    min-width: 100%;
    min-height: 1lh;
    padding: 0 8px;
    color: var(--text-secondary);
}

.nb-code-block__line[data-tone="added"] {
    background: color-mix(in srgb, var(--status-success) 12%, transparent);
    color: var(--text-main);
}

.nb-code-block__line[data-tone="removed"] {
    background: color-mix(in srgb, var(--status-danger) 12%, transparent);
    color: var(--text-main);
}

.nb-code-block__line[data-tone="muted"] {
    color: var(--text-muted);
}

.nb-code-block__number {
    flex-shrink: 0;
    min-width: 3ch;
    margin-right: 10px;
    color: var(--text-muted);
    text-align: right;
    user-select: none;
}

.nb-code-block__mark {
    flex-shrink: 0;
    width: 1ch;
    margin-right: 6px;
    user-select: none;
}

.nb-code-block__line[data-tone="added"] .nb-code-block__mark {
    color: var(--status-success);
}

.nb-code-block__line[data-tone="removed"] .nb-code-block__mark {
    color: var(--status-danger);
}

.nb-code-block__text {
    white-space: pre;
}
</style>
