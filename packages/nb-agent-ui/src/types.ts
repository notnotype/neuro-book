/**
 * AgentConversationView 的视图合同：宿主传入的只读 ctx、纯函数服务，以及视图发出的 action。
 *
 * 行为以 `docs/specs/ui/agent-conversation-view.md` 为准。ctx 必须能完整表示为 JSON，
 * 这样 Lab 的数据 tab 可以直接编辑它，时间线也能确定性回放；函数只允许出现在 services 与注册表里。
 */

import type {SessionTreeNodeView} from "./session-tree";

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
    /** 这次调用的唯一身份（harness 适配器从 `toolStarted` 取）；调用 id 只在同一条回复里不重复，宿主跨回复认调用用它。 */
    invocation?: string;
    /**
     * 它在执行中经代码调的工具（嵌套调用，例如 eval 里的 `tool.read`），按受理的先后；没调过的不带这个字段。子调用自己不再有
     * 子调用。子调用的结果只有预览（`result.truncated` 标出），全文模型已经在父调用的结果里看到。
     */
    children?: ToolCallView[];
    /** 开始执行的时刻（毫秒）；运行中的卡片按它与 `ctx.now` 算已用时（含等审批的时间）。还没开始执行的没有。 */
    startedAt?: number;
    /**
     * 参数里有字符串只给了预览（嵌套调用里超过 2 KB 的字符串由内核截短）：读写的文件照算，增删行数与 diff 按参数算不准，
     * 不给（`callEffects`）。
     */
    argsPreview?: true;
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
    /** 别的会话或宿主以自己的身份发来的话（派子代理的父 Agent、日程）：头像与名称用它；缺省是用户。 */
    author?: {label: Text; icon: string};
    /** 乐观消息前面还有几条别的发出者的话先跑（合并留着的话发出的那一条）；视图写“前面还有 N 条”。 */
    ahead?: number;
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
     * 这条回复出自会话里的第几次模型请求（`modelStarted` 的序号），宿主据此打开请求查看器。只有真的发给了模型的才有：
     * 拦截层不调 `next`、直接交回的回复没有对应的请求，也就没有这个字段。
     */
    request?: number;
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
    /** 放回了什么；没有放回（shake）是空数组。`skill` 的 `target` 是 Skill 的 id（docs/specs/agent/skills.md 输出 17）。 */
    restored: readonly {kind: "file" | "plan" | "log" | "skill"; target: string; tokens: number; truncated: boolean}[];
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

/** 轮与轮之间的分隔线（ui/agent-conversation-view.md 的“分轮视图”）。 */
export type DividersView = {
    /** 为真时画按天的线：每一轮之前与上一轮不在同一个日历日时一条，第一轮之前总有一条。 */
    readonly day?: boolean;
    /** 未读线起点的消息 id：线画在含它的那一轮之前；它不在已加载的消息里时不画。 */
    readonly unreadFrom?: string | null;
};

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
    /**
     * 子会话的祖先，从根会话到父会话；不是子会话时不给。顶栏据此画面包屑，点祖先发 `session.select`。`title` 为 `null`
     * 的段写“未知会话”（祖先读不到），空字符串写“未命名会话”（读到了、还没有标题）。
     */
    path?: Array<{id: string; title: string | null; icon?: string}>;
    /** 头像图片的地址（例如 bot 的主对话）；给了时顶栏画它，不画 Profile 图标。 */
    avatar?: string;
};

export type AvailabilityStatus = "ready" | "loading" | "empty" | "unselected" | "archived" | "profile-unavailable" | "load-error";

