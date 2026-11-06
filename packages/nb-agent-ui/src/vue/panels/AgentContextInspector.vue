<script setup lang="ts">
/**
 * 上下文详情的内容（docs/specs/ui/agent-conversation-view.md 的“上下文检查器”）：下一次请求的组成、缓存、系统提示词、扩展的槽、诊断。
 * 组成是内核按估算算的，不调模型。外框、开关与刷新在视图里。
 */
import {computed, shallowRef, watch} from "vue";
import {Spinner} from "@notnotype/nb-ui/components";

import {formatTokens} from "../../process-summary";
import type {ContextInspectionView, SystemPromptView, UsageSummaryView} from "../../types";
import {useAgentText} from "../host";

const props = defineProps<{
    inspection: ContextInspectionView;
    systemPrompt: SystemPromptView | null;
    usage: UsageSummaryView;
}>();

const emit = defineEmits<{
    (e: "load-system-prompt"): void;
}>();

const {t} = useAgentText();

const AREA_COLORS: Record<string, string> = {
    system: "var(--accent-main)",
    tools: "var(--text-muted)",
    opening: "var(--status-success)",
    history: "var(--status-warning)",
    turn: "var(--status-danger)",
};

/** 刷新时留着上一次的结果：收起的、展开的都不跳，读到新的再换。 */
const lastReady = shallowRef<Extract<ContextInspectionView, {state: "ready"}> | null>(null);
watch(() => props.inspection, (inspection) => {
    if (inspection.state === "ready") lastReady.value = inspection;
    else if (inspection.state === "unavailable") lastReady.value = null;
}, {immediate: true});
const ready = lastReady;
const total = computed(() => ready.value?.estimated ?? 0);
const limit = computed(() => Math.max(ready.value?.window ?? 0, total.value, 1));
const percent = (value: number): string => `${String(Math.round(value * 100))}%`;
const share = (tokens: number): string => percent(total.value === 0 ? 0 : tokens / total.value);

function onSystemToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) emit("load-system-prompt");
}
</script>

