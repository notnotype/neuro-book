/**
 * AgentConversationView 的视图合同：宿主传入的只读 ctx、纯函数服务，以及视图发出的 action。
 *
 * 行为以 `docs/specs/ui/agent-conversation-view.md` 为准。ctx 必须能完整表示为 JSON，
 * 这样 Lab 的数据 tab 可以直接编辑它，时间线也能确定性回放；函数只允许出现在 services 与注册表里。
 */

import type {Text} from "@notnotype/nb-ui/text";

import type {MarkdownAssetResolver, PromptAttachment, PromptLocale, PromptMenu, PromptMenuContext, PromptMenuItem, PromptPastePolicy} from "./ports";

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

/** 视图与注入的渲染组件用同一组语言。 */
export type AgentLocale = PromptLocale;

/** 中英两份文字（`LocaleMap` 的特例）。 */
export type LocalizedText = {readonly "zh-CN": string; readonly "en-US": string};

// ─── 消息 ───────────────────────────────────────────────────────────────

export type ContentBlockView =
    | {kind: "text"; text: string}
    | {kind: "attachment"; locator: string; name: string; mimeType: string; bytes: number};

/** 一次模型调用的用量。`cost` 已按 `ctx.usage.currency` 折算；单价未知时为 null，界面不显示金额（免费模型是 0）。 */
export type UsageView = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number | null;
};

export type ToolResultView = {
    text: string;
    /** 结果正文只公开了预览时为 true。 */
    truncated: boolean;
    /** 专用渲染器消费的结构化结果。 */
    details?: JsonValue;
};

/** `denied`：没有执行（用户拒绝、规则拒绝、还没开始就停了）。`unknown`：开始了但不知道有没有执行完，要用户核对。 */
export type ToolCallStatus = "streaming" | "running" | "success" | "error" | "invalid" | "denied" | "unknown";

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
    /** 状态的说明，例如“你拒绝了”；适配器给的是本包目录的引用。 */
    note?: Text;
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

/**
 * 宿主挂在一条助手消息上的附注（Spec“术语”的附注），例如问答回复里没核实的出处。它跟着这条消息显示与收起，
 * 不占消息流里的位置，不参与分轮、用时与计数。
 */
export type MessageAnnotationView = {
    /** 条目渲染器按它匹配，例如 "nb-story.unverified-refs"。 */
    customType: string;
    /** 没有登记渲染器、或渲染器出错时显示的一句；写成单独读也看得懂。 */
    text: string;
    /** 条目渲染器读的结构化数据。 */
    details?: JsonValue;
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
    /**
     * 宿主给这条回复加的附注，显示在它的文字之后（没有文字时单独一行）。加附注时换成新的消息对象并按依据缓存，
     * 打节拍时给同一个对象，否则这一轮每次都重新整理。
     */
    annotations?: readonly MessageAnnotationView[];
};

export type SystemMessageSource = "prompt" | "reminder" | "compaction" | "branch_summary" | "custom";

/** 一次压缩的详情（`compaction` 分隔线展开后看到的）：数字与字符串，宿主和适配器各自填，视图自己配文案。 */
export type CompactionView = {
    /** 方法名，例如 `nbook.agent.shake`；显示末一段。 */
    method: string;
    /** 压缩前后的上下文，都是估算（不含系统提示与工具）。`tokensAfter` 不含放回的内容，视图自己加上。 */
    tokensBefore: number;
    tokensAfter: number;
    /** 调了模型的方法才有：模型全名、各次调用的输入输出与缓存读写 token、花费（null 是单价未知）。没调模型（shake）是 null。`input` 只含没命中缓存的部分。 */
    model: {name: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null} | null;
    /** 用到的压缩要求。 */
    require: readonly string[];
    /** 放回了什么；没有放回（shake）是空数组。 */
    restored: readonly {kind: "file" | "plan" | "log"; target: string; tokens: number; truncated: boolean}[];
    /** 换成占位的工具结果条数。 */
    omitted: number;
    /** 原样保留了最近几轮；切在一轮中间或算不出时是 null。 */
    keptTurns: number | null;
};

