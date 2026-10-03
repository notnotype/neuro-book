/**
 * AgentConversationView 的视图合同：宿主传入的只读 ctx、纯函数服务，以及视图发出的 action。
 *
 * 行为以 `docs/specs/ui/agent-conversation-view.md` 为准。ctx 必须能完整表示为 JSON，
 * 这样 Lab 的数据 tab 可以直接编辑它，时间线也能确定性回放；函数只允许出现在 services 与注册表里。
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

/**
 * 界面文字。内置登记项用 i18n key，插件可以直接给出已本地化的文字。
 * 纯逻辑层（分轮规则、注册表）拿不到 i18n 运行时，所以只产出这个描述，由视图翻译。
 */
export type ViewText = string | {key: string; params?: {[name: string]: string | number}};

// ─── 消息 ───────────────────────────────────────────────────────────────

export type ContentBlockView =
    | {kind: "text"; text: string}
    | {kind: "attachment"; locator: string; name: string; mimeType: string; bytes: number};

/** 一次模型调用的用量。`cost` 已按 `ctx.usage.currency` 折算。 */
export type UsageView = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
};

export type ToolResultView = {
    text: string;
    /** 结果正文只公开了预览时为 true。 */
    truncated: boolean;
    /** 专用渲染器消费的结构化结果。 */
    details?: JsonValue;
};

export type ToolCallStatus = "streaming" | "running" | "success" | "error" | "invalid";

export type ToolCallView = {
    id: string;
    name: string;
    status: ToolCallStatus;
    /**
     * 工具参数，字段名与工具自己的参数一致（例如 edit 的 `{path, edits: [{oldText, newText}]}`）。
     * 长字符串可能只是预览；流式生成中可能缺字段，渲染器必须容忍。
     */
    args: JsonValue;
    result?: ToolResultView;
    error?: string;
};

export type UserMessageView = {
    kind: "user";
    id: string;
    timestamp: number;
    /** steer 是运行中插入的补充说明，不开启新轮次。 */
    intent: "normal" | "steer";
    blocks: ContentBlockView[];
    /** 正文只公开了预览。 */
    contentOmitted: boolean;
    /** 仅尚未确认送达的乐观消息有值。 */
    delivery?: "pending" | "unknown";
};

export type AssistantMessageStatus = "streaming" | "done" | "stopped" | "interrupted" | "error";

export type AssistantMessageView = {
    kind: "assistant";
    id: string;
    timestamp: number;
    status: AssistantMessageStatus;
    text: string;
    thinking: string;
    model: string;
    usage?: UsageView;
    toolCalls: ToolCallView[];
    /** 用户可读的错误说明；宿主负责把内部错误译成普通作者能看懂的文字。 */
    error?: string;
    contentOmitted: boolean;
};

export type SystemMessageSource = "prompt" | "reminder" | "compaction" | "branch_summary" | "custom";

export type SystemMessageView = {
    kind: "system";
    id: string;
    timestamp: number;
    source: SystemMessageSource;
    label: string;
    text: string;
};

export type ErrorMessageView = {
    kind: "error";
    id: string;
    timestamp: number;
    message: string;
    retryable: boolean;
};

export type MessageView = UserMessageView | AssistantMessageView | SystemMessageView | ErrorMessageView;

// ─── ctx 各部分 ─────────────────────────────────────────────────────────

export type SessionView = {
    id: string;
    title: string;
    summary: string;
    profileName: string;
    /** 图标 class，例如 `i-lucide-feather`。 */
    profileIcon: string;
    archived: boolean;
    /** 后台摘要生成状态。 */
    summaryState: "idle" | "running" | "failed";
};

export type AvailabilityStatus = "ready" | "loading" | "empty" | "unselected" | "archived" | "profile-unavailable" | "load-error";

export type AvailabilityView = {
    status: AvailabilityStatus;
    /** 用户可读说明；`ready` 时为空串。 */
    message: string;
    /** 可执行的恢复动作；点击发出 `availability.act`。 */
    actions: Array<{id: string; label: string}>;
};

