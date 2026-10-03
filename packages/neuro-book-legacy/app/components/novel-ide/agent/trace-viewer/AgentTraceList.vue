<script setup lang="ts">
/**
 * Pi 请求 trace 列表（查看器左栏）。纯展示组件：props 进、select 事件出，
 * 不做任何数据获取——属于查看器的可分离核心。
 * 「最近请求」聚合模式下条目带来源 bucket 与预格式化的 sourceLabel（由宿主 Dialog 生成，
 * 本组件不引入 session / i18n 语义）；行 key 与选中态用 bucket/id 复合键防跨 bucket 撞号。
 */
import type {AgentTraceIndexEntryDto} from "nbook/shared/dto/agent-trace.dto";
import {formatMs, formatTokens, formatTraceTime, groupTraceEntries, traceEntryKey, traceStatusDotClass} from "nbook/app/components/novel-ide/agent/trace-viewer/trace-view-model";

/** 列表条目：index 行 + 聚合模式下的来源信息（可选）。 */
type TraceListEntry = AgentTraceIndexEntryDto & {bucket?: string; sourceLabel?: string};

const props = withDefaults(defineProps<{
    entries: TraceListEntry[];
    /** 当前选中条目的复合键（traceEntryKey）；未选中为空。 */
    selectedKey?: string | null;
    loading?: boolean;
}>(), {
    selectedKey: null,
    loading: false,
});

const emit = defineEmits<{
    (e: "select", entry: TraceListEntry): void;
}>();

const {t} = useI18n();

const groups = computed(() => groupTraceEntries(props.entries));

/** invocationId 缩短展示（uuid 太长）。 */
function shortInvocation(invocationId: string): string {
    return invocationId.length > 8 ? invocationId.slice(0, 8) : invocationId;
}
</script>

<template>
    <!-- trace 列表容器 -->
    <div class="flex h-full flex-col">
        <div v-if="props.loading" class="flex flex-1 items-center justify-center py-10">
            <span class="i-lucide-loader-2 h-5 w-5 animate-spin text-[var(--text-muted)]"></span>
        </div>

        <div v-else-if="props.entries.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <span class="i-lucide-inbox h-6 w-6 text-[var(--text-muted)]"></span>
            <span class="text-xs text-[var(--text-muted)]">{{ t("agent.traceViewer.empty") }}</span>
        </div>

        <div v-else class="flex-1 space-y-3 overflow-y-auto p-2">
            <!-- 每个 invocation 分组 -->
            <section v-for="(group, groupIndex) in groups" :key="group.invocationId ?? `single-${String(groupIndex)}`" class="space-y-1">
                <div class="flex items-center gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span class="i-lucide-corner-down-right h-3 w-3"></span>
                    <span v-if="group.invocationId">{{ t("agent.traceViewer.invocationGroup", {id: shortInvocation(group.invocationId), count: group.entries.length}) }}</span>
                    <span v-else>{{ t("agent.traceViewer.singleGroup") }}</span>
                </div>

                <!-- 组内单条 trace 行 -->
                <button
                    v-for="entry in group.entries"
                    :key="traceEntryKey(entry)"
                    type="button"
                    class="block w-full rounded-lg border px-2.5 py-2 text-left transition-colors"
                    :class="props.selectedKey === traceEntryKey(entry) ? 'border-[var(--accent-main)] border-opacity-40 bg-[var(--accent-bg)]' : 'border-transparent hover:bg-[var(--bg-hover)]'"
                    @click="emit('select', entry)"
                >
                    <div class="flex items-center gap-2">
                        <span class="h-2 w-2 shrink-0 rounded-full" :class="traceStatusDotClass(entry.status)"></span>
                        <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ entry.kind }}</span>
                        <span class="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-main)]">{{ entry.model }}</span>
                        <span class="shrink-0 text-[10px] text-[var(--text-muted)]">#{{ entry.id }}</span>
                    </div>
                    <div class="mt-1 flex items-center gap-2 pl-4 text-[10px] text-[var(--text-muted)]">
                        <span>{{ formatTraceTime(entry.ts) }}</span>
                        <span v-if="entry.sourceLabel" class="max-w-[40%] truncate rounded bg-[var(--bg-input)] px-1 text-[var(--text-secondary)]">{{ entry.sourceLabel }}</span>
                        <span v-if="entry.turnIndex !== undefined">T{{ entry.turnIndex }}</span>
                        <span :title="t('agent.traceViewer.field.tokens')">{{ formatTokens(entry.totalTokens) }} tok</span>
                        <span :title="t('agent.traceViewer.field.ttft')">TTFT {{ formatMs(entry.ttftMs) }}</span>
                        <span :title="t('agent.traceViewer.field.duration')">{{ formatMs(entry.durationMs) }}</span>
                        <span v-if="entry.stopReason" class="truncate">{{ entry.stopReason }}</span>
                    </div>
                </button>
            </section>
        </div>
    </div>
</template>
