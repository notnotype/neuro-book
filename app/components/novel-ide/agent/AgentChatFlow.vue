<script setup lang="ts">
import type { AgentMessage, AgentMessageSwitcherState, AgentToolCall, ChatNode } from "nbook/app/components/novel-ide/agent/agent-message";
import { toChatNodes } from "nbook/app/components/novel-ide/agent/agent-message";
import AgentTextBubble from "nbook/app/components/novel-ide/agent/AgentTextBubble.vue";
import AgentToolBubble from "nbook/app/components/novel-ide/agent/AgentToolBubble.vue";
import type {CostDisplayOptions} from "nbook/app/utils/cost-format";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {
    prependAnchoredScrollTop,
    shouldAutoScrollChat,
    shouldLoadPreviousHistory,
} from "nbook/app/components/novel-ide/agent/agent-chat-history-ui";

const AUTO_SCROLL_RELEASE_THRESHOLD_PX = 12;

const props = defineProps<{
    /** 消息列表。 */
    messages: AgentMessage[];
    /** 当前 session ID；变化时认为是整段历史切换，需要立即定位到底部。 */
    sessionId?: number | null;
    /** 是否正在执行中。 */
    running: boolean;
    /** 模式区分。main 显示空状态引导，compact 显示简洁空状态。 */
    mode: "main" | "compact";
    /** 当前处于编辑态的消息 ID。 */
    editingMessageId?: string | null;
    /** 当前编辑消息的完整 Markdown；可能来自按需 user-content 请求。 */
    editingMessageText?: string;
    /** 是否禁用消息工具栏动作。 */
    messageActionDisabled?: boolean;
    /** 是否禁用会重新触发运行的消息动作。 */
    runActionDisabled?: boolean;
    /** 当前是否正在提交编辑。 */
    savingEdit?: boolean;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    canRegisterAttachments: boolean;
    canInsertAttachments: boolean;
    projectRoot: string | null;
    modelSupportsImages: boolean;
    attachmentInsertRequest?: {id: number; item: AgentSessionAttachmentItemDto} | null;
    /** 消息级分支切换状态，按承载切换器的气泡 id 建索引。 */
    branchSwitcherStateByMessageId?: Record<string, AgentMessageSwitcherState>;
    /** 编辑器触发菜单刷新 key。 */
    menuRefreshKey?: string | number;
    /** 编辑器触发菜单解析器。 */
    resolveEditorMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    /** 编辑器触发技能菜单时的刷新钩子。 */
    onEditorSkillTriggerStart?: () => void;
    /** 打开消息 Markdown 中的 workspace 引用。 */
    openReference?: (target: string) => void;
    /** 费用显示币种与汇率。 */
    costDisplayOptions: CostDisplayOptions;
    /** 费用 tooltip 汇率说明。 */
    costExchangeRateSuffix?: string;
    /** 当前 durable history 是否还有更早一页。 */
    historyHasPrevious?: boolean;
    /** 是否正在加载更早历史。 */
    historyLoading?: boolean;
    /** 更早历史的局部加载错误。 */
    historyError?: string;
}>();

