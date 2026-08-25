<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {hasVisibleInvocationError, isContinuationPointMessage} from "nbook/app/components/novel-ide/agent/agent-message";
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
import AgentWorkflowPendingPanel from "nbook/app/components/novel-ide/agent/AgentWorkflowPendingPanel.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import AgentLinkedAgentPanel from "nbook/app/components/novel-ide/agent/AgentLinkedAgentPanel.vue";
import AgentSessionDialog from "nbook/app/components/novel-ide/agent/AgentSessionDialog.vue";
import AgentSessionTreeDialog from "nbook/app/components/novel-ide/agent/AgentSessionTreeDialog.vue";
import AgentContextInspectorDialog from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextInspectorDialog.vue";
import AgentSessionAttachmentPanel from "nbook/app/components/novel-ide/agent/AgentSessionAttachmentPanel.vue";
import {deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";
import {AgentSessionListRequestGuard} from "nbook/app/components/novel-ide/agent/session-list-request-guard";
import {
    AgentSessionLoadController,
    AgentSurfaceActivationController,
    AgentSurfaceOperationController,
    adoptInlineEditorRequest,
    forgetRememberedSession,
    readRememberedSession,
    isAgentSurfaceSupersededError,
    projectAgentSessionLoad,
    projectAgentComposerAvailability,
    projectInlineEditorSelection,
    projectReconnectReady,
    registerReconnectRestoreWatcher,
    runSessionLoadAttempt,
    tryWriteRememberedSession,
    writeRememberedAfterStreamOpen,
    watchAgentSurfaceActivation,
    type AgentComposerAvailability,
    type AgentComposerAvailabilityAction,
    type AgentSessionLoadResult,
    type AgentSessionLoadOwner,
    type AgentSessionOpenResult,
    type RememberedSession,
    type AgentSurfaceActivationAttempt,
    type InlineEditorSelectionResult,
    type AgentSurfaceOperationResult,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useThemeManager} from "nbook/app/composables/useThemeManager";
import {agentSessionScopeKey} from "nbook/app/utils/agent-session-scope-key";
import {resolveApiErrorCode, resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {formatCost, formatCostExact, usingCnyRate} from "nbook/app/utils/cost-format";
import {promptCacheHitRate, type PromptCacheUsage} from "nbook/app/utils/prompt-cache";
import type {ConfigBootstrapDto, ConfigModelSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentQueuedMessageDto, AgentSessionAttachmentItemDto, AgentSessionAttachmentResolveResultDto, AgentSessionInteractionDto, AgentSessionListPageDto, AgentSessionListQueryDto, AgentSessionRecoveryDto, AgentSessionSummaryDto, AgentMode, AgentSessionIdentity} from "nbook/shared/dto/agent-session.dto";
import {AgentModeSchema} from "nbook/shared/dto/agent-session.dto";
import type {AgentCommandResult, InvokeAgentResult} from "nbook/shared/dto/agent-session.dto";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import {
    AgentComposerDraftClientStore,
    AgentComposerDraftBlockedError,
    AgentComposerDraftSession,
    type AgentComposerDraftContext,
    type AgentComposerDraftPreparedContext,
    type AgentComposerDraftSaveResult,
    type AgentComposerSubmission,
} from "nbook/app/components/novel-ide/agent/agent-composer-draft";
import {
    agentMessageMarkdown,
} from "nbook/app/components/novel-ide/agent/agent-user-message-markdown";
import {
    attachmentIdFromMarkdownTarget,
    parseAgentImageMarkdown,
} from "nbook/shared/agent/agent-image-markdown";
import {
    reconcileInvocationReceipt,
    reconcileInvocationTransportFailure,
} from "nbook/app/components/novel-ide/agent/agent-invocation-reconciliation";
import {
    acceptsAgentPendingOperation,
    buildAgentPendingResolutions,
    createAgentPendingResolutionDraft,
    ownsAgentPendingSubmission,
    pendingResolutionBatchKey,
    reconcileAgentPendingResolutionDraft,
    type AgentPendingOperationOwner,
    type AgentPendingResolutionDraft,
    type AgentPendingSubmissionIssue,
} from "nbook/app/components/novel-ide/agent/agent-pending-resolution";

type LeaderCreateProfileOption = {
    profileKey: string;
    label: string;
    iconClass: string;
};

const NO_SESSION_INTERACTION: AgentSessionInteractionDto = {
    canInvoke: false,
    canResolveUserInput: false,
    canRegisterAttachment: false,
    canInsertAttachment: false,
    canMutateHistory: false,
    canChangeRuntime: false,
    canArchive: false,
    canRestore: false,
    canAbort: false,
};

const props = defineProps<{
    active: boolean;
    layout: "drawer" | "workbench";
    novelId: string;
    /** 当前 Project ready generation；同 root reconnect 也必须产生新的数据面 scope。 */
    projectReadyRevision?: number | null;
    historyInboxRefreshKey?: string | number;
    selectedFilePath?: string;
    /** 打开消息 Markdown 中的 workspace 引用。 */
    openReference?: (target: string) => void;
}>();

const emit = defineEmits<{
    (e: "close"): void;
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
const activeSessionIdentity = ref<AgentSessionIdentity | null>(null);
const inlineEditorSessions = ref<AgentSessionSummaryDto[]>([]);
const inlineSessionModelPopoverOpen = ref(false);
const inlineSessionModelSaving = ref(false);
const inlineEditorSessionId = ref<number | null>(null);
const inlineEditorSessionIdentity = ref<AgentSessionIdentity | null>(null);
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
const attachmentPanelOpen = ref(false);
const sessionAttachments = ref<AgentSessionAttachmentItemDto[]>([]);
const knownSessionAttachments = ref<AgentSessionAttachmentItemDto[]>([]);
const sessionAttachmentUniqueTotal = ref(0);
const sessionAttachmentPageTotal = ref(0);
const sessionAttachmentHasMore = ref(false);
const sessionAttachmentNextOffset = ref<number | null>(null);
const sessionAttachmentLoading = ref(false);
const sessionAttachmentSearch = ref("");
const sessionActionId = ref<number | null>(null);
const editingMessageId = ref<string | null>(null);
const editingMessageText = ref("");
const historyAttachmentInsertRequest = ref<{id: number; item: AgentSessionAttachmentItemDto} | null>(null);
const messageActionId = ref<string | null>(null);
const selectableModels = ref<ConfigModelSettingsDto["enabledModels"]>([]);
const resolvedDefaultProfileKey = ref("leader.default");
const sessionModelDraft = ref<AgentSessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});
const sessionModelPopoverOpen = ref(false);
const sessionModelSaving = ref(false);
const submittingUserInputKey = ref<string | null>(null);
const pendingResolutionDraft = ref<AgentPendingResolutionDraft>(createAgentPendingResolutionDraft([]));
const pendingSubmissionIssue = ref<AgentPendingSubmissionIssue | null>(null);
let pendingSubmissionIssueBatchKey: string | null = null;
let defaultProfileResolveRequest = 0;
let inlineEditorSessionRequestId = 0;
let sessionAttachmentRequestId = 0;
let sessionAttachmentGeneration = 0;
let historyAttachmentInsertRequestId = 0;
let sessionAttachmentSearchTimer: ReturnType<typeof setTimeout> | null = null;
let composerDraftWarning = "";
let composerDraftSession: AgentComposerDraftSession | null = null;
const composerContextGeneration = ref(0);
const sessionListRequestGuard = new AgentSessionListRequestGuard();
const surfaceActivation = new AgentSurfaceActivationController();
const surfaceOperations = new AgentSurfaceOperationController();
const inlineSurfaceOperations = new AgentSurfaceOperationController();
const mainSessionLoads = new AgentSessionLoadController();
const inlineSessionLoads = new AgentSessionLoadController();
const surfaceOperationRevision = ref(0);
const inlineOperationRevision = ref(0);
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
const connectionStatus = session.connectionStatus;
const runPhase = session.runPhase;
const pendingUserInputSession = session.pendingUserInputSession;
const pendingUserInputSessions = session.pendingUserInputSessions;
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
const activeInteraction = computed(() => activeSummary.value?.interaction ?? NO_SESSION_INTERACTION);
const composerAvailability = computed<AgentComposerAvailability>(() => projectAgentComposerAvailability({
    activation: surfaceActivation.state.value,
    summary: activeSummary.value
        ? {
            archived: activeSummary.value.archived,
            profileAvailability: activeSummary.value.profileAvailability ?? "unavailable",
            profileIssueMessage: activeSummary.value.profileIssueMessage,
        }
        : null,
    pendingUserInput: Boolean(pendingUserInputSession.value),
    running: running.value,
    interaction: {
        canInvoke: activeInteraction.value.canInvoke,
        canResolveUserInput: activeInteraction.value.canResolveUserInput,
        canRestore: activeInteraction.value.canRestore,
        canAbort: activeInteraction.value.canAbort,
    },
}));
const activeSummarizer = computed(() => activeRecovery.value?.summarizer ?? null);
const linkedAgents = computed(() => activeRecovery.value?.linkedAgents ?? []);
const linkedByAgents = computed(() => activeRecovery.value?.linkedByAgents ?? []);
const queuedMessages = computed<AgentQueuedMessageDto[]>(() => [
    ...activeRecovery.value?.steerQueue.items ?? [],
    ...activeRecovery.value?.followUpQueue.items ?? [],
].sort((left, right) => left.createdAt - right.createdAt));
const linkedAgentCount = computed(() => linkedAgents.value.length + linkedByAgents.value.length);
const agentMode = computed<AgentMode>(() => activeRecovery.value?.agentMode ?? "normal");
const activeModelSupportsImages = computed(() => {
    const selectedKey = sessionModelDraft.value.modelKey;
    const selected = selectedKey
        ? selectableModels.value.find((model) => model.key === selectedKey)
        : selectableModels.value.find((model) => model.providerId === activeRecovery.value?.model?.providerConfigId
            && model.modelId === activeRecovery.value?.model?.modelId);
    return selected?.input.includes("image") ?? false;
});
const renderNodes = computed(() => messages.value);
const messageActionsDisabled = computed(() => Boolean(messageActionId.value));
const historyMutationDisabled = computed(() => Boolean(messageActionId.value) || !activeInteraction.value.canMutateHistory);
const canContinueWithoutInput = computed(() => {
    if (!activeInteraction.value.canInvoke || running.value || inputText.value.trim() || messages.value.length === 0) {
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
    if (ideStore.workspaceKind !== "user-assets" && hiddenWritingModeProfileKeys.has(resolvedDefaultProfileKey.value)) {
        return systemLeaderProfileKey.value;
    }
    return resolvedDefaultProfileKey.value || systemLeaderProfileKey.value;
});

const createProfileOptions = computed<LeaderCreateProfileOption[]>(() => {
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

/** localStorage 等稳定记忆只按 Workspace/Project 身份分区，不随 reconnect generation 改名。 */
const sessionMemoryScopeKey = computed(() => agentSessionScopeKey(ideStore.workspaceKind, ideStore.currentProjectRoot));
/** 数据面 scope 包含 ready revision；同 root reconnect 后旧请求也会立即失去发布权。 */
const sessionScopeKey = computed(() => `${sessionMemoryScopeKey.value}@ready:${String(props.projectReadyRevision ?? 0)}`);
const surfaceOperationKey = computed(() => `${sessionScopeKey.value}@activation:${String(surfaceOperationRevision.value)}`);
const inlineOperationKey = computed(() => `${sessionScopeKey.value}@inline:${String(inlineOperationRevision.value)}`);
const sessionScope = computed<Pick<AgentSessionListQueryDto, "scope" | "projectRoot">>(() => (
    ideStore.workspaceKind === "novel" && ideStore.currentProjectRoot
        ? {scope: "project", projectRoot: ideStore.currentProjectRoot}
        : {scope: "workspace-root"}
));

/** 当前异步边界是否仍属于同一 Project scope 与 Surface 激活代次。 */
function acceptsActivation(attempt: AgentSurfaceActivationAttempt): boolean {
    return surfaceActivation.accepts(attempt, sessionScopeKey.value);
}

/** 开启新 Surface 操作代次，并同步更新供页面捕获的不透明 operation key。 */
function beginSurfaceOperations(scopeKey: string): AgentSurfaceActivationAttempt {
    return surfaceOperations.begin(scopeKey);
}

/** 立即失效旧操作；旧页面命令即使 Project scope 相同也无法借用新代次。 */
function invalidateSurfaceOperations(): void {
    surfaceOperations.invalidate();
}

/** 开启 Inline PromptBar 自己的 Project 代次，不受右侧面板显隐影响。 */
function beginInlineSurfaceOperations(scopeKey: string): AgentSurfaceActivationAttempt {
    const owner = inlineSurfaceOperations.begin(scopeKey);
    inlineOperationRevision.value = owner.revision;
    return owner;
}

/** Project scope 或组件销毁时才使 Inline 操作失效。 */
function invalidateInlineSurfaceOperations(): void {
    inlineSurfaceOperations.invalidate();
    inlineOperationRevision.value += 1;
}

/** 捕获当前 Project generation 的操作 owner；页面传入旧 scope 时直接拒绝。 */
function captureSurfaceOperation(expectedOperationKey?: string): AgentSurfaceActivationAttempt | null {
    if (expectedOperationKey !== undefined && expectedOperationKey !== surfaceOperationKey.value) {
        return null;
    }
    return surfaceOperations.capture(sessionScopeKey.value);
}

/** 主面板请求只校验主面板 Project generation。 */
function acceptsSurfaceOperation(owner: AgentSurfaceActivationAttempt): boolean {
    return surfaceOperations.accepts(owner, sessionScopeKey.value);
}

/** 捕获 Inline PromptBar 当前 Project 代次；右侧面板隐藏时仍可用。 */
function captureInlineSurfaceOperation(expectedOperationKey?: string): AgentSurfaceActivationAttempt | null {
    if (expectedOperationKey !== undefined && expectedOperationKey !== inlineOperationKey.value) {
        return null;
    }
    return inlineSurfaceOperations.capture(sessionScopeKey.value);
}

/** Inline 请求只校验 Inline owner 与目标 Session 身份。 */
function acceptsInlineSurfaceOperation(owner: AgentSurfaceActivationAttempt, expectedSessionId?: number): boolean {
    return inlineSurfaceOperations.accepts(owner, sessionScopeKey.value)
        && (expectedSessionId === undefined || inlineEditorSessionId.value === expectedSessionId);
}

/** 清空 Inline Editor 当前状态；expectedSessionId 用于拒绝迟到请求清理新选择。 */
function clearInlineEditorSession(
    expectedSessionId?: number,
    invalidateRecovery = true,
    expectedSessionIdentity?: AgentSessionIdentity,
): boolean {
    if (import.meta.client && expectedSessionId !== undefined && expectedSessionIdentity !== undefined) {
        forgetRememberedSession(
            localStorage,
            `agent:inline-editor-session:${sessionMemoryScopeKey.value}`,
            {sessionId: expectedSessionId, sessionIdentity: expectedSessionIdentity},
        );
    }
    if (expectedSessionId !== undefined && inlineEditorSessionId.value !== expectedSessionId) {
        return false;
    }
    if (invalidateRecovery) {
        inlineSessionLoads.invalidate();
    }
    inlineEditorStream.stop();
    inlineEditorSessionId.value = null;
    inlineEditorSessionIdentity.value = null;
    inlineEditorSession.reset();
    inlineEditorResultText.value = "";
    inlineSessionModelPopoverOpen.value = false;
    inlineSessionModelSaving.value = false;
    syncInlineSessionModelState();
    return true;
}

const INLINE_EDITOR_PROFILE_KEY = "inline.editor";


const inlineSessionModelDraft = ref<AgentSessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});

const inlineEditorMessages = inlineEditorSession.messages;

const inlineEditorRunning = inlineEditorSession.running;

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

let lastUnavailableRelationWarningKey = "";

const ensureInlineEditorEvents = async (): Promise<void> => {
    await inlineEditorStream.ensure();
};

/**
 * 把 Agent 面板内 API 异常统一转换为 notification 文案。
 */
const notifyAgentError = (error: unknown, fallback: string, title = fallback): string => {
    const message = resolveApiErrorMessage(error, fallback);
    notification.error(message, {title});
    return message;
};

/** 捕获主 Composer 当前 pending 批次的 Project/Session 发布权。 */
function capturePendingUserInputOperation(): AgentPendingOperationOwner | null {
    const owner = captureSurfaceOperation();
    const sessionId = activeSessionId.value;
    const batchKey = pendingResolutionBatchKey(sessionId, pendingUserInputSessions.value);
    return owner && sessionId && batchKey ? {owner, sessionId, batchKey} : null;
}

/** 旧 Project、旧主 Session 或旧 pending 批次都不能发布结果。 */
function acceptsPendingUserInputOperation(operation: AgentPendingOperationOwner): boolean {
    return acceptsAgentPendingOperation(
        surfaceOperations,
        operation,
        sessionScopeKey.value,
        activeSessionId.value,
        pendingUserInputSessions.value,
    );
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

const currentPendingUserInputKey = computed(() => pendingResolutionBatchKey(activeSessionId.value, pendingUserInputSessions.value));
const submittingCurrentUserInput = computed(() => {
    return Boolean(submittingUserInputKey.value && submittingUserInputKey.value === currentPendingUserInputKey.value);
});

let pendingResolutionDraftScopeKey = "";
let pendingResolutionDraftSessionId: number | null = null;

/** 同 Project/Session 的权威重投影按身份保留草稿；跨 scope 或 Session 不继承。 */
watch([sessionScopeKey, activeSessionId, pendingUserInputSessions], ([scopeKey, sessionId, pendingSessions]) => {
    const sameOwner = scopeKey === pendingResolutionDraftScopeKey && sessionId === pendingResolutionDraftSessionId;
    pendingResolutionDraft.value = sameOwner
        ? reconcileAgentPendingResolutionDraft(pendingSessions, pendingResolutionDraft.value)
        : createAgentPendingResolutionDraft(pendingSessions);
    pendingResolutionDraftScopeKey = scopeKey;
    pendingResolutionDraftSessionId = sessionId;

    const batchKey = pendingResolutionBatchKey(sessionId, pendingSessions);
    if (pendingSubmissionIssueBatchKey !== batchKey) {
        pendingSubmissionIssue.value = null;
        pendingSubmissionIssueBatchKey = null;
    }
    if (submittingUserInputKey.value !== batchKey) {
        submittingUserInputKey.value = null;
    }
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
/** 上下文检查面板开关（Task 126）；由 composer 的 gauge 芯片触发。 */
const contextInspectorOpen = ref(false);
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
 * 格式化 prompt cache 命中率；口径见 `app/utils/prompt-cache.ts`，无从计算时显示 —。
 *
 * 这里传入的是**会话累计** usage，只适合当粗略指示。首轮全量 cacheWrite 会永久压在
 * 累计分母里，判断缓存健康度要看上下文面板的逐请求时间轴。
 */
function formatCacheHitRate(usage: PromptCacheUsage): string {
    const rate = promptCacheHitRate(usage);
    return rate === null ? "—" : formatPercent(rate);
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
        novelId: isUserAssetsWorkspace ? "" : ideStore.currentProjectRoot,
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

/** 应用同一次 bootstrap 快照中的模型、费用与默认 Profile，避免两个请求看到不同配置代次。 */
function applySurfaceBootstrap(settings: ConfigBootstrapDto): boolean {
    const previousProfileKey = resolvedDefaultProfileKey.value;
    selectableModels.value = settings.modelSettings.enabledModels;
    resolvedDefaultProfileKey.value = settings.defaultProfileSettings.effectiveProfileKey || systemLeaderProfileKey.value;
    costDisplay.setCostCurrency(settings.ui.costCurrency);
    void costDisplay.ensureExchangeRate(configApi.exchangeRate);
    return previousProfileKey !== resolvedDefaultProfileKey.value;
}

/** 按当前 Project generation 读取 Agent Surface 所需的唯一 config bootstrap。 */
const loadSurfaceBootstrap = async (attempt?: AgentSurfaceActivationAttempt): Promise<boolean> => {
    const requestId = ++defaultProfileResolveRequest;
    const previousProfileKey = resolvedDefaultProfileKey.value;
    if (ideStore.workspaceKind !== "user-assets" && !ideStore.currentProjectRoot) {
        if (requestId === defaultProfileResolveRequest && (!attempt || acceptsActivation(attempt))) {
            resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
        }
        return previousProfileKey !== resolvedDefaultProfileKey.value;
    }
    try {
        const settings = await configApi.bootstrap();
        if (requestId !== defaultProfileResolveRequest || (attempt && !acceptsActivation(attempt))) {
            return false;
        }
        return applySurfaceBootstrap(settings);
    } catch (error) {
        if (requestId !== defaultProfileResolveRequest || (attempt && !acceptsActivation(attempt))) {
            return false;
        }
        console.error("读取默认 Agent Profile 失败", error);
        selectableModels.value = [];
        resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
        return previousProfileKey !== resolvedDefaultProfileKey.value;
    }
};

/**
 * 刷新 session 列表。
 */
const refreshSessions = async (attempt?: AgentSurfaceActivationAttempt): Promise<AgentSessionSummaryDto[]> => {
    return refreshSessionsWithQuery({
        profileGroup: "leader",
        status: "active",
        relation: "all",
        limit: 50,
    }, attempt);
};

/**
 * 按弹窗筛选条件刷新 session 列表。
 */
const refreshSessionsWithQuery = async (
    query: AgentSessionListQueryDto = {},
    attempt?: AgentSurfaceActivationAttempt,
): Promise<AgentSessionSummaryDto[]> => {
    const requestQuery = {
        ...query,
        ...sessionScope.value,
    };
    const request = sessionListRequestGuard.begin(requestQuery);
    if (!request.shouldFetch) {
        return sessions.value;
    }
    sessionListRequestGuard.start(request);
    sessionListLoading.value = true;
    try {
        const page = await agentApi.listSessions(requestQuery);
        if (attempt && !acceptsActivation(attempt)) {
            return [];
        }
        if (sessionListRequestGuard.accepts(request)) {
            applySessionListPage(page, request.append);
            sessionListRequestGuard.markApplied(request);
        }
        // activation 只消费自己请求得到的快照；弹窗查询只决定共享列表是否更新。
        return attempt ? page.items : sessions.value;
    } catch (error) {
        if (attempt && !acceptsActivation(attempt)) {
            return [];
        }
        if (!attempt && !sessionListRequestGuard.accepts(request)) {
            return sessions.value;
        }
        console.error("刷新 session 列表失败", error);
        if (!attempt) {
            notifyAgentError(error, t("agent.chatSurface.loadSessionsFailed"));
        }
        throw error;
    } finally {
        sessionListLoading.value = sessionListRequestGuard.finish(request);
    }
};

/**
 * 恢复当前 workspace 下已有的有效 session，不主动创建新 session。
 */
const ensureSessionReady = async (
    requestedAttempt?: AgentSurfaceActivationAttempt,
    options: {forceRecovery?: boolean} = {},
): Promise<AgentSessionSummaryDto[]> => {
    if (!requestedAttempt) {
        const attempt = surfaceActivation.begin(sessionScopeKey.value);
        beginSurfaceOperations(attempt.scopeKey);
        return restoreAgentSurface(attempt, {reset: false});
    }
    const attempt = requestedAttempt;
    const list = await surfaceActivation.run(
        attempt,
        () => sessionScopeKey.value,
        () => ensureSessionReadyInternal(attempt, options),
    );
    if (surfaceActivation.state.value.status === "loading") {
        if (activeSessionId.value) {
            surfaceActivation.markReady(attempt, sessionScopeKey.value);
        } else if (list.length === 0) {
            surfaceActivation.markEmpty(attempt, sessionScopeKey.value);
        } else {
            surfaceActivation.markUnselected(attempt, sessionScopeKey.value);
        }
    }
    return list;
};

/**
 * 执行 session 恢复。
 */
const ensureSessionReadyInternal = async (
    attempt: AgentSurfaceActivationAttempt,
    options: {forceRecovery?: boolean},
): Promise<AgentSessionSummaryDto[]> => {
    if (!props.active || !acceptsActivation(attempt)) {
        return sessions.value;
    }
    if (activeSessionId.value) {
        if (options.forceRecovery) {
            let recovered = false;
            try {
                recovered = await sessionStream.refreshRecovery("manual_refresh");
            } catch (error) {
                const hasStableSession = session.recoveryShell.value?.summary.sessionId === activeSessionId.value;
                if (resolveApiErrorCode(error) === "SESSION_DEPENDENCY_NOT_FOUND"
                    && hasStableSession
                    && acceptsActivation(attempt)) {
                    surfaceActivation.markReady(attempt, sessionScopeKey.value);
                    notifyAgentError(error, "关联对话不可用，当前对话未切换", "对话未切换");
                    void sessionStream.ensure().catch(() => {});
                    return sessions.value;
                }
                throw error;
            }
            if (!recovered && acceptsActivation(attempt)) {
                throw new Error(t("agent.chatSurface.syncSessionFailed"));
            }
            if (recovered && acceptsActivation(attempt) && activeSessionId.value) {
                // 面板隐藏时 stop() 会清掉 controller；恢复快照后显式恢复实时事件流。
                void sessionStream.ensure().catch(() => {});
            }
        }
        return sessions.value;
    }
    if (activeSessionId.value) {
        return sessions.value;
    }
    const remembered = readLastSession();
    if (remembered) {
        const loaded = await loadSession(remembered.sessionId, {
            attempt,
            expectedIdentity: remembered.sessionIdentity,
            recoverMissing: false,
        });
        if (loaded.status === "loaded") {
            return sessions.value;
        }
        if (loaded.status === "superseded") {
            return sessions.value;
        }
        if (loaded.status === "primary_missing" && import.meta.client) {
            forgetRememberedSession(
                localStorage,
                `agent:last-session:${sessionMemoryScopeKey.value}`,
                remembered,
            );
        }
    }
    const list = await refreshSessions(attempt);
    if (!acceptsActivation(attempt)) {
        return sessions.value;
    }
    if (sessionListTotal.value === 0) {
        surfaceActivation.markEmpty(attempt, sessionScopeKey.value);
    } else {
        surfaceActivation.markUnselected(attempt, sessionScopeKey.value);
    }
    return list;
};

/**
 * 显式创建一个新的 session。只能由按钮、弹窗或 /new 这类用户命令调用。
 */
const createSession = async (profileKey?: string): Promise<AgentSessionOpenResult<AgentSessionSummaryDto[]>> => {
    const attempt = surfaceActivation.begin(sessionScopeKey.value);
    beginSurfaceOperations(sessionScopeKey.value);
    const loadOwner = mainSessionLoads.beginForeground(attempt.scopeKey);
    clearMainReconnectWatchers();
    let replayDeferred = false;
    try {
        await loadSurfaceBootstrap(attempt);
        if (!acceptsActivation(attempt)) {
            return {status: "superseded"};
        }
        const created = await agentApi.createSession({
            profileKey: profileKey || leaderProfileKey.value,
            initial: {},
            currentProjectRoot: ideStore.workspaceKind === "novel" ? ideStore.currentProjectRoot || undefined : undefined,
        });
        if (!acceptsActivation(attempt)) {
            return {status: "superseded"};
        }
        await refreshSessions(attempt);
        if (!acceptsActivation(attempt)) {
            return {status: "superseded"};
        }
        const loaded = await loadSession(created.sessionId, {attempt, loadOwner});
        if (loaded.status === "loaded") {
            return {status: "current", value: sessions.value};
        }
        if (loaded.status === "superseded") {
            return loaded;
        }
        replayDeferred = activeSessionId.value !== null
            && session.recoveryShell.value?.summary.sessionId === activeSessionId.value;
        const message = loaded.status === "dependency_missing"
            ? resolveApiErrorMessage(loaded.error, "关联对话不可用，无法打开新对话")
            : loaded.status === "failed"
                ? resolveApiErrorMessage(loaded.error, t("agent.chatSurface.createSessionFailed"))
                : "当前没有可用对话";
        return {status: "failed", message};
    } catch (error) {
        if (!acceptsActivation(attempt) || isAgentSurfaceSupersededError(error)) {
            return {status: "superseded"};
        }
        const message = notifyAgentError(error, t("agent.chatSurface.createSessionFailed"));
        const hasStableSession = activeSessionId.value !== null
            && session.recoveryShell.value?.summary.sessionId === activeSessionId.value;
        if (hasStableSession) {
            replayDeferred = true;
            surfaceActivation.markReady(attempt, sessionScopeKey.value);
        } else {
            if (!await clearComposerContextForNoSession(() => acceptsActivation(attempt)
                && mainSessionLoads.accepts(loadOwner, sessionScopeKey.value))) {
                if (!acceptsActivation(attempt)) {
                    return {status: "superseded"};
                }
                return {status: "failed", message};
            }
            clearActiveAgentSession();
            surfaceActivation.markError(attempt, sessionScopeKey.value, message);
        }
        return {status: "failed", message};
    } finally {
        await mainSessionLoads.finish(loadOwner, replayDeferred);
    }
};

/** 草稿保存结果只使用控制器捕获的 context，不能读取已经切换后的响应式 key。 */
function handleComposerDraftSave(result: AgentComposerDraftSaveResult, context: AgentComposerDraftContext): void {
    if (result === "oversize" && composerDraftWarning !== `${context.scopeKey}:${String(context.sessionId)}:oversize`) {
        composerDraftWarning = `${context.scopeKey}:${String(context.sessionId)}:oversize`;
        notification.warning("Composer 草稿超过 256 KiB，已停止保存该草稿。", {title: "草稿过大"});
    }
    if (result === "unsafe" && composerDraftWarning !== `${context.scopeKey}:${String(context.sessionId)}:unsafe`) {
        composerDraftWarning = `${context.scopeKey}:${String(context.sessionId)}:unsafe`;
        notification.warning("草稿包含不安全图片地址，仍保留当前正文；请返回编辑或明确放弃。", {title: "草稿未保存"});
    }
}

function ensureComposerDraftSession(): AgentComposerDraftSession | null {
    if (!import.meta.client) {
        return null;
    }
    composerDraftSession ??= new AgentComposerDraftSession(
        new AgentComposerDraftClientStore(agentApi, localStorage),
        handleComposerDraftSave,
        (error) => notifyAgentError(error, "保存 Composer 草稿失败", "草稿未保存"),
    );
    return composerDraftSession;
}

/** 立即持久化控制器当前 context；pending File 永远不进入 inputText。 */
async function saveComposerDraftNow(): Promise<void> {
    const drafts = ensureComposerDraftSession();
    if (!drafts) return;
    drafts.update(inputText.value);
    const result = await drafts.flush();
    if (result === "oversize" || result === "unsafe") {
        throw new AgentComposerDraftBlockedError(result);
    }
}

/** 用户确认放弃无法保存的草稿后解除 context；普通路径不能调用。 */
function discardComposerDraft(): void {
    const drafts = ensureComposerDraftSession();
    if (!drafts) {
        composerContextGeneration.value += 1;
    } else {
        composerContextGeneration.value = drafts.discardContext();
    }
    inputText.value = "";
}

/** 只读取目标草稿；Session owner 通过后才允许激活这个快照。 */
async function prepareComposerDraftContext(sessionId: number): Promise<AgentComposerDraftPreparedContext | null> {
    const drafts = ensureComposerDraftSession();
    if (!drafts) {
        return null;
    }
    return await drafts.prepareContext(sessionMemoryScopeKey.value, sessionId);
}

/** 在主 Session 的同步提交段激活已读取的草稿 context。 */
function activateComposerDraftContext(prepared: AgentComposerDraftPreparedContext | null): void {
    const drafts = ensureComposerDraftSession();
    if (!drafts || !prepared) {
        composerContextGeneration.value += 1;
        inputText.value = "";
        return;
    }
    composerContextGeneration.value = drafts.activateContext(prepared);
    inputText.value = prepared.text;
}

/** 捕获本次提交的 context/revision，供迟到 acceptance compare-and-clear。 */
function captureComposerSubmission(sessionId: number, text: string): AgentComposerSubmission | null {
    if (activeSessionId.value !== sessionId) return null;
    const drafts = ensureComposerDraftSession();
    drafts?.update(text);
    return drafts?.capture(text) ?? null;
}

async function clearComposerAfterAccepted(
    sessionId: number,
    acceptedText: string,
    submission = captureComposerSubmission(sessionId, acceptedText),
): Promise<void> {
    if (!submission) {
        return;
    }
    let result: {clearEditor: boolean} | undefined;
    try {
        result = await ensureComposerDraftSession()?.accept(submission);
    } catch (error) {
        notifyAgentError(error, "消息已发送，但 Composer 草稿未清除", "草稿未清除");
        return;
    }
    if (result?.clearEditor && activeSessionId.value === sessionId && inputText.value === acceptedText) {
        inputText.value = "";
    }
}

/** 重置附件分页状态；目录请求通过 requestId、Composer metadata 请求通过 generation 失效。 */
function resetSessionAttachments(): void {
    sessionAttachmentRequestId += 1;
    sessionAttachmentGeneration += 1;
    sessionAttachments.value = [];
    knownSessionAttachments.value = [];
    sessionAttachmentUniqueTotal.value = 0;
    sessionAttachmentPageTotal.value = 0;
    sessionAttachmentHasMore.value = false;
    sessionAttachmentNextOffset.value = null;
    sessionAttachmentLoading.value = false;
    sessionAttachmentSearch.value = "";
    attachmentPanelOpen.value = false;
    if (sessionAttachmentSearchTimer) {
        clearTimeout(sessionAttachmentSearchTimer);
        sessionAttachmentSearchTimer = null;
    }
}

/** 附件控制事件只使目录缓存失效；刷新目录与计数，不触发完整 Session recovery。 */
function invalidateSessionAttachments(): void {
    const sessionId = activeSessionId.value;
    if (!sessionId) {
        return;
    }
    sessionAttachmentRequestId += 1;
    sessionAttachmentGeneration += 1;
    sessionAttachmentLoading.value = false;
    knownSessionAttachments.value = [];
    void loadSessionAttachments(true);
    if (sessionAttachmentSearch.value) {
        void agentApi.getSessionAttachments(sessionId, {offset: 0, limit: 1}).then((page) => {
            if (activeSessionId.value === sessionId) {
                sessionAttachmentUniqueTotal.value = page.total;
            }
        }).catch(() => {});
    }
}

/** 合并已经看见的附件，避免附件面板搜索结果覆盖 Composer 的 Session 附件来源。 */
function rememberSessionAttachments(items: AgentSessionAttachmentItemDto[]): void {
    const byId = new Map(knownSessionAttachments.value.map((item) => [item.attachment.attachmentId, item]));
    for (const item of items) {
        byId.set(item.attachment.attachmentId, item);
    }
    knownSessionAttachments.value = [...byId.values()].sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
        || left.attachment.attachmentId.localeCompare(right.attachment.attachmentId));
}

/** 加载附件目录；搜索与分页结果都由服务端按 Attachment ID 去重。 */
async function loadSessionAttachments(reset = true): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId || sessionAttachmentLoading.value || (!reset && !sessionAttachmentHasMore.value)) {
        return;
    }
    const requestId = ++sessionAttachmentRequestId;
    sessionAttachmentLoading.value = true;
    try {
        const page = await agentApi.getSessionAttachments(sessionId, {
            search: sessionAttachmentSearch.value || undefined,
            offset: reset ? 0 : sessionAttachmentNextOffset.value ?? sessionAttachments.value.length,
            limit: 40,
        });
        if (requestId !== sessionAttachmentRequestId || sessionId !== activeSessionId.value) {
            return;
        }
        const currentIds = new Set(reset ? [] : sessionAttachments.value.map((item) => item.attachment.attachmentId));
        sessionAttachments.value = reset
            ? page.items
            : [...sessionAttachments.value, ...page.items.filter((item) => !currentIds.has(item.attachment.attachmentId))];
        rememberSessionAttachments(page.items);
        sessionAttachmentPageTotal.value = page.total;
        if (!sessionAttachmentSearch.value) {
            sessionAttachmentUniqueTotal.value = page.total;
        }
        sessionAttachmentHasMore.value = page.hasMore;
        sessionAttachmentNextOffset.value = page.nextOffset ?? null;
    } catch (error) {
        if (requestId === sessionAttachmentRequestId) {
            notifyAgentError(error, "加载 Session 附件失败");
        }
    } finally {
        if (requestId === sessionAttachmentRequestId) {
            sessionAttachmentLoading.value = false;
        }
    }
}

function toggleAttachmentPanel(): void {
    if (!activeSessionId.value) {
        return;
    }
    attachmentPanelOpen.value = !attachmentPanelOpen.value;
    if (attachmentPanelOpen.value) {
        void loadSessionAttachments(true);
    }
}

function updateAttachmentSearch(value: string): void {
    sessionAttachmentSearch.value = value;
    if (sessionAttachmentSearchTimer) {
        clearTimeout(sessionAttachmentSearchTimer);
    }
    sessionAttachmentSearchTimer = setTimeout(() => {
        sessionAttachmentSearchTimer = null;
        void loadSessionAttachments(true);
    }, 250);
}

function registerSessionAttachment(item: AgentSessionAttachmentItemDto): void {
    rememberSessionAttachments([item]);
    const remaining = sessionAttachments.value.filter((current) => current.attachment.attachmentId !== item.attachment.attachmentId);
    sessionAttachments.value = [item, ...remaining];
    sessionAttachmentRequestId += 1;
    sessionAttachmentLoading.value = false;
    void loadSessionAttachments(true);
}

function insertSessionAttachment(item: AgentSessionAttachmentItemDto): void {
    if (!activeInteraction.value.canInsertAttachment) {
        return;
    }
    if (editingMessageId.value) {
        historyAttachmentInsertRequest.value = {id: ++historyAttachmentInsertRequestId, item};
    } else {
        inputRef.value?.insertAttachment(item);
    }
    attachmentPanelOpen.value = false;
}

/** 清空主 Agent Session；只有确认没有可保留的稳定 recovery 时调用。 */
function clearActiveAgentSession(): void {
    sessionStream.stop();
    resetSessionAttachments();
    linkedAgentRelationsRequestId += 1;
    linkedAgentsLoading.value = false;
    linkedAgentPanelOpen.value = false;
    systemPromptPanelOpen.value = false;
    sessionTreeDialogOpen.value = false;
    contextInspectorOpen.value = false;
    sessionModelPopoverOpen.value = false;
    sessionModelSaving.value = false;
    sessionActionId.value = null;
    cancelEditingMessage();
    historyAttachmentInsertRequest.value = null;
    messageActionId.value = null;
    fileChangedSinceLastSend.value = false;
    pendingResolutionDraft.value = createAgentPendingResolutionDraft([]);
    pendingSubmissionIssue.value = null;
    pendingSubmissionIssueBatchKey = null;
    submittingUserInputKey.value = null;
    activeSessionId.value = null;
    activeSessionIdentity.value = null;
    session.reset();
    syncSessionModelState(null);
}

/** 在解除 Session 绑定前保存并解除 Composer context；保存失败时保留当前输入。 */
async function clearComposerContextForNoSession(accepts: () => boolean): Promise<boolean> {
    const drafts = ensureComposerDraftSession();
    if (!drafts) {
        if (!accepts()) return false;
        composerContextGeneration.value += 1;
        inputText.value = "";
        return true;
    }
    drafts.update(inputText.value);
    let generation: number;
    try {
        generation = await drafts.clearContext();
    } catch (error) {
        if (accepts()) {
            notifyAgentError(error, "保存 Composer 草稿失败，当前对话未切换", "对话未切换");
        }
        return false;
    }
    if (!accepts()) return false;
    composerContextGeneration.value = generation;
    inputText.value = "";
    return true;
}

/** Session 消失后只刷新当前实例列表，不猜测另一个同号 Session。 */
async function recoverMissingAgentSession(
    failedSessionId: number,
    previousSessionId: number | null,
    attempt: AgentSurfaceActivationAttempt,
    loadOwner: AgentSessionLoadOwner,
): Promise<AgentSessionLoadResult<void>> {
    const acceptsLoad = (): boolean => acceptsActivation(attempt)
        && mainSessionLoads.accepts(loadOwner, sessionScopeKey.value);
    if (!acceptsLoad()) {
        return {status: "superseded"};
    }
    const stablePreviousSession = previousSessionId !== null
        && activeSessionId.value === previousSessionId
        && session.recoveryShell.value?.summary.sessionId === previousSessionId
        && activeSessionIdentity.value === session.recoveryShell.value.summary.sessionIdentity;
    const failedIdentity = activeSessionId.value === failedSessionId ? activeSessionIdentity.value : null;
    try {
        await refreshSessions(attempt);
        if (!acceptsLoad()) return {status: "superseded"};
        if (stablePreviousSession) {
            surfaceActivation.markReady(attempt, sessionScopeKey.value);
            notification.warning("目标对话不可用，当前对话未切换。", {title: "对话未切换"});
            return {status: "failed", error: new Error("目标对话已失效")};
        }
        if (failedIdentity && import.meta.client) {
            const remembered = readLastSession();
            if (remembered?.sessionId === failedSessionId && remembered.sessionIdentity === failedIdentity) {
                forgetRememberedSession(
                    localStorage,
                    `agent:last-session:${sessionMemoryScopeKey.value}`,
                    remembered,
                );
            }
        }
        if (!await clearComposerContextForNoSession(acceptsLoad)) {
            if (acceptsLoad()) {
                const error = new Error("保存 Composer 草稿失败");
                surfaceActivation.markError(attempt, sessionScopeKey.value, error.message);
                return {status: "failed", error};
            }
            return {status: "superseded"};
        }
        clearActiveAgentSession();
        if (sessionListTotal.value === 0) {
            surfaceActivation.markEmpty(attempt, sessionScopeKey.value);
            return {status: "empty"};
        }
        surfaceActivation.markUnselected(attempt, sessionScopeKey.value);
        notification.warning("目标对话不在当前打开的 NeuroBook 中，请重新选择对话。", {title: "对话已失效"});
        return {status: "failed", error: new Error("目标对话已失效")};
    } catch (refreshError) {
        if (!acceptsLoad()) {
            return {status: "superseded"};
        }
        console.error("失效 Session 的列表恢复失败", refreshError);
        if (stablePreviousSession) {
            surfaceActivation.markReady(attempt, sessionScopeKey.value);
            notifyAgentError(refreshError, "目标对话不可用，当前对话未切换", "对话未切换");
            return {status: "failed", error: refreshError};
        }
        const message = notifyAgentError(refreshError, "目标对话已失效，刷新对话列表失败");
        surfaceActivation.markError(attempt, sessionScopeKey.value, message);
        return {status: "failed", error: refreshError};
    }
}

/**
 * 切换到指定 session，并拉取 recovery。
 */
const loadSession = async (
    sessionId: number,
    options: {
        attempt?: AgentSurfaceActivationAttempt;
        loadOwner?: AgentSessionLoadOwner;
        recoverMissing?: boolean;
        expectedIdentity?: AgentSessionIdentity;
        acceptsAdditional?: () => boolean;
    } = {},
): Promise<AgentSessionLoadResult<void>> => {
    const attempt = options.attempt ?? surfaceActivation.begin(sessionScopeKey.value);
    const previousSessionId = activeSessionId.value;
    if (!options.attempt) {
        beginSurfaceOperations(attempt.scopeKey);
    }
    const targetScopeKey = attempt.scopeKey;
    const loadOwner = options.loadOwner ?? mainSessionLoads.beginForeground(targetScopeKey);
    const ownsLoadOwner = options.loadOwner === undefined;
    // 无论 owner 由谁创建（外层 createSession/Inline handoff 传 loadOwner），
    // 前台加载开始即取代旧代次：旧重连 watcher 立即失效，不依赖下一次 status 变化。
    clearMainReconnectWatchers();
    let replayDeferred = false;
    let committedSessionIdentity: AgentSessionIdentity | null = null;
    const acceptsLoad = (): boolean => acceptsActivation(attempt)
        && mainSessionLoads.accepts(loadOwner, sessionScopeKey.value)
        && sessionScopeKey.value === targetScopeKey
        && (options.acceptsAdditional?.() ?? true);
    try {
        try {
            await saveComposerDraftNow();
        } catch (error) {
            if (!acceptsLoad()) {
                return {status: "superseded"};
            }
            if (error instanceof AgentComposerDraftBlockedError) {
                const discard = await confirm(
                    "当前草稿无法安全保存。返回编辑会保留正文；放弃草稿后才继续切换对话。",
                    "草稿未保存",
                );
                if (!discard || !acceptsLoad()) {
                    const hasStableSession = previousSessionId !== null
                        && activeSessionId.value === previousSessionId
                        && session.recoveryShell.value?.summary.sessionId === previousSessionId;
                    if (hasStableSession) {
                        replayDeferred = true;
                        surfaceActivation.markReady(attempt, sessionScopeKey.value);
                    } else {
                        surfaceActivation.markError(attempt, sessionScopeKey.value, error.message);
                    }
                    return {status: "failed", error};
                }
                discardComposerDraft();
            } else {
            const hasStablePreviousSession = previousSessionId !== null
                && activeSessionId.value === previousSessionId
                && session.recoveryShell.value?.summary.sessionId === previousSessionId;
            if (hasStablePreviousSession) {
                replayDeferred = true;
                surfaceActivation.markReady(attempt, sessionScopeKey.value);
                notifyAgentError(error, "保存 Composer 草稿失败，当前对话未切换", "对话未切换");
            } else {
                const message = notifyAgentError(error, "保存 Composer 草稿失败，无法切换对话", "对话未切换");
                surfaceActivation.markError(attempt, sessionScopeKey.value, message);
            }
                return {status: "failed", error};
            }
        }
        if (!acceptsLoad()) {
            return {status: "superseded"};
        }
        const result = await runSessionLoadAttempt({
            read: () => agentApi.getSessionRecovery(sessionId),
            accepts: acceptsLoad,
            errorCode: resolveApiErrorCode,
            commit: async (recovery) => {
                if (recovery.summary.sessionId !== sessionId) {
                    throw new Error(`加载 session 身份不匹配：期望 ${String(sessionId)}，收到 ${String(recovery.summary.sessionId)}`);
                }
                if (options.expectedIdentity !== undefined
                    && recovery.summary.sessionIdentity !== options.expectedIdentity) {
                    throw new Error("加载的对话身份与浏览器记忆不一致。请从当前对话列表重新选择。");
                }
                const preparedDraft = await prepareComposerDraftContext(sessionId);
                if (!acceptsLoad()) {
                    return;
                }

                // 下面是同步提交段：owner 通过后立即发布状态；open 成功、记忆写入与 markReady 在提交之后进行。
                clearActiveAgentSession();
                activeSessionId.value = sessionId;
                activeSessionIdentity.value = recovery.summary.sessionIdentity;
                committedSessionIdentity = recovery.summary.sessionIdentity;
                activateComposerDraftContext(preparedDraft);
                session.applyRecovery(recovery);
                syncSessionModelState(recovery.summary);
                void loadSessionAttachments(true);
                fileChangedSinceLastSend.value = false;
            },
        });
        if (result.status === "loaded") {
            void nextTick().then(() => {
                if (acceptsActivation(attempt)
                    && sessionScopeKey.value === targetScopeKey
                    && activeSessionId.value === sessionId) {
                    scrollToBottom();
                }
            });
            // 记忆只在事件流 open 成功且 owner 仍有效时写入（ADR 0018）；失败保留已提交 Session，不回滚。
            const streamOutcome = await writeRememberedAfterStreamOpen({
                start: () => sessionStream.start(sessionId),
                accepts: acceptsLoad,
                remember: () => {
                    if (committedSessionIdentity) {
                        saveLastSession(sessionId, committedSessionIdentity);
                    }
                },
            });
            if (streamOutcome.status === "connect_failed") {
                console.error(`连接 session ${String(sessionId)} 实时事件流失败，本次不写入对话记忆`, streamOutcome.error);
                const message = notifyAgentError(streamOutcome.error, "对话已切换，但实时事件流连接失败，恢复连接前不会更新对话记忆。", "连接失败");
                surfaceActivation.markError(attempt, sessionScopeKey.value, message);
                // 后台重连成功后解除 load-error；不能用 acceptsLoad() 守卫：loadSession 的 finally
                // 会立刻 finish loadOwner，重连通常在稍后才 connected；改用 activation 仍是同一
                // attempt 且目标 Session 仍是当前会话，防跨代次误标。
                // watch 在多次 await 后的异步 continuation 中创建，没有 active effect scope；
                // 登记到 setup 同步注册的重连 watcher 清理表，组件卸载时统一 stop。
                if (surfaceUnmounted) {
                    return {status: "superseded"};
                }
                registerReconnectRestoreWatcher({
                    connectionStatus: session.connectionStatus,
                    stops: mainReconnectWatcherStops,
                    // 新代次接管、会话切换或身份不符时立即自停，防止反复握手失败后闭包累积。
                    shouldRestore: () => {
                        const state = surfaceActivation.state.value;
                        if (state.status !== "error") {
                            return false;
                        }
                        return projectReconnectReady({
                            activationStatus: state.status,
                            attemptScopeKey: state.attempt.scopeKey,
                            attemptRevision: state.attempt.revision,
                            expectedScopeKey: attempt.scopeKey,
                            expectedRevision: attempt.revision,
                            activeSessionId: activeSessionId.value,
                            expectedSessionId: sessionId,
                        }) === "restore_ready"
                            && activeSessionIdentity.value === committedSessionIdentity;
                    },
                    onRestored: () => {
                        surfaceActivation.markReady(attempt, sessionScopeKey.value);
                        if (committedSessionIdentity) {
                            // 握手失败时未写记忆；后台重连 open 成功后补写，避免下次启动仍恢复旧记忆。
                            saveLastSession(sessionId, committedSessionIdentity);
                        }
                    },
                });
            } else if (streamOutcome.status === "connected") {
                surfaceActivation.markReady(attempt, sessionScopeKey.value);
            } else if (streamOutcome.status === "superseded") {
                // 提交后等待 open 期间被新 owner 取代：新 owner 已发布自己的状态，
                // 本代次不写记忆、不标记任何 activation；结果按 superseded 转发给调用方。
                return {status: "superseded"};
            }
            return {status: "loaded", value: undefined};
        }
        if (result.status === "superseded") {
            return result;
        }
        if (result.status === "primary_missing" && options.recoverMissing !== false) {
            const recovered = await recoverMissingAgentSession(sessionId, previousSessionId, attempt, loadOwner);
            if (recovered.status === "failed" || recovered.status === "empty") {
                replayDeferred = previousSessionId !== null
                    && activeSessionId.value === previousSessionId
                    && session.recoveryShell.value?.summary.sessionId === previousSessionId;
            }
            return recovered;
        }
        if (result.status === "primary_missing") {
            return {status: "primary_missing"};
        }
        const hasStablePreviousSession = previousSessionId !== null
            && activeSessionId.value === previousSessionId
            && Boolean(session.recoveryShell.value);
        const projection = projectAgentSessionLoad(result.status, hasStablePreviousSession);
        if (projection.status === "preserve") {
            replayDeferred = hasStablePreviousSession;
            surfaceActivation.markReady(attempt, sessionScopeKey.value);
            const error = result.status === "dependency_missing" || result.status === "failed"
                ? result.error
                : new Error("Session 不存在或已不可用");
            console.error(`加载 session ${String(sessionId)} 失败，保留当前 Session`, error);
            notifyAgentError(
                error,
                result.status === "dependency_missing"
                    ? "关联对话不可用，当前对话未切换"
                    : t("agent.chatSurface.loadSessionFailed"),
                result.status === "dependency_missing" ? "对话未切换" : t("agent.chatSurface.loadSessionFailed"),
            );
            return result.status === "dependency_missing"
                ? result
                : {status: "failed", error};
        }
        const error = result.status === "dependency_missing" || result.status === "failed"
            ? result.error
            : new Error("Session 不存在或已不可用");
        if (!await clearComposerContextForNoSession(acceptsLoad)) {
            if (acceptsLoad()) {
                const draftError = new Error("保存 Composer 草稿失败");
                surfaceActivation.markError(attempt, sessionScopeKey.value, draftError.message);
                return {status: "failed", error: draftError};
            }
            return {status: "superseded"};
        }
        clearActiveAgentSession();
        console.error(`加载 session ${String(sessionId)} 失败`, error);
        const message = notifyAgentError(
            error,
            result.status === "dependency_missing"
                ? "关联对话不可用，无法加载目标对话"
                : t("agent.chatSurface.loadSessionFailed"),
        );
        surfaceActivation.markError(attempt, sessionScopeKey.value, message);
        return {status: "failed", error};
    } catch (error) {
        if (!acceptsLoad()) {
            return {status: "superseded"};
        }
        const hasStablePreviousSession = previousSessionId !== null
            && activeSessionId.value === previousSessionId
            && session.recoveryShell.value?.summary.sessionId === previousSessionId;
        if (hasStablePreviousSession) {
            replayDeferred = true;
            surfaceActivation.markReady(attempt, sessionScopeKey.value);
            notifyAgentError(error, "目标对话不可用，当前对话未切换", "对话未切换");
            return {status: "failed", error};
        }
        const message = notifyAgentError(error, t("agent.chatSurface.loadSessionFailed"));
        surfaceActivation.markError(attempt, sessionScopeKey.value, message);
        return {status: "failed", error};
    } finally {
        if (ownsLoadOwner) {
            await mainSessionLoads.finish(loadOwner, replayDeferred);
        }
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
const unavailableLinkedAgentWarningKeys = new Set<string>();

const notifyUnavailableLinkedAgents = (targetSessionId: number, count: number | undefined): void => {
    if (!count || count < 1) {
        return;
    }
    const key = `${String(targetSessionId)}:${String(count)}`;
    if (unavailableLinkedAgentWarningKeys.has(key)) {
        return;
    }
    unavailableLinkedAgentWarningKeys.add(key);
    notification.warning(t("agent.chatSurface.linkedUnavailableMessage", {count}), {
        title: t("agent.chatSurface.linkedUnavailableTitle"),
    });
};

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
        notifyUnavailableLinkedAgents(targetSessionId, relations.unavailableLinkedAgents);
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
    // 用户取消不是错误：气泡上已经有「已停止生成」标记，这里再弹通知既重复，又会把
    // result.error 里的英文技术文本（"invocation aborted" / provider 原文）带到界面上（Task 139）。
    if (result.aborted) {
        return;
    }
    if (!hasVisibleInvocationError(messages.value, result.invocationId)) {
        notification.error(result.error ?? t("agent.chatSurface.runFailed"), {title: t("agent.chatSurface.runFailed")});
    }
};

/**
 * 处理后台 Inline AI invoke 结果，并把最终摘要留给 PromptBar 展示。
 */
const handleInlineEditorInvokeResult = async (
    result: InvokeAgentResult,
    owner: AgentSurfaceActivationAttempt,
    sessionId: number,
): Promise<AgentSurfaceOperationResult<void>> => {
    if (!acceptsInlineSurfaceOperation(owner, sessionId)) {
        return {status: "superseded"};
    }
    inlineEditorResultText.value = result.reportResult?.result ?? result.finalMessage ?? "";
    if (result.status !== "error") {
        const refreshed = await refreshInlineEditorSessions(owner);
        return refreshed.status === "superseded"
            ? refreshed
            : {status: "current", value: undefined};
    }
    await inlineEditorStream.syncRecovery("invoke_error_fallback");
    if (!acceptsInlineSurfaceOperation(owner, sessionId)) {
        return {status: "superseded"};
    }
    // 取消同样走这个分支（停止按钮和 in-flight 阻塞 invoke 谁先返回是竞态），
    // 但结果条不能显示 result.error 里的英文技术文本，用和停止按钮一致的说法（Task 139）。
    inlineEditorResultText.value = result.aborted
        ? t("agent.chatSurface.stopped")
        : result.error ?? t("agent.chatSurface.runFailed");
    throw new Error(inlineEditorResultText.value);
};

/**
 * 委托 AgentChatFlow 滚动到底部。
 */
const scrollToBottom = (): void => {
    chatFlowRef.value?.scrollToBottom();
};

const acknowledgeClientPatch = async (
    sessionId: number,
    request: Parameters<typeof applyClientVariablePatch>[0],
    isCurrent: () => boolean,
): Promise<void> => {
    if (!isCurrent()) {
        return;
    }
    const toolCallId = request.toolCallId === undefined ? undefined : assertPublicToolCallId(request.toolCallId);
    try {
        const appliedValue = await applyClientVariablePatch(request, buildClientState(), {
            setActivePanel: (value) => {
                if (!isCurrent()) return false;
                ideStore.activeLeftTab = value;
                return true;
            },
            setTheme: async (value) => {
                if (!isCurrent()) return false;
                const applied = await themeManager.setTheme(value);
                return isCurrent() && applied;
            },
            customThemeIds: ideStore.customThemes.map((theme) => theme.id),
        });
        if (!isCurrent()) {
            return;
        }
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            appliedValue,
            invocationId: request.invocationId,
            toolCallId,
        });
    } catch (error) {
        if (!isCurrent()) {
            return;
        }
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

/** 只向仍拥有当前批次的操作发布局部提交状态。 */
function publishPendingSubmissionIssue(operation: AgentPendingOperationOwner, issue: AgentPendingSubmissionIssue | null): void {
    if (!acceptsPendingUserInputOperation(operation)) return;
    pendingSubmissionIssueBatchKey = issue ? operation.batchKey : null;
    pendingSubmissionIssue.value = issue;
}

/** 提交完整 pending 批次；服务端权威状态移除 pending 前不乐观清空。 */
const submitPendingUserInput = async (): Promise<void> => {
    if (submittingCurrentUserInput.value || !activeInteraction.value.canResolveUserInput) return;
    const operation = capturePendingUserInputOperation();
    if (!operation) return;

    const pendingSnapshot = [...pendingUserInputSessions.value];
    const build = buildAgentPendingResolutions(pendingSnapshot, pendingResolutionDraft.value, {
        otherAnswer: t("agent.userInput.otherAnswer"),
        addSuggestion: t("agent.userInput.addSuggestion"),
        continueLabel: t("agent.userInput.continue"),
        noteLabel: (note) => t("agent.userInput.notePrefix", {text: note}),
    });
    if (build.status === "incomplete") return;

    const clientState = buildClientState();
    submittingUserInputKey.value = operation.batchKey;
    publishPendingSubmissionIssue(operation, null);
    try {
        await ensureActiveSessionEvents();
        if (!acceptsPendingUserInputOperation(operation)) return;

        const result = await agentApi.invokeSession(operation.sessionId, {
            mode: "continue",
            clientState,
            resolutions: build.resolutions,
        });
        if (!acceptsPendingUserInputOperation(operation)) return;

        let recovered = false;
        try {
            recovered = await sessionStream.refreshRecovery(result.status === "error" ? "invoke_error_fallback" : "active_path_changed");
        } catch {
            recovered = false;
        }
        if (!acceptsPendingUserInputOperation(operation)) return;

        if (!recovered || result.status !== "error") {
            publishPendingSubmissionIssue(operation, {
                kind: "unknown",
                message: t("agent.userInput.submissionUnknown"),
            });
            return;
        }
        publishPendingSubmissionIssue(operation, {
            kind: "error",
            message: result.aborted
                ? t("agent.chatSurface.stopped")
                : result.error || t("agent.chatSurface.submitAnswersFailed"),
        });
    } catch (error) {
        if (!acceptsPendingUserInputOperation(operation)) return;
        let recovered = false;
        try {
            recovered = await sessionStream.refreshRecovery("manual_refresh");
        } catch {
            recovered = false;
        }
        if (!acceptsPendingUserInputOperation(operation)) return;
        publishPendingSubmissionIssue(operation, recovered
            ? {kind: "error", message: resolveApiErrorMessage(error, t("agent.chatSurface.submitAnswersFailed"))}
            : {kind: "unknown", message: t("agent.userInput.submissionUnknown")});
    } finally {
        if (ownsAgentPendingSubmission(surfaceOperations, operation, sessionScopeKey.value, activeSessionId.value, submittingUserInputKey.value)) {
            submittingUserInputKey.value = null;
        }
    }
};

/** 用户确认结果未知后显式重新同步；绝不自动重放 resolution。 */
const resyncPendingUserInput = async (): Promise<void> => {
    if (submittingCurrentUserInput.value) return;
    const operation = capturePendingUserInputOperation();
    if (!operation) return;
    submittingUserInputKey.value = operation.batchKey;
    try {
        const recovered = await sessionStream.refreshRecovery("manual_refresh");
        if (!acceptsPendingUserInputOperation(operation)) return;
        publishPendingSubmissionIssue(operation, recovered
            ? {kind: "error", message: t("agent.userInput.submissionRetry")}
            : {kind: "unknown", message: t("agent.userInput.submissionUnknown")});
    } catch {
        publishPendingSubmissionIssue(operation, {
            kind: "unknown",
            message: t("agent.userInput.submissionUnknown"),
        });
    } finally {
        if (ownsAgentPendingSubmission(surfaceOperations, operation, sessionScopeKey.value, activeSessionId.value, submittingUserInputKey.value)) {
            submittingUserInputKey.value = null;
        }
    }
};

provide(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, {
    pendingSessions: pendingUserInputSessions,
});

/** 终止当前 pending 批次；canAbort 与回答能力相互独立。 */
const cancelPendingUserInput = async (): Promise<void> => {
    if (submittingCurrentUserInput.value || !activeInteraction.value.canAbort) return;
    const operation = capturePendingUserInputOperation();
    if (!operation) return;
    submittingUserInputKey.value = operation.batchKey;
    publishPendingSubmissionIssue(operation, null);
    try {
        await agentApi.abortSession(operation.sessionId, {
            reason: "user cancelled pending user input",
            clearQueue: true,
        });
        if (!acceptsPendingUserInputOperation(operation)) return;
        const recovered = await sessionStream.refreshRecovery("manual_refresh");
        if (!acceptsPendingUserInputOperation(operation)) return;
        if (!recovered) {
            publishPendingSubmissionIssue(operation, {
                kind: "unknown",
                message: t("agent.userInput.abortUnknown"),
            });
            return;
        }
        publishPendingSubmissionIssue(operation, {
            kind: "error",
            message: t("agent.userInput.abortRetry"),
        });
    } catch (error) {
        if (!acceptsPendingUserInputOperation(operation)) return;
        let recovered = false;
        try {
            recovered = await sessionStream.refreshRecovery("manual_refresh");
        } catch {
            recovered = false;
        }
        if (!acceptsPendingUserInputOperation(operation)) return;
        publishPendingSubmissionIssue(operation, recovered
            ? {kind: "error", message: resolveApiErrorMessage(error, t("agent.chatSurface.cancelUserInputFailed"))}
            : {kind: "unknown", message: t("agent.userInput.abortUnknown")});
    } finally {
        if (ownsAgentPendingSubmission(surfaceOperations, operation, sessionScopeKey.value, activeSessionId.value, submittingUserInputKey.value)) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 停止当前运行。
 */
const stopRun = async (): Promise<void> => {
    if (!activeSessionId.value || !running.value || !activeInteraction.value.canAbort) {
        return;
    }
    try {
        await agentApi.abortSession(activeSessionId.value, {reason: "user abort"});
        await syncActiveSessionRecovery();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("agent.chatSurface.stopRunFailed")));
    }
};

/**
 * 切换到指定 Agent 模式（三态按钮、Shift+Tab 与 /mode 命令共用）。
 */
const setAgentMode = async (mode: AgentMode): Promise<void> => {
    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime) {
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

/** 为乐观图片预览补齐当前正文引用的 Session Attachment metadata。 */
async function resolveComposerAttachmentItems(
    sessionId: number,
    markdown: string,
): Promise<AgentSessionAttachmentItemDto[] | null> {
    const attachmentIds = [...new Set(parseAgentImageMarkdown(markdown).flatMap((part) => {
        if (part.type !== "image") {
            return [];
        }
        const attachmentId = attachmentIdFromMarkdownTarget(part.target);
        return attachmentId ? [attachmentId] : [];
    }))];
    const byId = new Map(knownSessionAttachments.value.map((item) => [item.attachment.attachmentId, item]));
    const missingIds = attachmentIds.filter((attachmentId) => !byId.has(attachmentId));
    if (missingIds.length > 0) {
        const requestScopeKey = sessionScopeKey.value;
        const requestSessionId = sessionId;
        const requestGeneration = sessionAttachmentGeneration;
        const isCurrent = (): boolean => sessionScopeKey.value === requestScopeKey
            && activeSessionId.value === requestSessionId
            && sessionAttachmentGeneration === requestGeneration;
        let resolved: AgentSessionAttachmentResolveResultDto;
        try {
            resolved = await agentApi.resolveSessionAttachments(sessionId, missingIds);
        } catch (error) {
            if (!isCurrent()) {
                return null;
            }
            throw error;
        }
        if (!isCurrent()) {
            return null;
        }
        rememberSessionAttachments(resolved.items);
        for (const item of resolved.items) {
            byId.set(item.attachment.attachmentId, item);
        }
    }
    return attachmentIds.flatMap((attachmentId) => {
        const item = byId.get(attachmentId);
        return item ? [item] : [];
    });
}

/** 附件 metadata 失败时不能进入乐观消息或 Session invoke。 */
async function prepareComposerAttachmentItems(
    sessionId: number,
    markdown: string,
): Promise<AgentSessionAttachmentItemDto[] | null> {
    try {
        return await resolveComposerAttachmentItems(sessionId, markdown);
    } catch (error) {
        console.error("校验 Agent 消息图片附件失败", error);
        notifyAgentError(error, "校验 Session 图片失败");
        return null;
    }
}

/** 等待 durable user entry 或 queue item，二者都是输入已接受的 SSE 旁证。 */
function waitForOptimisticAdmission(
    clientMessageId: string,
): {promise: Promise<void>; stop: () => void} {
    let stopWatch = (): void => {};
    let settled = false;
    const promise = new Promise<void>((resolve) => {
        const check = (): void => {
            if (settled) {
                return;
            }
            const accepted = session.durableEntries.value.some((entry) => {
                return entry.type === "user" && entry.clientMessageId === clientMessageId;
            }) || queuedMessages.value.some((item) => item.clientMessageId === clientMessageId);
            if (!accepted) {
                return;
            }
            settled = true;
            stopWatch();
            resolve();
        };
        stopWatch = watch([session.durableEntries, queuedMessages], check);
        check();
    });
    return {
        promise,
        stop: () => {
            settled = true;
            stopWatch();
        },
    };
}

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
    if (!activeInteraction.value.canInvoke) {
        return;
    }
    const sessionId = activeSessionId.value;

    if (message.startsWith("/")) {
        try {
            if (await handleSlashCommand(message)) {
                await clearComposerAfterAccepted(sessionId, inputText.value);
                return;
            }
        } catch (error) {
            console.error("执行 Agent 命令失败", error);
            notifyAgentError(error, t("agent.chatSurface.runFailed"));
            return;
        }
    }

    if (!message) {
        if (canContinueWithoutInput.value) {
            try {
                await ensureActiveSessionEvents();
                const result = await agentApi.invokeSession(sessionId, {
                    mode: "continue",
                    clientState: buildClientState(),
                });
                await handleInvokeResult(result);
            } catch (error) {
                console.error("继续 Agent 运行失败", error);
                notifyAgentError(error, t("agent.chatSurface.runFailed"));
            }
        }
        return;
    }

    const prompt = inputText.value;
    const attachmentItems = await prepareComposerAttachmentItems(sessionId, prompt);
    if (!attachmentItems) {
        return;
    }
    if (activeSessionId.value !== sessionId || inputText.value !== prompt) {
        return;
    }
    const clientMessageId = crypto.randomUUID();
    const draftSubmission = captureComposerSubmission(sessionId, prompt);
    const optimisticMessageId = session.appendOptimisticUserMessage(clientMessageId, prompt, attachmentItems);
    const admission = waitForOptimisticAdmission(clientMessageId);
    let accepted = false;
    const request = (async () => {
        await ensureActiveSessionEvents();
        return agentApi.invokeSession(sessionId, {
            mode: "prompt",
            clientMessageId,
            message: {text: prompt},
            clientState: buildClientState(),
        });
    })();
    try {
        const first = await Promise.race([
            admission.promise.then(() => ({kind: "accepted" as const})),
            request.then(
                (result) => ({kind: "result" as const, result}),
                (error: unknown) => ({kind: "error" as const, error}),
            ),
        ]);
        let result: InvokeAgentResult;
        if (first.kind === "accepted") {
            accepted = true;
            await clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            result = await request;
        } else if (first.kind === "result") {
            result = first.result;
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
            accepted = reconciliation.state === "accepted";
            if (reconciliation.state === "accepted") {
                await clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            } else {
                session.removeOptimisticUserMessage(optimisticMessageId);
                notification.error(result.error ?? t("agent.chatSurface.runFailed"), {title: t("agent.chatSurface.runFailed")});
                return;
            }
        } else {
            throw first.error;
        }
        await handleInvokeResult(result);
    } catch (error) {
        if (!accepted) {
            const reconciliation = reconcileInvocationTransportFailure();
            if (reconciliation.state === "unknown") {
                session.markOptimisticUserMessageUnknown(clientMessageId);
            }
        }
        console.error("发送 Agent 消息失败", error);
        if (accepted) {
            notification.warning("消息已被 Session 接受，但请求连接提前中断；后续状态将由事件流继续收敛。", {title: "连接中断"});
        } else {
            notification.warning("未收到服务器 acceptance；消息结果未知，未自动重试。", {title: "发送结果未知"});
        }
    } finally {
        admission.stop();
    }
};

/**
 * 发送 Inline AI 编辑任务。调用方只负责构造 visible message 与 payload。
 */
const sendInlineEditorPrompt = async (
    payload: InlineEditPayload,
    visibleMessage: string,
    expectedOperationKey?: string,
): Promise<AgentSurfaceOperationResult<void>> => {
    const owner = captureInlineSurfaceOperation(expectedOperationKey);
    if (!owner) {
        return {status: "superseded"};
    }
    const targetResult = await ensureInlineEditorSession(owner);
    if (targetResult.status === "superseded") return targetResult;
    if (targetResult.status === "empty" || targetResult.status === "failed") {
        throw new Error(targetResult.status === "empty" ? "当前没有可用 Inline AI 对话，请先创建。" : targetResult.message);
    }
    const targetSession = targetResult.value;
    if (targetSession.status === "running" || targetSession.status === "waiting") {
        throw new Error(t("agent.chatSurface.inlineRunningError"));
    }
    if (inlineEditorSessionId.value !== targetSession.sessionId || !inlineEditorSession.recoveryShell.value) {
        const loaded = await loadInlineEditorSession(targetSession.sessionId, {owner});
        if (loaded.status === "superseded") return loaded;
    }

    if (!acceptsInlineSurfaceOperation(owner, targetSession.sessionId)) return {status: "superseded"};
    inlineEditorResultText.value = "";
    const clientMessageId = crypto.randomUUID();
    const optimisticId = inlineEditorSession.appendOptimisticUserMessage(clientMessageId, visibleMessage);
    let receivedReceipt = false;
    try {
        await ensureInlineEditorEvents();
        if (!acceptsInlineSurfaceOperation(owner, targetSession.sessionId)) {
            return {status: "superseded"};
        }
        const result = await agentApi.invokeSession(targetSession.sessionId, {
            mode: "prompt",
            clientMessageId,
            message: {text: visibleMessage},
            input: inlineEditPayloadToJson(payload),
            clientState: buildClientState(),
        });
        if (!acceptsInlineSurfaceOperation(owner, targetSession.sessionId)) {
            return {status: "superseded"};
        }
        receivedReceipt = true;
        const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
        if (reconciliation.state === "rejected") {
            inlineEditorSession.removeOptimisticUserMessage(optimisticId);
            throw new Error(result.error ?? t("agent.chatSurface.runFailed"));
        }
        return await handleInlineEditorInvokeResult(result, owner, targetSession.sessionId);
    } catch (error) {
        if (!acceptsInlineSurfaceOperation(owner, targetSession.sessionId)) {
            return {status: "superseded"};
        }
        if (!receivedReceipt) {
            inlineEditorSession.markOptimisticUserMessageUnknown(clientMessageId);
        }
        throw error;
    }
};

/**
 * 打开或创建 Inline AI Session，供 PromptBar 主动绑定。
 */
const openInlineEditorSession = async (): Promise<AgentSessionOpenResult<AgentSessionSummaryDto>> => {
    const owner = captureInlineSurfaceOperation();
    if (!owner) return {status: "superseded"};
    const targetResult = await ensureInlineEditorSession(owner);
    if (targetResult.status === "superseded") return targetResult;
    if (targetResult.status === "empty" || targetResult.status === "failed") {
        return {status: "failed", message: targetResult.status === "empty" ? "当前没有可用 Inline AI 对话，请先创建。" : targetResult.message};
    }
    const targetSession = targetResult.value;
    if (!acceptsInlineSurfaceOperation(owner, targetSession.sessionId)) {
        return {status: "superseded"};
    }
    if (activeSessionId.value === targetSession.sessionId && activeRecovery.value) {
        return {status: "current", value: targetSession};
    }

    // Inline Prompt 的打开动作必须把主面板切换提升为新的前台操作；旧 SSE
    // recovery 只在这个 handoff 完成前保留，不能在用户操作之后抢回 Session。
    const attempt = surfaceActivation.begin(sessionScopeKey.value);
    const operationOwner = beginSurfaceOperations(attempt.scopeKey);
    const loadOwner = mainSessionLoads.beginForeground(attempt.scopeKey);
    clearMainReconnectWatchers();
    try {
        if (!props.active) {
            return {status: "superseded"};
        }
        const loaded = await loadSession(targetSession.sessionId, {
            attempt,
            loadOwner,
            acceptsAdditional: () => acceptsInlineSurfaceOperation(owner, targetSession.sessionId),
        });
        if (!acceptsActivation(attempt)
            || !acceptsSurfaceOperation(operationOwner)
            || !acceptsInlineSurfaceOperation(owner, targetSession.sessionId)) {
            return {status: "superseded"};
        }
        if (loaded.status === "loaded"
            && activeSessionId.value === targetSession.sessionId
            && activeRecovery.value?.summary.sessionId === targetSession.sessionId) {
            return {status: "current", value: targetSession};
        }
        if (loaded.status === "superseded") {
            return {status: "superseded"};
        }
        const message = loaded.status === "dependency_missing"
            ? resolveApiErrorMessage(loaded.error, "关联对话不可用，无法打开当前对话")
            : loaded.status === "failed"
                ? resolveApiErrorMessage(loaded.error, t("agent.chatSurface.loadSessionFailed"))
                : loaded.status === "empty"
                    ? "当前没有可用对话"
                    : t("agent.chatSurface.loadSessionFailed");
        return {status: "failed", message};
    } finally {
        await mainSessionLoads.finish(loadOwner);
    }
};

/**
 * 停止后台 Inline AI session 当前运行。
 */
const stopInlineEditorPrompt = async (): Promise<AgentSurfaceOperationResult<void>> => {
    const owner = captureInlineSurfaceOperation();
    const sessionId = inlineEditorSessionId.value;
    if (!owner || !sessionId) return {status: "superseded"};
    await agentApi.abortSession(sessionId, {});
    if (!acceptsInlineSurfaceOperation(owner, sessionId)) return {status: "superseded"};
    inlineEditorResultText.value = t("agent.chatSurface.stopped");
    await inlineEditorStream.syncRecovery("manual_refresh");
    if (!acceptsInlineSurfaceOperation(owner, sessionId)) return {status: "superseded"};
    const refreshed = await refreshInlineEditorSessions(owner);
    return refreshed.status === "superseded"
        ? refreshed
        : {status: "current", value: undefined};
};

/** 运行中的 steer/follow-up 共用同一 receipt、SSE 与 transport unknown 对账。 */
const sendRunningMessage = async (mode: "steer" | "followup"): Promise<void> => {
    const message = inputText.value.trim();
    if (!activeSessionId.value || !running.value || !activeInteraction.value.canInvoke || !message) {
        return;
    }
    const sessionId = activeSessionId.value;
    const prompt = inputText.value;
    const attachmentItems = await prepareComposerAttachmentItems(sessionId, prompt);
    if (!attachmentItems) {
        return;
    }
    if (activeSessionId.value !== sessionId || inputText.value !== prompt) {
        return;
    }
    const clientMessageId = crypto.randomUUID();
    const draftSubmission = captureComposerSubmission(sessionId, prompt);
    const optimisticMessageId = session.appendOptimisticUserMessage(
        clientMessageId,
        prompt,
        attachmentItems,
        mode,
    );
    const admission = waitForOptimisticAdmission(clientMessageId);
    let accepted = false;
    const request = (async () => {
        await ensureActiveSessionEvents();
        return agentApi.invokeSession(sessionId, {
            mode,
            clientMessageId,
            message: {text: prompt},
            clientState: buildClientState(),
        });
    })();
    try {
        const first = await Promise.race([
            admission.promise.then(() => ({kind: "accepted" as const})),
            request.then(
                (result) => ({kind: "result" as const, result}),
                (error: unknown) => ({kind: "error" as const, error}),
            ),
        ]);
        let result: InvokeAgentResult;
        if (first.kind === "accepted") {
            accepted = true;
            await clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            result = await request;
        } else if (first.kind === "result") {
            result = first.result;
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
            accepted = reconciliation.state === "accepted";
            if (!accepted) {
                session.removeOptimisticUserMessage(optimisticMessageId);
                notification.error(result.error ?? t("agent.chatSurface.runFailed"), {
                    title: mode === "steer" ? t("agent.chatSurface.steerFailed") : t("agent.chatSurface.queueFailed"),
                });
                return;
            }
            await clearComposerAfterAccepted(sessionId, prompt, draftSubmission);
            if (result.acceptance.state === "queued") {
                session.removeOptimisticUserMessage(optimisticMessageId);
            }
        } else {
            throw first.error;
        }
        await handleInvokeResult(result);
        if (result.status !== "error") {
            notification.success(mode === "steer" ? t("agent.chatSurface.steered") : t("agent.chatSurface.queued"));
        }
    } catch (error) {
        if (!accepted) {
            session.markOptimisticUserMessageUnknown(clientMessageId);
            notification.warning("未收到服务器 acceptance；消息结果未知，未自动重试。", {title: "发送结果未知"});
        } else {
            notification.warning("消息已被 Session 接受，但请求连接提前中断；后续状态将由事件流继续收敛。", {title: "连接中断"});
        }
        console.error(mode === "steer" ? "引导消息失败" : "排队消息失败", error);
    } finally {
        admission.stop();
    }
};

/**
 * 运行中引导当前 Agent loop。
 */
const steer = async (): Promise<void> => sendRunningMessage("steer");

/** 运行中把消息排到当前 loop 结束后继续执行。 */
const followup = async (): Promise<void> => {
    await sendRunningMessage("followup");
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
        if (!activeInteraction.value.canMutateHistory) {
            return true;
        }
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
        if (!activeInteraction.value.canChangeRuntime) {
            return true;
        }
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey: rest[0] ?? null,
        });
        await applyCommandResult(result);
        return true;
    }
    if (command === "/rename") {
        if (!activeInteraction.value.canChangeRuntime) {
            return true;
        }
        // 用原始剩余文本作为标题，保留标题内部的连续空格。
        const title = message.trim().slice("/rename".length).trim();
        if (!title) {
            notification.error(t("agent.chatSurface.renameMissingTitle"));
            return true;
        }
        await renameSession(activeSessionId.value, title);
        return true;
    }
    if (command === "/fork") {
        if (!activeInteraction.value.canMutateHistory) {
            return true;
        }
        try {
            // fork 只以同 Profile 开一条新线并记录出处，不复制历史；同一会话内换版本请用消息上的分支切换。
            const result = await agentApi.runCommand(activeSessionId.value, {command: "fork"});
            await applyCommandResult(result);
            notification.info(t("agent.chatSurface.forkCreated"), {title: t("agent.chatSurface.forkTitle")});
        } catch (error) {
            console.error("分叉 Session 失败", error);
            notifyAgentError(error, t("agent.chatSurface.forkFailed"));
        }
        return true;
    }
    if (command === "/summarize") {
        if (!activeInteraction.value.canChangeRuntime) {
            return true;
        }
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
    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime) {
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
 * 返回复制/编辑使用的完整正文；被公开预算截断的用户消息按需读取。
 */
async function resolveMessageMarkdown(message: AgentMessage): Promise<{text: string; complete: boolean}> {
    const local = agentMessageMarkdown(message);
    if (local !== null) {
        return {text: local, complete: true};
    }
    if (message.type === "user" && activeSessionId.value && !message.id.startsWith("optimistic-user-")) {
        const result = await agentApi.getSessionUserContent(activeSessionId.value, message.id);
        return {text: result.text, complete: true};
    }
    return {text: message.content, complete: false};
}

/**
 * 复制消息正文；用户消息始终输出文字与图片 Markdown 的完整原顺序。
 */
const copyMessage = async (message: AgentMessage): Promise<void> => {
    try {
        const resolved = await resolveMessageMarkdown(message);
        if (!resolved.text.trim()) {
            return;
        }
        await navigator.clipboard.writeText(resolved.text);
        notification.success(resolved.complete ? t("agent.chatSurface.copied") : t("agent.chatSurface.previewCopied"));
    } catch (error) {
        console.error("复制 Agent 消息失败", error);
        notifyAgentError(error, "读取完整用户消息失败");
    }
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

const startEditingMessage = async (message: AgentMessage): Promise<void> => {
    if (historyMutationDisabled.value) {
        return;
    }
    messageActionId.value = message.id;
    try {
        const resolved = await resolveMessageMarkdown(message);
        if (!resolved.complete) {
            return;
        }
        editingMessageText.value = resolved.text;
        editingMessageId.value = message.id;
    } catch (error) {
        console.error("读取待编辑 Agent 消息失败", error);
        notifyAgentError(error, "读取完整用户消息失败");
    } finally {
        messageActionId.value = null;
    }
};

const cancelEditingMessage = (): void => {
    editingMessageId.value = null;
    editingMessageText.value = "";
    historyAttachmentInsertRequest.value = null;
};

/**
 * 更新当前 session 模型覆盖。
 */
const updateSessionModelSelection = async (modelKey: string | null): Promise<void> => {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey,
    };

    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime || sessionModelSaving.value) {
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

    if (!activeSessionId.value || !activeInteraction.value.canChangeRuntime || sessionModelSaving.value) {
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
    if (!activeInteraction.value.canChangeRuntime) {
        return;
    }
    sessionModelPopoverOpen.value = !sessionModelPopoverOpen.value;
}

async function applySessionModelSettings(): Promise<void> {
    if (!activeInteraction.value.canChangeRuntime) {
        return;
    }
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
    if (!activeInteraction.value.canChangeRuntime) {
        return;
    }
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

type InlineSessionOperation = Readonly<{
    owner: AgentSurfaceActivationAttempt;
    sessionId: number;
}>;

/** 捕获模型命令的 Project generation 与 Inline Session 身份。 */
function captureInlineSessionOperation(): InlineSessionOperation | null {
    const owner = captureInlineSurfaceOperation();
    const sessionId = inlineEditorSessionId.value;
    return owner && sessionId ? {owner, sessionId} : null;
}

/**
 * 更新 Inline AI session 模型覆盖，不影响右侧主 Agent 当前会话。
 */
const updateInlineSessionModelSelection = async (
    modelKey: string | null,
    requestedOperation?: InlineSessionOperation,
): Promise<boolean> => {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return false;
    }
    const operation = requestedOperation ?? captureInlineSessionOperation();
    if (!operation || !acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) {
        restoreInlineSessionModelDraft();
        return false;
    }

    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        modelKey,
    };

    inlineSessionModelSaving.value = true;
    try {
        await agentApi.runCommand(operation.sessionId, {
            command: "model",
            modelKey,
        });
        if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return false;
        await inlineEditorStream.syncRecovery("manual_refresh");
        if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return false;
        syncInlineSessionModelState();
        return true;
    } catch (error) {
        if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return false;
        console.error("更新 Inline AI session 模型失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateModelFailed"));
        restoreInlineSessionModelDraft();
        return false;
    } finally {
        if (acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) {
            inlineSessionModelSaving.value = false;
        }
    }
};

/**
 * 更新 Inline AI session 推理强度覆盖。
 */
const updateInlineSessionThinkingLevel = async (
    thinkingLevel: ThinkingLevelDto | null,
    requestedOperation?: InlineSessionOperation,
): Promise<boolean> => {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        return false;
    }
    const operation = requestedOperation ?? captureInlineSessionOperation();
    if (!operation || !acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) {
        restoreInlineSessionModelDraft();
        return false;
    }

    inlineSessionModelDraft.value = {
        ...inlineSessionModelDraft.value,
        reasoningEffort: thinkingLevel,
    };

    inlineSessionModelSaving.value = true;
    try {
        await agentApi.runCommand(operation.sessionId, {
            command: "thinking",
            thinkingLevel,
        });
        if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return false;
        await inlineEditorStream.syncRecovery("manual_refresh");
        if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return false;
        syncInlineSessionModelState();
        return true;
    } catch (error) {
        if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return false;
        console.error("更新 Inline AI session 推理强度失败", error);
        notifyAgentError(error, t("agent.chatSurface.updateThinkingFailed"));
        restoreInlineSessionModelDraft();
        return false;
    } finally {
        if (acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) {
            inlineSessionModelSaving.value = false;
        }
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
    const operation = captureInlineSessionOperation();
    if (!operation) return;
    const nextModelKey = inlineSessionModelDraft.value.modelKey;
    const nextThinkingLevel = inlineSessionModelDraft.value.reasoningEffort;
    if (!await updateInlineSessionModelSelection(nextModelKey, operation)) return;
    if (!await updateInlineSessionThinkingLevel(nextThinkingLevel, operation)) return;
    if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return;
    restoreInlineSessionModelDraft();
    inlineSessionModelPopoverOpen.value = false;
}

async function resetInlineSessionModelSettings(): Promise<void> {
    if (inlineSessionModelActionBlocked()) {
        restoreInlineSessionModelDraft();
        inlineSessionModelPopoverOpen.value = false;
        return;
    }
    const operation = captureInlineSessionOperation();
    if (!operation) return;
    if (!await updateInlineSessionModelSelection(null, operation)) return;
    if (!await updateInlineSessionThinkingLevel(null, operation)) return;
    if (!acceptsInlineSurfaceOperation(operation.owner, operation.sessionId)) return;
    restoreInlineSessionModelDraft();
    inlineSessionModelPopoverOpen.value = false;
}

const sessionStream = useAgentSessionStream({
    session,
    api: agentApi,
    activeSessionId,
    activeSessionIdentity,
    applyRecoverySideEffects: async (recovery, result, owner) => {
        if (!owner.isCurrent()) return;
        syncSessionModelState(recovery.summary);
        notifyUnavailableLinkedAgents(recovery.summary.sessionId, recovery.unavailableLinkedAgents);
        if (result.historyWindowReset) {
            await nextTick();
            if (!owner.isCurrent()) return;
            chatFlowRef.value?.scrollToBottom();
        }
    },
    onEvent: async (event, owner) => {
        if (event.kind === "session" && event.event.type === "session_attachments_changed") {
            invalidateSessionAttachments();
        }
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested") {
            await acknowledgeClientPatch(owner.sessionId, event.event.request, owner.isCurrent);
        }
    },
    onSessionNotFound: async (_error, owner) => {
        if (!owner.isCurrent()) return "ignored";
        const state = surfaceActivation.state.value;
        if (state.status === "inactive" || !acceptsActivation(state.attempt)) return "ignored";
        const attempt = state.attempt;
        const recovery = mainSessionLoads.runRecovery(sessionScopeKey.value, async (loadOwner) => {
            return await recoverMissingAgentSession(owner.sessionId, null, attempt, loadOwner);
        });
        try {
            await recovery.promise;
        } catch (error) {
            if (!owner.isCurrent() || !acceptsActivation(attempt)) return "ignored";
            console.error("失效 Session 的 recovery 发生未处理错误", error);
            const message = notifyAgentError(error, "目标对话已失效，恢复失败");
            surfaceActivation.markError(attempt, sessionScopeKey.value, message);
        }
        return recovery.status === "deferred" ? "deferred" : "handled";
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
    activeSessionIdentity: inlineEditorSessionIdentity,
    applyRecoverySideEffects: (_recovery, _result, owner) => {
        if (!owner.isCurrent()) return;
        syncInlineSessionModelState();
    },
    onEvent: async (event, owner) => {
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested") {
            await acknowledgeClientPatch(owner.sessionId, event.event.request, owner.isCurrent);
        }
    },
    onSessionNotFound: async (_error, streamOwner) => {
        if (!streamOwner.isCurrent()) return "ignored";
        const owner = captureInlineSurfaceOperation();
        if (!owner) return "ignored";
        const recovery = inlineSessionLoads.runRecovery(sessionScopeKey.value, async (loadOwner) => {
            const result = await recoverMissingInlineEditorSession(streamOwner.sessionId, owner, loadOwner);
            if (result.status === "failed"
                && acceptsInlineSurfaceOperation(owner)
                && inlineSessionLoads.accepts(loadOwner, sessionScopeKey.value)) {
                notifyAgentError(new Error(result.message), "Inline AI 对话已失效，切换到可用对话失败");
            }
            return result;
        });
        try {
            await recovery.promise;
        } catch (error) {
            if (!streamOwner.isCurrent() || !acceptsInlineSurfaceOperation(owner)) return "ignored";
            console.error("失效 Inline AI Session 的 recovery 发生未处理错误", error);
            notifyAgentError(error, "Inline AI 对话已失效，恢复失败");
        }
        return recovery.status === "deferred" ? "deferred" : "handled";
    },
    onError: (error, fallback) => {
        console.error(fallback, error);
        notifyAgentError(error, fallback);
    },
});

const cycleMessageBranch = async (messageId: string, direction: -1 | 1): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
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
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
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
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    messageActionId.value = payload.message.id;
    try {
        await ensureActiveSessionEvents();
        const clientMessageId = crypto.randomUUID();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: payload.message.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "prompt",
                clientMessageId,
                message: {text: payload.content},
                clientState: buildClientState(),
            },
        });
        session.applyLiveState(result.state);
        if (result.invocation) {
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.invocation.acceptance);
            if (reconciliation.state === "rejected") {
                notification.error(result.invocation.error ?? t("agent.chatSurface.rewriteFailed"), {title: t("agent.chatSurface.rewriteFailed")});
                return;
            }
            await handleInvokeResult(result.invocation);
        }
        cancelEditingMessage();
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
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
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
        cancelEditingMessage();
        await syncActiveSessionRecovery();
    } catch (error) {
        console.error("刷新消息失败", error);
        notifyAgentError(error, t("agent.chatSurface.refreshMessageFailed"));
    } finally {
        messageActionId.value = null;
    }
};

