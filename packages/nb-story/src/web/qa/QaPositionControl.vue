<script setup lang="ts">
import {Button, Popover, Select} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {formatAt} from "../host/book";

const props = defineProps<{at: {chapter: number; paragraph?: number}; paragraphs: readonly number[]; maxChapter: number; disabledReason: string | null; busy: boolean}>();
const emit = defineEmits<{(event: "change", chapter: number): void}>();

const open = ref(false);
const picked = ref(String(props.at.chapter));
// 打开时从当前位置起选：位置在别处被改了（换对话、改完刷新）选择跟着变。
watch(() => [props.at.chapter, open.value] as const, () => {
    if (open.value) picked.value = String(props.at.chapter);
});
const options = computed(() => Array.from({length: Math.max(1, props.maxChapter)}, (_, index) => ({value: String(index + 1), label: `第 ${index + 1} 章`})));
/** 停在一章最后一段（或只记了章）：位置就是“读完这一章”。 */
const atChapterEnd = computed(() => props.at.paragraph === undefined || props.at.paragraph === props.paragraphs[props.at.chapter - 1]);
// 选的是“读完第 N 章”：停在 N.M（章中）时选同一章是有效的改动，把位置挪到章末。
const same = computed(() => Number(picked.value) === props.at.chapter && atChapterEnd.value);
/** 停在一章最后一段的写“第 N 章”，否则写“N.M”（同对话里的系统提醒）。 */
const label = computed(() => (atChapterEnd.value ? `第 ${props.at.chapter} 章` : formatAt(props.at)));

function confirm(): void {
    emit("change", Number(picked.value));
    open.value = false;
}
</script>

<template>
    <Popover v-model:open="open" align="start" content-class="w-[min(260px,92vw)] p-3">
        <template #trigger>
            <button type="button" class="qa-position" data-testid="qa-position" :disabled="disabledReason !== null || busy" :title="disabledReason ?? '点开改这个对话读到哪里'">
                <span class="i-lucide-book-open-check shrink-0" />读到 {{ label }}<span class="i-lucide-chevron-down shrink-0" />
            </button>
        </template>
        <div class="flex flex-col gap-2 text-[length:var(--text-sm)]" data-testid="qa-position-popover">
            <span class="text-[var(--text-secondary)]">读到</span>
            <Select v-model="picked" size="sm" :options="options" aria-label="章" data-testid="qa-position-chapter" />
            <div class="flex justify-end gap-2">
                <Button size="sm" variant="secondary" @click="open = false">取消</Button>
                <Button variant="primary" size="sm" :disabled="same" data-testid="qa-position-confirm" @click="confirm">确定</Button>
            </div>
        </div>
    </Popover>
</template>

<style scoped>
.qa-position { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--radius-control); padding: 2px 8px; color: var(--text-secondary); font-size: var(--text-xs); background: var(--bg-subtle); }
.qa-position:not(:disabled):hover { background: var(--bg-hover); color: var(--text-main); }
.qa-position:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
