<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload} from "nbook/app/stores/novel-ide";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {hasVisibleInvocationError, isContinuationPointMessage, toPendingUserInputSession, type AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import {applyClientVariablePatch, buildAgentClientState} from "nbook/app/components/novel-ide/agent/client-variables";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {useAgentSessionStream, type AgentSessionStreamRecoveryReason} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import {applyAgentCommandResult} from "nbook/app/components/novel-ide/agent/agent-command-result";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useCostDisplay} from "nbook/app/composables/useCostDisplay";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import AgentChatFlow from "nbook/app/components/novel-ide/agent/AgentChatFlow.vue";
import AgentSystemPromptPanel from "nbook/app/components/novel-ide/agent/AgentSystemPromptPanel.vue";
import AgentComposer from "nbook/app/components/novel-ide/agent/AgentComposer.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import AgentLinkedAgentPanel from "nbook/app/components/novel-ide/agent/AgentLinkedAgentPanel.vue";
import AgentSessionDialog from "nbook/app/components/novel-ide/agent/AgentSessionDialog.vue";
import AgentSessionTreeDialog from "nbook/app/components/novel-ide/agent/AgentSessionTreeDialog.vue";
import {deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";
import {AgentSessionListRequestGuard} from "nbook/app/components/novel-ide/agent/session-list-request-guard";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useThemeManager} from "nbook/app/composables/useThemeManager";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {formatCost, formatCostExact, usingCnyRate} from "nbook/app/utils/cost-format";
import type {ConfigModelSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentQueuedMessageDto, AgentSessionListPageDto, AgentSessionListQueryDto, AgentSessionRecoveryDto, AgentSessionSummaryDto, AgentPendingUserInputDto, AgentMode} from "nbook/shared/dto/agent-session.dto";
import {AgentModeSchema} from "nbook/shared/dto/agent-session.dto";
import type {AgentCommandResult, InvokeAgentResult} from "nbook/shared/dto/agent-session.dto";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {InlineEditPayload} from "nbook/app/utils/inline-editor-selection";
import {LowCodeJsonObjectSchema} from "nbook/shared/dto/low-code-form.dto";

type LeaderCreateProfileOption = {
    profileKey: string;
    label: string;
    iconClass: string;
};

const INLINE_EDITOR_PROFILE_KEY = "inline.editor";

const props = defineProps<{
    active: boolean;
    layout: "drawer" | "workbench";
    novelId: string;
    historyInboxRefreshKey?: string | number;
    selectedFilePath?: string;
    /** 打开消息 Markdown 中的 workspace 引用。 */
    openReference?: (target: string) => void;
    /** 锁定单一 profile（如 RP 界面锁定 rp.leader）：会话列表按该 profile 过滤，新建只用该 profile。 */
    profileKeyOverride?: string;
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "sync-workspace", payload: AgentWorkspaceSyncPayload): void;
    (e: "open-reference", target: string): void;
    (e: "open-history-inbox"): void;
}>();

const inputText = ref("");
const chatFlowRef = ref<InstanceType<typeof AgentChatFlow> | null>(null);
const inputRef = ref<InstanceType<typeof AgentComposer> | null>(null);

const sessions = ref<AgentSessionSummaryDto[]>([]);
const sessionListTotal = ref(0);
const sessionListHasMore = ref(false);
const sessionListNextOffset = ref<number | null>(null);
const activeSessionId = ref<number | null>(null);
const inlineEditorSessions = ref<AgentSessionSummaryDto[]>([]);
const inlineEditorSessionId = ref<number | null>(null);
const inlineEditorSessionLoading = ref(false);
const inlineEditorResultText = ref("");
const linkedAgentPanelOpen = ref(false);
const loadingSession = ref(false);
const sessionListLoading = ref(false);
const linkedAgentsLoading = ref(false);
const previousSelectedFilePath = ref<string | null>(props.selectedFilePath || null);
const fileChangedSinceLastSend = ref(false);
const selectionVersion = ref(0);
const sessionDialogOpen = ref(false);
const sessionTreeDialogOpen = ref(false);
const systemPromptPanelOpen = ref(false);
const sessionActionId = ref<number | null>(null);
const editingMessageId = ref<string | null>(null);
const messageActionId = ref<string | null>(null);
const selectableModels = ref<ConfigModelSettingsDto["enabledModels"]>([]);
const resolvedDefaultProfileKey = ref("leader.default");
const sessionModelDraft = ref<AgentSessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});
const sessionModelPopoverOpen = ref(false);
const sessionModelSaving = ref(false);
const inlineSessionModelDraft = ref<AgentSessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});
const inlineSessionModelPopoverOpen = ref(false);
const inlineSessionModelSaving = ref(false);
const submittingUserInputKey = ref<string | null>(null);
const userInputSelectedAnswers = ref<Record<string, number[]>>({});
const userInputNotes = ref<Record<string, string>>({});
let defaultProfileResolveRequest = 0;
let ensureSessionRequest: Promise<AgentSessionSummaryDto[]> | null = null;
let suppressLeaderProfileReset = false;
let inlineEditorSessionRequestId = 0;
const sessionListRequestGuard = new AgentSessionListRequestGuard();
const hiddenWritingModeProfileKeys = new Set(["rp.leader", "simulator.leader"]);

/**
 * 应用 session 列表分页结果。
 */
function applySessionListPage(page: AgentSessionListPageDto, append: boolean): AgentSessionSummaryDto[] {
    if (append) {
        const seenSessionIds = new Set(sessions.value.map((sessionSummary) => sessionSummary.sessionId));
        sessions.value = [
            ...sessions.value,
            ...page.items.filter((sessionSummary) => {
                if (seenSessionIds.has(sessionSummary.sessionId)) {
                    return false;
                }
                seenSessionIds.add(sessionSummary.sessionId);
                return true;
            }),
        ];
    } else {
        sessions.value = page.items;
    }
    sessionListTotal.value = page.total;
    sessionListHasMore.value = page.hasMore;
    sessionListNextOffset.value = page.nextOffset ?? null;
    return sessions.value;
}

const sanitizeHtml = ref<((html: string) => string) | null>(null);
const session = useAgentSession();
const inlineEditorSession = useAgentSession();
const agentApi = useAgentSessionApi();
const configApi = useConfigApi();
const themeManager = useThemeManager();
const costDisplay = useCostDisplay();
const messages = session.messages;
const running = session.running;
const inlineEditorMessages = inlineEditorSession.messages;
const inlineEditorRunning = inlineEditorSession.running;
const connectionStatus = session.connectionStatus;
const runPhase = session.runPhase;
const pendingUserInputSession = session.pendingUserInputSession;
const pendingUserInputSessionsComputed = computed(() => {
    const pendings = session.recoveryShell.value?.pendingUserInputs ?? [];
    return pendings.map((pending: AgentPendingUserInputDto) => toPendingUserInputSession(pending, messages.value))
        .filter((s): s is AgentPendingUserInputSession => s !== null);
});
const {confirm, prompt} = useDialog();
const notification = useNotification();
const {t} = useI18n();

const ideStore = useNovelIdeStore();
const {
    selectedStoryThreadId,
    selectedStorySceneId,
    workspaceTree,
} = storeToRefs(ideStore);

/** 打开 Agent 消息里的 workspace 引用。 */
function openMessageReference(target: string): void {
    if (props.openReference) {
        props.openReference(target);
        return;
    }
    emit("open-reference", target);
}

const novelIdRef = toRef(props, "novelId");
const {
    resolveMenu: resolveInputMenu,
    menuRefreshKey: agentMenuRefreshKey,
    refreshSkillCatalog,
} = useStructuredReferenceMenu({
    novelId: novelIdRef,
    selectedStoryThreadId,
    selectedStorySceneId,
    workspaceTree,
});

provide("sanitizeHtml", sanitizeHtml);

const activeRecovery = computed(() => session.recoveryShell.value);
const activeSummary = computed(() => activeRecovery.value?.summary ?? null);
const activeSummarizer = computed(() => activeRecovery.value?.summarizer ?? null);
const linkedAgents = computed(() => activeRecovery.value?.linkedAgents ?? []);
const linkedByAgents = computed(() => activeRecovery.value?.linkedByAgents ?? []);
const queuedMessages = computed<AgentQueuedMessageDto[]>(() => [
    ...activeRecovery.value?.steerQueue.items ?? [],
    ...activeRecovery.value?.followUpQueue.items ?? [],
].sort((left, right) => left.createdAt - right.createdAt));
const linkedAgentCount = computed(() => linkedAgents.value.length + linkedByAgents.value.length);
const agentMode = computed<AgentMode>(() => activeRecovery.value?.agentMode ?? "normal");
const renderNodes = computed(() => messages.value);
const inlineEditorCurrentTurnMessages = computed<AgentMessage[]>(() => {
    const latestUserIndex = inlineEditorMessages.value.findLastIndex((message) => message.type === "user");
    return latestUserIndex >= 0
        ? inlineEditorMessages.value.slice(latestUserIndex + 1)
        : inlineEditorMessages.value;
});
const inlineEditPreview = computed(() => {
    const toolCall = inlineEditorCurrentTurnMessages.value
        .flatMap((message) => message.toolCalls ?? [])
        .filter((item) => (item.name === "edit" || item.name === "write") && (item.status === "streaming" || item.status === "running"))
        .at(-1);
    if (!toolCall) {
        return "";
    }
    const path = readToolPath(toolCall);
    const status = t("agent.chatSurface.inlineRunning");
    const result = toolCall.error || toolCall.result || "";
    return [`${status}${path ? `：${path}` : ""}`, result].filter(Boolean).join("\n");
});
const inlineEditorLiveView = computed(() => {
    const latestAssistant = inlineEditorCurrentTurnMessages.value
        .filter((message) => message.type === "ai")
        .at(-1);
    return {
        thinking: latestAssistant?.thinking ?? "",
        content: latestAssistant?.content ?? "",
        status: latestAssistant?.status ?? null,
        editPreview: inlineEditPreview.value,
        resultText: inlineEditorResultText.value,
    };
});
const inlineEditorSessionLabel = computed(() => {
    const selected = inlineEditorSessions.value.find((item) => item.sessionId === inlineEditorSessionId.value)
        ?? inlineEditorSession.recoveryShell.value?.summary
        ?? null;
    if (!selected) {
        return t("agent.chatSurface.inlineSessionLabel");
    }
    return selected.title || `Inline AI #${String(selected.sessionId)}`;
});
const messageActionsDisabled = computed(() => running.value || Boolean(messageActionId.value));
const canContinueWithoutInput = computed(() => {
    if (running.value || inputText.value.trim() || messages.value.length === 0) {
        return false;
    }
    return isContinuationPointMessage(messages.value.at(-1), {
        allowSettledAiToolCalls: activeSummary.value?.status === "interrupted",
    });
});
const connectionStatusLabel = computed(() => {
    switch (connectionStatus.value) {
        case "connecting": return t("agent.chatSurface.connecting");
        case "reconnecting": return t("agent.chatSurface.reconnecting");
        case "recovering": return t("agent.chatSurface.recovering");
        case "disconnected": return t("agent.chatSurface.disconnected");
        default: return "";
    }
});
const connectionNeedsAction = computed(() => connectionStatus.value === "disconnected" || sessionStream.reconnectAttempt.value > 3);
const runPhaseLabel = computed(() => {
    switch (runPhase.value) {
        case "model_pending": return t("agent.chatSurface.phaseModelPending");
        case "thinking": return t("agent.chatSurface.phaseThinking");
        case "assistant_streaming": return t("agent.chatSurface.phaseAssistantStreaming");
        case "tool_args_streaming": return t("agent.chatSurface.phaseToolArgsStreaming");
        case "tool_running": return t("agent.chatSurface.phaseToolRunning");
        case "tool_streaming": return t("agent.chatSurface.phaseToolStreaming");
        case "waiting_user": return t("agent.chatSurface.phaseWaitingUser");
        case "finishing": return t("agent.chatSurface.phaseFinishing");
        default: return t("agent.chatSurface.phaseRunning");
    }
});

