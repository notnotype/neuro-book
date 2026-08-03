<script setup lang="ts">
import type { ChatNode, AgentMessage, AgentMessageSwitcherState } from "nbook/app/components/novel-ide/agent/agent-message";
import { messageStatusLabel } from "nbook/app/components/novel-ide/agent/agent-message";
import { useCollapsible } from "nbook/app/composables/useCollapsible";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import AgentBranchSwitcher from "nbook/app/components/novel-ide/agent/AgentBranchSwitcher.vue";
import AgentAttachmentGallery from "nbook/app/components/novel-ide/agent/AgentAttachmentGallery.vue";
import AgentAttachmentCard from "nbook/app/components/novel-ide/agent/AgentAttachmentCard.vue";
import AgentHistoryMessageEditor from "nbook/app/components/novel-ide/agent/AgentHistoryMessageEditor.vue";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {formatCost, formatCostExact, type CostDisplayOptions} from "nbook/app/utils/cost-format";
import {promptCacheHitRate, promptCacheTotalTokens, type PromptCacheUsage} from "nbook/app/utils/prompt-cache";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {canEditHistoryMessage} from "nbook/app/components/novel-ide/agent/agent-chat-history-ui";

const THINKING_SUMMARY_LENGTH = 48;
const SWIPE_MIN_DELTA_X = 48;
const SWIPE_MAX_DELTA_Y = 24;

const props = defineProps<{
    node: Extract<ChatNode, { kind: "text" }>;
    /** 当前 durable session；附件读取 locator 不能脱离 session 构造。 */
    sessionId?: number | null;
    editingMessageId?: string | null;
    /** 当前历史消息按 stored block 顺序重建的完整 Markdown。 */
    editingContent?: string;
    actionDisabled?: boolean;
    runActionDisabled?: boolean;
    savingEdit?: boolean;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    canRegisterAttachments: boolean;
    canInsertAttachments: boolean;
    projectRoot: string | null;
    modelSupportsImages: boolean;
    attachmentInsertRequest?: {id: number; item: AgentSessionAttachmentItemDto} | null;
    branchSwitcher?: AgentMessageSwitcherState;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    /** 打开消息 Markdown 中的 workspace 引用。 */
    openReference?: (target: string) => void;
    costDisplayOptions: CostDisplayOptions;
    costExchangeRateSuffix?: string;
}>();

