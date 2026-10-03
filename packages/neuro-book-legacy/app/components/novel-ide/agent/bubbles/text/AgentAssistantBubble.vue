<script setup lang="ts">
import {computed} from "vue";
import type {AgentMessage, AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";
import {messageStatusLabel} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMessageActionBar from "../base/AgentMessageActionBar.vue";
import AgentThinkingCollapsible from "../base/AgentThinkingCollapsible.vue";
import AgentMarkdownContent from "../base/AgentMarkdownContent.vue";
import AgentAttachmentGallery from "../base/AgentAttachmentGallery.vue";
import {formatCost, formatCostExact, type CostDisplayOptions} from "nbook/app/utils/cost-format";
import {promptCacheHitRate, promptCacheTotalTokens, type PromptCacheUsage} from "nbook/app/utils/prompt-cache";

const props = withDefaults(defineProps<{
    message: AgentMessage;
    sessionId?: number | null;
    actionDisabled?: boolean;
    runActionDisabled?: boolean;
    branchSwitcher?: AgentMessageSwitcherState;
    openReference?: (target: string) => void;
    costDisplayOptions?: CostDisplayOptions;
    costExchangeRateSuffix?: string;
}>(), {
    sessionId: null,
    actionDisabled: false,
    runActionDisabled: false,
    costDisplayOptions: () => ({ currency: "USD", exchangeRate: 1 }),
    costExchangeRateSuffix: "",
});

const emit = defineEmits<{
    (e: "copy", message: AgentMessage): void;
    (e: "retry", message: AgentMessage): void;
    (e: "branch-from-here", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
}>();

const {t, locale} = useI18n();

const isContentOmitted = computed(() => props.message.contentOmitted === true);
const hasThinking = computed(() => Boolean(props.message.thinking?.trim()));
const hasMessageContent = computed(() => Boolean(props.message.content.trim() || props.message.attachments?.length));

const messageUsage = computed(() => props.message.usage);

const messageUsageTitle = computed(() => {
    const usage = messageUsage.value;
    if (!usage) return "";
    const costLabel = formatCost(usage.cost.total, props.costDisplayOptions)
        ? t("agent.textBubble.usageCost", {
            compactCost: formatCost(usage.cost.total, props.costDisplayOptions),
            inputCost: formatCostExact(usage.cost.input, props.costDisplayOptions),
            outputCost: formatCostExact(usage.cost.output, props.costDisplayOptions),
            cacheReadCost: formatCostExact(usage.cost.cacheRead, props.costDisplayOptions),
            cacheWriteCost: formatCostExact(usage.cost.cacheWrite, props.costDisplayOptions),
            totalCost: formatCostExact(usage.cost.total, props.costDisplayOptions),
            suffix: props.costExchangeRateSuffix || "",
        })
        : "";
    return t("agent.textBubble.usageTitle", {
        total: formatTokenCount(usage.totalTokens),
        input: formatTokenCount(usage.input),
        output: formatTokenCount(usage.output),
        cacheRead: formatTokenCount(usage.cacheRead),
        cacheWrite: formatTokenCount(usage.cacheWrite),
        hitRate: formatCacheHitRate(usage),
        cost: costLabel,
    });
});

const messageCacheHitRateLabel = computed(() => {
    const usage = messageUsage.value;
    if (!usage || promptCacheTotalTokens(usage) <= 0) return "";
    return formatCacheHitRate(usage);
});

const messageCostLabel = computed(() => formatCost(messageUsage.value?.cost.total, props.costDisplayOptions));

function formatTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return new Intl.NumberFormat(locale.value, {maximumFractionDigits: 0}).format(value);
}

function formatCompactTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    return `${value}`;
}

function formatPercent(value: number): string {
    return `${new Intl.NumberFormat(locale.value, {
        maximumFractionDigits: value >= 10 ? 0 : 1,
    }).format(value)}%`;
}

function formatCacheHitRate(usage: PromptCacheUsage): string {
    const rate = promptCacheHitRate(usage);
    return rate === null ? "—" : formatPercent(rate);
}

const cycleBranch = (direction: -1 | 1): void => {
    if (!props.branchSwitcher || props.actionDisabled) return;
    emit("cycle-branch", {messageId: props.message.id, direction});
};
</script>