const systemLeaderProfileKey = computed(() => {
    return ideStore.workspaceKind === "user-assets" ? "leader.assets" : "leader.default";
});

const leaderProfileKey = computed(() => {
    if (props.profileKeyOverride) {
        return props.profileKeyOverride;
    }
    if (ideStore.workspaceKind !== "user-assets" && hiddenWritingModeProfileKeys.has(resolvedDefaultProfileKey.value)) {
        return systemLeaderProfileKey.value;
    }
    return resolvedDefaultProfileKey.value || systemLeaderProfileKey.value;
});

const createProfileOptions = computed<LeaderCreateProfileOption[]>(() => {
    if (props.profileKeyOverride) {
        return [{
            profileKey: props.profileKeyOverride,
            label: profileDisplayName(props.profileKeyOverride),
            iconClass: profileIconClass(props.profileKeyOverride),
        }];
    }
    const defaultKey = leaderProfileKey.value;
    const options: LeaderCreateProfileOption[] = [
        {
            profileKey: defaultKey,
            label: defaultKey === systemLeaderProfileKey.value ? profileDisplayName(defaultKey) : t("agent.profiles.defaultPrefix", {name: profileDisplayName(defaultKey)}),
            iconClass: profileIconClass(defaultKey),
        },
    ];
    if (ideStore.workspaceKind !== "user-assets") {
        options.push(
            {profileKey: "leader.default", label: profileDisplayName("leader.default"), iconClass: profileIconClass("leader.default")},
        );
    }
    const seen = new Set<string>();
    return options.filter((option) => {
        if (seen.has(option.profileKey)) {
            return false;
        }
        seen.add(option.profileKey);
        return true;
    });
});
const createProfileDropdownItems = computed<DropdownItem[]>(() => createProfileOptions.value.map((option) => ({
    label: option.label,
    value: option.profileKey,
    iconClass: option.iconClass,
    active: option.profileKey === activeSummary.value?.profileKey,
})));
const canChooseCreateProfile = computed(() => createProfileOptions.value.length > 1);

const workspaceKey = computed(() => {
    if (ideStore.workspaceKind === "user-assets") {
        return "user-assets";
    }
    return ideStore.currentNovelId || "workspace";
});

const agentWorkspaceRoot = computed(() => ideStore.workspaceKind === "user-assets" ? "workspace/.nbook" : ideStore.currentWorkspaceRoot || "workspace");

/**
 * 把 Agent 面板内 API 异常统一转换为 notification 文案。
 */
const notifyAgentError = (error: unknown, fallback: string, title = fallback): string => {
    const message = resolveApiErrorMessage(error, fallback);
    notification.error(message, {title});
    return message;
};

/**
 * 将 InlineEditPayload 转成 DTO 接受的 JsonValue。
 */
function inlineEditPayloadToJson(payload: InlineEditPayload): JsonValue {
    return {
        version: payload.version,
        task: payload.task,
        targetPath: payload.targetPath,
        instruction: payload.instruction,
        references: payload.references.map((reference) => {
            const output: {[key: string]: JsonValue} = {
                ref: reference.ref,
                path: reference.path,
                match: reference.match,
                text: reference.text,
            };
            if (reference.range) {
                output.range = {
                    startLine: reference.range.startLine,
                    endLine: reference.range.endLine,
                };
            }
            return output;
        }),
    };
}

/**
 * 从文件工具参数中读取 path，用于 Inline AI 轻量预览。
 */
function readToolPath(toolCall: AgentToolCall): string {
    const argsText = toolCall.argsJson || toolCall.argsText;
    if (!argsText.trim()) {
        return "";
    }
    try {
        const parsed = JSON.parse(argsText) as {path?: string};
        return typeof parsed.path === "string" ? parsed.path : "";
    } catch {
        return "";
    }
}

/**
 * 生成等待用户输入实例的稳定 key，用来避免旧 pending 的提交态影响下一组问题。
 */
function pendingUserInputKey(session: typeof pendingUserInputSession.value): string | null {
    if (!session) {
        return null;
    }
    const firstQuestion = session.questions[0];
    const toolKey = firstQuestion?.toolCallId ?? firstQuestion?.toolNodeId;
    return toolKey ? `${session.assistantMessageId}\n${toolKey}` : session.assistantMessageId;
}

/**
 * 返回 profile 在抽屉里的短名称。
 */
function profileDisplayName(profileKey: string): string {
    switch (profileKey) {
        case "leader.assets": return t("agent.profiles.leaderAssets");
        case "rp.leader": return t("agent.profiles.rpLeader");
        case "simulator.leader": return t("agent.profiles.simulatorLeader");
        case "leader.default": return t("agent.profiles.leaderDefault");
        default: return profileKey;
    }
}

/**
 * 返回创建菜单使用的 profile 图标。
 */
function profileIconClass(profileKey: string): string {
    switch (profileKey) {
        case "leader.assets": return "i-lucide-folder-heart";
        case "rp.leader": return "i-lucide-theater";
        case "simulator.leader": return "i-lucide-orbit";
        case "leader.default": return "i-lucide-sparkles";
        default: return "i-lucide-bot";
    }
}

const currentPendingUserInputKey = computed(() => pendingUserInputKey(pendingUserInputSession.value));
const submittingCurrentUserInput = computed(() => {
    return Boolean(submittingUserInputKey.value && submittingUserInputKey.value === currentPendingUserInputKey.value);
});

/**
 * 当前挂起提问 session 变化时，重置本地答案草稿。
 */
watch(() => pendingUserInputSession.value?.assistantMessageId ?? null, () => {
    userInputSelectedAnswers.value = {};
    userInputNotes.value = {};
}, {immediate: true});

const activeDrawerTitle = computed(() => profileDisplayName(activeSummary.value?.profileKey ?? leaderProfileKey.value));
const activeSessionTitle = computed(() => activeSummary.value?.title || (activeSessionId.value ? `Session #${String(activeSessionId.value)}` : t("agent.session.unnamed")));
const activeSessionSummaryText = computed(() => activeSummary.value?.summary?.trim() || activeSummary.value?.lastMessagePreview?.trim() || t("agent.session.noRecentMessages"));
const summarizerStatus = computed<null | {
    label: string;
    icon: string;
    className: string;
    title: string;
    spinning: boolean;
}>(() => {
    const state = activeSummarizer.value;
    if (!state) {
        return null;
    }
    if (state.running && state.dirty) {
        return {
            label: t("agent.chatSurface.summaryQueued"),
            icon: "i-lucide-refresh-cw",
            className: "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
            title: t("agent.chatSurface.summaryQueuedTitle"),
            spinning: true,
        };
    }
    if (state.running) {
        return {
            label: t("agent.chatSurface.summarizing"),
            icon: "i-lucide-loader-circle",
            className: "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]",
            title: t("agent.chatSurface.summarizingTitle"),
            spinning: true,
        };
    }
    if (state.lastError) {
        return {
            label: t("agent.chatSurface.summaryFailed"),
            icon: "i-lucide-triangle-alert",
            className: "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]",
            title: state.lastError,
            spinning: false,
        };
    }
    return null;
});
const sessionModelSelectionValue = computed(() => sessionModelDraft.value.modelKey);
const sessionThinkingResolvedLabel = computed(() => {
    const requested = activeRecovery.value?.thinkingLevel ?? null;
    const effective = activeRecovery.value?.effectiveThinkingLevel ?? "off";
    if (requested === null) {
        return t("agent.chatSurface.followProfileCurrent", {level: thinkingLevelLabel(effective)});
    }
    if (requested === effective) {
        return thinkingLevelLabel(effective);
    }
    return t("agent.chatSurface.requestedEffective", {requested: thinkingLevelLabel(requested), effective: thinkingLevelLabel(effective)});
});
const inlineSessionModelSelectionValue = computed(() => inlineSessionModelDraft.value.modelKey);
const inlineSessionThinkingResolvedLabel = computed(() => {
    const requested = inlineEditorSession.recoveryShell.value?.thinkingLevel ?? null;
    const effective = inlineEditorSession.recoveryShell.value?.effectiveThinkingLevel ?? "off";
    if (requested === null) {
        return t("agent.chatSurface.followProfileCurrent", {level: thinkingLevelLabel(effective)});
    }
    if (requested === effective) {
        return thinkingLevelLabel(effective);
    }
    return t("agent.chatSurface.requestedEffective", {requested: thinkingLevelLabel(requested), effective: thinkingLevelLabel(effective)});
});
const drawerIconClass = computed(() => "i-lucide-sparkles text-[var(--accent-text)]");

const sessionTreeState = computed(() => deriveAgentTreeState(activeRecovery.value?.tree ?? []));
const branchSwitcherStateByMessageId = computed(() => sessionTreeState.value.switcherByMessageId);

