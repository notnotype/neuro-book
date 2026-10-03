<script setup lang="ts">
/**
 * 诊断条目渲染（Task 126）。组成与缓存两个 Tab 共用。
 *
 * 语气契约：只陈述观察与因果，不写建议、不评价用法。文案全在 i18n，
 * 这里只负责按 code 取对应 key 并填参数——新增诊断必须同时配文案，
 * 否则 diagnostic-messages.test.ts 会直接红。
 */
import {diagnosticDotClass} from "nbook/app/components/novel-ide/agent/context-inspector/context-inspector-view-model";
import type {AgentContextDiagnosticDto} from "nbook/shared/dto/agent-context-inspection.dto";

const props = defineProps<{
    diagnostics: AgentContextDiagnosticDto[];
    /** 紧凑模式用于挂在时间轴柱下，去掉外框与留白。 */
    compact?: boolean;
}>();

const {t, n} = useI18n();

/** 百分比文案：小于 10 保留一位小数，避免「0%」把有意义的小占比抹平。 */
function percent(value: number): string {
    return `${n(value, {maximumFractionDigits: value >= 10 ? 0 : 1})}%`;
}

/** token 数按本地化千分位展示。 */
function tokens(value: number): string {
    return n(Math.round(value), {maximumFractionDigits: 0});
}

/** 秒 → 人读时长；诊断里用来表达请求间隔与缓存保留期。 */
function duration(seconds: number): string {
    if (seconds < 60) {
        return t("agent.contextInspector.durationSeconds", {value: n(Math.round(seconds)) });
    }
    if (seconds < 3600) {
        return t("agent.contextInspector.durationMinutes", {value: n(Math.round(seconds / 60))});
    }
    return t("agent.contextInspector.durationHours", {value: n(Math.round(seconds / 3600 * 10) / 10)});
}

/** 按 code 组装最终文案。参数类型由判别联合保证，无需 any。 */
function message(diagnostic: AgentContextDiagnosticDto): string {
    const key = `agent.contextInspector.diagnostics.${diagnostic.code}`;
    switch (diagnostic.code) {
        case "fixedOverhead":
            return t(key, {percent: percent(diagnostic.percent), tokens: tokens(diagnostic.tokens)});
        case "dominantSource":
            return t(key, {label: diagnostic.label, percent: percent(diagnostic.percent)});
        case "toolSchemaCost":
            return t(key, {percent: percent(diagnostic.percent)});
        case "nearCompaction":
            return diagnostic.estimatedTurnsLeft === null
                ? t("agent.contextInspector.diagnostics.nearCompactionUnknown", {percent: percent(diagnostic.percent)})
                : t(key, {percent: percent(diagnostic.percent), turns: diagnostic.estimatedTurnsLeft});
        case "contextWindowUnset":
            return t(key);
        case "dynamicContextRewrite":
            return t(key, {tokens: tokens(diagnostic.tokens)});
        case "cacheRetention":
            return t(key, {duration: duration(diagnostic.seconds)});
        case "cacheAutoPrefix":
        case "cacheNotReported":
            return t(key, {provider: diagnostic.provider});
        case "cacheExpired":
            return t(key, {gap: duration(diagnostic.gapSeconds), retention: duration(diagnostic.retentionSeconds)});
        case "cacheCompactionRebuild":
        case "cacheToolsChanged":
            return t(key);
        case "cacheModelChanged":
            return t(key, {from: diagnostic.from, to: diagnostic.to});
    }
}

/** 稳定 key：同一 code 可能针对不同请求出现多次。 */
function itemKey(diagnostic: AgentContextDiagnosticDto, index: number): string {
    return "traceId" in diagnostic ? `${diagnostic.code}-${diagnostic.traceId}` : `${diagnostic.code}-${String(index)}`;
}
</script>

<template>
    <!-- 诊断列表：圆点表示严重度，文案只陈述事实 -->
    <ul v-if="props.diagnostics.length" :class="props.compact ? 'space-y-1' : 'space-y-1.5'">
        <li
            v-for="(diagnostic, index) in props.diagnostics"
            :key="itemKey(diagnostic, index)"
            class="flex items-start gap-2 text-[var(--text-secondary)]"
            :class="props.compact ? 'text-[11px]' : 'text-xs'"
        >
            <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" :class="diagnosticDotClass(diagnostic.severity)"></span>
            <span>{{ message(diagnostic) }}</span>
        </li>
    </ul>
</template>