/**
 * 从这条消息新开一条分支：只把 active leaf 移到该消息，不删除任何历史。
 * 原来的后续内容留在原地成为一条非活动分支，可通过气泡上的分支切换器切回。
 */
const branchFromMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || !activeInteraction.value.canMutateHistory) {
        return;
    }
    const confirmed = await confirm(t("agent.chatSurface.branchFromHereConfirm"), t("agent.chatSurface.branchFromHereTitle"));
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
        cancelEditingMessage();
        notification.success(t("agent.chatSurface.branchFromHereSuccess"));
    } catch (error) {
        console.error("从消息分叉失败", error);
        notifyAgentError(error, t("agent.chatSurface.branchFromHereFailed"));
    } finally {
        messageActionId.value = null;
    }
};

// Task 129：列表加载归对话框单一入口——AgentSessionDialog 打开时必然按自身筛选条件刷新一次，
// 这里再预拉一次只会产生重复请求。`ensureSessionReady` 仍保留给 mounted / 发消息前的 active session 恢复。
const openSessionDialog = (): void => {
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
        const loaded = await loadSession(sessionId);
        if (loaded.status === "loaded") {
            sessionDialogOpen.value = false;
        }
    } finally {
        loadingSession.value = false;
    }
};

/** 关联 Agent 面板只在目标 Session 成功提交后关闭，失败时保留选择上下文。 */
const selectLinkedAgentSession = async (sessionId: number): Promise<void> => {
    const loaded = await loadSession(sessionId);
    if (loaded.status === "loaded") {
        linkedAgentPanelOpen.value = false;
    }
};