export type InteractionView = {
    canSend: boolean;
    canAnswer: boolean;
    canMutateHistory: boolean;
    canStop: boolean;
    canRegisterAttachments: boolean;
    canChangeRuntime: boolean;
    canArchive: boolean;
    canRestore: boolean;
};

export type RunStatus = "idle" | "running" | "waiting" | "stopping";

export type RunView = {
    status: RunStatus;
    /** 当前运行阶段的用户可读文案，例如“正在思考”；空闲时为空串。 */
    phase: string;
};

export type HistoryView = {
    hasMore: boolean;
    loading: boolean;
    error: string | null;
};

export type BranchView = {
    /** 从 1 开始。 */
    index: number;
    total: number;
};

export type EditingView = {
    messageId: string;
    text: string;
    /** 完整原文仍在加载时编辑器只读。 */
    loading: boolean;
};

export type PendingQuestionView = {
    header?: string;
    question: string;
    options: Array<{label: string; description?: string}>;
    /** 表单型提问的规格，由提问向导解释。 */
    form?: JsonValue;
};

export type PendingInputView = {
    batchKey: string;
    toolCallId: string;
    questions: PendingQuestionView[];
};

export type WorkflowView = {
    runId: string;
    phase: "running" | "waiting" | "done" | "failed" | "cancelled";
    currentAction: string;
    questions: PendingQuestionView[];
    result: string | null;
};

export type WorkspaceChangeGroupView = {
    path: string;
    added: number;
    removed: number;
    diffState: "idle" | "loading" | "ready" | "error";
};

export type WorkspaceChangesView = {
    groups: WorkspaceChangeGroupView[];
    selectedPath: string | null;
    loading: boolean;
    error: string | null;
};

export type ComposerImageView = {
    localId: string;
    name: string;
    state: "uploading" | "ready" | "failed";
    error?: string;
};

export type ComposerView = {
    models: Array<{key: string; label: string; supportsImages: boolean}>;
    modelKey: string | null;
    thinkingLevels: string[];
    thinking: string | null;
    modes: Array<{key: string; label: string}>;
    mode: string;
    queued: Array<{id: string; text: string; delivery: "steer" | "followup"}>;
    attachmentCount: number;
    images: ComposerImageView[];
    /**
     * 草稿。版本号变化时视图用它替换输入框内容；
     * 宿主受理提交后给出文字为空的新版本，视图据此清空，提交失败时文字就不会丢。
     */
    draft: {text: string; version: number};
};

export type UsageSummaryView = {
    contextTokens: number;
    contextLimit: number | null;
    totalTokens: number;
    cacheRead: number;
    cacheWrite: number;
    /** 0 到 1；没有数据时为 null。 */
    cacheHitRate: number | null;
    cost: number;
    currency: "USD" | "CNY";
};

export type ConnectionView = {
    status: "connected" | "connecting" | "disconnected";
    actionRequired: boolean;
};

/**
 * 面板数据按面板 id 分区。各面板在 S7 实现时各自收窄自己的那一份；
 * 分区而不是逐个写死字段，是为了让插件登记的面板和内置面板走同一条路。
 */
export type PanelsView = {[panelId: string]: JsonValue};

export type AgentConversationContext = {
    /** 未选择会话时为 null。 */
    session: SessionView | null;
    availability: AvailabilityView;
    interaction: InteractionView;
    run: RunView;
    /** 已加载的全部消息，按时间顺序，包含运行中尚未落盘的内容。 */
    messages: MessageView[];
    history: HistoryView;
    /** 按消息 id 索引；指向不存在的消息时忽略。 */
    branches: {[messageId: string]: BranchView};
    editing: EditingView | null;
    pendingInputs: PendingInputView[];
    /** 按工具调用 id 索引。 */
    workflows: {[toolCallId: string]: WorkflowView};
    workspaceChanges: WorkspaceChangesView;
    composer: ComposerView;
    usage: UsageSummaryView;
    connection: ConnectionView;
    panels: PanelsView;
    /** 宿主提供的当前时间（毫秒）。视图不自己计时，运行中的用时按它计算。 */
    now: number;
    /** 按插件 id 分区的数据，供插件登记的渲染器读取。 */
    extensions: {[pluginId: string]: JsonValue};
};

// ─── 服务 ───────────────────────────────────────────────────────────────