const contextUsageCompactLabel = computed(() => {
    const usage = activeRecovery.value?.contextUsage;
    if (!usage) {
        return "- / -";
    }
    return `${formatCompactTokenCount(usage.usedTokens)} / ${formatCompactTokenCount(usage.limitTokens)}`;
});
const contextUsageExactLabel = computed(() => {
    const usage = activeRecovery.value?.contextUsage;
    if (!usage) {
        return t("agent.chatSurface.contextUnknown");
    }
    const percent = typeof usage.percent === "number" && Number.isFinite(usage.percent)
        ? `（${formatPercent(usage.percent)}）`
        : "";
    return t("agent.chatSurface.contextEstimate", {used: formatTokenCount(usage.usedTokens), limit: formatTokenCount(usage.limitTokens), percent});
});
const contextPercentCompactLabel = computed(() => {
    const percent = activeRecovery.value?.contextUsage?.percent;
    return typeof percent === "number" && Number.isFinite(percent) ? formatPercent(percent) : "";
});
const cumulativeInputCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.input));
const cumulativeOutputCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.output));
const cumulativeCacheCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.cacheRead));
const cumulativeCacheWriteCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.cacheWrite));
const cumulativeCacheHitRateLabel = computed(() => {
    const usage = activeSummary.value?.usage;
    return usage ? formatCacheHitRate(usage) : "";
});
const costDisplayOptions = computed(() => costDisplay.costDisplayOptions.value);
const costExchangeRateSuffix = computed(() => {
    if (!usingCnyRate(costDisplayOptions.value)) {
        return "";
    }
    return costDisplay.exchangeRateStale.value ? t("agent.chatSurface.cachedRateSuffix") : t("agent.chatSurface.currentRateSuffix");
});
const cumulativeCostCompactLabel = computed(() => formatCost(activeSummary.value?.usage?.cost.total, costDisplayOptions.value));
const cumulativeUsageExactLabel = computed(() => {
    const usage = activeSummary.value?.usage;
    if (!usage) {
        return t("agent.chatSurface.totalUsageEmpty");
    }
    const costLabel = formatCost(usage.cost.total, costDisplayOptions.value)
        ? t("agent.chatSurface.totalUsageWithCost", {
            compactCost: formatCost(usage.cost.total, costDisplayOptions.value),
            inputCost: formatCostExact(usage.cost.input, costDisplayOptions.value),
            outputCost: formatCostExact(usage.cost.output, costDisplayOptions.value),
            cacheReadCost: formatCostExact(usage.cost.cacheRead, costDisplayOptions.value),
            cacheWriteCost: formatCostExact(usage.cost.cacheWrite, costDisplayOptions.value),
            totalCost: formatCostExact(usage.cost.total, costDisplayOptions.value),
            suffix: costExchangeRateSuffix.value,
        })
        : "";
    return t("agent.chatSurface.totalUsage", {
        input: formatTokenCount(usage.input),
        output: formatTokenCount(usage.output),
        cacheRead: formatTokenCount(usage.cacheRead),
        cacheWrite: formatTokenCount(usage.cacheWrite),
        hitRate: formatCacheHitRate(usage),
        cost: costLabel,
    });
});

/**
 * 将 token 数值格式化为精确文本。
 */
function formatTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    return new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 0}).format(value);
}

/**
 * 将 token 数值格式化为 K/M 紧凑文本。
 */
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

/**
 * 格式化 context 使用百分比。
 */
function formatPercent(value: number): string {
    return `${new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: value >= 10 ? 0 : 1,
    }).format(value)}%`;
}

/**
 * 计算 prompt cache 命中率：缓存读 / 本次输入 prompt 总量。
 */
function formatCacheHitRate(usage: {input: number; cacheRead: number}): string {
    const promptTokens = usage.input + usage.cacheRead;
    if (promptTokens <= 0) {
        return "0%";
    }
    return formatPercent(usage.cacheRead / promptTokens * 100);
}

/**
 * 显示 PI thinking level 的中文标签。
 */
function thinkingLevelLabel(level: ThinkingLevelDto): string {
    switch (level) {
        case "off": return t("agent.composer.off");
        case "minimal": return t("agent.composer.minimal");
        case "low": return t("agent.composer.low");
        case "medium": return t("agent.composer.medium");
        case "high": return t("agent.composer.high");
        case "xhigh": return t("agent.composer.xhigh");
        case "max": return t("agent.composer.max");
    }
}

/**
 * 组装 Novel IDE 客户端变量快照。目前新 profile 第一版不走 header，但保留本地上下文组装入口。
 */
const buildClientState = () => {
    const isUserAssetsWorkspace = ideStore.workspaceKind === "user-assets";
    return buildAgentClientState({
        activePanel: isNovelIdeTab(ideStore.activeLeftTab) ? ideStore.activeLeftTab : null,
        theme: ideStore.activeThemeId,
        novelId: isUserAssetsWorkspace ? "" : ideStore.currentNovelId,
        workspace: ideStore.currentWorkspaceRoot || null,
        workspaceKind: ideStore.workspaceKind,
        selectedFilePath: props.selectedFilePath || null,
        selectedStoryThreadId: isUserAssetsWorkspace ? null : selectedStoryThreadId.value,
        selectedStorySceneId: isUserAssetsWorkspace ? null : selectedStorySceneId.value,
        previousSelectedFilePath: previousSelectedFilePath.value,
        fileChangedSinceLastSend: fileChangedSinceLastSend.value,
        selectionVersion: selectionVersion.value,
    });
};

/**
 * 读取可选模型列表。
 */
const loadSelectableModels = async (): Promise<void> => {
    try {
        const settings = await configApi.bootstrap();
        selectableModels.value = settings.modelSettings.enabledModels;
        costDisplay.setCostCurrency(settings.ui.costCurrency);
        void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    } catch (error) {
        console.error("读取模型列表失败", error);
        selectableModels.value = [];
    }
};

/**
 * 按当前 workspace 解析默认 Agent Profile。
 */
const loadResolvedLeaderProfileKey = async (): Promise<void> => {
    const requestId = ++defaultProfileResolveRequest;
    if (ideStore.workspaceKind !== "user-assets" && !ideStore.currentNovelId) {
        if (requestId === defaultProfileResolveRequest) {
            resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
        }
        return;
    }
    try {
        const settings = await configApi.bootstrap();
        if (requestId !== defaultProfileResolveRequest) {
            return;
        }
        resolvedDefaultProfileKey.value = settings.defaultProfileSettings.effectiveProfileKey || systemLeaderProfileKey.value;
        costDisplay.setCostCurrency(settings.ui.costCurrency);
        void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    } catch (error) {
        if (requestId !== defaultProfileResolveRequest) {
            return;
        }
        console.error("读取默认 Agent Profile 失败", error);
        resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
    }
};

/**
 * 刷新 session 列表。
 */
const refreshSessions = async (): Promise<AgentSessionSummaryDto[]> => {
    if (props.profileKeyOverride) {
        return refreshSessionsWithQuery({
            profileKey: props.profileKeyOverride,
            status: "active",
            relation: "all",
            limit: 50,
        });
    }
    return refreshSessionsWithQuery({
        profileGroup: "leader",
        status: "active",
        relation: "all",
        limit: 50,
    });
};

/**
 * 按弹窗筛选条件刷新 session 列表。
 */
const refreshSessionsWithQuery = async (query: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> => {
    const requestQuery = {
        ...query,
        workspaceKey: workspaceKey.value,
    };
    const request = sessionListRequestGuard.begin(requestQuery);
    if (!request.shouldFetch) {
        return sessions.value;
    }
    sessionListRequestGuard.start();
    sessionListLoading.value = true;
    try {
        const page = await agentApi.listSessions(requestQuery);
        if (!sessionListRequestGuard.accepts(request)) {
            return sessions.value;
        }
        const nextSessions = applySessionListPage(page, request.append);
        sessionListRequestGuard.markApplied(request);
        return nextSessions;
    } catch (error) {
        if (!sessionListRequestGuard.accepts(request)) {
            return sessions.value;
        }
        console.error("刷新 session 列表失败", error);
        notifyAgentError(error, t("agent.chatSurface.loadSessionsFailed"));
        throw error;
    } finally {
        sessionListLoading.value = sessionListRequestGuard.finish(request);
    }
};

/**
 * 恢复当前 workspace 下已有的有效 session，不主动创建新 session。
 */
const ensureSessionReady = async (): Promise<AgentSessionSummaryDto[]> => {
    if (ensureSessionRequest) {
        return ensureSessionRequest;
    }
    ensureSessionRequest = ensureSessionReadyInternal();
    try {
        return await ensureSessionRequest;
    } finally {
        ensureSessionRequest = null;
    }
};

/**
 * 执行 session 恢复。
 */
const ensureSessionReadyInternal = async (): Promise<AgentSessionSummaryDto[]> => {
    if (!props.active) {
        return sessions.value;
    }
    if (activeSessionId.value) {
        return sessions.value;
    }
    await loadResolvedLeaderProfileKey();
    if (activeSessionId.value) {
        return sessions.value;
    }
    const list = await refreshSessions();
    if (activeSessionId.value) {
        return list;
    }
    const rememberedId = readLastSessionId();
    const rememberedSession = rememberedId ? list.find((item) => item.sessionId === rememberedId) : undefined;
    const target = rememberedSession ?? list[0];
    if (target) {
        await loadSession(target.sessionId);
        return list;
    }
    return list;
};

/**
 * 显式创建一个新的 session。只能由按钮、弹窗或 /new 这类用户命令调用。
 */
const createSession = async (profileKey?: string): Promise<AgentSessionSummaryDto[]> => {
    await loadResolvedLeaderProfileKey();
    const created = await agentApi.createSession({
        profileKey: profileKey || leaderProfileKey.value,
        initial: {},
        workspaceRoot: agentWorkspaceRoot.value,
        workspaceKey: workspaceKey.value,
        projectPath: ideStore.workspaceKind === "user-assets" ? undefined : ideStore.currentNovelId,
    });
    await refreshSessions();
    await loadSession(created.sessionId);
    return sessions.value;
};

/**
 * 切换到指定 session，并拉取 recovery。
 */
const loadSession = async (sessionId: number): Promise<void> => {
    sessionStream.stop();
    activeSessionId.value = sessionId;
    session.reset();
    editingMessageId.value = null;
    messageActionId.value = null;
    linkedAgentPanelOpen.value = false;
    systemPromptPanelOpen.value = false;
    saveLastSessionId(sessionId);

    try {
        const recovery = await agentApi.getSessionRecovery(sessionId);
        session.applyRecovery(recovery);
        syncSessionModelState(recovery.summary);
        void sessionStream.start(sessionId);
        fileChangedSinceLastSend.value = false;
        await nextTick();
        scrollToBottom();
    } catch (error) {
        console.error(`加载 session ${String(sessionId)} 失败`, error);
        notifyAgentError(error, t("agent.chatSurface.loadSessionFailed"));
    }
};

/**
 * 从服务端重新同步当前 session recovery。
 */
const syncActiveSessionRecovery = async (reason: AgentSessionStreamRecoveryReason = "manual_refresh"): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    return sessionStream.syncRecovery(reason);
};

