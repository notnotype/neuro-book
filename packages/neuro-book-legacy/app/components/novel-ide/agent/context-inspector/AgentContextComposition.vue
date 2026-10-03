<script setup lang="ts">
/**
 * 「组成」Tab（Task 126）：堆叠条 + 分区表 + 来源明细 + 面板级诊断。
 *
 * 纯展示：数据全部由 Dialog 粘合层传入，本组件不取数、不发请求。
 */
import AgentContextDiagnosticList from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextDiagnosticList.vue";
import {aggregateByKind, calibrate} from "nbook/app/components/novel-ide/agent/context-inspector/context-inspector-view-model";
import type {
    AgentContextDiagnosticDto,
    AgentContextFactsDto,
    AgentContextSelectedRequestDto,
} from "nbook/shared/dto/agent-context-inspection.dto";
import type {AgentTraceSegmentKindDto} from "nbook/shared/dto/agent-trace.dto";

const props = defineProps<{
    selected: AgentContextSelectedRequestDto;
    facts: AgentContextFactsDto;
    diagnostics: AgentContextDiagnosticDto[];
}>();

const {t, n} = useI18n();

/** 各分区可展开的开关；默认全收起，避免一打开就是一屏明细。 */
const expanded = ref<Set<AgentTraceSegmentKindDto>>(new Set());

/** provider 上报的真实 prompt 总量；未上报时 null，下游只显示估算。 */
const promptTokens = computed(() => {
    const usage = props.selected.usage;
    return usage ? usage.input + usage.cacheRead + usage.cacheWrite : null;
});

const rows = computed(() => calibrate(aggregateByKind(props.selected.segments), promptTokens.value));

/** 堆叠条按占比切段，颜色沿用分区色板。 */
const totalTokens = computed(() => promptTokens.value ?? rows.value.reduce((sum, row) => sum + row.estimatedTokens, 0));

/** 窗口占用文案；模型没配窗口时给出明确说明而不是显示 NaN。 */
const windowLabel = computed(() => {
    const limit = props.facts.contextWindowTokens;
    if (limit === null) {
        return t("agent.contextInspector.windowUnknown");
    }
    return t("agent.contextInspector.windowUsage", {
        used: formatTokens(totalTokens.value),
        limit: formatTokens(limit),
    });
});

const windowPercent = computed(() => {
    const limit = props.facts.contextWindowTokens;
    return limit && limit > 0 ? Math.min(100, totalTokens.value / limit * 100) : null;
});

/** 分区 → 该分区的来源明细行。 */
function breakdownOf(kind: AgentTraceSegmentKindDto) {
    return props.selected.labelBreakdown.filter((item) => item.kind === kind);
}

function toggle(kind: AgentTraceSegmentKindDto): void {
    const next = new Set(expanded.value);
    if (next.has(kind)) {
        next.delete(kind);
    } else {
        next.add(kind);
    }
    expanded.value = next;
}

function formatTokens(value: number): string {
    return n(Math.round(value), {maximumFractionDigits: 0});
}

function formatPercent(value: number): string {
    return `${n(value, {maximumFractionDigits: value >= 10 ? 0 : 1})}%`;
}

/** 分区色：仅用于堆叠条区分段落，不承载状态语义。 */
function barColor(kind: AgentTraceSegmentKindDto): string {
    const map: Record<AgentTraceSegmentKindDto, string> = {
        system: "var(--status-info)",
        tools: "var(--accent-bg)",
        historySet: "var(--status-warning)",
        conversation: "var(--text-muted)",
        modelContext: "var(--status-success)",
        appending: "var(--border-strong)",
        currentInput: "var(--text-secondary)",
    };
    return map[kind];
}
</script>