const emit = defineEmits<{
    (e: "copy", message: AgentMessage): void;
    (e: "start-edit", message: AgentMessage): void;
    (e: "cancel-edit", message: AgentMessage): void;
    (e: "save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "retry", message: AgentMessage): void;
    /** 从这条消息新开一条分支；只移动 active leaf，不删除任何历史。 */
    (e: "branch-from-here", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
    (e: "resend-unknown", message: AgentMessage): void;
    (e: "dismiss-unknown", message: AgentMessage): void;
}>();

const { isCollapsed: isThinkingCollapsed, toggle: toggleThinking } = useCollapsible(true);
const editingDraft = ref("");
const isSystemCollapsed = ref(true);
const swipeStart = ref<{x: number; y: number} | null>(null);
const {t, locale} = useI18n();

/**
 * 编辑态统一解码 HTML 实体。
 * 这里主要修正历史上已经被写入消息内容的 `&gt;` / `&lt;` 等转义文本，
 * 并兼容 `&amp;gt;` 这类多重转义。
 */
const decodeEditableContent = (content: string): string => {
    let current = content;

    for (let index = 0; index < 3; index += 1) {
        let decoded = current;

        if (import.meta.client) {
            const textarea = document.createElement("textarea");
            textarea.innerHTML = current;
            decoded = textarea.value;
        } else {
            decoded = current
                .replace(/&amp;/g, "&")
                .replace(/&gt;/g, ">")
                .replace(/&lt;/g, "<")
                .replace(/&quot;/g, "\"")
                .replace(/&#039;|&#39;/g, "'");
        }

        if (decoded === current) {
            return decoded;
        }
        current = decoded;
    }

    return current;
};

/** 同步当前消息到编辑草稿。 */
const syncEditingDraft = (): void => {
    editingDraft.value = decodeEditableContent(props.editingContent ?? props.node.message.content);
};

/** 是否显示思维链。 */
const hasThinking = computed(() => {
    return Boolean(props.node.message.type === "ai" && props.node.message.thinking?.trim());
});

/** 是否显示正文气泡。 */
const hasMessageContent = computed(() => {
    return Boolean(props.node.message.content.trim() || props.node.message.contentBlocks?.length || props.node.message.attachments?.length);
});

/** 按自然段抽取折叠摘要。 */
const thinkingSummary = computed(() => {
    const thinking = props.node.message.thinking?.trim();
    if (!thinking) {
        return "";
    }

    const summaries = thinking
        .split(/\n\s*\n/g)
        .map((segment) => segment
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "")
        .filter((line) => line.length > 0)
        .map((line) => line.length > THINKING_SUMMARY_LENGTH
            ? `${line.slice(0, THINKING_SUMMARY_LENGTH)}...`
            : line,
        );

    return summaries.at(-1) ?? "";
});

/** 当前消息是否允许编辑。 */
const canEdit = computed(() => canEditHistoryMessage(props.node.message));

/** 当前消息是否处于编辑态。 */
const isEditing = computed(() => canEdit.value && props.editingMessageId === props.node.message.id);

/** 当前正文是否只是持久化消息的有界公开预览。 */
const isContentOmitted = computed(() => props.node.message.contentOmitted === true);

/** 当前消息是否允许重试。 */
const isUnknownDelivery = computed(() => props.node.message.deliveryState === "unknown");
const canRetry = computed(() => !isUnknownDelivery.value && (props.node.message.type === "user" || props.node.message.type === "ai"));

/** 是否为已进入历史的 steer 引导消息。 */
const isSteerMessage = computed(() => props.node.message.type === "user" && props.node.message.intent === "steer");

/** 普通消息头部图标。 */
const messageIconClass = computed(() => {
    if (props.node.message.type === "ai") {
        return "i-lucide-sparkles text-[var(--accent-text)]";
    }
    if (isSteerMessage.value) {
        return "i-lucide-corner-down-left text-[var(--accent-text)]";
    }
    return "i-lucide-user text-[var(--text-muted)]";
});

/** 普通消息头部标签。 */
const messageAuthorLabel = computed(() => {
    if (props.node.message.type === "ai") {
        return "Assistant";
    }
    return isSteerMessage.value ? t("agent.textBubble.steer") : "You";
});

/** 系统消息展示类型。 */
const systemDisplayKind = computed(() => props.node.message.systemDisplayKind ?? "system");

/** 是否为低权重运行时提醒。 */
const isSystemReminder = computed(() => systemDisplayKind.value === "reminder");
const isSystemError = computed(() => systemDisplayKind.value === "error");

/** 系统消息标题。 */
const systemLabel = computed(() => {
    if (props.node.message.systemLabel) {
        return props.node.message.systemLabel;
    }
    if (systemDisplayKind.value === "prompt") {
        return "System Prompt";
    }
    if (systemDisplayKind.value === "reminder") {
        return "System Reminder";
    }
    if (systemDisplayKind.value === "error") {
        return "Run Error";
    }
    return "System";
});

/** 当前 assistant 消息的 provider 调用用量。 */
const messageUsage = computed(() => props.node.message.type === "ai" ? props.node.message.usage : undefined);

/** 本次调用 token 明细 tooltip。 */
const messageUsageTitle = computed(() => {
    const usage = messageUsage.value;
    if (!usage) {
        return "";
    }
    const costLabel = formatCost(usage.cost.total, props.costDisplayOptions)
        ? t("agent.textBubble.usageCost", {
            compactCost: formatCost(usage.cost.total, props.costDisplayOptions),
            inputCost: formatCostExact(usage.cost.input, props.costDisplayOptions),
            outputCost: formatCostExact(usage.cost.output, props.costDisplayOptions),
            cacheReadCost: formatCostExact(usage.cost.cacheRead, props.costDisplayOptions),
            cacheWriteCost: formatCostExact(usage.cost.cacheWrite, props.costDisplayOptions),
            totalCost: formatCostExact(usage.cost.total, props.costDisplayOptions),
            suffix: props.costExchangeRateSuffix ?? "",
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

/** 当前调用是否有可计算的 prompt cache 命中率。 */
const messageCacheHitRateLabel = computed(() => {
    const usage = messageUsage.value;
    if (!usage || promptCacheTotalTokens(usage) <= 0) {
        return "";
    }
    return formatCacheHitRate(usage);
});

/** 本次调用费用标签；没有可展示价格时为空。 */
const messageCostLabel = computed(() => formatCost(messageUsage.value?.cost.total, props.costDisplayOptions));

/** 格式化精确 token 数。 */
function formatTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    return new Intl.NumberFormat(locale.value, {maximumFractionDigits: 0}).format(value);
}

/** 格式化紧凑 token 数。 */
function formatCompactTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    }
    return `${value}`;
}

/** 格式化百分比。 */
function formatPercent(value: number): string {
    return `${new Intl.NumberFormat(locale.value, {
        maximumFractionDigits: value >= 10 ? 0 : 1,
    }).format(value)}%`;
}

/** 格式化 prompt cache 命中率；口径见 `app/utils/prompt-cache.ts`，无从计算时显示 —。 */
function formatCacheHitRate(usage: PromptCacheUsage): string {
    const rate = promptCacheHitRate(usage);
    return rate === null ? "—" : formatPercent(rate);
}

/** 系统消息折叠摘要。 */
const systemSummary = computed(() => {
    const firstLine = props.node.message.content
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    return firstLine.length > 86 ? `${firstLine.slice(0, 86)}...` : firstLine;
});

/** 切换系统消息展开态。 */
const toggleSystem = (): void => {
    isSystemCollapsed.value = !isSystemCollapsed.value;
};

/**
 * 进入编辑态时同步草稿。
 */
watch(isEditing, (nextValue) => {
    if (nextValue) {
        syncEditingDraft();
    }
}, {immediate: true});

/**
 * System Prompt 和运行时系统卡片默认收起，避免新会话顶部过重。
 */
watch(() => props.node.message.id, () => {
    isSystemCollapsed.value = !isSystemError.value;
}, {immediate: true});

watch(() => props.editingContent, () => {
    if (isEditing.value) {
        syncEditingDraft();
    }
});

/**
 * 开始编辑当前消息。
 */
const startEdit = (): void => {
    if (!canEdit.value || props.actionDisabled || props.runActionDisabled) {
        return;
    }
    syncEditingDraft();
    emit("start-edit", props.node.message);
};

/**
 * 取消编辑当前消息。
 */
const cancelEdit = (): void => {
    syncEditingDraft();
    emit("cancel-edit", props.node.message);
};

/**
 * 保存编辑内容。
 */
const saveEdit = (): void => {
    const content = decodeEditableContent(editingDraft.value);
    if (!canEdit.value || !content.trim() || props.savingEdit || props.runActionDisabled) {
        return;
    }
    emit("save-edit", {
        message: props.node.message,
        content,
    });
};

/**
 * 切换到当前消息的上一条/下一条 continuation 分支。
 */
const cycleBranch = (direction: -1 | 1): void => {
    if (!props.branchSwitcher || props.actionDisabled) {
        return;
    }
    emit("cycle-branch", {
        messageId: props.node.message.id,
        direction,
    });
};

/**
 * 记录消息正文横向滑动起点。
 */
const startSwipe = (event: PointerEvent): void => {
    if (!props.branchSwitcher || props.actionDisabled || isEditing.value) {
        return;
    }
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
    swipeStart.value = {
        x: event.clientX,
        y: event.clientY,
    };
};

/**
 * 横向滑动切换消息分支，纵向滚动不拦截。
 */
const endSwipe = (event: PointerEvent): void => {
    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
    }
    if (!swipeStart.value || !props.branchSwitcher || props.actionDisabled || isEditing.value) {
        swipeStart.value = null;
        return;
    }
    const deltaX = event.clientX - swipeStart.value.x;
    const deltaY = event.clientY - swipeStart.value.y;
    swipeStart.value = null;
    if (Math.abs(deltaX) < SWIPE_MIN_DELTA_X || Math.abs(deltaY) > SWIPE_MAX_DELTA_Y) {
        return;
    }
    cycleBranch(deltaX < 0 ? 1 : -1);
};
</script>

<template>
    <!-- System 消息 -->
    <div v-if="props.node.message.type === 'system'" class="group flex min-w-0 w-full flex-col pl-6" :class="isSystemReminder ? 'my-2' : 'my-3'">
        <div class="flex min-w-0 w-full items-center gap-2">
            <button
                class="flex min-w-0 flex-1 items-center gap-2 rounded-md border text-left transition-colors"
                :class="isSystemError
                    ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)]'
                    : isSystemReminder
                        ? 'border-[var(--border-color)]/50 bg-[var(--bg-panel)]/45 px-2.5 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text-secondary)]'
                        : 'border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click="toggleSystem"
            >
                <span :class="isSystemError ? 'i-lucide-alert-triangle h-3.5 w-3.5' : isSystemReminder ? 'i-lucide-bell-ring h-3 w-3' : 'i-lucide-settings-2 h-3.5 w-3.5'" class="shrink-0"></span>
                <span class="shrink-0 font-medium uppercase tracking-[0.18em]">{{ systemLabel }}</span>
                <span v-if="isSystemCollapsed && systemSummary" class="min-w-0 flex-1 truncate normal-case tracking-normal opacity-75">{{ systemSummary }}</span>
                <span v-else class="min-w-0 flex-1"></span>
                <span :class="isSystemCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="h-3.5 w-3.5 shrink-0"></span>
            </button>
            <!-- 跑挂的运行也是一条分支；没有它用户切不回上一个成功的回答。 -->
            <AgentBranchSwitcher
                v-if="isSystemError && props.branchSwitcher"
                :state="props.branchSwitcher"
                :disabled="props.actionDisabled || props.runActionDisabled"
                @cycle="cycleBranch"
            />
        </div>

        <div v-show="!isSystemCollapsed" class="mt-2 min-w-0 w-full">
            <div
                class="min-w-0 max-w-full overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)]/55 px-3 py-2 shadow-sm"
                :class="isSystemError ? 'max-h-[240px] border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]' : isSystemReminder ? 'max-h-[180px]' : 'max-h-[320px]'"
            >
                <div v-if="props.node.message.content" class="min-w-0 text-xs leading-relaxed" :class="isSystemError ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'">
                    <AgentMarkdownContent :content="props.node.message.content" :html="props.node.message.html" :open-reference="props.openReference" />
                </div>
            </div>
        </div>
    </div>

    <!-- 用户 / Assistant 消息 -->
    <div v-else class="group flex min-w-0 w-full flex-col items-start">
        <!-- 消息头部 -->
        <div class="mb-1.5 ml-1 flex w-full items-center gap-2">
            <div
                class="flex h-4 w-4 items-center justify-center rounded-full border"
                :class="props.node.message.type === 'ai' ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]'"
            >
                <span :class="messageIconClass" class="h-2.5 w-2.5"></span>
            </div>
            <span class="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--text-main)]">
                {{ messageAuthorLabel }}
            </span>
            <span v-if="props.node.message.model" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {{ props.node.message.model }}
            </span>
            <span v-if="props.node.message.timestamp" class="text-[10px] text-[var(--text-muted)]">{{ props.node.message.timestamp }}</span>
            <span v-if="messageStatusLabel(props.node.message)" class="rounded border border-[var(--border-color)] bg-[var(--bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {{ messageStatusLabel(props.node.message) }}
            </span>

            <div class="flex-1"></div>

            <div class="mr-4 flex items-center gap-1 text-[var(--text-muted)]">
                <button v-if="isUnknownDelivery" class="rounded p-1 text-[var(--status-warning)] transition-colors hover:bg-[var(--bg-hover)]" title="确认可能重复后重新发送" @click="emit('resend-unknown', props.node.message)">
                    <span class="i-lucide-send h-3.5 w-3.5"></span>
                </button>
                <button v-if="isUnknownDelivery" class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--status-danger)]" title="移除本地未知占位" @click="emit('dismiss-unknown', props.node.message)">
                    <span class="i-lucide-x h-3.5 w-3.5"></span>
                </button>
                <AgentBranchSwitcher
                    v-if="props.branchSwitcher"
                    class="mr-1"
                    :state="props.branchSwitcher"
                    :disabled="props.actionDisabled || props.runActionDisabled"
                    @cycle="cycleBranch"
                />
                <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" :title="isContentOmitted ? t('agent.textBubble.copyPreview') : t('agent.textBubble.copy')" @click="emit('copy', props.node.message)">
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                </button>
                <button v-if="canEdit" class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled || props.runActionDisabled" :title="t('agent.textBubble.edit')" @click="startEdit">
                    <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                </button>
                <button v-if="canRetry" class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled || props.runActionDisabled" :title="t('agent.textBubble.retry')" @click="emit('retry', props.node.message)">
                    <span class="i-lucide-rotate-cw h-3.5 w-3.5"></span>
                </button>
                <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled || props.runActionDisabled" :title="t('agent.textBubble.branchFromHere')" @click="emit('branch-from-here', props.node.message)">
                    <span class="i-lucide-git-branch-plus h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <!-- Assistant 思维链 -->
        <div v-if="hasThinking" class="mb-1 w-full pl-6">
            <div class="px-0.5 py-0.5">
                <button
                    class="flex w-full items-center gap-1.5 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]/90 transition-colors hover:text-[var(--text-main)]"
                    @click="toggleThinking"
                >
                    <span :class="isThinkingCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3 w-3 shrink-0"></span>
                    <span class="i-lucide-brain-circuit h-3 w-3 shrink-0"></span>
                    <span
                        v-if="isThinkingCollapsed"
                        class="min-w-0 flex-1 truncate text-[11px] normal-case tracking-normal text-[var(--text-muted)]/75"
                    >
                        {{ thinkingSummary }}
                    </span>
                    <span v-else class="text-[10px] normal-case tracking-normal text-[var(--text-muted)]/65">{{ t("agent.textBubble.collapse") }}</span>
                </button>

                <div v-if="!isThinkingCollapsed" class="mt-1.5 border-l border-[var(--border-color)]/40 pl-3 text-[13px] leading-relaxed text-[var(--text-muted)]/85">
                    <AgentMarkdownContent :content="props.node.message.thinking ?? ''" :streaming="props.node.message.status === 'streaming'" :open-reference="props.openReference" />
                </div>
            </div>
        </div>

        <!-- 消息正文 -->
        <div
            v-if="hasMessageContent"
            class="min-w-0 w-full touch-pan-y pl-6"
            @pointerdown="startSwipe"
            @pointerup="endSwipe"
            @pointercancel="swipeStart = null"
        >
            <div
                class="min-w-0 max-w-full rounded-2xl border border-[var(--border-color)] bg-[var(--chat-ai-bg)] px-4 py-3 shadow-sm"
                :class="props.node.message.error ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]' : ''"
            >
                <div v-if="isEditing" class="space-y-3">
                    <!-- 消息编辑器 -->
                    <AgentHistoryMessageEditor
                        v-model="editingDraft"
                        :session-id="props.sessionId ?? null"
                        :session-attachments="props.sessionAttachments"
                        :can-register-attachments="props.canRegisterAttachments"
                        :can-insert-attachments="props.canInsertAttachments"
                        :readonly="Boolean(props.runActionDisabled)"
                        :saving="Boolean(props.savingEdit)"
                        :menu-refresh-key="props.menuRefreshKey"
                        :resolve-menu="props.resolveMenu"
                        :on-skill-trigger-start="props.onSkillTriggerStart"
                        :project-root="props.projectRoot"
                        :model-supports-images="props.modelSupportsImages"
                        :attachment-insert-request="props.attachmentInsertRequest"
                        @cancel="cancelEdit"
                        @save="saveEdit"
                        @attachment-registered="emit('attachment-registered', $event)"
                    />
                </div>
                <div v-else class="min-w-0 text-sm leading-relaxed text-[var(--text-main)]">
                    <!-- 新 durable user DTO 按原始 contentIndex 保序；其他消息继续走原正文路径。 -->
                    <template v-if="props.node.message.contentBlocks?.length">
                        <div v-for="(block, blockIndex) in props.node.message.contentBlocks" :key="`${block.type}:${block.contentIndex}`" :class="blockIndex > 0 ? 'mt-3' : ''">
                            <AgentMarkdownContent v-if="block.type === 'text'" :content="block.content.preview" :open-reference="props.openReference" />
                            <AgentAttachmentCard
                                v-else
                                :session-id="props.sessionId"
                                :entry-id="block.locator?.entryId ?? props.node.message.id"
                                :content-index="block.locator?.contentIndex ?? block.contentIndex"
                                :attachment="block.attachment"
                            />
                        </div>
                    </template>
                    <template v-else>
                        <AgentMarkdownContent v-if="props.node.message.content" :content="props.node.message.content" :html="props.node.message.html" :streaming="props.node.message.status === 'streaming'" :open-reference="props.openReference" />
                        <AgentAttachmentGallery
                            v-if="props.node.message.attachments?.length"
                            :attachments="props.node.message.attachments"
                            :session-id="props.sessionId"
                            :entry-id="props.node.message.id"
                        />
                    </template>
                    <div v-if="isContentOmitted" class="mt-3 flex items-center gap-1.5 border-t border-[var(--border-color)] pt-2 text-[11px] text-[var(--status-info)]">
                        <span class="i-lucide-info h-3.5 w-3.5 shrink-0"></span>
                        <span>{{ t("agent.textBubble.previewOnly", {bytes: props.node.message.contentBytes ?? 0}) }}</span>
                    </div>
                    <div v-if="(props.node.message.omittedToolCalls ?? 0) > 0" class="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--status-info)]"><span class="i-lucide-info h-3.5 w-3.5 shrink-0"></span><span>另有 {{ props.node.message.omittedToolCalls }} 个工具调用未在历史预览中显示</span></div>
                </div>
            </div>
        </div>

        <!-- token 尾部 -->
        <div v-if="messageUsage" class="mt-1 flex w-full items-center pl-6 text-[var(--text-muted)]">
            <div class="flex-1"></div>
            <div class="flex items-center gap-1 text-[10px] text-[var(--text-muted)]" :title="messageUsageTitle">
                <span class="i-lucide-zap mr-1 h-3 w-3"></span>
                <span>{{ t("agent.textBubble.thisTurn", {value: formatCompactTokenCount(messageUsage.totalTokens)}) }}</span>
                <span class="i-lucide-arrow-down h-3 w-3"></span>
                <span>{{ formatCompactTokenCount(messageUsage.input) }}</span>
                <span class="i-lucide-arrow-up h-3 w-3"></span>
                <span>{{ formatCompactTokenCount(messageUsage.output) }}</span>
                <span class="i-lucide-database-zap h-3 w-3"></span>
                <span>{{ formatCompactTokenCount(messageUsage.cacheRead) }}</span>
                <template v-if="messageCacheHitRateLabel">
                    <span class="i-lucide-percent h-3 w-3"></span>
                    <span>{{ messageCacheHitRateLabel }}</span>
                </template>
                <template v-if="messageUsage.cacheWrite">
                    <span class="i-lucide-hard-drive-upload h-3 w-3"></span>
                    <span>{{ formatCompactTokenCount(messageUsage.cacheWrite) }}</span>
                </template>
                <template v-if="messageCostLabel">
                    <span class="i-lucide-circle-dollar-sign h-3 w-3"></span>
                    <span>{{ t("agent.textBubble.thisTurn", {value: messageCostLabel}) }}</span>
                </template>
            </div>
        </div>
    </div>
</template>