/** 加载当前 active path 的更早 durable history。 */
const loadPreviousHistory = async (): Promise<void> => {
    await session.loadPrevious(agentApi.getSessionHistory);
    if (session.needsRecovery.value) {
        const reason = session.recoveryReasons.value.includes("invalid_history_cursor")
            ? "invalid_history_cursor"
            : "active_path_changed";
        await syncActiveSessionRecovery(reason);
    }
};

/** 用户显式打开或刷新时才构建 System Prompt。 */
const loadActiveSystemPrompt = async (refresh = false): Promise<void> => {
    await session.loadSystemPrompt(agentApi.getSessionSystemPrompt, refresh);
};

let linkedAgentRelationsRequestId = 0;

/**
 * 只刷新关联 Agent 面板数据，不触碰当前对话消息流。
 */
const refreshLinkedAgentRelations = async (): Promise<void> => {
    const targetSessionId = activeSessionId.value;
    if (!targetSessionId) {
        return;
    }
    const requestId = ++linkedAgentRelationsRequestId;
    linkedAgentsLoading.value = true;
    try {
        const relations = await agentApi.getSessionRelations(targetSessionId);
        if (requestId !== linkedAgentRelationsRequestId || activeSessionId.value !== targetSessionId) {
            return;
        }
        session.applyRelations(relations);
    } catch (error) {
        if (requestId !== linkedAgentRelationsRequestId || activeSessionId.value !== targetSessionId) {
            return;
        }
        console.error(`刷新 session ${String(targetSessionId)} 关联 Agent 失败`, error);
        notifyAgentError(error, t("agent.chatSurface.refreshLinkedFailed"));
    } finally {
        if (requestId === linkedAgentRelationsRequestId) {
            linkedAgentsLoading.value = false;
        }
    }
};

/**
 * durable mutation 后进入与 SSE 共用的 recovery single-flight。
 */
const syncMutationRecovery = async (): Promise<void> => {
    await syncActiveSessionRecovery("active_path_changed");
};

/**
 * 应用 command HTTP 返回。轻控制命令只更新 live shell，不补拉完整 recovery。
 */
const applyCommandResult = async (result: AgentCommandResult): Promise<void> => {
    await applyAgentCommandResult(result, {
        activeSessionId: () => activeSessionId.value,
        applyLiveState: session.applyLiveState,
        needsRecovery: () => session.needsRecovery.value,
        syncRecovery: () => syncActiveSessionRecovery("active_path_changed"),
        syncSessionModelState,
        refreshSessions,
        loadSession,
    });
};

/**
 * 统一处理阻塞 invoke 的 HTTP 返回。SSE 正常时错误会以 session entry 进入消息流；
 * 这里负责补 recovery，并在事件流缺失时给一个即时通知兜底。
 */
const handleInvokeResult = async (result: InvokeAgentResult): Promise<void> => {
    if (result.status !== "error") {
        return;
    }
    await syncActiveSessionRecovery("invoke_error_fallback");
    if (!hasVisibleInvocationError(messages.value, result.invocationId)) {
        notification.error(result.error ?? t("agent.chatSurface.runFailed"), {title: t("agent.chatSurface.runFailed")});
    }
};

/**
 * 处理后台 Inline AI invoke 结果，并把最终摘要留给 PromptBar 展示。
 */
const handleInlineEditorInvokeResult = async (result: InvokeAgentResult): Promise<void> => {
    inlineEditorResultText.value = result.reportResult?.result ?? result.finalMessage ?? "";
    if (result.status !== "error") {
        await refreshInlineEditorSessions();
        return;
    }
    await inlineEditorStream.syncRecovery("invoke_error_fallback");
    inlineEditorResultText.value = result.error ?? t("agent.chatSurface.runFailed");
    throw new Error(inlineEditorResultText.value);
};

/**
 * 委托 AgentChatFlow 滚动到底部。
 */
const scrollToBottom = (): void => {
    chatFlowRef.value?.scrollToBottom();
};

const acknowledgeClientPatch = async (sessionId: number, request: Parameters<typeof applyClientVariablePatch>[0]): Promise<void> => {
    const toolCallId = request.toolCallId === undefined ? undefined : assertPublicToolCallId(request.toolCallId);
    try {
        const appliedValue = await applyClientVariablePatch(request, buildClientState(), {
            setActivePanel: (value) => {
                ideStore.activeLeftTab = value;
            },
            setTheme: (value) => themeManager.setTheme(value),
            customThemeIds: ideStore.customThemes.map((theme) => theme.id),
        });
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            appliedValue,
            invocationId: request.invocationId,
            toolCallId,
        });
    } catch (error) {
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            error: error instanceof Error ? error.message : String(error),
            invocationId: request.invocationId,
            toolCallId,
        });
    }
};

/**
 * 发送或继续前确保当前 session SSE 处于连接状态。
 */
const ensureActiveSessionEvents = async (): Promise<void> => {
    await sessionStream.ensure();
};

/**
 * 发送 Inline AI 前确保后台 inline session SSE 处于连接状态。
 */
const ensureInlineEditorEvents = async (): Promise<void> => {
    await inlineEditorStream.ensure();
};

/**
 * 用户显式要求立即重连事件流。
 */
const reconnectActiveSessionEvents = async (): Promise<void> => {
    try {
        await sessionStream.reconnectNow();
    } catch (error) {
        console.error("重新连接 Agent 事件流失败", error);
        notifyAgentError(error, t("agent.chatSurface.reconnectFailed"));
    }
};

/**
 * Task 63: 提交 Low-Code Form 数据。
 */
const submitUserInputForm = async (payload: {
    assistantMessageId: string;
    toolCallId: string;
    data: import("nbook/shared/dto/low-code-form.dto").LowCodeJsonObject;
}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }

    // 验证提交的 formData
    const dataValidation = LowCodeJsonObjectSchema.safeParse(payload.data);
    if (!dataValidation.success) {
        console.error("submitUserInputForm: payload.data 验证失败", dataValidation.error);
        notification.error(t("agent.chatSurface.invalidFormData"), {title: t("agent.chatSurface.submitAnswersFailed")});
        return;
    }

    try {
        submittingUserInputKey.value = pendingKey;
        await ensureActiveSessionEvents();
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};

        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "continue",
            clientState: buildClientState(),
            resolution: {
                kind: "user_input",
                toolCallId: payload.toolCallId,
                data: dataValidation.data,
            },
        });
        await handleInvokeResult(result);
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("提交 Low-Code Form 失败", error);
        await syncActiveSessionRecovery();
        notifyAgentError(error, t("agent.chatSurface.submitAnswersFailed"));
        throw error;
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 提交结构化问题答案（支持单个或批量）。
 */