const createSessionFromDialog = async (profileKey?: string): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        const created = await createSession(profileKey);
        if (created.status === "current") {
            sessionDialogOpen.value = false;
        }
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
    if (loadingSession.value || sessionActionId.value || target.interaction?.canChangeRuntime !== true) {
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
    if (loadingSession.value || sessionActionId.value || target.interaction?.canArchive !== true) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await agentApi.runCommand(target.sessionId, {
            command: "archive",
            reason: "archived from drawer",
        });
        await refreshSessions();
        if (target.sessionId !== activeSessionId.value) {
            return;
        }
        await loadSession(target.sessionId);
    } finally {
        sessionActionId.value = null;
    }
};

/** unknown attempt 只有用户确认可能重复后才以新 clientMessageId 重新发送。 */
const resendUnknownMessage = async (message: AgentMessage): Promise<void> => {
    if (message.deliveryState !== "unknown" || !activeSessionId.value) {
        return;
    }
    const markdown = agentMessageMarkdown(message);
    if (markdown === null) {
        notification.error("无法重建这条未知消息的完整正文。", {title: "无法重新发送"});
        return;
    }
    if (inputText.value && inputText.value !== markdown) {
        notification.warning("Composer 中已有其它草稿，请先处理当前草稿。", {title: "未重新发送"});
        return;
    }
    const accepted = await confirm(
        "服务器可能已经接受原消息。重新发送会生成新的 clientMessageId，并可能产生重复内容。",
        "确认重新发送",
    );
    if (!accepted) {
        return;
    }
    inputText.value = markdown;
    await nextTick();
    if (running.value && message.deliveryMode === "steer") {
        await steer();
        return;
    }
    if (running.value && message.deliveryMode === "followup") {
        await followup();
        return;
    }
    await send();
};

