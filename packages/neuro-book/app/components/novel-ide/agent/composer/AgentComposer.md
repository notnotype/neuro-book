---
标签: [state:local, io:mutate]
---

# AgentComposer

Agent 界面底部核心输入与交互编排容器。组合并调度排队消息列表（`AgentQueuedMessageList`）、工作区历史变更（`AgentWorkspaceChanges`）、用户请求问答向导（`AgentUserInputPrompt`）、可用性横幅（`AgentComposerAvailabilityBanner`）、图片附件栏（`AgentComposerImageBar`）、富文本输入框（`AgentComposerInput`）、底部工具栏（`AgentComposerToolbar` 与 `AgentSessionModelControls`）及状态统计栏（`AgentComposerStatusBar`）。

## 隐藏通道理由

- `io:mutate`：通过 `useComposerImageTransaction` 在用户粘贴/拖入图片时向服务端临时注册附件 blob，为输入流提供乐观图片节点。

## 数据

```typescript
type Props = {
    inputText: string;
    pendingSessions: readonly AgentPendingUserInputSession[];
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
    runPhaseLabel: string;
    connectionNeedsAction: boolean;
    queuedMessages: AgentQueuedMessageDto[];
    menuRefreshKey: string | number;
    projectRoot: string | null;
    historyInboxRefreshKey: string | number;
    historyInboxActive: boolean;
    sessionId: number | null;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    modelSupportsImages: boolean;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
};

type Emits = {
    (e: "update:inputText", value: string): void;
    (e: "update:pendingResolutionDraft", value: AgentPendingResolutionDraft): void;
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "submit-user-input"): void;
    (e: "cancel-user-input"): void;
    (e: "resync-user-input"): void;
    (e: "open-context-inspector"): void;
    (e: "send"): void;
    (e: "steer"): void;
    (e: "followup"): void;
    (e: "stop"): void;
    (e: "cycle-mode"): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
    (e: "reconnect-events"): void;
    (e: "refresh-history"): void;
    (e: "open-history-inbox"): void;
    (e: "open-workspace-file", path: string): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
    (e: "availability-action", action: AgentComposerAvailabilityAction): void;
};

type Expose = {
    focus: () => void;
    insertAttachment: (item: AgentSessionAttachmentItemDto) => void;
};

type Slots = {};
```

- **扩展面**：expose 导出 `focus` 与 `insertAttachment`。
