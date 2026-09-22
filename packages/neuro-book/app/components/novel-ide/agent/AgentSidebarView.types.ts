import type {AgentMessage, AgentMessageSwitcherState, AgentPendingUserInputSession, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentAttachmentUrlResolver} from "nbook/app/components/novel-ide/agent/agent-attachment";
import type {AgentWorkflowObservation} from "nbook/app/components/novel-ide/agent/composables/useAgentWorkflowObservation";
import type {AgentWorkflowPendingRunView, AskDraftValue} from "nbook/app/components/novel-ide/agent/composables/useAgentWorkflowPending";
import type {WorkspaceHistoryDiffState} from "nbook/app/components/novel-ide/agent/composables/useAgentWorkspaceChanges";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {CostDisplayOptions} from "nbook/app/utils/cost-format";
import type {
    AgentComposerAvailability,
    AgentComposerAvailabilityAction,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";
import type {
    AgentLinkedSessionDto,
    AgentMode,
    AgentQueuedMessageDto,
    AgentSessionAttachmentItemDto,
    AgentSessionListQueryDto,
    AgentSessionSummaryDto,
} from "nbook/shared/dto/agent-session.dto";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentPendingResolutionDraft, AgentPendingSubmissionIssue} from "nbook/app/components/novel-ide/agent/agent-pending-resolution";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {DropdownItem} from "@notnotype/nb-ui/components";
import type {SummarizerStatus} from "nbook/app/components/novel-ide/agent/panels/header/AgentSessionHeader.vue";

export interface AgentSidebarHeaderProps {
    drawerIconClass: string;
    activeSessionTitle: string;
    activeDrawerTitle: string;
    activeSessionSummaryText: string;
    summarizerStatus?: SummarizerStatus | null;
    canChooseCreateProfile?: boolean;
    createProfileDropdownItems?: DropdownItem[];
    loadingSession?: boolean;
    activeSessionId: number | null;
    sessionAttachmentUniqueTotal?: number;
    linkedAgentCount?: number;
    canMutateHistory?: boolean;
}

export interface AgentSidebarFlowProps {
    messages: AgentMessage[];
    sessionId?: number | null;
    unselected?: boolean;
    mode?: "main" | "compact";
    editingMessageId?: string | null;
    editingMessageText?: string;
    messageActionDisabled?: boolean;
    runActionDisabled?: boolean;
    savingEdit?: boolean;
    sessionAttachments?: AgentSessionAttachmentItemDto[];
    canRegisterAttachments?: boolean;
    canInsertAttachments?: boolean;
    projectRoot?: string | null;
    modelSupportsImages?: boolean;
    attachmentInsertRequest?: {id: number; item: AgentSessionAttachmentItemDto} | null;
    branchSwitcherStateByMessageId?: Record<string, AgentMessageSwitcherState>;
    menuRefreshKey?: string | number;
    resolveEditorMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onEditorSkillTriggerStart?: () => void;
    openReference?: (target: string) => void;
    costDisplayOptions?: CostDisplayOptions;
    costExchangeRateSuffix?: string;
    historyHasPrevious?: boolean;
    historyLoading?: boolean;
    historyError?: string;
    recentSessions?: AgentSessionSummaryDto[];
}

export interface AgentSidebarComposerProps {
    inputText: string;
    pendingResolutionDraft: AgentPendingResolutionDraft;
    submittingUserInput: boolean;
    canResolveUserInput: boolean;
    canAbort: boolean;
    pendingSubmissionIssue: AgentPendingSubmissionIssue | null;
    running: boolean;
    availability: AgentComposerAvailability;
    canRegisterAttachments: boolean;
    canInsertAttachments: boolean;
    loadingSession: boolean;
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: EnabledModelOptionDto[];
    agentMode: AgentMode;
    canContinueWithoutInput: boolean;
    queuedMessages: AgentQueuedMessageDto[];
    menuRefreshKey: string | number;
    projectRoot: string | null;
    sessionId: number | null;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    modelSupportsImages: boolean;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}