/** 用户可移除仅存在于当前页面内存中的 unknown optimistic 占位。 */
const dismissUnknownMessage = (message: AgentMessage): void => {
    if (message.deliveryState === "unknown") {
        session.removeOptimisticUserMessage(message.id);
    }
};

/** 恢复归档 Session；关系账本未 detach 的关系会由 effective view 自动重新显现。 */
const restoreSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (loadingSession.value || sessionActionId.value || target.interaction?.canRestore !== true) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await agentApi.runCommand(target.sessionId, {command: "restore"});
        await refreshSessions();
        if (target.sessionId === activeSessionId.value) {
            await loadSession(target.sessionId);
        }
        notification.success("Session 已恢复");
    } catch (error) {
        notifyAgentError(error, "恢复 Session 失败");
    } finally {
        sessionActionId.value = null;
    }
};

/** Composer 状态条动作只调用现有显式 Session 命令，不隐式创建。 */
function handleComposerAvailabilityAction(action: AgentComposerAvailabilityAction): void {
    if (action === "choose-session") {
        openSessionDialog();
        return;
    }
    if (action === "create-session") {
        void createSessionFromHeader();
        return;
    }
    if (action === "retry-session") {
        if (!props.active) {
            return;
        }
        const attempt = surfaceActivation.begin(sessionScopeKey.value);
        beginSurfaceOperations(attempt.scopeKey);
        void restoreAgentSurface(attempt, {reset: false, forceRecovery: true});
        return;
    }
    if (activeSummary.value) {
        void restoreSessionFromDialog(activeSummary.value);
    }
}