<template>
    <div class="agent-assistant-bubble group flex min-w-0 w-full flex-col items-start select-none">
        <!-- 头部栏 -->
        <div class="mb-1.5 ml-1 flex w-full items-center gap-2">
            <div class="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--accent-main)] bg-[var(--accent-bg)]">
                <span class="i-lucide-sparkles h-2.5 w-2.5 text-[var(--accent-text)]" />
            </div>
            <span class="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--text-main)]">
                Assistant
            </span>
            <span v-if="props.message.model" class="rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {{ props.message.model }}
            </span>
            <span v-if="props.message.timestamp" class="text-[10px] text-[var(--text-muted)]">
                {{ props.message.timestamp }}
            </span>
            <span v-if="messageStatusLabel(props.message)" class="rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {{ messageStatusLabel(props.message) }}
            </span>

            <div class="flex-1" />

            <!-- 操作条 -->
            <AgentMessageActionBar
                :can-retry="true"
                :is-content-omitted="isContentOmitted"
                :action-disabled="props.actionDisabled"
                :run-action-disabled="props.runActionDisabled"
                :branch-switcher="props.branchSwitcher"
                @copy="emit('copy', props.message)"
                @retry="emit('retry', props.message)"
                @branch-from-here="emit('branch-from-here', props.message)"
                @cycle-branch="cycleBranch"
            />
        </div>

        <!-- Assistant 思维链 -->
        <AgentThinkingCollapsible
            v-if="hasThinking"
            :thinking="props.message.thinking || ''"
            :streaming="props.message.status === 'streaming'"
            :open-reference="props.openReference"
        />

        <!-- 消息正文 -->
        <div v-if="hasMessageContent" class="min-w-0 w-full pl-6 select-text">
            <div
                class="min-w-0 max-w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-subtle)] px-4 py-3 shadow-sm"
                :class="props.message.error ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]' : ''"
            >
                <div class="min-w-0 text-sm leading-relaxed text-[var(--text-main)]">
                    <AgentMarkdownContent
                        v-if="props.message.content"
                        :content="props.message.content"
                        :html="props.message.html"
                        :streaming="props.message.status === 'streaming'"
                        :open-reference="props.openReference"
                    />
                    <AgentAttachmentGallery
                        v-if="props.message.attachments?.length"
                        :attachments="props.message.attachments"
                        :session-id="props.sessionId"
                        :entry-id="props.message.id"
                    />

                    <!-- 截断或只读预览提示 -->
                    <div v-if="isContentOmitted" class="mt-3 flex items-center gap-1.5 border-t border-[var(--border-color)] pt-2 text-[11px] text-[var(--status-info)]">
                        <span class="i-lucide-info h-3.5 w-3.5 shrink-0" />
                        <span>{{ t("agent.textBubble.previewOnly", {bytes: props.message.contentBytes ?? 0}) }}</span>
                    </div>

                    <!-- 用户主动取消运行 -->
                    <div v-if="props.message.status === 'interrupted'" class="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <span class="i-lucide-square h-3.5 w-3.5 shrink-0" />
                        <span>{{ t("agent.textBubble.interrupted") || "运行已被用户取消" }}</span>
                    </div>

                    <div v-if="(props.message.omittedToolCalls ?? 0) > 0" class="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--status-info)]">
                        <span class="i-lucide-info h-3.5 w-3.5 shrink-0" />
                        <span>另有 {{ props.message.omittedToolCalls }} 个工具调用未在历史预览中显示</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- token 与费用统计尾部 -->
        <div v-if="messageUsage" class="mt-1 flex w-full items-center pl-6 text-[var(--text-muted)] select-none">
            <div class="flex-1" />
            <div class="flex items-center gap-1 text-[10px] text-[var(--text-muted)]" :title="messageUsageTitle">
                <span class="i-lucide-zap mr-1 h-3 w-3" />
                <span>{{ t("agent.textBubble.thisTurn", {value: formatCompactTokenCount(messageUsage.totalTokens)}) }}</span>
                <span class="i-lucide-arrow-down h-3 w-3" />
                <span>{{ formatCompactTokenCount(messageUsage.input) }}</span>
                <span class="i-lucide-arrow-up h-3 w-3" />
                <span>{{ formatCompactTokenCount(messageUsage.output) }}</span>
                <span class="i-lucide-database-zap h-3 w-3" />
                <span>{{ formatCompactTokenCount(messageUsage.cacheRead) }}</span>
                <template v-if="messageCacheHitRateLabel">
                    <span class="i-lucide-percent h-3 w-3" />
                    <span>{{ messageCacheHitRateLabel }}</span>
                </template>
                <template v-if="messageUsage.cacheWrite">
                    <span class="i-lucide-hard-drive-upload h-3 w-3" />
                    <span>{{ formatCompactTokenCount(messageUsage.cacheWrite) }}</span>
                </template>
                <template v-if="messageCostLabel">
                    <span class="i-lucide-circle-dollar-sign h-3 w-3" />
                    <span>{{ t("agent.textBubble.thisTurn", {value: messageCostLabel}) }}</span>
                </template>
            </div>
        </div>
    </div>
</template>
