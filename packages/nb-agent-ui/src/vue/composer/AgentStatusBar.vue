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

const emit = defineEmits<{(e: "inspect"): void}>();

const inspectable = computed(() => props.ctx.interaction.canInspectContext === true);

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
/** 不是默认模式才标出来：默认模式没什么要提醒的。 */
const modeFlag = computed(() => {
    const {modes, mode} = props.ctx.composer;
    return mode !== modes[0]?.key ? modes.find((item) => item.key === mode) ?? null : null;
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
        <div class="acv-status__left">
        <AgentContextMeter v-if="usage.contextLimit !== null && usage.contextLimit > 0" :used="usage.contextTokens" :limit="usage.contextLimit" :interactive="inspectable" @inspect="emit('inspect')" />
        <span v-else-if="usage.contextTokens > 0" class="acv-status__context">{{ formatTokens(usage.contextTokens) }}</span>
        <span v-if="phase !== null" class="acv-status__phase" :data-tone="phase.tone" data-status-phase>
            <span v-if="phase.tone === 'wait'" class="acv-status__dot" aria-hidden="true" />
            <Spinner v-else-if="phase.spin" size="sm" :label="phase.text" />
            <span class="acv-status__text">{{ phase.text }}</span>
        </span>
        <span v-if="usage.costState === 'warned'" class="acv-status__flag is-warn" data-status-cost-warned>{{ t("status.costWarned") }}</span>
        <span v-if="modeFlag" class="acv-status__flag is-accent" data-status-mode><span :class="modeFlag.icon ?? 'i-lucide-circle-dot'" aria-hidden="true" />{{ t("status.modeFlag", {mode: modeFlag.label}) }}</span>
        <span v-if="yolo" class="acv-status__flag is-danger" data-status-yolo><span class="i-lucide-triangle-alert" aria-hidden="true" />{{ t("status.yolo") }}</span>
        <span v-if="disconnected" class="acv-status__flag is-warn" data-status-connection>{{ props.ctx.connection.status === "connecting" ? t("status.connecting") : t("status.disconnected") }}</span>
        <component :is="item.component" v-for="item in items" :key="item.id" :ctx="props.ctx" />
        </div>
        <Tooltip v-if="hasUsage" :text="detail" side="top">
            <span class="acv-status__usage" tabindex="0" :aria-label="detail" data-status-usage>
                <span class="acv-status__metric acv-status__metric--detail"><span class="i-lucide-zap" aria-hidden="true" />{{ formatTokens(usage.totalTokens) }}</span>
                <span class="acv-status__metric acv-status__metric--detail"><span class="i-lucide-arrow-down" aria-hidden="true" />{{ formatTokens(usage.input ?? 0) }}</span>
                <span class="acv-status__metric acv-status__metric--detail"><span class="i-lucide-arrow-up" aria-hidden="true" />{{ formatTokens(usage.output ?? 0) }}</span>
                <component
                    :is="inspectable ? 'button' : 'span'"
                    v-if="cachePercent !== null"
                    v-bind="inspectable ? {type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('panel.context.open')} : {}"
                    class="acv-status__metric"
                    :class="{'is-button': inspectable}"
                    data-status-cache
                    @click="inspectable && emit('inspect')"
                ><span class="i-lucide-database-zap" aria-hidden="true" />{{ cachePercent }}</component>
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

/* 左边放不下时先省略，右边的用量不收缩。 */
.acv-status__left {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 6px;
    /* 裁剪的边往外让一点：圆环能点，焦点环要看得见。 */
    margin: -4px 0 -4px -4px;
    padding: 4px 0 4px 4px;
    overflow: hidden;
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
    min-width: 0;
    align-items: center;
    gap: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.acv-status__flag.is-accent {
    color: var(--accent-text);
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

.acv-status__metric.is-button {
    border-radius: 3px;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.acv-status__metric.is-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.acv-status__metric.is-button:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

/* 窄的时候右边只留缓存命中与费用（开发者 2026-11-06），累计、输入、输出在悬停里。右栏默认就窄，缓存命中不能让。 */
@container (max-width: 400px) {
    .acv-status__metric--detail {
        display: none;
    }

    /* 服务商不报缓存时留累计：悬停明细要有个地方可指。 */
    .acv-status__usage:not(:has([data-status-cache])) .acv-status__metric--detail:first-child {
        display: inline-flex;
    }
}

</style>