export type SystemMessageView = {
    kind: "system";
    id: string;
    timestamp: number;
    source: SystemMessageSource;
    /** 条目的名称（例如“上下文已压缩”）；适配器给的是本包目录的引用。 */
    label: Text;
    text: string;
    /** `source` 是 `compaction` 时的详情；没有时分隔线只有摘要。 */
    compaction?: CompactionView;
};

export type ErrorMessageView = {
    kind: "error";
    id: string;
    timestamp: number;
    /** 用户可读的错误说明；适配器给的是本包目录的引用，宿主也可以给自己的文字。 */
    message: Text;
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
    /** 运行中（含等待回答与停止中）能否补充说明（steer）。宿主的运行时不支持时给 false。 */
    canSteer: boolean;
    /** 运行中能否排队一条消息（followup），运行结束后发出。 */
    canQueue: boolean;
    canAnswer: boolean;
    canMutateHistory: boolean;
    canStop: boolean;
    canRegisterAttachments: boolean;
    canChangeRuntime: boolean;
    canArchive: boolean;
    canRestore: boolean;
    /** 宿主有管理模型的地方（例如设置页）：为真时模型下拉的末尾有“管理模型…”，发出 `model.manage`。 */
    canManageModels: boolean;
    /** 宿主支持的输入框命令名（不含 `/`）；不给时登记的命令都显示。宿主没做的命令不进菜单，免得发出去没有反应。 */
    commands?: readonly string[];
};

export type RunStatus = "idle" | "running" | "waiting" | "stopping";

export type RunView = {
    status: RunStatus;
    /** 当前运行阶段的用户可读文案，例如“正在思考”；空闲时为空串。 */
    phase: string;
    /** 这次运行的开始时刻（毫秒）；状态栏据此算用时。 */
    startedAt?: number | null;
    /** 只压缩的运行：它不属于任何一轮，分轮视图不把上一轮算成运行中。 */
    kind?: "compact";
    /** 模型请求失败、在等重发：第几次、最多几次、什么时候再发。 */
    retry?: {attempt: number; max: number; resumeAt: number} | null;
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
    multiSelect?: boolean;
    /** 表单型提问的规格（JSON Schema），由 `renderers.form` 画。 */
    form?: JsonValue;
};

/** 审批预览：宿主取来之前是 `loading`。文件级的 `failed` 是这个文件算不出来，整个查询失败是 `failed`。 */
export type ApprovalPreviewView =
    | {state: "loading"}
    | {state: "failed"}
    | {state: "ready"; files: Array<{address: string; kind: "diff"; before: string; after: string} | {address: string; kind: "too-large"; bytes: number} | {address: string; kind: "failed"; code: string}>};

/** 一个等批准的工具调用。`tool` 是显示给用户的工具名，也按它选怎么画（`edit`、`write` 看预览，`shell` 看命令，别的看参数）。 */
export type PendingApprovalView = {
    kind: "approval";
    /** 事项 id；提交时放在 `input.submit` 的 `batchKey` 里。 */
    id: string;
    toolCallId: string;
    tool: string;
    args: JsonValue;
    reason?: string;
    preview: ApprovalPreviewView;
};

/** 一次提问：一个工具调用里 1 到 4 题。 */
export type PendingQuestionsView = {
    kind: "question";
    id: string;
    toolCallId: string;
    questions: PendingQuestionView[];
};

/** 等用户的事项。一条回复的审批是一批，都在这里，向导一步一个。 */
export type PendingInputView = PendingApprovalView | PendingQuestionsView;

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

/**
 * 输入框里一个附件的上传状态，按编辑器给的 `localId` 对应。就绪后带附件目标，编辑器据此把标签写回文字；
 * 编辑器发出过的每个 `localId` 都要在这里，直到它就绪或收到 `composer.attachmentRemoved`。
 */