/**
 * 清空当前 workspace 绑定的 Agent session 状态。workspace 切换时必须硬重置，
 * 避免同 profile 的不同 Project Workspace 复用旧会话。
 */
async function resetWorkspaceSessionState(attempt?: AgentSurfaceActivationAttempt): Promise<void> {
    const resetOwner = attempt ? beginSurfaceOperations(attempt.scopeKey) : null;
    if (!resetOwner) {
        invalidateSurfaceOperations();
    }
    defaultProfileResolveRequest += 1;
    sessionListRequestGuard.invalidate();
    sessionListLoading.value = false;
    sessionStream.stop();
    unavailableLinkedAgentWarningKeys.clear();
    mainSessionLoads.invalidate();
    inlineEditorSessionRequestId += 1;
    inlineSessionLoads.invalidate();
    invalidateInlineSurfaceOperations();
    beginInlineSurfaceOperations(sessionScopeKey.value);
    inlineEditorSessionLoading.value = false;    const drafts = ensureComposerDraftSession();
    if (drafts) {
        drafts.update(inputText.value);
        try {
            if (!resetOwner) {
                composerContextGeneration.value = await drafts.clearContext();
            } else {
                const cleared = await surfaceOperations.run(
                    resetOwner,
                    () => sessionScopeKey.value,
                    () => drafts.clearContext(),
                );
                if (cleared.status === "superseded" || (attempt && !acceptsActivation(attempt))) return;
                composerContextGeneration.value = cleared.value;
            }
        } catch (error) {
            notifyAgentError(error, "保存 Composer 草稿失败，未切换工作区", "工作区未切换");
            throw error;
        }
    }
    sessionStream.stop();
    inlineEditorStream.stop();
    activeSessionId.value = null;
    sessions.value = [];
    linkedAgentPanelOpen.value = false;
    sessionDialogOpen.value = false;
    sessionTreeDialogOpen.value = false;
    sessionModelPopoverOpen.value = false;
    cancelEditingMessage();
    messageActionId.value = null;
    inputText.value = "";
    resetSessionAttachments();
    session.reset();
    syncSessionModelState(null);
    if (!drafts) {
        return;
    }
    if (!resetOwner) {
        await drafts.clearContext();
        return;
    }
    const cleared = await surfaceOperations.run(
        resetOwner,
        () => sessionScopeKey.value,
        () => drafts.clearContext(),
    );
    if (cleared.status === "superseded" || (attempt && !acceptsActivation(attempt))) return;
    composerContextGeneration.value = cleared.value;
}

