<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, ref, watch} from "vue";

/** 确认键停用的秒数：留够时间读完对比，不是点掉就算。 */
const HOLD_SECONDS = 3;

const props = defineProps<{open: boolean; target: "graph" | "full"}>();
const emit = defineEmits<{(event: "confirm"): void; (event: "cancel"): void}>();

const left = ref(HOLD_SECONDS);
let timer: ReturnType<typeof setInterval> | null = null;
function stop(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
}
watch(() => props.open, open => {
    stop();
    if (!open) return;
    left.value = HOLD_SECONDS;
    timer = setInterval(() => {
        left.value -= 1;
        if (left.value <= 0) stop();
    }, 1000);
}, {immediate: true});
onBeforeUnmount(stop);

const ROWS = [
    {label: "做法", graph: "先查记忆图，再读相关的原文段", full: "把读到的位置之前的原文都交给模型"},
    {label: "优点", graph: "快、便宜，适合长书", full: "不依赖图有没有漏记，细节最全"},
    {label: "弊端", graph: "图里漏记或记错的事，模型可能看不到", full: "慢、贵；超过模型上下文的书读不完"},
] as const;
</script>

<template>
    <Dialog
        :open="open" size="md" title="两种读书方式" closable data-testid="mode-notice"
        @request-close="emit('cancel')"
    >
        <p class="mb-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            你要切换到“{{ target === "full" ? "全读" : "图当目录" }}”。两种方式各有取舍，读完再切换：
        </p>
        <div class="mode-notice-grid" role="table" aria-label="两种读书方式的对比">
            <div class="mode-notice-head" role="row"><span role="columnheader" /><span role="columnheader">图当目录（默认）</span><span role="columnheader">全读</span></div>
            <div v-for="row in ROWS" :key="row.label" class="mode-notice-row" role="row">
                <span class="mode-notice-label" role="rowheader">{{ row.label }}</span>
                <span role="cell">{{ row.graph }}</span>
                <span role="cell">{{ row.full }}</span>
            </div>
        </div>
        <p class="mt-3 text-[length:var(--text-xs)] text-[var(--text-muted)]">只在第一次切换时提示；之后在输入框里随时切换。</p>
        <!-- 只有确认键等倒计时；“先不切换”随时能点。 -->
        <template #footer="{cancel}">
            <Button variant="secondary" @click="cancel">先不切换</Button>
            <Button variant="primary" :disabled="left > 0" @click="emit('confirm')">{{ left > 0 ? `知道了，切换（${left}）` : "知道了，切换" }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.mode-notice-grid { display: grid; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; font-size: var(--text-sm); }
.mode-notice-head, .mode-notice-row { display: grid; grid-template-columns: 4.5rem 1fr 1fr; gap: 0.75rem; padding: 0.5rem 0.75rem; align-items: start; }
.mode-notice-head { background: var(--bg-subtle); font-weight: 600; }
.mode-notice-row { border-top: 1px solid var(--border-color); }
.mode-notice-label { color: var(--text-secondary); }
</style>
