/**
 * nb-agent-ui 的核心入口：视图合同（ctx、services、action）、注册表、界面文字的引用与宿主注入组件的形状，都是纯 TS，不依赖
 * Vue 与 DOM。本包的目录在 `./locales` 子路径。行为合同是 docs/specs/ui/agent-conversation-view.md；渲染层在 `@notnotype/nb-agent-ui/vue`。
 *
 * 分轮、摘要等纯逻辑只给渲染层用，不导出；宿主起步用的 `createAgentContext`、输入框动作与 harness 适配器在这里。
 */

// 公开类型逐个列出：新增类型默认是包内的，要给宿主用时在这里加一行。
export type {
    AgentConversationContext, AgentConversationServices, AgentLocale, AgentViewAction, AgentViewMode, AssistantMessageStatus,
    AgentSessionListItem, AgentSessionListState, MessagesContact, MessagesContactSection, MessagesRecentSession, ApprovalPreviewView, AssistantMessageView, AvailabilityStatus, AvailabilityView, BranchView, BuiltinAgentViewAction, ComposerAttachmentView,
    SessionPanelFilter, ComposerApprovalOption, ComposerEffortView, ComposerGroupView, ComposerIcon, ComposerModelView, ComposerModeView, ComposerRoleView, SessionTreeView, ContextInspectionView, SystemPromptView, ComposerView, ConnectionView, ContentBlockView, EditingView, ErrorMessageView, HistoryView,
    InteractionView, JsonValue, LocalizedText, MessageAnnotationView, MessageView, PanelsView, PendingApprovalView, PendingInputCommon, PendingInputView, PendingQuestionsView,
    PendingModeSwitchView,
    CompactionView, PendingQuestionView, PluginAgentViewAction,
    RunStatus, RunView, SessionView, SubmitDelivery, SystemMessageSource, SystemMessageView, ToolCallStatus, ToolCallView,
    ToolResultView, TriggerMenu, TriggerMenuContext, TriggerMenuItem, UsageSummaryView, UsageView, UserMessageView,
    WorkflowView, WorkspaceChangeGroupView, WorkspaceChangesView, AgentWelcomeView,
} from "./types";
export type {
    AgentIconPort, AgentResolvedIcon, MarkdownActivation, MarkdownAssetResolver, MarkdownDisplayPortProps, MarkdownPreviewPort, PromptAttachment, PromptBarenessPort, PromptAttachmentKind, PromptDraft,
    PromptEditorPortExpose, PromptEditorPortProps, PromptLocale, PromptMenu, PromptMenuContext, PromptMenuItem, PromptPastePolicy,
    PromptTextViewPortProps, PromptToken, StickerPreviewRequest,
} from "./ports";
export {AgentViewRegistryConflictError, createAgentViewRegistry, GENERIC_TOOL_RENDERER} from "./registry";
export type {
    AgentViewContribution, AgentViewRegistry, ComposerCommandEntry, ComposerTriggerEntry, EntryComponentProps, EntryRendererEntry, ExtensionPoint,
    ExtensionPointEntries, FileChangeView, HeaderActionEntry, RegistryConflict, MessageActionEntry, MessageActionTarget, PanelEntry, RegistryEntryBase, RoleEntry,
    StatusItemEntry, ToolbarButtonEntry, ToolbarPopoverProps, ToolCategory, ToolComponentProps, ToolEffects, ToolRendererEntry, HostComponentContext, HostComponentEmits, TrayItemEntry,
} from "./registry";
export {argArray, argBoolean, argNumber, argString, countLines, objectString} from "./tool-args";
export type {CodeLine} from "./tool-detail-lines";
// 文字值的类型在 nb-ui 的纯数据层；视图合同的文字字段都是 `Text`，转出来给宿主写类型时用。
export type {LocaleMap, Text, TextRef} from "@notnotype/nb-ui/text";
export {agentRef, formatText} from "./text";
export {formatListTime, markdownPreviewLine} from "./format";
export type {AgentTextKey} from "./text";
export {acceptSubmission, applyComposerAction, nextMode} from "./composer-actions";
export {createAgentContext} from "./context";
export {BUILTIN_STATUS_ITEMS, collapsedItems, moveStatusItem, resolveStatusLine, shiftStatusItem, statusLineCatalog, toggleStatusItem} from "./status-line";
export type {ResolvedStatusItem, StatusLineItem, StatusLineSetting, StatusLineSide, StatusLineSlot, StatusLineWidth} from "./status-line";
export type {AgentContextPatch} from "./context";
export {createHarnessTranscript, logSeqOf, modelErrorText} from "./harness";
export {createKernelTranscript, NOTICE_SUMMARY_CHARS} from "./kernel-transcript";
export type {KernelAnchor, KernelIssuer, KernelMeta, KernelNotice, KernelPending, KernelQueued, KernelRun, KernelTranscript, KernelTranscriptProblem, KernelUsage} from "./kernel-transcript";
export type {HarnessTranscript, TranscriptProblem} from "./harness";
export {catalogRef, providerSelectable} from "./model-catalog";
export type {CatalogAccess, CatalogModelView, CatalogProviderView} from "./model-catalog";
export {graphEdgePath, graphPosition, graphSize, SESSION_TREE_GRAPH_LIMIT, SESSION_TREE_NODE_SIZE, sessionTreeGraph, sessionTreeRows} from "./session-tree";
export type {SessionTreeDirection, SessionTreeFilter, SessionTreeGraph, SessionTreeGraphNode, SessionTreeNodeKind, SessionTreeNodeView, SessionTreeRow, TreeGuide} from "./session-tree";
// 宿主只要按筛选判断新来的一条（`matchesQuery`）；分组、格式化、查找的切分是查看器自己的，不从包根交出去。
export {matchesQuery} from "./request-trace";
export type {RequestTraceWithin, RequestTraceHit, RequestTraceMatch, RequestTraceAction, RequestTraceCompareView, RequestTraceSearchState, RequestTraceContentState, RequestTraceDetailState, RequestTraceListState, RequestTracePayloadView, RequestTraceAttempt, RequestTraceBlock, RequestTraceDetail, RequestTraceFacets, RequestTraceMessage, RequestTracePayloadState, RequestTracePurpose, RequestTraceQuery, RequestTraceRow, RequestTraceSort, RequestTraceStatus, RequestTraceStatusFilter, RequestTraceTool, RequestTraceTotals, RequestTraceUsage} from "./request-trace";
