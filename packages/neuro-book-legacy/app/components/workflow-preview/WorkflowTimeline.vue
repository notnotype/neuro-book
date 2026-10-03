<script setup lang="ts">
import {computed} from "vue";
import type {TimelineLaneVm} from "nbook/server/agent/workflow/workflow-run-vm";

/**
 * 泳道时间线：每个 session 一条泳道，activity 是条形（started→完成）。
 * 并发 = 多条泳道同时有条形；进行中条右端开放 + 呼吸动画；⚡ = 缓存命中瞬时条。
 */
const props = defineProps<{lanes: TimelineLaneVm[]}>();

/** 总时长（ms）：所有 span 的最大时刻，进行中条延伸到这里 */
const total = computed(() => {
    let max = 1;
    for (const lane of props.lanes) for (const span of lane.spans) max = Math.max(max, span.end ?? span.start, span.start);
    return max;
});

const pct = (ms: number) => `${Math.min(100, (ms / total.value) * 100).toFixed(2)}%`;
/** 条宽：进行中延伸到最右；瞬时（缓存）给最小宽度 */
function width(span: {start: number; end: number | null}): string {
    const end = span.end ?? total.value;
    return `${Math.max(0.8, ((end - span.start) / total.value) * 100).toFixed(2)}%`;
}
const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
</script>

<template>
    <!-- 泳道时间线容器 -->
    <div class="rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 text-xs">
        <div v-if="!lanes.length" class="py-4 text-center text-[var(--text-muted)]">暂无时间线数据</div>
        <div v-for="lane in lanes" :key="lane.sessionId ?? 'wf'" class="flex items-center gap-2 py-1">
            <div class="w-28 shrink-0 truncate text-right text-[var(--text-secondary)]" :title="lane.name">{{ lane.name }}</div>
            <div class="relative h-5 min-w-0 flex-1 rounded bg-[var(--bg-panel)]">
                <div v-for="span in lane.spans" :key="span.key"
                    class="absolute top-0.5 h-4 overflow-hidden whitespace-nowrap rounded border px-1 text-[10px] leading-4"
                    :class="span.cached
                        ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]'
                        : span.end === null
                            ? 'wf-timeline-running border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'
                            : 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]'"
                    :style="{left: pct(span.start), width: width(span)}"
                    :title="`${span.label}（${span.end === null ? '进行中' : span.cached ? '缓存命中' : fmt(span.end - span.start)}）`">
                    {{ span.cached ? "⚡" : span.label }}
                </div>
            </div>
        </div>
        <div class="mt-1 pl-30 text-[10px] text-[var(--text-muted)]">0 ─ {{ fmt(total) }}　蓝=已完成　橙（呼吸）=进行中　绿⚡=缓存命中</div>
    </div>
</template>

<style scoped>
/* 进行中条形呼吸动画 */
.wf-timeline-running { animation: wf-breathe 1.2s ease-in-out infinite; }
@keyframes wf-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
</style>