const submitUserInputAnswers = async (payload: {
    assistantMessageId: string;
    resume?: boolean;
    answers: Array<{
        toolNodeId: string;
        questionIndex?: number;
        selectedOptionIndex?: number;
        note?: string;
        ignored?: boolean;
    }>;
}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }
    try {
        submittingUserInputKey.value = pendingKey;
        await ensureActiveSessionEvents();
        const toolCallId = pendingSession.questions[0]?.toolCallId;
        const firstQuestion = pendingSession.questions[0];
        if (!toolCallId || !firstQuestion) {
            return;
        }
        const answers = payload.answers.map((answer, index) => {
            const questionIndex = answer.questionIndex ?? index;
            const question = pendingSession.questions.find((item) => {
                return item.toolNodeId === answer.toolNodeId && item.questionIndex === questionIndex;
            }) ?? pendingSession.questions[questionIndex] ?? firstQuestion;
            return {
                questionIndex,
                text: answer.ignored
                    ? t("agent.chatSurface.userTerminated")
                    : formatAnswerText(question.options, answer.selectedOptionIndex, answer.note),
                selectedOptionIndex: answer.selectedOptionIndex,
                note: answer.note,
                ignored: answer.ignored,
            };
        });
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};

        // 如果有多个待审批项，一次性提交所有审批
        const allPendingSessions = pendingUserInputSessionsComputed.value;
        if (allPendingSessions.length > 1) {
            type AnswerItem = {
                questionIndex: number;
                text: string;
                selectedOptionIndex?: number;
                note?: string;
                ignored?: boolean;
            };
            type ResolutionItem = {
                kind: "tool_approval";
                toolCallId: string;
                approved: boolean;
                resultText: string;
                answers: AnswerItem[];
            } | {
                kind: "user_input";
                toolCallId: string;
                answers: AnswerItem[];
            };
            const resolutionCandidates: Array<ResolutionItem | null> = allPendingSessions.map((session: AgentPendingUserInputSession) => {
                const rawSessionToolCallId = session.questions[0]?.toolCallId;
                const sessionFirstQuestion = session.questions[0];
                if (!rawSessionToolCallId || !sessionFirstQuestion) {
                    return null;
                }
                const sessionToolCallId = assertPublicToolCallId(rawSessionToolCallId);
                // 只有第一个审批使用用户交互的答案，其余使用默认批准
                const isFirstSession = session === pendingSession;
                const sessionAnswers: AnswerItem[] = isFirstSession
                    ? answers
                    : [{
                        questionIndex: 0,
                        text: t("agent.userInput.approve"),
                        selectedOptionIndex: 0,
                    }];

                if (sessionFirstQuestion.kind === "tool_approval") {
                    return {
                        kind: "tool_approval" as const,
                        toolCallId: sessionToolCallId,
                        approved: isFirstSession ? isApprovalApproved(payload.answers[0]) : true,
                        resultText: sessionAnswers.map((a) => a.text).join("\n"),
                        answers: sessionAnswers,
                    };
                }
                return {
                    kind: "user_input" as const,
                    toolCallId: sessionToolCallId,
                    answers: sessionAnswers,
                };
            });
            const resolutions = resolutionCandidates.filter((resolution): resolution is ResolutionItem => resolution !== null);

            const result = await agentApi.invokeSession(activeSessionId.value, {
                mode: "continue",
                clientState: buildClientState(),
                resolutions,
            });
            await handleInvokeResult(result);
            await syncActiveSessionRecovery();
        } else {
            // 单个审批，保持原有逻辑
            const result = await agentApi.invokeSession(activeSessionId.value, {
                mode: "continue",
                clientState: buildClientState(),
                resolution: firstQuestion.kind === "tool_approval"
                    ? {
                        kind: "tool_approval",
                        toolCallId,
                        approved: isApprovalApproved(payload.answers[0]),
                        resultText: answers.map((answer) => answer.text).join("\n"),
                        answers,
                    }
                    : {
                        kind: "user_input",
                        toolCallId,
                        answers,
                    },
            });
            await handleInvokeResult(result);
            await syncActiveSessionRecovery();
        }
    } catch (error) {
        // pendingUserInputSession 现在是 computed，会自动从 session 状态恢复
        console.error("提交问题答案失败", error);
        await syncActiveSessionRecovery();
        notifyAgentError(error, t("agent.chatSurface.submitAnswersFailed"));
        throw error;
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 提交当前挂起中的整组结构化答案。
 */
const submitPendingUserInputAnswers = (): void => {
    if (!pendingUserInputSession.value || submittingCurrentUserInput.value) {
        return;
    }
    void submitUserInputAnswers({
        assistantMessageId: pendingUserInputSession.value.assistantMessageId,
        answers: pendingUserInputSession.value.questions.map((question) => {
            const key = `${question.toolNodeId}\n${question.questionIndex}`;
            const selected = userInputSelectedAnswers.value[key] ?? [];
            return {
                toolNodeId: question.toolNodeId,
                questionIndex: question.questionIndex,
                selectedOptionIndex: selected[0],
                note: userInputNotes.value[key]?.trim() || undefined,
            };
        }),
    });
};

provide(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, {
    pendingSession: pendingUserInputSession,
    submitting: submittingCurrentUserInput,
    draft: {
        selectedAnswers: userInputSelectedAnswers,
        notes: userInputNotes,
    },
    submitAnswers: submitPendingUserInputAnswers,
});

/**
 * 取消当前等待中的用户输入并终止本轮 ReAct loop。
 */
const cancelPendingUserInput = async (payload?: {assistantMessageId: string}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    if (payload?.assistantMessageId && payload.assistantMessageId !== pendingSession.assistantMessageId) {
        return;
    }
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }
    try {
        submittingUserInputKey.value = pendingKey;
        await agentApi.abortSession(activeSessionId.value, {
            reason: "user cancelled pending user input",
            clearQueue: true,
        });
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("取消用户输入等待失败", error);
        await syncActiveSessionRecovery();
        notifyAgentError(error, t("agent.chatSurface.cancelUserInputFailed"));
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 停止当前运行。
 */
const stopRun = async (): Promise<void> => {
    if (!activeSessionId.value || !running.value) {
        return;
    }
    try {
        await agentApi.abortSession(activeSessionId.value, {reason: "user abort"});
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("停止 Agent 运行失败", error);
    }
};

/**
 * 切换到指定 Agent 模式（三态按钮、Shift+Tab 与 /mode 命令共用）。
 */
const setAgentMode = async (mode: AgentMode): Promise<void> => {
    if (!activeSessionId.value || running.value) {
        return;
    }
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "mode",
            mode,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("切换 Agent 模式失败", error);
        notifyAgentError(error, t("agent.chatSurface.switchModeFailed"));
    }
};

/**
 * 循环切换 Agent 模式：normal → discuss → plan → normal。
 */
const cycleAgentMode = async (): Promise<void> => {
    const order: AgentMode[] = ["normal", "discuss", "plan"];
    const next = order[(order.indexOf(agentMode.value) + 1) % order.length] ?? "normal";
    await setAgentMode(next);
};

/**
 * 发送输入内容。
 */
const send = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (pendingUserInputSession.value) {
        return;
    }
    if (!activeSessionId.value) {
        notification.info(t("agent.chatSurface.noSessionMessage"), {title: t("agent.chatSurface.noSessionTitle")});
        sessionDialogOpen.value = true;
        return;
    }

    if (message.startsWith("/") && await handleSlashCommand(message)) {
        resetInput();
        return;
    }

    if (!message) {
        if (canContinueWithoutInput.value) {
            await ensureActiveSessionEvents();
            const result = await agentApi.invokeSession(activeSessionId.value, {
                mode: "continue",
                clientState: buildClientState(),
            });
            await handleInvokeResult(result);
        }
        return;
    }

    const prompt = inputText.value;
    resetInput();
    session.appendOptimisticUserMessage(prompt);
    await ensureActiveSessionEvents();
    const result = await agentApi.invokeSession(activeSessionId.value, {
        mode: "prompt",
        message: {text: prompt},
        clientState: buildClientState(),
    });
    await handleInvokeResult(result);
};

/**
 * 发送 Inline AI 编辑任务。调用方只负责构造 visible message 与 payload。
 */
const sendInlineEditorPrompt = async (payload: InlineEditPayload, visibleMessage: string): Promise<void> => {
    const targetSession = await ensureInlineEditorSession();
    if (targetSession.status === "running" || targetSession.status === "waiting") {
        throw new Error(t("agent.chatSurface.inlineRunningError"));
    }
    if (inlineEditorSessionId.value !== targetSession.sessionId || !inlineEditorSession.recoveryShell.value) {
        await loadInlineEditorSession(targetSession.sessionId);
    }

    inlineEditorResultText.value = "";
    inlineEditorSession.appendOptimisticUserMessage(visibleMessage);
    await ensureInlineEditorEvents();
    const result = await agentApi.invokeSession(targetSession.sessionId, {
        mode: "prompt",
        message: {text: visibleMessage},
        input: inlineEditPayloadToJson(payload),
        clientState: buildClientState(),
    });
    await handleInlineEditorInvokeResult(result);
};

/**
 * 打开或创建 Inline AI Session，供 PromptBar 主动绑定。
 */
const openInlineEditorSession = async (): Promise<AgentSessionSummaryDto> => {
    const targetSession = await ensureInlineEditorSession();
    if (activeSessionId.value !== targetSession.sessionId) {
        await loadSession(targetSession.sessionId);
    }
    return targetSession;
};

/**
 * 停止后台 Inline AI session 当前运行。
 */
const stopInlineEditorPrompt = async (): Promise<void> => {
    if (!inlineEditorSessionId.value) {
        return;
    }
    await agentApi.abortSession(inlineEditorSessionId.value, {});
    inlineEditorResultText.value = t("agent.chatSurface.stopped");
    await inlineEditorStream.syncRecovery("manual_refresh");
    await refreshInlineEditorSessions();
};

/**
 * 运行中引导当前 Agent loop。
 */
const steer = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (!activeSessionId.value || !running.value || !message) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const prompt = inputText.value;
        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "steer",
            message: {text: prompt},
            clientState: buildClientState(),
        });
        await handleInvokeResult(result);
        resetInput();
        notification.success(t("agent.chatSurface.steered"));
    } catch (error) {
        console.error("引导消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.steerFailed"));
    }
};

/**
 * 运行中把消息排到当前 loop 结束后继续执行。
 */
const followup = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (!activeSessionId.value || !running.value || !message) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const prompt = inputText.value;
        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "followup",
            message: {text: prompt},
            clientState: buildClientState(),
        });
        await handleInvokeResult(result);
        resetInput();
        notification.success(t("agent.chatSurface.queued"));
    } catch (error) {
        console.error("排队消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.queueFailed"));
    }
};

/**
 * 处理前端识别的 slash command。
 */
const handleSlashCommand = async (message: string): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    const [command, ...rest] = message.trim().split(/\s+/);
    if (command === "/new") {
        await createSession();
        return true;
    }
    if (command === "/clear") {
        const result = await agentApi.moveTree(activeSessionId.value, {
            position: "empty",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
        return true;
    }
    if (command === "/mode") {
        const requested = AgentModeSchema.safeParse(rest[0]);
        if (requested.success) {
            await setAgentMode(requested.data);
        } else {
            await cycleAgentMode();
        }
        return true;
    }
    if (command === "/plan") {
        await setAgentMode("plan");
        return true;
    }
    if (command === "/compact") {
        await compactSession(rest.join(" ") || undefined);
        return true;
    }
    if (command === "/model") {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey: rest[0] ?? null,
        });
        await applyCommandResult(result);
        return true;
    }
    if (command === "/rename") {
        // 用原始剩余文本作为标题，保留标题内部的连续空格。
        const title = message.trim().slice("/rename".length).trim();
        if (!title) {
            notification.error(t("agent.chatSurface.renameMissingTitle"));
            return true;
        }
        await renameSession(activeSessionId.value, title);
        return true;
    }
    if (command === "/summarize") {
        try {
            const result = await agentApi.runCommand(activeSessionId.value, {
                command: "summarize",
            });
            await applyCommandResult(result);
            notification.success(t("agent.chatSurface.summarizeStarted"));
        } catch (error) {
            console.error("重新生成摘要失败", error);
            notifyAgentError(error, t("agent.chatSurface.summarizeFailed"));
        }
        return true;
    }
    return false;
};

/**
 * 手动压缩当前 Session 上下文。压缩过程走 session SSE，同步一次 recovery 让 UI 立刻进入 running。
 */
const compactSession = async (instructions?: string): Promise<void> => {
    if (!activeSessionId.value || running.value) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "compact",
            instructions,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("压缩 Session 失败", error);
        notifyAgentError(error, t("agent.chatSurface.compactFailed"));
    }
};

/**
 * 清空输入态。
 */
function resetInput(): void {
    inputText.value = "";
}

/**
 * 复制消息正文。
 */
const copyMessage = async (message: AgentMessage): Promise<void> => {
    if (!message.content.trim()) {
        return;
    }
    await navigator.clipboard.writeText(message.content);
    notification.success(message.contentOmitted ? t("agent.chatSurface.previewCopied") : t("agent.chatSurface.copied"));
};

/**
 * 复制工具调用内容。
 */
const copyToolCall = async (toolCall: AgentToolCall): Promise<void> => {
    const text = [toolCall.argsJson ?? toolCall.argsText, toolCall.result ?? "", toolCall.error ?? ""]
        .filter((value) => value.trim())
        .join("\n\n");
    if (!text) {
        return;
    }
    await navigator.clipboard.writeText(text);
    notification.success(t("agent.chatSurface.toolCopied"));
};

const startEditingMessage = (message: AgentMessage): void => {
    if (messageActionsDisabled.value || message.contentOmitted) {
        return;
    }
    editingMessageId.value = message.id;
};

const cancelEditingMessage = (): void => {
    editingMessageId.value = null;
};

/**
 * 更新当前 session 模型覆盖。
 */
const updateSessionModelSelection = async (modelKey: string | null): Promise<void> => {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey,
    };

    if (!activeSessionId.value || running.value || sessionModelSaving.value) {
        return;
    }
    sessionModelSaving.value = true;
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("更新 session 模型失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateModelFailed"));
    } finally {
        sessionModelSaving.value = false;
    }
};