export interface AgentSessionStatusBarProps {
    contextUsageExactLabel: string;
    contextUsageCompactLabel: string;
    contextPercentCompactLabel: string;
    cumulativeUsageExactLabel: string;
    cumulativeInputCompactLabel: string;
    cumulativeOutputCompactLabel: string;
    cumulativeCacheCompactLabel: string;
    cumulativeCacheWriteCompactLabel: string;
    cumulativeCacheHitRateLabel: string;
    cumulativeCostCompactLabel: string;
    connectionStatusLabel: string;
    connectionNeedsAction: boolean;
    running: boolean;
    runPhaseLabel: string;
    agentMode: AgentMode;
}

export interface AgentSidebarAttachmentsProps {
    items: AgentSessionAttachmentItemDto[];
    total: number;
    hasMore: boolean;
    loading: boolean;
    search: string;
    insertDisabled: boolean;
}

export interface AgentSidebarLinkedAgentsProps {
    sessionId: number | null;
    ownedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    loading: boolean;
}

export interface AgentSidebarSystemPromptProps {
    value: string | null;
    loading: boolean;
    error?: string;
    openReference?: (target: string) => void;
}

export interface AgentSidebarWorkspaceChangesProps {
    projectRoot: string | null;
    groups: WorkspaceHistoryInboxGroupDto[];
    loading: boolean;
    error: string | null;
    expanded: boolean;
    selectedPath: string | null;
    busyPath: string | null;
    acceptingAll: boolean;
    diffStateFor: (group: WorkspaceHistoryInboxGroupDto) => WorkspaceHistoryDiffState;
}

export interface AgentSidebarWorkflowPendingProps {
    runs: readonly AgentWorkflowPendingRunView[];
    feedError?: string;
}

export interface AgentSidebarSessionsProps {
    sessions: AgentSessionSummaryDto[];
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
    activeSessionId: number | null;
    loading: boolean;
    running: boolean;
    actionId: number | null;
    createProfileOptions: Array<{profileKey: string; label: string; iconClass: string}>;
    canChooseCreateProfile: boolean;
}

export interface AgentSidebarSessionTreeProps {
    tree: SessionTreeNode[];
    activeLeafId: string | null;
    running: boolean;
    canActivate: boolean;
}

export interface AgentSidebarContextInspectorProps {
    sessionId: number | null;
    inspection: AgentContextInspectionDto | null;
    loading: boolean;
    error: string;
    selectedTraceId: string | null;
}

export interface AgentSidebarViewProps {
    layout: "drawer" | "workbench";
    teleportTarget: string | boolean;
    referenceTeleportTarget?: HTMLElement | null;
    composerContextGeneration?: number;
    pendingSessions: readonly AgentPendingUserInputSession[];
    workflowByToolKey?: Readonly<Record<string, AgentWorkflowObservation>>;
    resolveAttachmentUrl?: AgentAttachmentUrlResolver;

    // 面板开关
    attachmentPanelOpen: boolean;
    linkedAgentPanelOpen: boolean;
    systemPromptPanelOpen: boolean;
    sessionDialogOpen: boolean;
    sessionTreeDialogOpen: boolean;
    contextInspectorOpen: boolean;

    // 十一组分组 Props
    header: AgentSidebarHeaderProps;
    flow: AgentSidebarFlowProps;
    composer: AgentSidebarComposerProps;
    statusBar: AgentSessionStatusBarProps;
    attachments: AgentSidebarAttachmentsProps;
    linkedAgents: AgentSidebarLinkedAgentsProps;
    systemPrompt: AgentSidebarSystemPromptProps;
    workspaceChanges: AgentSidebarWorkspaceChangesProps;
    workflowPending: AgentSidebarWorkflowPendingProps;
    sessions: AgentSidebarSessionsProps;
    sessionTree: AgentSidebarSessionTreeProps;
    contextInspector: AgentSidebarContextInspectorProps;
}

export interface AgentSidebarViewEmits {
    // 浮层开关回写
    (e: "update:attachmentPanelOpen", value: boolean): void;
    (e: "update:linkedAgentPanelOpen", value: boolean): void;
    (e: "update:systemPromptPanelOpen", value: boolean): void;
    (e: "update:sessionDialogOpen", value: boolean): void;
    (e: "update:sessionTreeDialogOpen", value: boolean): void;
    (e: "update:contextInspectorOpen", value: boolean): void;