/**
 * 恢复当前 Surface。config、默认 Profile、Session 列表与 recovery 都受同一 attempt 约束。
 */
async function restoreAgentSurface(
    attempt: AgentSurfaceActivationAttempt,
    options: {reset: boolean; prepareConfig?: boolean; forceRecovery?: boolean},
): Promise<AgentSessionSummaryDto[]> {
    try {
        if (options.reset) {
            await resetWorkspaceSessionState(attempt);
            if (!acceptsActivation(attempt)) {
                return sessions.value;
            }
        }
        if (options.prepareConfig !== false) {
            const profileChanged = await loadSurfaceBootstrap(attempt);
            if (!acceptsActivation(attempt)) {
                return sessions.value;
            }
            if (profileChanged) {
                const nextAttempt = surfaceActivation.begin(sessionScopeKey.value);
                await resetWorkspaceSessionState(nextAttempt);
                if (!acceptsActivation(nextAttempt)) {
                    return sessions.value;
                }
                return restoreAgentSurface(nextAttempt, {
                    reset: false,
                    prepareConfig: false,
                    forceRecovery: options.forceRecovery,
                });
            }
        }
        return await ensureSessionReady(attempt, {forceRecovery: options.forceRecovery});
    } catch (error) {
        if (!acceptsActivation(attempt) || isAgentSurfaceSupersededError(error)) {
            return sessions.value;
        }
        const message = resolveApiErrorMessage(error, t("agent.chatSurface.loadSessionFailed"));
        surfaceActivation.markError(attempt, sessionScopeKey.value, message);
        return sessions.value;
    }
}

