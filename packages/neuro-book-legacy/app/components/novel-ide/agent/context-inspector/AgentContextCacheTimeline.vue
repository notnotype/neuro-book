<script setup lang="ts">
/**
 * 「缓存」Tab（Task 126）：provider 能力条 + 逐请求柱状时间轴 + 每柱诊断。
 *
 * 这是诊断「为什么命中率低」的主视图——**逐请求**看，不看会话累计值：
 * 首轮必然全量写缓存、命中为 0，那一笔会永久压在累计分母里。
 */
import AgentContextDiagnosticList from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextDiagnosticList.vue";
import {cacheBar, groupDiagnostics} from "nbook/app/components/novel-ide/agent/context-inspector/context-inspector-view-model";
import type {
    AgentContextDiagnosticDto,
    AgentContextFactsDto,
    AgentContextTimelineEntryDto,
} from "nbook/shared/dto/agent-context-inspection.dto";

const props = defineProps<{
    timeline: AgentContextTimelineEntryDto[];
    facts: AgentContextFactsDto;
    diagnostics: AgentContextDiagnosticDto[];
    provider: string;
}>();

const {t, n} = useI18n();

const grouped = computed(() => groupDiagnostics(props.diagnostics));

/** 只画 turn：compaction / health-check 不是对话请求，混进来会让柱子读不懂。 */
const turns = computed(() => props.timeline.filter((entry) => entry.kind === "turn"));

/** provider 缓存能力说明：显式断点 or 自动前缀缓存。 */
const providerLabel = computed(() => {
    const retention = props.facts.cacheRetention;
    if (!retention) {
        return t("agent.contextInspector.cacheProviderAuto", {provider: props.provider});
    }
    return t("agent.contextInspector.cacheProviderExplicit", {duration: formatDuration(retention.seconds)});
});

function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return t("agent.contextInspector.durationSeconds", {value: n(Math.round(seconds))});
    }
    if (seconds < 3600) {
        return t("agent.contextInspector.durationMinutes", {value: n(Math.round(seconds / 60))});
    }
    return t("agent.contextInspector.durationHours", {value: n(Math.round(seconds / 3600 * 10) / 10)});
}

function formatTime(ts: string): string {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? ts : date.toLocaleTimeString();
}

function formatPercent(value: number): string {
    return `${n(value, {maximumFractionDigits: value >= 10 ? 0 : 1})}%`;
}

function barFor(entry: AgentContextTimelineEntryDto) {
    return cacheBar(entry);
}

function diagnosticsFor(id: string): AgentContextDiagnosticDto[] {
    return grouped.value.byTraceId.get(id) ?? [];
}
</script>

<template>
    <div class="space-y-3">
        <!-- provider 能力与保留期 -->
        <p class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            {{ providerLabel }}
        </p>

        <!-- 图例 -->
        <div class="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
            <span class="inline-flex items-center gap-1">
                <span class="h-2 w-2 rounded-sm bg-[var(--status-success)]"></span>{{ t("agent.contextInspector.cacheLegendRead") }}
            </span>
            <span class="inline-flex items-center gap-1">
                <span class="h-2 w-2 rounded-sm bg-[var(--status-warning)]"></span>{{ t("agent.contextInspector.cacheLegendWrite") }}
            </span>
            <span class="inline-flex items-center gap-1">
                <span class="h-2 w-2 rounded-sm bg-[var(--text-muted)]"></span>{{ t("agent.contextInspector.cacheLegendFresh") }}
            </span>
        </div>

        <p v-if="turns.length === 0" class="text-xs text-[var(--text-muted)]">{{ t("agent.contextInspector.cacheTimelineEmpty") }}</p>

        <!-- 逐请求柱状时间轴 -->
        <ul v-else class="space-y-2">
            <li v-for="entry in turns" :key="entry.id" class="space-y-1">
                <div class="flex items-center gap-2 text-[11px]">
                    <span class="w-24 shrink-0 truncate text-[var(--text-muted)]">#{{ entry.id }} {{ formatTime(entry.ts) }}</span>
                    <div class="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-input)]">
                        <template v-if="barFor(entry).state === 'measured'">
                            <div :style="{width: `${(barFor(entry) as {cacheReadPercent: number}).cacheReadPercent}%`}" class="bg-[var(--status-success)]"></div>
                            <div :style="{width: `${(barFor(entry) as {cacheWritePercent: number}).cacheWritePercent}%`}" class="bg-[var(--status-warning)]"></div>
                            <div :style="{width: `${(barFor(entry) as {freshInputPercent: number}).freshInputPercent}%`}" class="bg-[var(--text-muted)]"></div>
                        </template>
                    </div>
                    <span class="w-20 shrink-0 text-right text-[var(--text-secondary)]">
                        {{ barFor(entry).state === "measured"
                            ? t("agent.contextInspector.cacheHitRate", {rate: formatPercent((barFor(entry) as {hitRate: number}).hitRate)})
                            : t("agent.contextInspector.cacheUnreported") }}
                    </span>
                </div>
                <div v-if="diagnosticsFor(entry.id).length" class="pl-6">
                    <AgentContextDiagnosticList :diagnostics="diagnosticsFor(entry.id)" compact />
                </div>
            </li>
        </ul>

        <!-- 面板级缓存诊断（保留期、provider 能力、未上报等） -->
        <AgentContextDiagnosticList :diagnostics="grouped.cachePanel" />
    </div>
</template>
