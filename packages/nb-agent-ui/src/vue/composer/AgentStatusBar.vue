<script setup lang="ts">
/**
 * 输入框下面一行小字（docs/specs/agent/conversation.md 输出 15–18）。左边是现在怎样了，右边是累计的用量，图标与轮末的用量相同。
 * 视图不自己计时：用时按宿主给的 `ctx.now` 算。
 */
import {computed} from "vue";
import {Spinner, Tooltip} from "@notnotype/nb-ui/components";

import {formatCost, formatDuration, formatTokens} from "../../process-summary";
import {visibleEntries} from "../../registry";
import type {AgentViewRegistry} from "../../registry";
import type {AgentConversationContext} from "../../types";
import {useAgentText} from "../host";
import AgentContextMeter from "./AgentContextMeter.vue";

const props = defineProps<{
    ctx: AgentConversationContext;
    registry: AgentViewRegistry;
}>();

const {t} = useAgentText();

/** 停止超过这么久还没停下，多半是工具不理会中止。 */
const STOP_SLOW_MS = 10_000;

const items = computed(() => visibleEntries(props.registry.list("statusItems"), props.ctx));
const usage = computed(() => props.ctx.usage);
const elapsed = computed(() => {
    const started = props.ctx.run.startedAt;
    return started === undefined || started === null ? null : Math.max(0, props.ctx.now - started);
});

/** 左边的运行状态，同一时间只有一个。 */
const phase = computed<{text: string; tone: "normal" | "warn" | "wait"; spin: boolean} | null>(() => {
    const {run} = props.ctx;
    const time = elapsed.value === null ? "" : ` ${formatDuration(elapsed.value)}`;
    if (run.status === "waiting") {
        const approvals = props.ctx.pendingInputs.some((item) => item.kind === "approval");
        return {text: approvals ? t("wizard.waitingApproval") : t("wizard.waitingAnswer"), tone: "wait", spin: false};
    }
    if (run.status === "stopping") {
        const slow = elapsed.value !== null && props.ctx.stopRequestedAt !== undefined && props.ctx.now - props.ctx.stopRequestedAt > STOP_SLOW_MS;
        return {text: slow ? t("status.stopSlow") : t("status.stopping"), tone: slow ? "warn" : "normal", spin: true};
    }
    if (run.status !== "running") return null;
    if (run.retry !== undefined && run.retry !== null) {
        const seconds = Math.max(0, Math.ceil((run.retry.resumeAt - props.ctx.now) / 1000));
        return {text: t("status.retry", {attempt: run.retry.attempt, max: run.retry.max, seconds}), tone: "warn", spin: true};
    }
    return {text: `${run.phase}${time}`, tone: "normal", spin: true};
});

const yolo = computed(() => {
    const approval = props.ctx.composer.approval;
    return approval?.options.find((option) => option.key === approval.value)?.danger === true;
});
const disconnected = computed(() => props.ctx.connection.status !== "connected");

const costText = computed(() => {
    const {cost, currency} = usage.value;
    if (cost === null) return null;
    return cost === 0 ? t("status.free") : formatCost(cost, currency);
});
const costTitle = computed(() => (usage.value.costState === "unpriced" ? t("status.unpriced") : undefined));
const detail = computed(() => t("status.detail", {
    input: formatTokens(usage.value.input ?? 0),
    output: formatTokens(usage.value.output ?? 0),
    cacheRead: formatTokens(usage.value.cacheRead),
    cacheWrite: formatTokens(usage.value.cacheWrite),
}));
const hasUsage = computed(() => usage.value.totalTokens > 0);
const cachePercent = computed(() => (usage.value.cacheHitRate === null ? null : `${String(Math.round(usage.value.cacheHitRate * 100))}%`));
</script>

<template>
    <div class="acv-status" data-agent-status>
        <AgentContextMeter v-if="usage.contextLimit !== null && usage.contextLimit > 0" :used="usage.contextTokens" :limit="usage.contextLimit" />
        <span v-else-if="usage.contextTokens > 0" class="acv-status__context">{{ formatTokens(usage.contextTokens) }}</span>
        <span v-if="phase !== null" class="acv-status__phase" :data-tone="phase.tone" data-status-phase>
            <span v-if="phase.tone === 'wait'" class="acv-status__dot" aria-hidden="true" />
            <Spinner v-else-if="phase.spin" size="sm" :label="phase.text" />
            <span class="acv-status__text">{{ phase.text }}</span>
        </span>
        <span v-if="usage.costState === 'warned'" class="acv-status__flag is-warn" data-status-cost-warned>{{ t("status.costWarned") }}</span>
        <span v-if="yolo" class="acv-status__flag is-danger" data-status-yolo><span class="i-lucide-triangle-alert" aria-hidden="true" />{{ t("status.yolo") }}</span>
        <span v-if="disconnected" class="acv-status__flag is-warn" data-status-connection>{{ props.ctx.connection.status === "connecting" ? t("status.connecting") : t("status.disconnected") }}</span>
        <component :is="item.component" v-for="item in items" :key="item.id" :ctx="props.ctx" />
        <span class="acv-status__spacer" />
        <Tooltip v-if="hasUsage" :text="detail" side="top">
            <span class="acv-status__usage" tabindex="0" :aria-label="detail" data-status-usage>
                <span class="acv-status__metric"><span class="i-lucide-zap" aria-hidden="true" />{{ formatTokens(usage.totalTokens) }}</span>
                <span class="acv-status__metric"><span class="i-lucide-arrow-down" aria-hidden="true" />{{ formatTokens(usage.input ?? 0) }}</span>
                <span class="acv-status__metric"><span class="i-lucide-arrow-up" aria-hidden="true" />{{ formatTokens(usage.output ?? 0) }}</span>
                <span v-if="cachePercent !== null" class="acv-status__metric"><span class="i-lucide-database-zap" aria-hidden="true" />{{ cachePercent }}</span>
            </span>
        </Tooltip>
        <span v-if="costText !== null" class="acv-status__metric acv-status__cost" :class="{'is-warn': usage.costState === 'warned'}" :title="costTitle" data-status-cost>
            <span class="i-lucide-circle-dollar-sign" aria-hidden="true" />{{ costText }}
        </span>
    </div>
</template>

<style scoped>
.acv-status {
    /* 下面的窄宽规则按状态栏自己的宽度：它的祖先没有别的查询容器。 */
    container-type: inline-size;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 24px;
    padding: 0 12px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    white-space: nowrap;
}

.acv-status__phase {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
}

.acv-status__text {
    overflow: hidden;
    text-overflow: ellipsis;
}

.acv-status__phase[data-tone="warn"],
.acv-status__flag.is-warn,
.acv-status__cost.is-warn {
    color: var(--status-warning);
}

.acv-status__phase[data-tone="wait"] {
    color: var(--accent-text);
}

.acv-status__flag {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 3px;
}

.acv-status__flag.is-danger {
    color: var(--status-danger);
}

.acv-status__dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-main);
}

.acv-status__spacer {
    flex: 1;
}

.acv-status__usage {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    border-radius: 3px;
}

.acv-status__usage:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-status__metric {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    font-variant-numeric: tabular-nums;
}

/* 窄的时候先让出明细，用量明细都在悬停里。左边有不收缩的提醒（费用告警、全部放行）时要让得更早。 */
@container (max-width: 380px) {
    .acv-status__usage .acv-status__metric:not(:first-child) {
        display: none;
    }
}

@container (max-width: 460px) {
    .acv-status:has(.acv-status__flag) .acv-status__usage .acv-status__metric:not(:first-child) {
        display: none;
    }
}
</style>