/**
 * 更新当前 session 的 thinking 覆盖。
 */
const updateSessionThinkingLevel = async (thinkingLevel: ThinkingLevelDto | null): Promise<void> => {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        reasoningEffort: thinkingLevel,
    };

    if (!activeSessionId.value || running.value || sessionModelSaving.value) {
        return;
    }
    sessionModelSaving.value = true;
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "thinking",
            thinkingLevel,
        });
        await applyCommandResult(result);
    } catch (error) {
        console.error("更新 session 推理强度失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateThinkingFailed"));
    } finally {
        sessionModelSaving.value = false;
    }
};

function toggleSessionModelPopover(): void {
    sessionModelPopoverOpen.value = !sessionModelPopoverOpen.value;
}

async function applySessionModelSettings(): Promise<void> {
    const nextModelKey = sessionModelDraft.value.modelKey;
    const nextThinkingLevel = sessionModelDraft.value.reasoningEffort;
    await updateSessionModelSelection(nextModelKey);
    await updateSessionThinkingLevel(nextThinkingLevel);
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey: nextModelKey,
        reasoningEffort: nextThinkingLevel,
    };
    sessionModelPopoverOpen.value = false;
}

async function resetSessionModelSettings(): Promise<void> {
    await updateSessionModelSelection(null);
    await updateSessionThinkingLevel(null);
    sessionModelPopoverOpen.value = false;
}

function modelDraftFromRecovery(recovery: Pick<AgentSessionRecoveryDto, "model" | "thinkingLevel"> | null): AgentSessionModelDraft {
    const model = recovery?.model ?? null;
    return {
        modelKey: model ? `${model.providerConfigId}/${model.modelId}` : null,
        reasoningEffort: recovery?.thinkingLevel ?? null,
    };
}

function syncSessionModelState(_summary: AgentSessionSummaryDto | null): void {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        ...modelDraftFromRecovery(session.recoveryShell.value),
    };
}

function syncInlineSessionModelState(): void {
    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        ...modelDraftFromRecovery(inlineEditorSession.recoveryShell.value),
    };
}

/**
 * 判断 Inline AI session 模型设置此刻是否允许写入。
 */
function inlineSessionModelActionBlocked(): boolean {
    return !inlineEditorSessionId.value || inlineEditorRunning.value || inlineEditorSessionLoading.value || inlineSessionModelSaving.value;
}

/**
 * 丢弃未落库草稿，恢复为当前 recovery 中的真实模型设置。
 */
function restoreInlineSessionModelDraft(): void {
    syncInlineSessionModelState();
}

/**
 * 更新 Inline AI session 模型覆盖，不影响右侧主 Agent 当前会话。
 */
const updateInlineSessionModelSelection = async (modelKey: string | null): Promise<boolean> => {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return false;
    }
    const sessionId = inlineEditorSessionId.value;
    if (!sessionId) {
        restoreInlineSessionModelDraft();
        return false;
    }

    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        modelKey,
    };

    inlineSessionModelSaving.value = true;
    try {
        await agentApi.runCommand(sessionId, {
            command: "model",
            modelKey,
        });
        await inlineEditorStream.syncRecovery("manual_refresh");
        syncInlineSessionModelState();
        return true;
    } catch (error) {
        console.error("更新 Inline AI session 模型失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateModelFailed"));
        restoreInlineSessionModelDraft();
        return false;
    } finally {
        inlineSessionModelSaving.value = false;
    }
};

/**
 * 更新 Inline AI session 推理强度覆盖。
 */
const updateInlineSessionThinkingLevel = async (thinkingLevel: ThinkingLevelDto | null): Promise<boolean> => {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return false;
    }
    const sessionId = inlineEditorSessionId.value;
    if (!sessionId) {
        restoreInlineSessionModelDraft();
        return false;
    }

    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        reasoningEffort: thinkingLevel,
    };

    inlineSessionModelSaving.value = true;
    try {
        await agentApi.runCommand(sessionId, {
            command: "thinking",
            thinkingLevel,
        });
        await inlineEditorStream.syncRecovery("manual_refresh");
        syncInlineSessionModelState();
        return true;
    } catch (error) {
        console.error("更新 Inline AI session 推理强度失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateThinkingFailed"));
        restoreInlineSessionModelDraft();
        return false;
    } finally {
        inlineSessionModelSaving.value = false;
    }
};

function toggleInlineSessionModelPopover(): void {
    if (!inlineSessionModelPopoverOpen.value && inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    inlineSessionModelPopoverOpen.value = !inlineSessionModelPopoverOpen.value;
}

function setInlineSessionModelDraft(value: AgentSessionModelDraft): void {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return;
    }
    inlineSessionModelDraft.value = value;
}

function setInlineSessionModelPopoverOpen(value: boolean): void {
    if (value && inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    inlineSessionModelPopoverOpen.value = value;
}

async function applyInlineSessionModelSettings(): Promise<void> {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    const nextModelKey = inlineSessionModelDraft.value.modelKey;
    const nextThinkingLevel = inlineSessionModelDraft.value.reasoningEffort;
    await updateInlineSessionModelSelection(nextModelKey);
    await updateInlineSessionThinkingLevel(nextThinkingLevel);
    restoreInlineSessionModelDraft();
    inlineSessionModelPopoverOpen.value = false;
}

async function resetInlineSessionModelSettings(): Promise<void> {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    await updateInlineSessionModelSelection(null);
    await updateInlineSessionThinkingLevel(null);
    restoreInlineSessionModelDraft();
    inlineSessionModelPopoverOpen.value = false;
}

const sessionStream = useAgentSessionStream({
    session,
    api: agentApi,
    activeSessionId,
    applyRecoverySideEffects: async (recovery, result) => {
        syncSessionModelState(recovery.summary);
        if (result.historyWindowReset) {
            await nextTick();
            chatFlowRef.value?.scrollToBottom();
        }
    },
    onEvent: async (event) => {
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested" && activeSessionId.value) {
            await acknowledgeClientPatch(activeSessionId.value, event.event.request);
        }
    },
    onError: (error, fallback) => {
        console.error(fallback, error);
        notifyAgentError(error, fallback);
    },
});

const inlineEditorStream = useAgentSessionStream({
    session: inlineEditorSession,
    api: agentApi,
    activeSessionId: inlineEditorSessionId,
    applyRecoverySideEffects: () => {
        syncInlineSessionModelState();
    },
    onEvent: async (event) => {
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested" && inlineEditorSessionId.value) {
            await acknowledgeClientPatch(inlineEditorSessionId.value, event.event.request);
        }
    },
    onError: (error, fallback) => {
        console.error(fallback, error);
        notifyAgentError(error, fallback);
    },
});

const cycleMessageBranch = async (messageId: string, direction: -1 | 1): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    const target = resolveBranchSwitchTarget(sessionTreeState.value, messageId, direction);
    if (!target) {
        return;
    }
    messageActionId.value = messageId;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: target.id,
            position: "at",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
    } catch (error) {
        console.error("切换消息分支失败", error);
        notifyAgentError(error, t("agent.chatSurface.switchBranchFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const selectTreeNode = async (entryId: string): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    messageActionId.value = entryId;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: entryId,
            position: "at",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
    } catch (error) {
        console.error("切换 Session Tree 节点失败", error);
        notifyAgentError(error, t("agent.chatSurface.switchTreeFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const saveEditedMessage = async (payload: {message: AgentMessage; content: string}): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value || payload.message.contentOmitted) {
        return;
    }
    messageActionId.value = payload.message.id;
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: payload.message.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "prompt",
                message: {text: payload.content},
                clientState: buildClientState(),
            },
        });
        session.applyLiveState(result.state);
        if (result.invocation) {
            await handleInvokeResult(result.invocation);
        }
        editingMessageId.value = null;
        await syncActiveSessionRecovery();
        notification.success(t("agent.chatSurface.messageUpdated"));
    } catch (error) {
        console.error("改写消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.rewriteFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const refreshMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    messageActionId.value = message.id;
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: message.type === "user" ? "at" : "before",
            next: {
                type: "invoke",
                mode: "continue",
                clientState: buildClientState(),
            },
        });
        session.applyLiveState(result.state);
        if (result.invocation) {
            await handleInvokeResult(result.invocation);
        }
        editingMessageId.value = null;
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("刷新消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.refreshMessageFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const rollbackMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    const confirmed = await confirm(t("agent.chatSurface.rollbackConfirm"), t("agent.chatSurface.rollbackTitle"));
    if (!confirmed) {
        return;
    }
    messageActionId.value = message.id;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: "at",
        });
        session.applyLiveState(result.state);
        await syncMutationRecovery();
        editingMessageId.value = null;
        notification.success(t("agent.chatSurface.rollbackSuccess"));
    } catch (error) {
        console.error("回退消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.rollbackFailed"));
    } finally {
        messageActionId.value = null;
    }
};

const openSessionDialog = async (): Promise<void> => {
    await ensureSessionReady();
    sessionDialogOpen.value = true;
};

const selectSession = async (sessionId: number): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    if (sessionId === activeSessionId.value) {
        sessionDialogOpen.value = false;
        return;
    }
    loadingSession.value = true;
    try {
        await loadSession(sessionId);
        sessionDialogOpen.value = false;
    } finally {
        loadingSession.value = false;
    }
};

const createSessionFromDialog = async (profileKey?: string): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        await createSession(profileKey);
        sessionDialogOpen.value = false;
    } finally {
        loadingSession.value = false;
    }
};

/**
 * 从抽屉头部显式创建 session，并避免重复点击连建多个空 session。
 */
const createSessionFromHeader = async (profileKey?: string): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        await createSession(profileKey);
    } finally {
        loadingSession.value = false;
    }
};

/**
 * 重命名 session 的共享核心：/rename 命令与侧边栏/列表按钮共用。
 * 改名后标题所有权归用户，自动摘要不再覆盖标题；失败走通知反馈。
 */
const renameSession = async (sessionId: number, title: string): Promise<void> => {
    try {
        const result = await agentApi.runCommand(sessionId, {
            command: "rename",
            title,
        });
        if (sessionId === activeSessionId.value) {
            await applyCommandResult(result);
        }
        await refreshSessions();
        notification.success(t("agent.chatSurface.renamed"));
    } catch (error) {
        console.error("重命名 session 失败", error);
        notifyAgentError(error, t("agent.chatSurface.renameFailed"));
    }
};

/**
 * 手动重命名 session：弹输入框后走共享 renameSession 核心。
 */
const renameSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    const title = (await prompt(t("agent.session.renamePrompt"), target.title ?? "", t("agent.session.rename")))?.trim();
    if (!title) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await renameSession(target.sessionId, title);
    } finally {
        sessionActionId.value = null;
    }
};

const archiveSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (target.status === "running" || target.status === "waiting" || loadingSession.value || sessionActionId.value) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await agentApi.runCommand(target.sessionId, {
            command: "archive",
            reason: "archived from drawer",
        });
        const nextSessions = await refreshSessions();
        if (target.sessionId !== activeSessionId.value) {
            return;
        }
        if (nextSessions[0]?.sessionId) {
            await loadSession(nextSessions[0].sessionId);
            return;
        }
        sessionStream.stop();
        activeSessionId.value = null;
        session.reset();
        syncSessionModelState(null);
    } finally {
        sessionActionId.value = null;
    }
};

/**
 * 清空当前 workspace 绑定的 Agent session 状态。workspace 切换时必须硬重置，
 * 避免同 profile 的不同 Project Workspace 复用旧会话。
 */
function resetWorkspaceSessionState(): void {
    sessionStream.stop();
    inlineEditorStream.stop();
    activeSessionId.value = null;
    inlineEditorSessionId.value = null;
    sessions.value = [];
    inlineEditorSessions.value = [];
    linkedAgentPanelOpen.value = false;
    sessionDialogOpen.value = false;
    sessionTreeDialogOpen.value = false;
    sessionModelPopoverOpen.value = false;
    inlineSessionModelPopoverOpen.value = false;
    inlineSessionModelSaving.value = false;
    editingMessageId.value = null;
    messageActionId.value = null;
    inputText.value = "";
    session.reset();
    inlineEditorSession.reset();
    inlineEditorResultText.value = "";
    syncSessionModelState(null);
    syncInlineSessionModelState();
}

watch(() => props.selectedFilePath, (nextFilePath, previousFilePath) => {
    const nextValue = nextFilePath || null;
    const previousValue = previousFilePath || null;
    if (nextValue === previousValue) {
        return;
    }
    previousSelectedFilePath.value = previousValue;
    fileChangedSinceLastSend.value = true;
    selectionVersion.value += 1;
});

watch(() => props.active, async (active) => {
    if (!active) {
        sessionDialogOpen.value = false;
        linkedAgentPanelOpen.value = false;
        sessionModelPopoverOpen.value = false;
        inlineSessionModelPopoverOpen.value = false;
        editingMessageId.value = null;
        messageActionId.value = null;
        return;
    }
    await loadSelectableModels();
    await loadResolvedLeaderProfileKey();
    await ensureSessionReady();
    await nextTick();
    requestAnimationFrame(() => {
        inputRef.value?.focus();
        scrollToBottom();
    });
});

watch(linkedAgentPanelOpen, (open) => {
    if (open) {
        void refreshLinkedAgentRelations();
    }
});

watch(activeSessionId, () => {
    if (linkedAgentPanelOpen.value) {
        void refreshLinkedAgentRelations();
    }
});

watch(leaderProfileKey, async () => {
    if (suppressLeaderProfileReset) {
        return;
    }
    resetWorkspaceSessionState();
    if (!props.active) {
        return;
    }
    await ensureSessionReady();
});

watch(() => [ideStore.workspaceKind, ideStore.currentNovelId] as const, async () => {
    suppressLeaderProfileReset = true;
    try {
        await loadResolvedLeaderProfileKey();
        resetWorkspaceSessionState();
        if (!props.active) {
            return;
        }
        await ensureSessionReady();
        await nextTick();
    } finally {
        suppressLeaderProfileReset = false;
    }
});

watch(() => ideStore.configRevision, async () => {
    if (!props.active) {
        return;
    }
    await loadSelectableModels();
    await loadResolvedLeaderProfileKey();
    await syncActiveSessionRecovery("manual_refresh");
});

onBeforeUnmount(() => {
    sessionStream.stop();
    inlineEditorStream.stop();
});

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            return;
        }
        await loadSelectableModels();
        await loadResolvedLeaderProfileKey();
        const {default: createDOMPurify} = await import("dompurify");
        const purifier = createDOMPurify(window);
        sanitizeHtml.value = (html) => purifier.sanitize(html) as string;
    })();
});

defineExpose({
    activeSessionId,
    sessions,
    loadingSession,
    linkedAgentsLoading,
    running,
    selectableModels,
    inlineEditorRunning,
    inlineEditorResultText,
    inlineEditorLiveView,
    inlineEditorSessionId,
    inlineEditorSessions,
    inlineEditorSessionLoading,
    inlineEditPreview,
    inlineEditorSessionLabel,
    inlineSessionModelDraft,
    inlineSessionModelPopoverOpen,
    inlineSessionModelSaving,
    inlineSessionModelSelectionValue,
    inlineSessionThinkingResolvedLabel,
    sessionActionId,
    ensureSessionReady,
    refreshSessionsWithQuery,
    selectSession,
    createSession: createSessionFromHeader,
    archiveSessionFromDialog,
    renameSessionFromDialog,
    openInlineEditorSession,
    refreshInlineEditorSessions,
    selectInlineEditorSession,
    createInlineEditorSession,
    setInlineSessionModelDraft,
    setInlineSessionModelPopoverOpen,
    updateInlineSessionModelSelection,
    toggleInlineSessionModelPopover,
    applyInlineSessionModelSettings,
    resetInlineSessionModelSettings,
    sendInlineEditorPrompt,
    stopInlineEditorPrompt,
    sendUserMessage,
});

/**
 * 程序化发送一条用户消息（如 RP 掷骰按钮的续流程回执）。agent 运行中或无会话时不发送并返回 false。
 */
async function sendUserMessage(text: string): Promise<boolean> {
    if (running.value || !activeSessionId.value || pendingUserInputSession.value) {
        return false;
    }
    inputText.value = text;
    await send();
    return true;
}

/**
 * 确保 Project 级 Inline AI Session 可用。
 */
async function ensureInlineEditorSession(): Promise<AgentSessionSummaryDto> {
    const list = await refreshInlineEditorSessions();
    const selected = inlineEditorSessionId.value
        ? list.find((item) => item.sessionId === inlineEditorSessionId.value)
        : undefined;
    if (selected) {
        return selected;
    }
    return createInlineEditorSession();
}

/**
 * 刷新当前 Project Workspace 下的 Inline AI sessions。
 */
async function refreshInlineEditorSessions(): Promise<AgentSessionSummaryDto[]> {
    const requestId = ++inlineEditorSessionRequestId;
    inlineEditorSessionLoading.value = true;
    try {
        const page = await agentApi.listSessions({
            workspaceKey: workspaceKey.value,
            profileGroup: "all",
            profileKey: INLINE_EDITOR_PROFILE_KEY,
            status: "active",
            relation: "all",
            limit: 50,
        });
        if (requestId !== inlineEditorSessionRequestId) {
            return inlineEditorSessions.value;
        }
        inlineEditorSessions.value = page.items;
        const rememberedId = readInlineEditorSessionId();
        const remembered = rememberedId ? page.items.find((item) => item.sessionId === rememberedId) : undefined;
        const current = inlineEditorSessionId.value ? page.items.find((item) => item.sessionId === inlineEditorSessionId.value) : undefined;
        const target = current ?? remembered ?? page.items[0];
        if (target && inlineEditorSessionId.value !== target.sessionId) {
            await loadInlineEditorSession(target.sessionId, {invalidateRefresh: false});
        }
        if (!target) {
            inlineEditorSessionId.value = null;
            inlineEditorSession.reset();
            inlineEditorResultText.value = "";
            inlineEditorStream.stop();
            syncInlineSessionModelState();
        }
        return inlineEditorSessions.value;
    } finally {
        if (requestId === inlineEditorSessionRequestId) {
            inlineEditorSessionLoading.value = false;
        }
    }
}

/**
 * 创建一个新的 Project 级 Inline AI session，并设为 PromptBar 当前 session。
 */
async function createInlineEditorSession(): Promise<AgentSessionSummaryDto> {
    const created = await agentApi.createSession({
        profileKey: INLINE_EDITOR_PROFILE_KEY,
        initial: {},
        workspaceRoot: agentWorkspaceRoot.value,
        workspaceKey: workspaceKey.value,
        projectPath: ideStore.workspaceKind === "user-assets" ? undefined : ideStore.currentNovelId,
    });
    await loadInlineEditorSession(created.sessionId);
    await refreshInlineEditorSessions();
    const recovery = inlineEditorSession.recoveryShell.value ?? await agentApi.getSessionRecovery(created.sessionId);
    return recovery.summary;
}

/**
 * 选择 PromptBar 当前使用的 Inline AI session，不影响右侧 Agent 面板。
 */
async function selectInlineEditorSession(sessionId: number): Promise<void> {
    if (inlineEditorSessionId.value === sessionId) {
        return;
    }
    await loadInlineEditorSession(sessionId);
}

/**
 * 加载后台 Inline AI session recovery，并启动它自己的 SSE。
 */
async function loadInlineEditorSession(sessionId: number, options: {invalidateRefresh?: boolean} = {}): Promise<AgentSessionSummaryDto> {
    if (options.invalidateRefresh !== false) {
        inlineEditorSessionRequestId += 1;
    }
    inlineEditorStream.stop();
    inlineEditorSessionId.value = sessionId;
    inlineEditorSession.reset();
    inlineEditorResultText.value = "";
    saveInlineEditorSessionId(sessionId);
    const recovery = await agentApi.getSessionRecovery(sessionId);
    if (recovery.summary.profileKey !== INLINE_EDITOR_PROFILE_KEY) {
        throw new Error(t("agent.chatSurface.inlineLoadFailed"));
    }
    inlineEditorSession.applyRecovery(recovery);
    syncInlineSessionModelState();
    inlineEditorSessions.value = inlineEditorSessions.value.some((item) => item.sessionId === recovery.summary.sessionId)
        ? inlineEditorSessions.value.map((item) => item.sessionId === recovery.summary.sessionId ? recovery.summary : item)
        : [recovery.summary, ...inlineEditorSessions.value];
    void inlineEditorStream.start(sessionId);
    return recovery.summary;
}