export type TriggerMenuItem = {
    id: string;
    label: string;
    description?: string;
    iconClass?: string;
    /** 确认后插入输入框的文字。 */
    insertText: string;
};

export type TriggerMenuContext = {
    trigger: string;
    query: string;
};

export type AgentConversationServices = {
    /** Markdown 渲染出的 HTML 必须经过它才能插入页面；缺失时以纯文本显示。 */
    sanitizeHtml?: (html: string) => string;
    /** 返回附件地址；返回 null 表示不可用，视图显示占位且不发请求。 */
    resolveAttachmentUrl: (locator: string, variant: "thumbnail" | "original") => string | null;
    resolveTriggerMenu: (context: TriggerMenuContext) => TriggerMenuItem[];
};

// ─── action ─────────────────────────────────────────────────────────────

export type SubmitDelivery = "prompt" | "steer" | "followup";

export type BuiltinAgentViewAction =
    // 会话
    | {type: "session.create"; profileKey?: string}
    | {type: "session.select"; sessionId: string}
    | {type: "session.rename"; sessionId: string; title: string}
    | {type: "session.archive"; sessionId: string}
    | {type: "session.restore"; sessionId: string}
    | {type: "sessions.query"; query: string}
    | {type: "view.close"}
    // 消息
    | {type: "message.copy"; messageId: string}
    | {type: "message.editStart"; messageId: string}
    | {type: "message.editCancel"}
    | {type: "message.editSubmit"; messageId: string; text: string}
    | {type: "message.retry"; messageId: string}
    | {type: "message.branchFrom"; messageId: string}
    | {type: "message.resend"; messageId: string}
    | {type: "message.dismiss"; messageId: string}
    | {type: "branch.switch"; messageId: string; direction: "previous" | "next"}
    | {type: "tool.copy"; toolCallId: string}
    | {type: "history.loadPrevious"}
    | {type: "history.refresh"}
    // 引用与文件
    | {type: "reference.open"; target: string}
    | {type: "file.openDiff"; path: string; toolCallId: string}
    // 输入框；图片的 File 对象不可 JSON 化，只在 composer.imageAdded 中出现
    | {type: "composer.submit"; text: string; images: string[]; delivery: SubmitDelivery}
    | {type: "composer.stop"}
    | {type: "composer.draftChanged"; text: string}
    | {type: "composer.imageAdded"; localId: string; file: File}
    | {type: "composer.imageRetry"; localId: string}
    | {type: "composer.imageRemoved"; localId: string}
    | {type: "command.run"; name: string; argsText: string}
    | {type: "menu.opened"; trigger: string}
    // 运行设置
    | {type: "mode.set"; mode: string}
    | {type: "model.set"; modelKey: string}
    | {type: "thinking.set"; level: string}
    | {type: "runtime.reset"}
    // 提问
    | {type: "input.submit"; batchKey: string; resolutions: JsonValue}
    | {type: "input.cancelRun"}
    | {type: "input.resync"}
    // 恢复
    | {type: "availability.act"; action: string}
    | {type: "connection.reconnect"}
    // 面板数据
    | {type: "attachments.query"; search: string; offset: number}
    | {type: "linkedAgents.refresh"}
    | {type: "systemPrompt.load"; refresh: boolean}
    | {type: "tree.activate"; entryId: string}
    | {type: "tree.copyId"; entryId: string}
    | {type: "context.selectTrace"; traceId: string}
    | {type: "context.refresh"}
    // 工作区变更
    | {type: "changes.select"; path: string}
    | {type: "changes.accept"; path: string}
    | {type: "changes.acceptAll"}
    | {type: "changes.refresh"}
    | {type: "changes.openInbox"}
    // Workflow
    | {type: "workflow.submit"; runId: string; answers: JsonValue}
    | {type: "workflow.cancel"; toolCallId: string};

/** 插件 action 的 type 为 `<插件 id>:<名称>`，负载由插件自行定义。 */
export type PluginAgentViewAction = {type: `${string}:${string}`; payload?: JsonValue};

export type AgentViewAction = BuiltinAgentViewAction | PluginAgentViewAction;

export type AgentViewMode = "turns" | "raw";