export type AvailabilityView = {
    status: AvailabilityStatus;
    /** 用户可读说明；`ready` 时为空串。 */
    message: string;
    /** 可执行的恢复动作；点击发出 `availability.act`。 */
    actions: Array<{id: string; label: string}>;
    /** 提示卡的标题与图标（`profile-unavailable` 画成提示卡，见 AgentNoticeCard.md）；标题也是输入框的占位。 */
    title?: string;
    icon?: string;
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
    /**
     * 停止并清空排队（ui/agent-conversation-view.md 的“停止的第二个选项”）：缓冲区里有用户自己的话（就绪或留着）时给出，
     * `count` 是会被清掉的条数；没有时为 null 或不写，停止键旁不画下拉箭头。
     */
    stopClearing?: {count: number} | null;
    /**
     * 宿主正在执行一次“继续”（几步之间也算，docs/specs/agent/conversation.md 输出 50）：发送键与排队区的“继续”不可用，
     * 编辑器照常可写、不失焦。缺省为 false。
     */
    continuing?: boolean;
    canRegisterAttachments: boolean;
    canChangeRuntime: boolean;
    /** 能切 Agent 模式。不写时跟 `canChangeRuntime`；宿主在还没有会话时也给它，先开 `plan` 再发第一条。 */
    canChangeMode?: boolean;
    canArchive: boolean;
    canRestore: boolean;
    /** 宿主能给上下文详情：为真时圆环与缓存命中能点，顶栏菜单有入口。 */
    canInspectContext?: boolean;
    /** 宿主能给分支树：为真时顶栏菜单有入口。切换还要看 `canMutateHistory` 与运行状态。 */
    canOpenTree?: boolean;
    /** 宿主有管理模型的地方（例如设置页）：为真时模型下拉的末尾有“管理模型…”，发出 `model.manage`。 */
    canManageModels: boolean;
    /** 宿主支持的触发字符；不给时登记的都算。宿主没做的（例如还没有 Skill 时的 `$`）不打开空菜单。 */
    triggers?: readonly string[];
    /** 宿主支持的输入框命令名（不含 `/`）；不给时登记的命令都显示。宿主没做的命令不进菜单，免得发出去没有反应。 */
    commands?: readonly string[];
    /**
     * 阻塞的待处理事项放在哪（同名 .md 的“用法档”）：缺省 `wizard`（替换输入框）；`dock` 时也进停靠区，输入框不隐藏（bot 的主对话）。
     * 按会话给：同一个视图里切到别的会话时跟着变。
     */
    placement?: "wizard" | "dock";
    /** 能不能从这里新建会话，缺省 true。为 false 时头上不画新建，没有消息时也不画第一屏（bot 的主对话：第一屏的“最近对话”会把聊天换成别的会话）。 */
    canCreate?: boolean;
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

/**
 * 待处理事项的公共字段。带 `source` 的来自后代会话（子代理的审批、提问、模式切换请求），`async` 的是异步提问；这两种进停靠区，
 * 不替换输入框，其余是阻塞的（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）。
 */
export type PendingInputCommon = {
    source?: {sessionId: string; name: string; icon: string};
    async?: true;
    /** 嵌套调用的事项（例如 eval 的代码里调的写工具）：`tool` 是外层工具显示给用户的名字，向导标题写明是它里面的调用。 */
    within?: {tool: string};
};

/** 一个等批准的工具调用。`tool` 是显示给用户的工具名，也按它选怎么画（`edit`、`write` 看预览，`shell` 看命令，别的看参数）。 */
export type PendingApprovalView = PendingInputCommon & {
    kind: "approval";
    /** 事项 id；提交时放在 `input.submit` 的 `batchKey` 里。 */
    id: string;
    toolCallId: string;
    tool: string;
    args: JsonValue;
    reason?: string;
    preview: ApprovalPreviewView;
    /** “本会话都批准”要记什么：`label` 是规则（`git diff *`）；不写是记整个工具；`false` 是这次不能记，没有这个选项。 */
    remember?: {label: string} | false;
};

/** 一次提问：一个工具调用里 1 到 4 题。 */
export type PendingQuestionsView = PendingInputCommon & {
    kind: "question";
    id: string;
    toolCallId: string;
    questions: PendingQuestionView[];
};

/** 模型申请切换 Agent 模式（`switch_mode`）。`plan` 是退出计划模式时要批准的计划全文。 */
export type PendingModeSwitchView = PendingInputCommon & {
    kind: "mode-switch";
    id: string;
    toolCallId: string;
    fromLabel: string;
    toLabel: string;
    plan?: string;
    /**
     * 批准计划时可以顺带改的审批模式，`value` 是那个会话现在的模式。宿主不知道时不给（后代会话的请求）：向导不画这一栏，
     * 批准时也不改模式。
     */
    approval?: {options: ComposerApprovalOption[]; value: string};
};

/** 等用户的事项。一条回复的审批是一批，都在这里，向导一步一个。 */
export type PendingInputView = PendingApprovalView | PendingQuestionsView | PendingModeSwitchView;

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

/**
 * 图标的引用：视图里只放键，由宿主注入的图标解析端口（`AgentIconPort`）在渲染时解析。这样图标表晚到、换了表都能重画，
 * 视图数据也不带地址与 SVG。端口解析不出（表还没到、没登记）时画 `fallback` 的首字母块。
 */
export type ComposerIcon =
    | {kind: "key"; set: "provider" | "role"; key: string; /** 解析不出时画它的首字母。 */ fallback?: string}
    | {kind: "initial"; text: string}
    | {kind: "class"; name: string}
    /** 宿主给的图片地址（用户上传的服务商图标）：多色图，原样显示，不经解析端口；`fallback` 是图片出不来时的首字母。 */
    | {kind: "url"; src: string; fallback?: string};

/** 模型库里的一组（服务商）。模型行只带 `groupId`，组的名字与图标在这里写一次。 */
export type ComposerGroupView = {id: string; name: string; icon?: ComposerIcon};

/**
 * 思考档的状态（选择器与角色页共用的语义）：模型的能力、档位、当前显示的档与它的来源。缺省时选择器按 `thinkingLevels` 与
 * `thinking` 推出。
 */
export type ComposerEffortView = {
    /** `none` 不推理；`fixed` 会思考但不能调档；`levels` 可调。 */
    kind: "none" | "fixed" | "levels";
    /** 档位，从低到高，不含 `off`。 */
    levels: string[];
    /** 能真正关闭：档位前另有 `off` 一项。只能降到最低档的模型为假，最低档就在 `levels` 里。 */
    canOff: boolean;
    /** 档位是 OMP 对缺证据的模型物化的未验证梯级：界面加“?”说明。 */
    verified: boolean;
    /** 当前显示的档：明确选的；或跟随时夹取后的有效档（`off` 或档位）；没有则为 null。 */
    value: string | null;
    /** `session` 明确选的；`role`、`model` 是跟随来的；null 没有指定。 */
    source: "session" | "role" | "model" | null;
    /**
     * “跟随”会用谁的默认：`role`（带角色的显示名，写“主力的默认”）或 `model`；null 是没有默认（交给服务商），这时没有
     * “用默认”的按钮。明确选了档时它说明“用默认”会回到哪里。
     */
    follow?: {source: "role" | "model"; name?: string; /** 回到跟随后显示的档；宿主知道时给，不经服务端往返就地回写的宿主（Lab）靠它。 */ value?: string | null} | null;
};

export type ComposerModelView = {
    key: string;
    label: string;
    supportsImages: boolean;
    /** 分组名（例如服务商）；同组的排在一起、组名做小标题，不同组里的同名模型分得清。 */
    group?: string;
    /** 分组键（服务商 id）：宿主给了 `ComposerView.groups` 时按它分组并取组的名字与图标，同名的两家分得开。 */
    groupId?: string;
    /** 用不了的原因（例如密钥没有设置）；有它时这一项灰掉、不能选，悬停看原因。 */
    unavailable?: string;
    /** 下面三项只在给了 `roles` 的选择器里显示。 */
    contextWindow?: number | null;
    reasoning?: boolean;
    /** 每百万 token 的输入、输出单价。 */
    price?: {input: number; output: number} | null;
};

/** 模型角色（`roles` 非空时输入框用带角色的选择器）。 */
export type ComposerRoleView = {
    /** 选中时作为 `modelKey` 交回，例如 `role:deep`。 */
    key: string;
    name: string;
    axis: "gradient" | "specialist";
    /** 绑定的模型的显示名；没绑定时为 null。 */
    modelLabel: string | null;
    /** 用不了的原因。仍然能选：选了之后输入框说明原因，绑定好了就能用。 */
    unavailable?: string;
    /** 角色自己的图标（内置角色有缺省图标，自建的可以挑）；缺省时选择器画通用图标。 */
    icon?: ComposerIcon;
    /** 绑定的模型的服务商图标。 */
    modelIcon?: ComposerIcon;
    /** 角色的默认思考档（`off` 或档位），写在行尾；没设为 null 或不写。 */
    effort?: string | null;
};

/** 审批模式的一项；`danger` 的（全部放行）选中时，输入框工具栏上的审批模式控件画成警告色。 */
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
    /** 模型角色；缺省或为空时选择器只列模型。 */
    roles?: ComposerRoleView[];
    /** 现在实际用的模型的显示名；解析不到时为 null。选了角色或跟随默认时，靠它知道用的是谁。 */
    effectiveModel?: string | null;
    /** 思考档位的取值，例如 `off`、`low`、`high`；常见取值由视图翻译，其余原样显示。 */
    thinkingLevels: string[];
    thinking: string | null;
    /** 思考档的完整状态；不给时按 `thinkingLevels` 与 `thinking` 推出（旧宿主不改）。 */
    effort?: ComposerEffortView;
    /** 模型库的分组；不给时按每个模型的 `group` 名分组。 */
    groups?: ComposerGroupView[];
    /** 第一项是普通模式；不是第一项时模式按钮用强调色。 */
    modes: ComposerModeView[];
    mode: string;
    /** 审批模式的菜单，和 `modes` 平行；缺省没有。 */
    approval?: {options: ComposerApprovalOption[]; value: string};
    /** 上次运行被中断：占位文字换掉，发送按钮换成继续，空着也能发。 */
    resume?: boolean;
    /** 宿主要说的一句，例如发送被拒的原因；显示在输入框上方。 */
    notice?: Text;
    /**
     * 排队的话（ui/agent-conversation-view.md 的排队区）。没有 `author` 的是用户自己的；`editable` 缺省为真；`held` 表示留着，
     * 原因文案由宿主写好。
     */
    queued: Array<{id: string; text: string; delivery: "steer" | "followup"; author?: {label: Text; icon: string}; editable?: boolean; removable?: boolean; held?: {reason: Text}}>;
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
    /** 累计命中率；服务商不报缓存时为 null。 */
    cacheHitRate: number | null;
    /** 最近一次模型回复的命中率；没有时为 null 或缺省。 */
    lastCacheHitRate?: number | null;
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
/** 上下文详情的数据（`context.refresh` 时宿主取；关了就放掉）。 */
export type ContextInspectionView =
    | {state: "idle" | "loading"}
    | {state: "unavailable"; reason: string}
    | {
        state: "ready";
        /** 下一次请求的估算，内核算的，不调模型。 */
        estimated: number;
        window: number;
        /** 到这里开始压缩。 */
        threshold: number;
        areas: {key: "system" | "tools" | "opening" | "history" | "turn"; tokens: number}[];
        slots: {name: string; extension: string; tokens: number; placed: boolean}[];
        diagnostics: {id: string; level: string; message: string}[];
    };

/** 系统提示词全文（`systemPrompt.load` 时才给）。 */
export type SystemPromptView = {text: string};

/** 分支树的数据（`tree.refresh` 时宿主分页读；关了就放掉）。 */
export type SessionTreeView =
    | {state: "loading"; loaded: number}
    | {state: "unavailable"; reason: string}
    | {state: "ready"; nodes: SessionTreeNodeView[]; activePath: string[]};

export type PanelsView = {
    contextInspection?: ContextInspectionView;
    systemPrompt?: SystemPromptView;
    sessionTree?: SessionTreeView;
};

/** 没有消息时第一屏的数据（视图的 `welcome` 属性，Spec 的“空状态”）；两块各只显示前 3 条。 */
export type AgentWelcomeView = {
    /** 欢迎的标题；不给时写“开始一段对话”。 */
    title?: string;
    /** 最近对话，最近的在前；`title` 为空时写“未命名会话”，`at` 是最近的活动时间。 */
    recent: ReadonlyArray<{id: string; title: string; at: number}>;
    /** “查看全部（N）”的 N。 */
    total: number;
    /** 开场指令。 */
    starters: ReadonlyArray<{text: string; icon?: string}>;
};

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
    /** 停靠区的界面状态（展开与否、看到第几个、各事项填了一半的答案），经 `dock.state` 交出、宿主原样放回；与 `wizardState` 分开。 */
    dockState?: JsonValue;
    /**
     * 进行中的调用的 `invocation`（后台子代理、后台命令）：含这些调用的轮次不自动收起，卡片的进度留在眼前。宿主算，集合没变就
     * 不换引用。
     */
    activeCalls?: readonly string[];
    /** 按工具调用 id 索引。 */
    workflows: {[toolCallId: string]: WorkflowView};
    workspaceChanges: WorkspaceChangesView;
    composer: ComposerView;
    usage: UsageSummaryView;
    connection: ConnectionView;
    panels: PanelsView;
    /** 宿主提供的当前时间（毫秒）。视图不自己计时，运行中的用时按它计算。 */
    now: number;
    /** 消息流里轮与轮之间的分隔线（同名 Spec 的“分轮视图”）；按会话给，不给时两种都不画。 */
    dividers?: DividersView;
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
    | {kind: "approval"; decision: "allow" | "allow-session" | "allow-always" | "deny"; note?: string}
    | {kind: "question"; answer: {text: string; data: {answers: JsonValue}}}
    | {kind: "mode-switch"; answer: {approved: boolean; approvalMode?: string; note?: string}};

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
    | {type: "composer.stop"; clearQueue?: boolean}
    | {type: "composer.draftChanged"; text: string}
    // 把一段文字放进输入框（第一屏的开场指令）：宿主换掉草稿、版本加一，编辑器才会显示它。`draftChanged` 方向相反，是编辑器报告用户打的字。
    | {type: "composer.fill"; text: string}
    | {type: "composer.attachmentAdded"; localId: string; kind: "image" | "file"; file: File}
    | {type: "composer.attachmentRetry"; localId: string}
    | {type: "composer.attachmentRemoved"; localId: string}
    | {type: "command.run"; name: string; argsText: string}
    /** 输入框自己处理了一条命令（`/model`）：宿主清掉草稿。 */
    | {type: "composer.commandHandled"}
    | {type: "menu.opened"; trigger: string}
    /** 确认了宿主菜单里的一项，标签已经插入；宿主做插入之外的事（例如问要不要初始化 Skill）。 */
    | {type: "menu.selected"; trigger: string; id: string}
    // 运行设置
    | {type: "mode.set"; mode: string}
    | {type: "model.set"; modelKey: string}
    | {type: "thinking.set"; level: string}
    /** 回到“跟随”：不再明确选档，用角色或模型的默认档。 */
    | {type: "thinking.reset"}
    | {type: "model.manage"}
    | {type: "runtime.reset"}
    // 提问
    | {
        type: "input.submit";
        batchKey: string;
        resolutions: InputResolution;
        /** 事项所在的会话；带 `source` 的事项（后代会话的）提交时有。 */
        sessionId?: string;
    }
    | {type: "input.cancelRun"}
    | {type: "wizard.state"; state: JsonValue}
    | {type: "dock.state"; state: JsonValue}
    | {type: "run.continue"}
    | {type: "queued.edit"; id: string}
    | {type: "queued.remove"; id: string}
    | {type: "approval.set"; mode: string}
    | {type: "input.resync"}
    // 恢复
    | {type: "availability.act"; action: string}
    | {type: "connection.reconnect"}
    // 状态栏：右键菜单里勾选一项、打开设置（宿主改用户设置、打开设置分区）
    | {type: "statusLine.toggle"; id: string}
    | {type: "statusLine.openSettings"}
    // 面板数据
    | {type: "attachments.query"; search: string; offset: number}
    | {type: "linkedAgents.refresh"}
    | {type: "systemPrompt.load"; refresh: boolean}
    | {type: "tree.refresh"}
    /** 分支树关了：宿主放掉数据。 */
    | {type: "tree.closed"}
    | {type: "tree.activate"; entryId: string}
    | {type: "tree.copyId"; entryId: string}
    | {type: "context.selectTrace"; traceId: string}
    | {type: "context.refresh"}
    /** 上下文详情关了：宿主放掉数据。 */
    | {type: "context.closed"}
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
    /** 会话面板：父会话的 id。父会话也在条目里时，这一行挂在它下面；父会话不在条目里的不列出。 */
    parentId?: string;
    /** 会话面板：它的子会话个数（宿主按未过滤的会话算），父会话行写“N 个子代理”。 */
    childCount?: number;
    /** 会话面板：它有后代在等用户（宿主按未过滤的会话算）；收起时写“子代理等你处理”。 */
    childWaiting?: boolean;
    /** 会话面板：它本身不符合筛选，只因为后代符合才列出（弱化显示，读屏说明它是上级）。 */
    dimmed?: boolean;
};

export type AgentSessionListState = "ready" | "loading" | "error";

/** 会话面板过滤菜单的一项（Profile）。 */
export type SessionPanelFilter = {id: string; label: string; icon?: string; active: boolean};

/** “消息”视图 bot 一页的一个联系人（AgentMessagesList.md）。 */
export type MessagesContact = {
    /** 在所有段里唯一（宿主拼贡献方与 id）。 */
    readonly key: string;
    readonly name: string;
    readonly avatar?: string;
    /** 未读数；还没数完为 null，不写。 */
    readonly unread: number | null;
    /** 第二行：在跑、等你处理，或平时（写最后一句话）。 */
    readonly activity: "idle" | "running" | "waiting";
    readonly last: {readonly text: string; readonly at: number} | null;
};

/** 一个贡献方的联系人：读到没有与读到的联系人。 */
export type MessagesContactSection = {
    readonly key: string;
    readonly state: {readonly kind: "loading"} | {readonly kind: "ready"} | {readonly kind: "failed"; readonly message: string};
    readonly contacts: readonly MessagesContact[];
};

/** 消息视图段里的一个最近会话：收着时画成写标题首字的方块。 */
export type MessagesRecentSession = {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
};