<template>
    <div class="space-y-3">
        <!-- 窗口占用与堆叠条 -->
        <div class="space-y-1.5">
            <div class="flex items-baseline justify-between text-xs">
                <span class="text-[var(--text-secondary)]">{{ windowLabel }}</span>
                <span v-if="windowPercent !== null" class="font-medium text-[var(--text-main)]">{{ formatPercent(windowPercent) }}</span>
            </div>
            <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
                <div
                    v-for="row in rows"
                    :key="row.kind"
                    :style="{width: `${row.percent}%`, backgroundColor: barColor(row.kind)}"
                    :title="t(`agent.contextInspector.segment.${row.kind}`)"
                ></div>
            </div>
        </div>

        <!-- 归因完整性提示：legacy / 无分区数据 -->
        <p v-if="props.selected.attribution === 'legacy'" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            {{ t("agent.contextInspector.legacyNotice") }}
        </p>
        <p v-else-if="props.selected.attribution === 'none'" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            {{ t("agent.contextInspector.noSegments") }}
        </p>

        <!-- 分区表 -->
        <table v-if="rows.length" class="w-full text-xs">
            <thead>
                <tr class="border-b border-[var(--border-color)] text-left text-[var(--text-muted)]">
                    <th class="py-1 font-normal">{{ t("agent.contextInspector.columnSegment") }}</th>
                    <th class="py-1 text-right font-normal">{{ t("agent.contextInspector.columnCount") }}</th>
                    <th class="py-1 text-right font-normal">{{ t("agent.contextInspector.columnEstimated") }}</th>
                    <th class="py-1 text-right font-normal">{{ t("agent.contextInspector.columnCalibrated") }}</th>
                    <th class="py-1 text-right font-normal">{{ t("agent.contextInspector.columnPercent") }}</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="row in rows" :key="row.kind">
                    <tr class="border-b border-[var(--border-color)]/50">
                        <td class="py-1">
                            <button
                                v-if="breakdownOf(row.kind).length"
                                class="inline-flex items-center gap-1 text-[var(--text-main)] transition-colors hover:text-[var(--accent-text-on-bg)]"
                                @click="toggle(row.kind)"
                            >
                                <span :class="expanded.has(row.kind) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3 w-3"></span>
                                <span>{{ t(`agent.contextInspector.segment.${row.kind}`) }}</span>
                            </button>
                            <span v-else class="pl-4 text-[var(--text-main)]">{{ t(`agent.contextInspector.segment.${row.kind}`) }}</span>
                        </td>
                        <td class="py-1 text-right text-[var(--text-secondary)]">{{ row.messageCount === null ? "—" : row.messageCount }}</td>
                        <td class="py-1 text-right text-[var(--text-secondary)]">{{ formatTokens(row.estimatedTokens) }}</td>
                        <td class="py-1 text-right text-[var(--text-main)]">{{ row.calibratedTokens === null ? "—" : formatTokens(row.calibratedTokens) }}</td>
                        <td class="py-1 text-right text-[var(--text-secondary)]">{{ formatPercent(row.percent) }}</td>
                    </tr>
                    <!-- 来源明细：Import 路径 / Catalog 名 / Reminder id -->
                    <tr v-if="expanded.has(row.kind)" :key="`${row.kind}-detail`">
                        <td colspan="5" class="py-1">
                            <ul class="space-y-0.5 pl-6">
                                <li v-for="item in breakdownOf(row.kind)" :key="item.label" class="flex justify-between text-[11px] text-[var(--text-secondary)]">
                                    <span class="truncate pr-2 font-mono">{{ item.label }}</span>
                                    <span class="shrink-0">{{ formatTokens(item.estimatedTokens) }}</span>
                                </li>
                            </ul>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>

        <!-- token 口径说明 -->
        <p class="text-[11px] text-[var(--text-muted)]">
            {{ promptTokens === null
                ? t("agent.contextInspector.estimateOnly")
                : t("agent.contextInspector.calibratedNote", {total: formatTokens(promptTokens)}) }}
        </p>

        <AgentContextDiagnosticList :diagnostics="props.diagnostics" />
    </div>
</template>