    // Header 意图
    (e: "header-create-session", profileKey?: string): void;
    (e: "close"): void;

    // Flow 消息流事件
    (e: "flow-copy", message: AgentMessage): void;
    (e: "flow-copy-tool", toolCall: AgentToolCall): void;
    (e: "flow-start-edit", message: AgentMessage): void;
    (e: "flow-cancel-edit", message: AgentMessage): void;
    (e: "flow-save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "flow-retry", message: AgentMessage): void;
    (e: "flow-branch-from-here", message: AgentMessage): void;
    (e: "flow-cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
    (e: "flow-load-previous"): void;
    (e: "flow-resend-unknown", message: AgentMessage): void;
    (e: "flow-dismiss-unknown", message: AgentMessage): void;

    // 附件面板事件
    (e: "attachment-search", search: string): void;
    (e: "attachment-load-more"): void;
    (e: "attachment-insert", item: AgentSessionAttachmentItemDto): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;

    // 关联 Agent 面板事件
    (e: "linked-agent-select", sessionId: number): void;
    (e: "linked-agent-refresh"): void;

    // 系统提示词面板事件
    (e: "system-prompt-load"): void;
    (e: "system-prompt-refresh"): void;

    // 工作区变更事件
    (e: "workspace-update-expanded", value: boolean): void;
    (e: "workspace-select-group", group: WorkspaceHistoryInboxGroupDto): void;
    (e: "workspace-accept-group", group: WorkspaceHistoryInboxGroupDto): void;
    (e: "workspace-accept-all"): void;
    (e: "workspace-refresh"): void;
    (e: "workspace-open-full"): void;
    (e: "workspace-open-file", path: string): void;

    // 后台 Workflow Pending 事件
    (e: "workflow-update-answer", payload: {runId: string; key: string; value: AskDraftValue}): void;
    (e: "workflow-submit-run", runId: string): void;

    // Workflow Bubble 观察事件
    (e: "workflow-observe", payload: {toolKey: string; toolCall: AgentToolCall}): void;
    (e: "workflow-unobserve", toolKey: string): void;
    (e: "workflow-cancel-job", toolKey: string): void;

    // Composer 输入区事件
    (e: "composer-update-input-text", value: string): void;
    (e: "composer-update-pending-resolution-draft", value: AgentPendingResolutionDraft): void;
    (e: "composer-update-session-model-popover-open", value: boolean): void;
    (e: "composer-update-session-model-draft", value: AgentSessionModelDraft): void;
    (e: "composer-update-session-model-selection", value: string | null): void;
    (e: "composer-submit-user-input"): void;
    (e: "composer-cancel-user-input"): void;
    (e: "composer-resync-user-input"): void;
    (e: "composer-send"): void;
    (e: "composer-steer"): void;
    (e: "composer-followup"): void;
    (e: "composer-stop"): void;
    (e: "composer-cycle-mode"): void;
    (e: "composer-toggle-session-model-popover"): void;
    (e: "composer-apply-session-model-settings"): void;
    (e: "composer-reset-session-model-settings"): void;
    (e: "composer-reconnect-events"): void;
    (e: "composer-refresh-history"): void;
    (e: "composer-availability-action", action: AgentComposerAvailabilityAction): void;

    // 会话弹窗事件
    (e: "session-select", sessionId: number): void;
    (e: "session-create", profileKey?: string): void;
    (e: "session-archive", session: AgentSessionSummaryDto): void;
    (e: "session-restore", session: AgentSessionSummaryDto): void;
    (e: "session-rename", session: AgentSessionSummaryDto): void;
    (e: "session-refresh", query: AgentSessionListQueryDto): void;
    (e: "session-load-more", query: AgentSessionListQueryDto): void;

    // 会话树弹窗事件
    (e: "tree-select", entryId: string): void;
    (e: "tree-copy-id", id: string): void;

    // 上下文检查弹窗事件
    (e: "context-select-trace", traceId: string | null): void;
    (e: "context-refresh"): void;

    // 空白态交互事件
    (e: "empty-select-starter", prompt: string): void;
    (e: "empty-create-session"): void;
    (e: "empty-open-sessions"): void;
}