/** Surface 停用时关闭临时浮层，但保留已恢复 Session 供同 scope 重开。 */
function closeSurfaceTransientState(): void {
    sessionDialogOpen.value = false;
    linkedAgentPanelOpen.value = false;
    sessionModelPopoverOpen.value = false;
    attachmentPanelOpen.value = false;
    cancelEditingMessage();
    messageActionId.value = null;
}

// Inline PromptBar 在右侧面板隐藏时仍然可用，因此提前建立独立 owner。
beginInlineSurfaceOperations(sessionScopeKey.value);

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

/** 组件卸载标记：异步 continuation（await start 等）在卸载后恢复时不得再创建 watcher 或发布状态。 */
let surfaceUnmounted = false;

/** 主面板与 Inline 的重连 watcher 各自独立注册：任一 surface 的前台加载清空
 * 自己的集合时不得误停另一个 surface 的 watcher（主/Inline owner 互不撤销合同）。 */
const mainReconnectWatcherStops = new Set<() => void>();
const inlineReconnectWatcherStops = new Set<() => void>();


/** 主面板前台加载/停用/卸载时清空主面板重连 watcher（不含 Inline）。 */
function clearMainReconnectWatchers(): void {
    for (const stop of mainReconnectWatcherStops) {
        stop();
    }
    mainReconnectWatcherStops.clear();
}

/** Inline 前台加载/卸载时清空 Inline 重连 watcher（不含主面板）。 */
function clearInlineReconnectWatchers(): void {
    for (const stop of inlineReconnectWatcherStops) {
        stop();
    }
    inlineReconnectWatcherStops.clear();
}

watchAgentSurfaceActivation({
    active: () => props.active,
    scopeKey: () => sessionScopeKey.value,
    controller: surfaceActivation,
    activate: async (attempt, context) => {
        if (!import.meta.client) {
            return;
        }
        beginSurfaceOperations(attempt.scopeKey);
        await restoreAgentSurface(attempt, {
            reset: context.scopeChanged,
            forceRecovery: context.reactivated,
        });
        const activationState = surfaceActivation.state.value;
        if (activationState.status !== "ready") {
            return;
        }
        const focusAttempt = activationState.attempt;
        await nextTick();
        if (!acceptsActivation(focusAttempt)) {
            return;
        }
        requestAnimationFrame(() => {
            if (acceptsActivation(focusAttempt)) {
                inputRef.value?.focus();
                scrollToBottom();
            }
        });
    },
    deactivate: (context) => {
        invalidateSurfaceOperations();
        mainSessionLoads.invalidate();
        sessionStream.stop();
        closeSurfaceTransientState();
        // 主面板停用/scope 改变时旧代次重连 watcher 已无意义，统一停止防闭包累积。
        // 只清主面板集合：Inline PromptBar/stream 保持独立（主/Inline 互不撤销合同）。
        clearMainReconnectWatchers();
        if (context.scopeChanged) {
            void resetWorkspaceSessionState();
        }
    },
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

watch(() => ideStore.configRevision, () => {
    if (!props.active) {
        return;
    }
    const attempt = surfaceActivation.begin(sessionScopeKey.value);
    beginSurfaceOperations(attempt.scopeKey);
    void restoreAgentSurface(attempt, {reset: false, forceRecovery: true});
});

onBeforeUnmount(() => {
    surfaceUnmounted = true;
    void composerDraftSession?.dispose().catch((error) => console.error("保存 Composer 草稿失败", error));
    composerDraftSession = null;
    sessionStream.stop();
    surfaceOperations.dispose();
    inlineSurfaceOperations.dispose();
    surfaceActivation.dispose();
    mainSessionLoads.invalidate();
    inlineSessionLoads.invalidate();
    surfaceOperationRevision.value += 1;
    inlineOperationRevision.value += 1;
    resetSessionAttachments();
    clearMainReconnectWatchers();
    clearInlineReconnectWatchers();
});

watch(queuedMessages, (items) => {
    session.consumeOptimisticClientMessageIds(items.map((item) => item.clientMessageId));
});

watch(inputText, () => {
    composerDraftSession?.update(inputText.value);
});

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            return;
        }
        const {default: createDOMPurify} = await import("dompurify");
        const purifier = createDOMPurify(window);
        sanitizeHtml.value = (html) => purifier.sanitize(html) as string;
    })();
});

defineExpose({
    operationScopeKey: surfaceOperationKey,
    inlineOperationScopeKey: inlineOperationKey,
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
    openInlineEditorSession,
    refreshInlineEditorSessions,    sessionActionId,
    ensureSessionReady,
    refreshSessionsWithQuery,
    selectSession,
    createSession: createSessionFromHeader,
    archiveSessionFromDialog,
    restoreSessionFromDialog,
    renameSessionFromDialog,
});

/**
 * 确保 Project 级 Inline AI Session 可用。
 */
async function ensureInlineEditorSession(
    owner: AgentSurfaceActivationAttempt,
): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto> | {status: "empty"} | {status: "failed"; message: string}> {
    if (inlineEditorSessionId.value && inlineEditorSession.recoveryShell.value) {
        return {status: "current", value: inlineEditorSession.recoveryShell.value.summary};
    }
    const listResult = await refreshInlineEditorSessions(owner);
    if (listResult.status === "superseded") return listResult;
    const list = listResult.value;
    const selected = inlineEditorSessionId.value
        ? list.find((item) => item.sessionId === inlineEditorSessionId.value)
        : undefined;
    if (selected && inlineEditorSession.recoveryShell.value) {
        return {status: "current", value: selected};
    }
    return list.length === 0
        ? {status: "empty"}
        : {status: "failed", message: "请选择一个 Inline AI 对话后继续。"};
}

/**
 * 刷新当前 Project Workspace 下的 Inline AI sessions。
 */
async function refreshInlineEditorSessions(
    requestedOwner?: AgentSurfaceActivationAttempt,
    options: {recoverMissing?: boolean; loadSelection?: boolean; loadOwner?: AgentSessionLoadOwner} = {},
): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto[]>> {
    const owner = requestedOwner ?? captureInlineSurfaceOperation();
    if (!owner) return {status: "superseded"};
    const loadOwner = options.loadOwner ?? inlineSessionLoads.beginForeground(sessionScopeKey.value);
    const ownsLoadOwner = options.loadOwner === undefined;
    clearInlineReconnectWatchers();
    const acceptsLoad = (): boolean => inlineSessionLoads.accepts(loadOwner, sessionScopeKey.value)
        && acceptsInlineSurfaceOperation(owner);
    if (!acceptsLoad()) {
        return {status: "superseded"};
    }
    let requestId = ++inlineEditorSessionRequestId;
    inlineEditorSessionLoading.value = true;
    try {
        const page = await agentApi.listSessions({
            ...sessionScope.value,
            profileGroup: "all",
            profileKey: INLINE_EDITOR_PROFILE_KEY,
            status: "active",
            relation: "all",
            limit: 50,
        });
        if (requestId !== inlineEditorSessionRequestId || !acceptsLoad()) {
            return {status: "superseded"};
        }
        inlineEditorSessions.value = page.items;
        if (options.loadSelection === false) {
            return {status: "current", value: page.items};
        }
        const current = inlineEditorSessionId.value && inlineEditorSession.recoveryShell.value
            ? page.items.find((item) => item.sessionId === inlineEditorSessionId.value)
            : undefined;
        const remembered = current ? null : readInlineEditorSession();
        const target = remembered && !current ? remembered : null;
        if (target) {
            const loaded = await loadInlineEditorSession(target.sessionId, {
                invalidateRefresh: false,
                owner,
                loadOwner,
                recoverMissing: options.recoverMissing,
                expectedIdentity: target.sessionIdentity,
            });
            const adopted = adoptInlineEditorRequest(requestId, loaded.status === "primary_missing"
                ? {status: "failed", requestId: loaded.requestId}
                : loaded);
            if (adopted.status === "superseded") {
                return {status: "superseded"};
            }
            requestId = adopted.requestId;
            if (loaded.status === "empty") {
                throw new Error(t("agent.chatSurface.inlineLoadFailed"));
            }
            if (loaded.status === "primary_missing") {
                throw new Error(t("agent.chatSurface.inlineLoadFailed"));
            }
            if (loaded.status === "failed") {
                throw new Error(loaded.message);
            }
            if (requestId !== inlineEditorSessionRequestId || !acceptsLoad()) {
                return {status: "superseded"};
            }
        }
        if (!target && !current && page.items.length === 0) {
            clearInlineEditorSession(undefined, false);
        }
        return {status: "current", value: page.items};
    } catch (error) {
        if (requestId !== inlineEditorSessionRequestId || !acceptsLoad()) {
            return {status: "superseded"};
        }
        throw error;
    } finally {
        if (requestId === inlineEditorSessionRequestId && acceptsLoad()) {
            inlineEditorSessionLoading.value = false;
        }
        if (ownsLoadOwner) {
            await inlineSessionLoads.finish(loadOwner);
        }
    }
}

/**
 * 创建一个新的 Project 级 Inline AI session，并设为 PromptBar 当前 session。
 */
async function createInlineEditorSession(
    requestedOwner?: AgentSurfaceActivationAttempt,
): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto>> {
    const owner = requestedOwner ?? captureInlineSurfaceOperation();
    if (!owner) return {status: "superseded"};
    const loadOwner = inlineSessionLoads.beginForeground(sessionScopeKey.value);
    clearInlineReconnectWatchers();
    const projectRoot = ideStore.workspaceKind === "novel" ? ideStore.currentProjectRoot || undefined : undefined;
    try {
        const created = await agentApi.createSession({
            profileKey: INLINE_EDITOR_PROFILE_KEY,
            initial: {},
            currentProjectRoot: projectRoot,
        });
        if (!acceptsInlineSurfaceOperation(owner) || !inlineSessionLoads.accepts(loadOwner, sessionScopeKey.value)) {
            return {status: "superseded"};
        }
        const loaded = await loadInlineEditorSession(created.sessionId, {owner, loadOwner});
        if (loaded.status === "superseded") return loaded;
        if (loaded.status === "empty") {
            throw new Error(t("agent.chatSurface.inlineLoadFailed"));
        }
        if (loaded.status === "primary_missing") {
            throw new Error(t("agent.chatSurface.inlineLoadFailed"));
        }
        if (loaded.status === "failed") {
            throw new Error(loaded.message);
        }
        const refreshed = await refreshInlineEditorSessions(owner, {loadOwner});
        if (refreshed.status === "superseded") return refreshed;
        return {status: "current", value: loaded.value};
    } finally {
        await inlineSessionLoads.finish(loadOwner);
    }
}

/**
 * 选择 PromptBar 当前使用的 Inline AI session，不影响右侧 Agent 面板。
 */
async function selectInlineEditorSession(sessionId: number): Promise<InlineEditorSelectionResult> {
    const owner = captureInlineSurfaceOperation();
    if (!owner) return {status: "superseded"};
    if (inlineEditorSessionId.value === sessionId) {
        return {status: "current", value: undefined};
    }
    const loadOwner = inlineSessionLoads.beginForeground(sessionScopeKey.value);
    clearInlineReconnectWatchers();
    try {
        const loaded = await loadInlineEditorSession(sessionId, {owner, loadOwner});
        return projectInlineEditorSelection(loaded.status === "primary_missing"
            ? {status: "failed", message: t("agent.chatSurface.inlineLoadFailed")}
            : loaded);
    } finally {
        await inlineSessionLoads.finish(loadOwner);
    }
}