function readInlineEditorSessionId(): number | null {
    if (!import.meta.client) {
        return null;
    }
    const raw = localStorage.getItem(`agent:inline-editor-session:${workspaceKey.value}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function saveInlineEditorSessionId(sessionId: number): void {
    if (!import.meta.client) {
        return;
    }
    localStorage.setItem(`agent:inline-editor-session:${workspaceKey.value}`, String(sessionId));
}

/**
 * 会话记忆的存储键按界面隔离：锁定 profile 的界面（如 RP 的 rp.leader）带 profile 前缀，
 * 避免 RP 界面与写作模式 Agent 界面互相覆盖「上次打开的 session」。
 */
function lastSessionStorageKey(): string {
    return props.profileKeyOverride
        ? `agent:last-session:${props.profileKeyOverride}:${workspaceKey.value}`
        : `agent:last-session:${workspaceKey.value}`;
}

function readLastSessionId(): number | null {
    if (!import.meta.client) {
        return null;
    }
    const raw = localStorage.getItem(lastSessionStorageKey());
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function saveLastSessionId(sessionId: number): void {
    if (!import.meta.client) {
        return;
    }
    localStorage.setItem(lastSessionStorageKey(), String(sessionId));
}

function formatAnswerText(
    options: Array<{label: string}>,
    selectedOptionIndex?: number,
    note?: string,
): string {
    const selectedText = selectedOptionIndex === undefined
        ? ""
        : selectedOptionIndex === -1 ? t("agent.userInput.otherAnswer") : options[selectedOptionIndex]?.label ?? String(selectedOptionIndex);
    if (selectedText && note?.trim()) {
        return `${selectedText}\n${t("agent.planApproval.note", {note: note.trim()})}`;
    }
    return note?.trim() || selectedText || t("agent.userInput.continue");
}

function isApprovalApproved(answer?: {
    selectedOptionIndex?: number;
    ignored?: boolean;
}): boolean {
    if (!answer || answer.ignored) {
        return false;
    }
    return answer.selectedOptionIndex === 0;
}
</script>

<template>
    <!-- Agent Chat Surface -->
    <section
        class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-panel)]"
        :class="[props.layout === 'workbench' ? 'border-x border-[var(--border-color)]' : '', props.active ? '' : 'pointer-events-none opacity-0']"
        :aria-hidden="!props.active"
    >
        <!-- 抽屉头部 -->
            <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
                <div class="min-w-0 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded border border-[var(--accent-main)] bg-[var(--accent-bg)]">
                        <span class="h-3.5 w-3.5" :class="drawerIconClass"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="flex min-w-0 items-center gap-1.5">
                            <div class="truncate text-sm font-medium tracking-wide text-[var(--text-main)]" :title="activeSessionTitle">{{ activeSessionTitle }}</div>
                            <span class="inline-flex shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-[var(--text-muted)]" :title="activeDrawerTitle">{{ activeDrawerTitle }}</span>
                        </div>
                        <div class="flex min-w-0 items-center gap-1.5">
                            <div class="truncate text-[10px] leading-4 text-[var(--text-muted)]" :title="activeSessionSummaryText">{{ activeSessionSummaryText }}</div>
                            <span v-if="summarizerStatus" class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-normal" :class="summarizerStatus.className" :title="summarizerStatus.title">
                                <span class="h-3 w-3" :class="[summarizerStatus.icon, summarizerStatus.spinning ? 'animate-spin' : '']"></span>
                                {{ summarizerStatus.label }}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <Dropdown v-if="canChooseCreateProfile" :items="createProfileDropdownItems" root-class="relative inline-block" menu-class="right-0 top-full mt-1.5 w-44" compact @select="void createSessionFromHeader($event)">
                        <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.session.newChat')" :disabled="loadingSession">
                            <span class="i-lucide-plus h-4 w-4"></span>
                        </button>
                    </Dropdown>
                    <button v-else class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.session.newChat')" :disabled="loadingSession" @click="void createSessionFromHeader()">
                        <span class="i-lucide-plus h-4 w-4"></span>
                    </button>
                    <button class="flex items-center gap-1.5 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': linkedAgentPanelOpen}" :title="t('agent.chatSurface.linkedAgentsTitle')" @click="linkedAgentPanelOpen = !linkedAgentPanelOpen">
                        <span class="i-lucide-users h-4 w-4"></span>
                        <span v-if="linkedAgentCount" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-[var(--text-inverse)]">{{ linkedAgentCount }}</span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.chatSurface.sessionTreeTitle')" :disabled="!activeSessionId" @click="sessionTreeDialogOpen = true">
                        <span class="i-lucide-git-branch h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': systemPromptPanelOpen}" :title="t('agent.systemPrompt.open')" :disabled="!activeSessionId" @click="systemPromptPanelOpen = !systemPromptPanelOpen">
                        <span class="i-lucide-terminal-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.chatSurface.sessionListTitle')" @click="void openSessionDialog()">
                        <span class="i-lucide-messages-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <!-- Linked Agent 面板 -->
            <AgentLinkedAgentPanel
                v-if="linkedAgentPanelOpen"
                :session-id="activeSessionId"
                :owned-agents="linkedAgents"
                :linked-by-agents="linkedByAgents"
                :loading="linkedAgentsLoading"
                @select="void loadSession($event); linkedAgentPanelOpen = false"
                @refresh="void refreshLinkedAgentRelations()"
                @close="linkedAgentPanelOpen = false"
            />

            <AgentSystemPromptPanel
                v-model="systemPromptPanelOpen"
                :value="session.systemPrompt.value"
                :loading="session.systemPromptLoading.value"
                :error="session.systemPromptError.value"
                :open-reference="openMessageReference"
                @load="void loadActiveSystemPrompt()"
                @refresh="void loadActiveSystemPrompt(true)"
            />

            <!-- 消息序列 -->
            <AgentChatFlow
                ref="chatFlowRef"
                :messages="renderNodes"
                :session-id="activeSessionId"
                :running="running"
                mode="main"
                :editing-message-id="editingMessageId"
                :message-action-disabled="messageActionsDisabled"
                :saving-edit="Boolean(messageActionId)"
                :branch-switcher-state-by-message-id="branchSwitcherStateByMessageId"
                :menu-refresh-key="agentMenuRefreshKey"
                :resolve-editor-menu="resolveInputMenu"
                :on-editor-skill-trigger-start="refreshSkillCatalog"
                :open-reference="openMessageReference"
                :cost-display-options="costDisplayOptions"
                :cost-exchange-rate-suffix="costExchangeRateSuffix"
                :history-has-previous="session.hasPrevious.value"
                :history-loading="session.historyLoading.value"
                :history-error="session.historyError.value"
                @copy="void copyMessage($event)"
                @copy-tool="void copyToolCall($event)"
                @start-edit="startEditingMessage"
                @cancel-edit="cancelEditingMessage"
                @save-edit="void saveEditedMessage($event)"
                @retry="void refreshMessage($event)"
                @delete="void rollbackMessage($event)"
                @cycle-branch="void cycleMessageBranch($event.messageId, $event.direction)"
                @load-previous="void loadPreviousHistory()"
            />

            <AgentComposer
                ref="inputRef"
                v-model:input-text="inputText"
                v-model:selected-answers="userInputSelectedAnswers"
                v-model:notes="userInputNotes"
                v-model:session-model-popover-open="sessionModelPopoverOpen"
                v-model:session-model-draft="sessionModelDraft"
                :pending-session="pendingUserInputSession"
                :submitting-user-input="submittingCurrentUserInput"
                :running="running"
                :loading-session="loadingSession"
                :session-model-saving="sessionModelSaving"
                :session-model-selection-value="sessionModelSelectionValue"
                :session-thinking-resolved-label="sessionThinkingResolvedLabel"
                :selectable-models="selectableModels"
                :agent-mode="agentMode"
                :can-continue-without-input="canContinueWithoutInput"
                :context-usage-exact-label="contextUsageExactLabel"
                :context-usage-compact-label="contextUsageCompactLabel"
                :context-percent-compact-label="contextPercentCompactLabel"
                :cumulative-usage-exact-label="cumulativeUsageExactLabel"
                :cumulative-input-compact-label="cumulativeInputCompactLabel"
                :cumulative-output-compact-label="cumulativeOutputCompactLabel"
                :cumulative-cache-compact-label="cumulativeCacheCompactLabel"
                :cumulative-cache-write-compact-label="cumulativeCacheWriteCompactLabel"
                :cumulative-cache-hit-rate-label="cumulativeCacheHitRateLabel"
                :cumulative-cost-compact-label="cumulativeCostCompactLabel"
                :connection-status-label="connectionStatusLabel"
                :run-phase-label="runPhaseLabel"
                :connection-needs-action="connectionNeedsAction"
                :queued-messages="queuedMessages"
                :menu-refresh-key="agentMenuRefreshKey"
                :project-path="props.novelId || null"
                :history-inbox-refresh-key="props.historyInboxRefreshKey ?? 0"
                :history-inbox-active="props.active"
                :resolve-menu="resolveInputMenu"
                :on-skill-trigger-start="refreshSkillCatalog"
                @submit-user-input="void submitUserInputAnswers($event)"
                @submit-user-input-form="void submitUserInputForm($event)"
                @cancel-user-input="void cancelPendingUserInput($event)"
                @send="void send()"
                @steer="void steer()"
                @followup="void followup()"
                @stop="void stopRun()"
                @cycle-mode="void cycleAgentMode()"
                @toggle-session-model-popover="toggleSessionModelPopover"
                @update-session-model-selection="void updateSessionModelSelection($event)"
                @apply-session-model-settings="void applySessionModelSettings()"
                @reset-session-model-settings="void resetSessionModelSettings()"
                @reconnect-events="void reconnectActiveSessionEvents()"
                @refresh-history="void syncActiveSessionRecovery()"
                @open-history-inbox="emit('open-history-inbox')"
                @open-workspace-file="openMessageReference"
            />

            <!-- Session 管理弹窗 -->
            <AgentSessionDialog
                v-model="sessionDialogOpen"
                :sessions="sessions"
                :total="sessionListTotal"
                :has-more="sessionListHasMore"
                :next-offset="sessionListNextOffset"
                :active-session-id="activeSessionId"
                :loading="loadingSession || sessionListLoading"
                :running="running"
                :action-id="sessionActionId"
                :create-profile-options="createProfileOptions"
                :can-choose-create-profile="canChooseCreateProfile"
                @select="void selectSession($event)"
                @create="void createSessionFromDialog($event)"
                @archive="void archiveSessionFromDialog($event)"
                @rename="void renameSessionFromDialog($event)"
                @refresh="void refreshSessionsWithQuery($event)"
                @load-more="void refreshSessionsWithQuery($event)"
            />

            <AgentSessionTreeDialog
                v-model="sessionTreeDialogOpen"
                :tree="activeRecovery?.tree ?? []"
                :active-leaf-id="activeRecovery?.activeLeafId ?? null"
                :running="running"
                @select="void selectTreeNode($event)"
            />
    </section>
</template>