<template>
    <div class="acv-inspector" data-context-inspector>
        <p v-if="(props.inspection.state === 'loading' || props.inspection.state === 'idle') && ready === null" class="acv-inspector__state" role="status">
            <Spinner size="sm" :label="t('panel.context.loading')" />{{ t("panel.context.loading") }}
        </p>
        <p v-else-if="props.inspection.state === 'unavailable'" class="acv-inspector__state" data-context-unavailable>
            <span class="i-lucide-info" aria-hidden="true" />{{ props.inspection.reason }}
        </p>
        <template v-if="ready !== null">
            <section>
                <div class="acv-inspector__summary">
                    <strong data-context-estimated>{{ t("panel.context.estimated", {tokens: formatTokens(total)}) }}</strong>
                    <span class="acv-inspector__muted">{{ t("panel.context.limits", {window: formatTokens(ready.window), threshold: formatTokens(ready.threshold)}) }}</span>
                </div>
                <div class="acv-inspector__bar" aria-hidden="true">
                    <span v-for="area in ready.areas" :key="area.key" :style="{width: percent(area.tokens / limit), background: AREA_COLORS[area.key]}" />
                    <i class="acv-inspector__threshold" :style="{left: percent(ready.threshold / limit)}" />
                </div>
                <table class="acv-inspector__table"><tbody>
                    <tr v-for="area in ready.areas" :key="area.key" :data-context-area="area.key">
                        <td><span class="acv-inspector__dot" :style="{background: AREA_COLORS[area.key]}" />{{ t(`panel.context.area.${area.key}`) }}</td>
                        <td class="acv-inspector__num">{{ formatTokens(area.tokens) }}</td>
                        <td class="acv-inspector__num acv-inspector__muted">{{ share(area.tokens) }}</td>
                    </tr>
                </tbody></table>
                <p class="acv-inspector__note">{{ t("panel.context.estimateNote") }}</p>
            </section>
        </template>
        <section>
            <h3 class="acv-inspector__heading">{{ t("panel.context.cache") }}</h3>
            <div v-if="props.usage.cacheHitRate !== null" class="acv-inspector__stats" data-context-cache>
                <div><b>{{ percent(props.usage.cacheHitRate) }}</b><span class="acv-inspector__muted">{{ t("panel.context.cacheTotal") }}</span></div>
                <div v-if="props.usage.lastCacheHitRate !== null && props.usage.lastCacheHitRate !== undefined"><b>{{ percent(props.usage.lastCacheHitRate) }}</b><span class="acv-inspector__muted">{{ t("panel.context.cacheLast") }}</span></div>
            </div>
            <p v-else class="acv-inspector__note" data-context-no-cache>{{ t("panel.context.noCache") }}</p>
            <table class="acv-inspector__table"><tbody>
                <tr><td>{{ t("panel.context.input") }}</td><td class="acv-inspector__num">{{ formatTokens(props.usage.input ?? 0) }}</td></tr>
                <tr><td>{{ t("panel.context.output") }}</td><td class="acv-inspector__num">{{ formatTokens(props.usage.output ?? 0) }}</td></tr>
                <tr><td>{{ t("panel.context.cacheRead") }}</td><td class="acv-inspector__num">{{ formatTokens(props.usage.cacheRead) }}</td></tr>
                <tr><td>{{ t("panel.context.cacheWrite") }}</td><td class="acv-inspector__num">{{ formatTokens(props.usage.cacheWrite) }}</td></tr>
            </tbody></table>
        </section>
        <template v-if="ready !== null">
            <details class="acv-inspector__fold" data-context-system @toggle="onSystemToggle">
                <summary>{{ t("panel.context.systemPrompt") }}</summary>
                <pre v-if="props.systemPrompt !== null" class="acv-inspector__pre">{{ props.systemPrompt.text }}</pre>
                <p v-else class="acv-inspector__note">{{ t("panel.context.loading") }}</p>
            </details>
            <details class="acv-inspector__fold" data-context-slots>
                <summary>{{ t("panel.context.slots") }} <span class="acv-inspector__muted">{{ ready.slots.length }}</span></summary>
                <table class="acv-inspector__table"><tbody>
                    <tr v-for="slot in ready.slots" :key="`${slot.extension}/${slot.name}`">
                        <td>{{ slot.name }} <span class="acv-inspector__muted">{{ slot.extension }}</span></td>
                        <td class="acv-inspector__num" :class="{'acv-inspector__muted': !slot.placed}">{{ slot.placed ? formatTokens(slot.tokens) : t("panel.context.notPlaced") }}</td>
                    </tr>
                </tbody></table>
            </details>
            <details class="acv-inspector__fold" data-context-diagnostics>
                <summary>{{ t("panel.context.diagnostics") }} <span :class="ready.diagnostics.length > 0 ? 'acv-inspector__warn' : 'acv-inspector__muted'">{{ ready.diagnostics.length }}</span></summary>
                <p v-for="item in ready.diagnostics" :key="item.id" class="acv-inspector__note" :class="{'acv-inspector__warn': item.level !== 'info'}">{{ item.message }}</p>
            </details>
        </template>
    </div>
</template>

<style scoped>
.acv-inspector {
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--text-main);
    font-size: var(--text-xs);
}

.acv-inspector__state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 0;
    color: var(--text-secondary);
}

.acv-inspector__summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
}

.acv-inspector__bar {
    position: relative;
    display: flex;
    height: 10px;
    margin: 8px 0;
    border-radius: 4px;
    background: var(--bg-hover);
}

.acv-inspector__bar > span:first-child {
    border-radius: 4px 0 0 4px;
}

.acv-inspector__threshold {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    background: var(--text-main);
}

.acv-inspector__table {
    width: 100%;
    border-collapse: collapse;
}

.acv-inspector__table td {
    padding: 3px 0;
}

.acv-inspector__num {
    width: 72px;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.acv-inspector__dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 2px;
}

.acv-inspector__muted {
    color: var(--text-muted);
    font-weight: var(--weight-normal);
}

.acv-inspector__warn {
    color: var(--status-warning);
}

.acv-inspector__note {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-inspector__note.acv-inspector__warn {
    color: var(--status-warning);
}

.acv-inspector__heading {
    margin-bottom: 6px;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
}

.acv-inspector__stats {
    display: flex;
    gap: 24px;
    margin-bottom: 6px;
}

.acv-inspector__stats > div {
    display: flex;
    flex-direction: column;
}

.acv-inspector__stats b {
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
}

.acv-inspector__fold summary {
    cursor: pointer;
    font-weight: var(--weight-strong);
}

.acv-inspector__fold > :not(summary) {
    margin-top: 6px;
}

.acv-inspector__pre {
    max-height: 280px;
    overflow: auto;
    padding: 8px;
    border-radius: var(--radius-control);
    background: var(--bg-hover);
    font-size: var(--text-2xs);
    white-space: pre-wrap;
}
</style>