export type ComposerAttachmentView = PromptAttachment;

export type ComposerModeView = {
    key: string;
    label: string;
    /** 图标 class；缺省时用通用图标。 */
    icon?: string;
};

export type ComposerModelView = {
    key: string;
    label: string;
    supportsImages: boolean;
    /** 分组名（例如服务商）；同组的排在一起、组名做小标题，不同组里的同名模型分得清。 */
    group?: string;
    /** 用不了的原因（例如密钥没有设置）；有它时这一项灰掉、不能选，悬停看原因。 */
    unavailable?: string;
};

/** 审批模式的一项；`danger` 的（全部放行）选中时状态栏有警告。 */
export type ComposerApprovalOption = {
    key: string;
    label: Text;
    description: Text;
    icon: string;
    danger?: boolean;
};

export type ComposerView = {
    models: ComposerModelView[];
    modelKey: string | null;
    /** 思考档位的取值，例如 `off`、`low`、`high`；常见取值由视图翻译，其余原样显示。 */
    thinkingLevels: string[];
    thinking: string | null;
    /** 第一项是普通模式；不是第一项时模式按钮用强调色。 */
    modes: ComposerModeView[];
    mode: string;
    /** 审批模式的菜单，和 `modes` 平行；缺省没有。 */
    approval?: {options: ComposerApprovalOption[]; value: string};
    /** 上次运行被中断：占位文字换掉，发送按钮换成继续，空着也能发。 */
    resume?: boolean;
    /** 宿主要说的一句，例如发送被拒的原因；显示在输入框上方。 */
    notice?: Text;
    queued: Array<{id: string; text: string; delivery: "steer" | "followup"}>;
    attachments: ComposerAttachmentView[];
    /** 已发送的内容，最新的在前，供输入历史使用。 */
    recall: string[];
    /** 粘贴分档设置；缺省用编辑器的默认值。 */
    pastePolicy?: Partial<PromptPastePolicy>;
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
    input?: number;
    output?: number;
    /** `warned`：累计费用到了告警线；`unpriced`：有没有单价的请求，费用上限对它不起作用。 */
    costState?: "ok" | "warned" | "unpriced";
    cacheRead: number;
    cacheWrite: number;
    /** 0 到 1；没有数据时为 null。 */
    cacheHitRate: number | null;
    /** 单价未知时为 null。 */
    cost: number | null;
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
    messages: readonly MessageView[];
    history: HistoryView;
    /** 按消息 id 索引；指向不存在的消息时忽略。 */
    branches: {[messageId: string]: BranchView};
    editing: EditingView | null;
    pendingInputs: PendingInputView[];
    /** 用户按下停止的时刻（毫秒）；状态栏据此在超过 10 秒时提示工具没有响应。 */
    stopRequestedAt?: number;
    /** 向导的界面状态，向导经 `wizard.state` 交出来，宿主原样放回：编辑区页面切标签会卸载，切回来答案还在。 */
    wizardState?: JsonValue;
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

// 触发菜单原样交给提示词编辑器，形状只在 `ports.ts` 写一份；这里的名字是视图合同一侧的叫法。
export type TriggerMenuItem = PromptMenuItem;
export type TriggerMenu = PromptMenu;
export type TriggerMenuContext = PromptMenuContext;

export type AgentConversationServices = {
    /** 回复里 Markdown 图片地址到可显示地址的换算；不提供时图片只显示说明。Markdown 的渲染与净化由注入的组件负责。 */
    resolveMarkdownAsset?: MarkdownAssetResolver;
    /** 返回附件地址；返回 null 表示不可用，视图显示占位且不发请求。 */
    resolveAttachmentUrl?: (locator: string, variant: "thumbnail" | "original") => string | null;
    /**
     * 触发菜单的内容；纯函数，数据变化时宿主换一个新函数。`/` 位于正文开头时菜单由视图按登记的命令列出，不调用它。
     */
    resolveTriggerMenu?: (context: TriggerMenuContext) => TriggerMenu;
};

// ─── action ─────────────────────────────────────────────────────────────

export type SubmitDelivery = "prompt" | "steer" | "followup";

/** 一个等用户事项的答复：审批的决定（`note` 是拒绝时给模型的话），或提问的回答（`text` 是拼好的人话，`data` 是逐题的回答）。 */
export type InputResolution =
    | {kind: "approval"; decision: "allow" | "allow-session" | "deny"; note?: string}
    | {kind: "question"; answer: {text: string; data: {answers: JsonValue}}};

export type BuiltinAgentViewAction =
    // 会话
    | {type: "session.create"; profileKey?: string}
    | {type: "session.select"; sessionId: string}
    | {type: "session.rename"; sessionId: string; title: string}
    | {type: "session.archive"; sessionId: string}
    | {type: "session.restore"; sessionId: string}
    | {type: "sessions.query"; query: string}
    | {type: "sessions.refresh"}
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
    | {type: "link.open"; href: string}
    | {type: "file.openDiff"; path: string; toolCallId: string}
    | {type: "attachment.open"; target: string}
    | {type: "skill.open"; name: string}
    // 输入框；附件都写在文字里（见 PromptEditor 的文字写法），submit 不另带附件。
    // File 对象不可 JSON 化，只在 composer.attachmentAdded 中出现。
    | {type: "composer.submit"; text: string; delivery: SubmitDelivery}
    | {type: "composer.stop"}
    | {type: "composer.draftChanged"; text: string}
    | {type: "composer.attachmentAdded"; localId: string; kind: "image" | "file"; file: File}
    | {type: "composer.attachmentRetry"; localId: string}
    | {type: "composer.attachmentRemoved"; localId: string}
    | {type: "command.run"; name: string; argsText: string}
    | {type: "menu.opened"; trigger: string}
    // 运行设置
    | {type: "mode.set"; mode: string}
    | {type: "model.set"; modelKey: string}
    | {type: "thinking.set"; level: string}
    | {type: "model.manage"}
    | {type: "runtime.reset"}
    // 提问
    | {type: "input.submit"; batchKey: string; resolutions: InputResolution}
    | {type: "input.cancelRun"}
    | {type: "wizard.state"; state: JsonValue}
    | {type: "run.continue"}
    | {type: "queued.edit"; id: string}
    | {type: "queued.remove"; id: string}
    | {type: "approval.set"; mode: string}
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

// ─── 会话列表 ────────────────────────────────────────────────────────────

/** 会话列表的一行（Spec“会话列表”）。会话列表是视图之外的独立组件，数据由宿主直接给，不在 ctx 里。 */
export type AgentSessionListItem = {
    id: string;
    /** 空串时显示“未命名会话”。 */
    title: string;
    /** 第二行的补充说明，宿主写好，例如“3 轮 · 图当目录”；缺省不显示。 */
    description?: string;
    /** 最近活动的时刻（毫秒）。 */
    updatedAt: number;
    /** 宿主按自己的状态映射，例如问答记录的中断与出错。`waiting` 是等用户批准或回答。 */
    status: "idle" | "running" | "waiting" | "interrupted" | "error";
    /** 图标 class（Profile 的图标）；缺省用通用图标。 */
    icon?: string;
    /** 图标的悬停提示（Profile 的名字）。 */
    iconTitle?: string;
    archived?: boolean;
    /** 需要注意的一句，提醒色另起一行，例如“读到 38.12，早于你现在的位置”；图标缺省 i-lucide-circle-alert。 */
    note?: {text: string; icon?: string};
};

export type AgentSessionListState = "ready" | "loading" | "error";

/** 会话面板过滤菜单的一项（Profile）。 */
export type SessionPanelFilter = {id: string; label: string; icon?: string; active: boolean};