const emit = defineEmits<{
    (e: "copy", message: AgentMessage): void;
    (e: "copy-tool", toolCall: AgentToolCall): void;
    (e: "start-edit", message: AgentMessage): void;
    (e: "cancel-edit", message: AgentMessage): void;
    (e: "save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "retry", message: AgentMessage): void;
    /** 从这条消息新开一条分支；只移动 active leaf，不删除任何历史。 */
    (e: "branch-from-here", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
    (e: "load-previous"): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
    (e: "resend-unknown", message: AgentMessage): void;
    (e: "dismiss-unknown", message: AgentMessage): void;
}>();

const scrollRef = ref<HTMLDivElement | null>(null);
const shouldStickToBottom = ref(true);
const lastScrollTop = ref(0);
let pendingImmediateScroll = true;
let autoScrollFrame: number | null = null;
let pendingPrependAnchor: {
    sessionId: number | null;
    firstMessageId: string;
    scrollHeight: number;
    scrollTop: number;
} | null = null;
const {t} = useI18n();

const chatNodes = computed(() => {
    return toChatNodes(props.messages);
});

/** 轻量追踪最后一条消息的渲染尺寸变化，避免 deep watch 扫描整棵消息树。 */
const messageScrollSignature = computed(() => {
    const lastMessage = props.messages.at(-1);
    const lastToolCall = lastMessage?.toolCalls?.at(-1);
    return [
        props.messages.length,
        lastMessage?.id ?? "",
        lastMessage?.status ?? "",
        lastMessage?.content.length ?? 0,
        lastMessage?.thinking?.length ?? 0,
        lastToolCall?.id ?? "",
        lastToolCall?.status ?? "",
        lastToolCall?.argsText.length ?? 0,
        lastToolCall?.result?.length ?? 0,
    ].join(":");
});

const getNodeKey = (node: ReturnType<typeof toChatNodes>[0]) => {
    if (node.kind === 'tool') return `${node.message.id}-${node.toolCall.id}`;
    return `${node.message.id}-text`;
};

/** 判断文本节点是否包含正文。 */
const hasTextBubbleContent = (node: ChatNode): boolean => {
    if (node.kind !== "text") {
        return false;
    }
    return Boolean(node.message.content.trim() || node.message.contentBlocks?.length || node.message.attachments?.length);
};

/** 计算节点间距，避免“仅思维链 + tool”之间出现过大空白。 */
const nodeSpacingClass = (index: number): string => {
    if (index === 0) {
        return "";
    }

    const previousNode = chatNodes.value[index - 1];
    const currentNode = chatNodes.value[index];
    if (!previousNode || !currentNode) {
        return "mt-6";
    }

    if (
        previousNode.kind === "text"
        && currentNode.kind === "tool"
        && previousNode.message.id === currentNode.message.id
        && !hasTextBubbleContent(previousNode)
    ) {
        return "mt-1";
    }

    if (
        previousNode.kind === "tool"
        && currentNode.kind === "tool"
        && previousNode.message.id === currentNode.message.id
    ) {
        return "mt-2";
    }

    return "mt-6";
};

/** 是否接近底部。 */
const isNearBottom = (thresholdPx = AUTO_SCROLL_RELEASE_THRESHOLD_PX): boolean => {
    if (!scrollRef.value) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.value;
    return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
};

/** 滚动到底部。 */
const scrollToBottom = (): void => {
    if (!scrollRef.value) return;
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    lastScrollTop.value = scrollRef.value.scrollTop;
};

/** 取消下一帧的自动吸底任务。 */
const cancelScheduledScrollToBottom = (): void => {
    if (autoScrollFrame !== null) {
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(autoScrollFrame);
        }
        autoScrollFrame = null;
    }
};

/** 把自动吸底合并到下一帧，减少流式输出时的布局读取/写入抖动。 */
const scheduleScrollToBottom = (): void => {
    if (autoScrollFrame !== null) {
        return;
    }
    if (typeof requestAnimationFrame !== "function") {
        if (shouldStickToBottom.value) {
            scrollToBottom();
        }
        return;
    }
    autoScrollFrame = requestAnimationFrame(() => {
        autoScrollFrame = null;
        if (shouldStickToBottom.value) {
            scrollToBottom();
        }
    });
};

/**
 * 记录 prepend 前的滚动快照，并请求更早 durable history。
 * cursor 去重与 revision 校验由 session state 统一负责。
 */
const requestPreviousHistory = (): void => {
    if (!scrollRef.value || !props.historyHasPrevious || props.historyLoading) {
        return;
    }
    const firstMessageId = props.messages[0]?.id;
    if (!firstMessageId) {
        return;
    }
    pendingPrependAnchor = {
        sessionId: props.sessionId ?? null,
        firstMessageId,
        scrollHeight: scrollRef.value.scrollHeight,
        scrollTop: scrollRef.value.scrollTop,
    };
    cancelScheduledScrollToBottom();
    emit("load-previous");
};

/** 滚动事件处理。 */
const onScroll = (): void => {
    if (!scrollRef.value) return;
    const currentScrollTop = scrollRef.value.scrollTop;
    const userScrolledUp = currentScrollTop < lastScrollTop.value;

    if (isNearBottom()) {
        shouldStickToBottom.value = true;
        lastScrollTop.value = currentScrollTop;
        return;
    }

    if (userScrolledUp && !isNearBottom(AUTO_SCROLL_RELEASE_THRESHOLD_PX)) {
        shouldStickToBottom.value = false;
    }

    lastScrollTop.value = currentScrollTop;

    if (!pendingImmediateScroll && shouldLoadPreviousHistory({
        scrollTop: currentScrollTop,
        hasPrevious: props.historyHasPrevious ?? false,
        loading: props.historyLoading ?? false,
    })) {
        requestPreviousHistory();
    }
};

/** prepend 完成后恢复原有可见内容的位置。 */
watch(() => props.messages[0]?.id, async () => {
    const anchor = pendingPrependAnchor;
    if (!anchor || anchor.sessionId !== (props.sessionId ?? null)) {
        return;
    }
    const oldFirstIndex = props.messages.findIndex((message) => message.id === anchor.firstMessageId);
    if (oldFirstIndex <= 0) {
        return;
    }
    await nextTick();
    if (!scrollRef.value || pendingPrependAnchor !== anchor) {
        return;
    }
    scrollRef.value.scrollTop = prependAnchoredScrollTop({
        previousScrollTop: anchor.scrollTop,
        previousScrollHeight: anchor.scrollHeight,
        nextScrollHeight: scrollRef.value.scrollHeight,
    });
    lastScrollTop.value = scrollRef.value.scrollTop;
    pendingPrependAnchor = null;
});

/** 请求结束但没有 prepend（错误或 cursor 失效）时释放旧锚点。 */
watch(() => props.historyLoading, (loading, previousLoading) => {
    if (previousLoading && !loading && props.messages[0]?.id === pendingPrependAnchor?.firstMessageId) {
        pendingPrependAnchor = null;
    }
});

/** 消息变化时自动吸底。 */
watch(messageScrollSignature, async () => {
    await nextTick();
    if (shouldAutoScrollChat({
        stickToBottom: shouldStickToBottom.value,
        prependPending: pendingPrependAnchor !== null,
    })) {
        if (pendingImmediateScroll && props.messages.length > 0) {
            pendingImmediateScroll = false;
            cancelScheduledScrollToBottom();
            scrollToBottom();
            return;
        }
        scheduleScrollToBottom();
    }
});

/** 切换 session 时，下一次消息渲染后直接定位到底部，避免长历史从顶部滚到底。 */
watch(() => props.sessionId, () => {
    pendingPrependAnchor = null;
    pendingImmediateScroll = true;
    shouldStickToBottom.value = true;
    lastScrollTop.value = 0;
    cancelScheduledScrollToBottom();
});

/** 外部可调用：强制滚动到底部。 */
const forceScrollToBottom = (): void => {
    shouldStickToBottom.value = true;
    pendingImmediateScroll = false;
    cancelScheduledScrollToBottom();
    scrollToBottom();
};

onUnmounted(() => {
    cancelScheduledScrollToBottom();
});

defineExpose({ scrollToBottom: forceScrollToBottom, scrollRef });
</script>

<template>
    <!-- 通用对话流容器 -->
    <div ref="scrollRef" class="flex flex-1 flex-col overflow-y-auto p-4 pb-12 bg-[var(--bg-panel)]" @scroll="onScroll">
        <!-- 更早历史局部状态；失败不会遮断当前已加载对话。 -->
        <div v-if="props.historyHasPrevious || props.historyLoading || props.historyError" class="mb-4 flex shrink-0 items-center justify-center">
            <button
                type="button"
                class="inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-wait disabled:opacity-60"
                :disabled="props.historyLoading"
                @click="requestPreviousHistory"
            >
                <span :class="props.historyLoading ? 'i-lucide-loader-circle animate-spin' : props.historyError ? 'i-lucide-rotate-ccw' : 'i-lucide-chevron-up'" class="h-3.5 w-3.5"></span>
                <span v-if="props.historyLoading">{{ t("agent.chat.loadingPrevious") }}</span>
                <span v-else-if="props.historyError">{{ t("agent.chat.retryPrevious") }}</span>
                <span v-else>{{ t("agent.chat.loadPrevious") }}</span>
            </button>
            <span v-if="props.historyError && !props.historyLoading" class="ml-2 max-w-[360px] truncate text-xs text-[var(--status-danger)]" :title="props.historyError">{{ props.historyError }}</span>
        </div>
        <template v-if="props.messages.length > 0">
            <div
                v-for="(node, index) in chatNodes"
                :key="getNodeKey(node)"
                :class="nodeSpacingClass(index)"
            >
                <AgentTextBubble
                    v-if="node.kind === 'text'"
                    :node="node"
                    :session-id="props.sessionId"
                    :editing-message-id="props.editingMessageId"
                    :editing-content="props.editingMessageText"
                    :action-disabled="props.messageActionDisabled"
                    :run-action-disabled="props.runActionDisabled"
                    :saving-edit="props.savingEdit"
                    :session-attachments="props.sessionAttachments"
                    :can-register-attachments="props.canRegisterAttachments"
                    :can-insert-attachments="props.canInsertAttachments"
                    :project-root="props.projectRoot"
                    :model-supports-images="props.modelSupportsImages"
                    :attachment-insert-request="props.attachmentInsertRequest"
                    :branch-switcher="props.branchSwitcherStateByMessageId?.[node.message.id]"
                    :menu-refresh-key="props.menuRefreshKey"
                    :resolve-menu="props.resolveEditorMenu"
                    :on-skill-trigger-start="props.onEditorSkillTriggerStart"
                    :open-reference="props.openReference"
                    :cost-display-options="props.costDisplayOptions"
                    :cost-exchange-rate-suffix="props.costExchangeRateSuffix"
                    @copy="emit('copy', $event)"
                    @start-edit="emit('start-edit', $event)"
                    @cancel-edit="emit('cancel-edit', $event)"
                    @save-edit="emit('save-edit', $event)"
                    @retry="emit('retry', $event)"
                    @branch-from-here="emit('branch-from-here', $event)"
                    @cycle-branch="emit('cycle-branch', $event)"
                    @attachment-registered="emit('attachment-registered', $event)"
                    @resend-unknown="emit('resend-unknown', $event)"
                    @dismiss-unknown="emit('dismiss-unknown', $event)"
                />
                <AgentToolBubble
                    v-else-if="node.kind === 'tool'"
                    :tool-call="node.toolCall"
                    :session-id="props.sessionId"
                    @copy="emit('copy-tool', $event)"
                />
            </div>
        </template>

        <!-- 空状态 -->
        <div v-else class="flex h-full flex-col items-center justify-center space-y-6 px-4 text-center">
            <!-- main 模式空状态 -->
            <template v-if="props.mode === 'main'">
                <div class="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm">
                    <span class="i-lucide-bot h-6 w-6 text-[var(--text-muted)]"></span>
                </div>
                <div class="space-y-2">
                    <h3 class="text-base font-medium text-[var(--text-main)]">{{ t("agent.chat.startTitle") }}</h3>
                    <p class="text-sm leading-relaxed text-[var(--text-muted)]">{{ t("agent.chat.startDescription") }}</p>
                </div>
            </template>
            <!-- compact 模式空状态 -->
            <template v-else>
                <div class="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin text-[var(--text-muted)]"></span>
                </div>
                <p class="text-xs text-[var(--text-muted)]">{{ t("agent.chat.waiting") }}</p>
            </template>
        </div>
    </div>
</template>