type InlineEditorSessionLoadResult =
    | {status: "current"; value: AgentSessionSummaryDto; requestId: number}
    | {status: "superseded"}
    | {status: "empty"; requestId: number}
    | {status: "primary_missing"; requestId: number}
    | {status: "failed"; message: string; requestId: number};

/** 清理失效 Inline Session 并刷新一次；有列表时保持未绑定，不猜测首项。 */
async function recoverMissingInlineEditorSession(
    failedSessionId: number,
    owner: AgentSurfaceActivationAttempt,
    loadOwner: AgentSessionLoadOwner,
    expectedIdentity?: AgentSessionIdentity,
): Promise<InlineEditorSessionLoadResult> {
    const acceptsLoad = (): boolean => inlineSessionLoads.accepts(loadOwner, sessionScopeKey.value)
        && acceptsInlineSurfaceOperation(owner);
    if (!acceptsLoad()) {
        return {status: "superseded"};
    }
    const failedIdentity = expectedIdentity ?? inlineEditorSessionIdentity.value;
    inlineEditorSessionRequestId += 1;

    try {
        const refreshed = await refreshInlineEditorSessions(owner, {
            recoverMissing: false,
            loadSelection: false,
            loadOwner,
        });
        if (refreshed.status === "superseded" || !acceptsLoad()) {
            return {status: "superseded"};
        }
        if (failedIdentity && import.meta.client) {
            const remembered = readInlineEditorSession();
            if (remembered?.sessionId === failedSessionId && remembered.sessionIdentity === failedIdentity) {
                forgetRememberedSession(
                    localStorage,
                    `agent:inline-editor-session:${sessionMemoryScopeKey.value}`,
                    remembered,
                );
            }
        }
        clearInlineEditorSession(failedSessionId, false, failedIdentity ?? undefined);
        if (refreshed.value.length === 0) {
            notification.warning("Inline AI 对话不在当前打开的 NeuroBook 中，当前没有可用对话。", {title: "对话已失效"});
            return {status: "empty", requestId: inlineEditorSessionRequestId};
        }
        notification.warning("Inline AI 对话不在当前打开的 NeuroBook 中，请重新选择对话。", {title: "对话已失效"});
        return {
            status: "failed",
            message: "Inline AI 对话已失效，请从列表重新选择。",
            requestId: inlineEditorSessionRequestId,
        };
    } catch (error) {
        if (!acceptsLoad()) {
            return {status: "superseded"};
        }
        console.error("失效 Inline AI Session 的列表恢复失败", error);
        return {
            status: "failed",
            message: resolveApiErrorMessage(error, t("agent.chatSurface.inlineLoadFailed")),
            requestId: inlineEditorSessionRequestId,
        };
    }
}

/**
 * 加载后台 Inline AI session recovery，并启动它自己的 SSE。
 */
async function loadInlineEditorSession(
    sessionId: number,
    options: {
        invalidateRefresh?: boolean;
        owner?: AgentSurfaceActivationAttempt;
        loadOwner?: AgentSessionLoadOwner;
        recoverMissing?: boolean;
        expectedIdentity?: AgentSessionIdentity;
    } = {},
): Promise<InlineEditorSessionLoadResult> {
    const owner = options.owner ?? captureInlineSurfaceOperation();
    if (!owner || !acceptsInlineSurfaceOperation(owner)) return {status: "superseded"};
    const loadOwner = options.loadOwner ?? inlineSessionLoads.beginForeground(sessionScopeKey.value);
    const ownsLoadOwner = options.loadOwner === undefined;
    const acceptsLoad = (): boolean => inlineSessionLoads.accepts(loadOwner, sessionScopeKey.value)
        && acceptsInlineSurfaceOperation(owner);
    if (!acceptsLoad()) {
        return {status: "superseded"};
    }
    // 无论 owner 由谁创建（select/create/refresh 传 loadOwner），前台加载开始即取代旧代次。
    clearInlineReconnectWatchers();
    if (options.invalidateRefresh !== false) {
        inlineEditorSessionRequestId += 1;
    }
    inlineEditorSessionLoading.value = true;
    try {
        const result = await runSessionLoadAttempt({
            read: () => agentApi.getSessionRecovery(sessionId),
            accepts: acceptsLoad,
            errorCode: resolveApiErrorCode,
            commit: (recovery) => {
                if (recovery.summary.sessionId !== sessionId) {
                    throw new Error(`Inline AI Session 身份不匹配：期望 ${String(sessionId)}，收到 ${String(recovery.summary.sessionId)}`);
                }
                if (options.expectedIdentity !== undefined
                    && recovery.summary.sessionIdentity !== options.expectedIdentity) {
                    throw new Error("Inline 对话身份与浏览器记忆不一致。请从当前列表重新选择。");
                }
                if (recovery.summary.profileKey !== INLINE_EDITOR_PROFILE_KEY) {
                    throw new Error(t("agent.chatSurface.inlineLoadFailed"));
                }
                inlineEditorStream.stop();
                inlineEditorSessionId.value = sessionId;
                inlineEditorSessionIdentity.value = recovery.summary.sessionIdentity;
                inlineEditorSession.reset();
                inlineEditorResultText.value = "";
                inlineEditorSession.applyRecovery(recovery);
                syncInlineSessionModelState();
                inlineEditorSessions.value = inlineEditorSessions.value.some((item) => item.sessionId === recovery.summary.sessionId)
                    ? inlineEditorSessions.value.map((item) => item.sessionId === recovery.summary.sessionId ? recovery.summary : item)
                    : [recovery.summary, ...inlineEditorSessions.value];
            },
        });
        if (result.status === "primary_missing" && options.recoverMissing !== false) {
            return recoverMissingInlineEditorSession(sessionId, owner, loadOwner, options.expectedIdentity);
        }
        if (result.status === "primary_missing") {
            clearInlineEditorSession(sessionId, false);
            return {status: "primary_missing", requestId: inlineEditorSessionRequestId};
        }
        if (result.status === "dependency_missing" || result.status === "failed") {
            throw result.error;
        }
        if (result.status === "superseded") {
            return {status: "superseded"};
        }
        if (result.status === "loaded") {
            // 记忆只在事件流 open 成功且 owner 仍有效时写入（ADR 0018）；失败保留已提交 Session，不回滚。
            const streamOutcome = await writeRememberedAfterStreamOpen({
                start: () => inlineEditorStream.start(sessionId),
                accepts: acceptsLoad,
                remember: () => saveInlineEditorSession(sessionId, result.value.summary.sessionIdentity),
            });
            if (streamOutcome.status === "connect_failed") {
                console.error(`连接 Inline session ${String(sessionId)} 实时事件流失败，本次不写入对话记忆`, streamOutcome.error);
                notifyAgentError(streamOutcome.error, "Inline 对话已切换，但实时事件流连接失败，恢复连接前不会更新对话记忆。", "连接失败");
                // watch 在异步 continuation 中创建，没有 active effect scope；登记到 setup
                // 同步注册的重连 watcher 清理表，组件卸载时统一 stop。
                if (surfaceUnmounted) {
                    return {status: "superseded"};
                }
                const expectedInlineIdentity = result.value.summary.sessionIdentity;
                registerReconnectRestoreWatcher({
                    connectionStatus: inlineEditorSession.connectionStatus,
                    stops: inlineReconnectWatcherStops,
                    // operation 被新代次接管、目标 Session 切换或身份不符时立即自停。
                    shouldRestore: () => acceptsInlineSurfaceOperation(owner, sessionId)
                        && inlineEditorSessionIdentity.value === expectedInlineIdentity,
                    onRestored: () => saveInlineEditorSession(sessionId, expectedInlineIdentity),
                });
            } else if (streamOutcome.status === "superseded") {
                // 提交后等待 open 期间被新 owner 取代：新 owner 已发布自己的状态，
                // 本代次不写记忆；结果按 superseded 转发给调用方。
                return {status: "superseded"};
            }
        }
        return {status: "current", value: result.value.summary, requestId: inlineEditorSessionRequestId};
    } finally {
        if (acceptsLoad()) {
            inlineEditorSessionLoading.value = false;
        }
        if (ownsLoadOwner) {
            await inlineSessionLoads.finish(loadOwner);
        }
    }
}

function readInlineEditorSession(): RememberedSession | null {
    if (!import.meta.client) {
        return null;
    }
    const result = readRememberedSession(localStorage, `agent:inline-editor-session:${sessionMemoryScopeKey.value}`);
    if (result.status === "failed") {
        notification.warning("当前 Inline 对话已打开，但浏览器记忆不可读取；下次启动可能需要重新选择。", {title: "对话记忆不可用"});
        return null;
    }
    return result.status === "valid" ? result.value : null;
}

function saveInlineEditorSession(sessionId: number, sessionIdentity: AgentSessionIdentity): void {
    if (!import.meta.client) {
        return;
    }
    const result = tryWriteRememberedSession(
        localStorage,
        `agent:inline-editor-session:${sessionMemoryScopeKey.value}`,
        {schema: 2, sessionId, sessionIdentity},
    );
    if (result.status === "failed") {
        notification.warning("当前 Inline 对话已打开，但下次启动可能需要重新选择。", {title: "对话记忆未保存"});
    }
}

function readLastSession(): RememberedSession | null {
    if (!import.meta.client) {
        return null;
    }
    const result = readRememberedSession(localStorage, `agent:last-session:${sessionMemoryScopeKey.value}`);
    if (result.status === "failed") {
        notification.warning("当前对话已打开，但浏览器记忆不可读取；下次启动可能需要重新选择。", {title: "对话记忆不可用"});
        return null;
    }
    return result.status === "valid" ? result.value : null;
}

function saveLastSession(sessionId: number, sessionIdentity: AgentSessionIdentity): void {
    if (!import.meta.client) {
        return;
    }
    const result = tryWriteRememberedSession(
        localStorage,
        `agent:last-session:${sessionMemoryScopeKey.value}`,
        {schema: 2, sessionId, sessionIdentity},
    );
    if (result.status === "failed") {
        notification.warning("当前对话已打开，但下次启动可能需要重新选择。", {title: "对话记忆未保存"});
    }
}

</script>

<template>
    <!-- Agent Chat Surface -->
    <section
        class="relative flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-panel)]"
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
                    <button class="flex items-center gap-1 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': attachmentPanelOpen}" title="查看当前 Session 的全部附件" :disabled="!activeSessionId" @click="toggleAttachmentPanel">
                        <span class="i-lucide-paperclip h-4 w-4"></span>
                        <span v-if="sessionAttachmentUniqueTotal" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-[var(--text-inverse)]">{{ sessionAttachmentUniqueTotal }}</span>
                    </button>
                    <button class="flex items-center gap-1.5 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': linkedAgentPanelOpen}" :title="t('agent.chatSurface.linkedAgentsTitle')" @click="linkedAgentPanelOpen = !linkedAgentPanelOpen">
                        <span class="i-lucide-users h-4 w-4"></span>
                        <span v-if="linkedAgentCount" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-[var(--text-inverse)]">{{ linkedAgentCount }}</span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.chatSurface.sessionTreeTitle')" :disabled="!activeSessionId || !activeInteraction.canMutateHistory" @click="sessionTreeDialogOpen = true">
                        <span class="i-lucide-git-branch h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': systemPromptPanelOpen}" :title="t('agent.systemPrompt.open')" :disabled="!activeSessionId" @click="systemPromptPanelOpen = !systemPromptPanelOpen">
                        <span class="i-lucide-terminal-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.chatSurface.sessionListTitle')" @click="openSessionDialog()">
                        <span class="i-lucide-messages-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <AgentSessionAttachmentPanel
                v-if="attachmentPanelOpen && activeSessionId"
                :session-id="activeSessionId"
                :items="sessionAttachments"
                :total="sessionAttachmentPageTotal"
                :has-more="sessionAttachmentHasMore"
                :loading="sessionAttachmentLoading"
                :search="sessionAttachmentSearch"
                :insert-disabled="!activeInteraction.canInsertAttachment"
                @update:search="updateAttachmentSearch"
                @load-more="void loadSessionAttachments(false)"
                @insert="insertSessionAttachment"
                @close="attachmentPanelOpen = false"
            />

            <!-- Linked Agent 面板 -->
            <AgentLinkedAgentPanel
                v-if="linkedAgentPanelOpen"
                :session-id="activeSessionId"
                :owned-agents="linkedAgents"
                :linked-by-agents="linkedByAgents"
                :loading="linkedAgentsLoading"
                @select="void selectLinkedAgentSession($event)"
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
                :unselected="surfaceActivation.state.value.status === 'unselected'"
                :running="running"
                mode="main"
                :editing-message-id="editingMessageId"
                :editing-message-text="editingMessageText"
                :message-action-disabled="messageActionsDisabled"
                :run-action-disabled="historyMutationDisabled"
                :saving-edit="Boolean(messageActionId)"
                :session-attachments="knownSessionAttachments"
                :can-register-attachments="activeInteraction.canRegisterAttachment"
                :can-insert-attachments="activeInteraction.canInsertAttachment"
                :project-root="props.novelId || null"
                :model-supports-images="activeModelSupportsImages"
                :attachment-insert-request="historyAttachmentInsertRequest"
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
                @start-edit="void startEditingMessage($event)"
                @cancel-edit="cancelEditingMessage"
                @save-edit="void saveEditedMessage($event)"
                @retry="void refreshMessage($event)"
                @branch-from-here="void branchFromMessage($event)"
                @cycle-branch="void cycleMessageBranch($event.messageId, $event.direction)"
                @load-previous="void loadPreviousHistory()"
                @attachment-registered="registerSessionAttachment"
            />

            <AgentWorkflowPendingPanel :session-id="activeSessionId" />

            <AgentComposer
                :key="composerContextGeneration"
                ref="inputRef"
                v-model:input-text="inputText"
                v-model:pending-resolution-draft="pendingResolutionDraft"
                v-model:session-model-popover-open="sessionModelPopoverOpen"
                v-model:session-model-draft="sessionModelDraft"
                :pending-sessions="pendingUserInputSessions"
                :submitting-user-input="submittingCurrentUserInput"
                :can-resolve-user-input="activeInteraction.canResolveUserInput"
                :can-abort="activeInteraction.canAbort"
                :pending-submission-issue="pendingSubmissionIssue"
                :running="running"
                :availability="composerAvailability"
                :can-register-attachments="activeInteraction.canRegisterAttachment"
                :can-insert-attachments="activeInteraction.canInsertAttachment"
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
                :project-root="props.novelId || null"
                :history-inbox-refresh-key="props.historyInboxRefreshKey ?? 0"
                :history-inbox-active="props.active"
                :session-id="activeSessionId"
                :session-attachments="knownSessionAttachments"
                :model-supports-images="activeModelSupportsImages"
                :resolve-menu="resolveInputMenu"
                :on-skill-trigger-start="refreshSkillCatalog"
                @submit-user-input="void submitPendingUserInput()"
                @cancel-user-input="void cancelPendingUserInput()"
                @resync-user-input="void resyncPendingUserInput()"
                @open-context-inspector="contextInspectorOpen = true"
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
                @attachment-registered="registerSessionAttachment"
                @availability-action="handleComposerAvailabilityAction"
                @resend-unknown="void resendUnknownMessage($event)"
                @dismiss-unknown="dismissUnknownMessage($event)"
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
                @restore="void restoreSessionFromDialog($event)"
                @rename="void renameSessionFromDialog($event)"
                @refresh="void refreshSessionsWithQuery($event)"
                @load-more="void refreshSessionsWithQuery($event)"
            />

            <AgentSessionTreeDialog
                v-model="sessionTreeDialogOpen"
                :tree="activeRecovery?.tree ?? []"
                :active-leaf-id="activeRecovery?.activeLeafId ?? null"
                :running="running"
                :can-activate="activeInteraction.canMutateHistory"
                @select="void selectTreeNode($event)"
            />

            <!-- 上下文检查面板（Task 126）：非模态，可与聊天并存 -->
            <AgentContextInspectorDialog v-model="contextInspectorOpen" :session-id="activeSessionId" />
    </section>
</template>
