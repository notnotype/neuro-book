/**
 * 宿主面：指令与查询、向外吐的帧、预览、诊断、`SessionEnv`、插件宿主。
 *
 * 与宿主平台的对应（只对形状，不导入 nb-runtime）：每个指令是远程服务的一个 `write` 方法，`commandErrors` 里的码就是
 * 方法的 `errors`；写请求帧发出后链路断了得到路由层的“结果未知”，所以每个指令带 `commandId`，重发同一个得到同一个结果
 * （`commandAccepted`）。`frames` 是远程服务的一个事件，断线重连用 `log` 按 seq 补。
 */

import type {Attributed, Clock, Issuer, JsonValue, UserInput} from "./basics.js";
import type {CommandErrorTable, DiagnosticCode, DiagnosticLevel} from "./codes.js";
import type {Resources} from "./ctx.js";
import type {EntryPoint, HeldCause, InteractionDecision, KernelEvents, LogEvent, RunResultValue, SessionHeader, SessionOwner, EventData} from "./events.js";
import type {AnyExtension, CompactionMethodImpl, ContributedExtension} from "./extension.js";
import type {Spend, ApprovalMode, CoreSettings, EffortSource, Message, ModelCaller, ModelErrorKind, ModelReasoning, ModelPort, ModelRequest, ModelResolutionChoice, ModelResolutionCode, RequestBlock, RequestPurpose, StopReason, Usage} from "./model.js";
import type {AnyProfile} from "./profile.js";
import type {Contract, ExportsOfContract} from "./contract.js";
import type {LogStore, StorageResult} from "./storage.js";
import type {ApprovalVerdict, ToolCall, ToolDeclaration, ToolEffect, ToolImplementation, ToolInfo, ToolStatus} from "./tool.js";

// ====================================================================
// 指令
// ====================================================================

export type InputMode = "steer" | "followup";

/** 指令的参数与成功时的值（不含 `commandId`）。`value` 里引用的 id 都在受理批里写出。 */
export interface CommandMap {
    /** 入队，空闲时同时开始运行（对话框的发送按钮）；运行中回车是 followup，另一个操作是 steer。 */
    /**
     * `runId` 是这次开始或接着跑的运行，入队进在跑的运行时为 null，这时 `currentRunId` 是那次运行（runtime.md 输出 88）。
     */
    /**
     * `release` 是放行出来的话怎么跑（缺省 `keep`），`replaces` 是条件替换的留着的话（runtime.md 输出 105、107）；
     * `placement` 是这条话受理时的去向（输出 110）。
     */
    /** `settlePending: "deny"`：同一个受理批里先以 `deny` 结算路径上待处理的同步事项，只收用户（runtime.md 输出 111）。 */
    send: {args: {input: UserInput; mode?: InputMode; release?: ReleaseMode; replaces?: readonly {id: string; edits: number}[]; settlePending?: "deny"}; value: {inputId: string; runId: string | null; currentRunId?: string; placement: Placement}};
    /**
     * 入队。有运行在取输入时只入队；空闲时用户的入队等同 `send`（交回开的运行），会话、宿主的写成留着（输出 3）。
     * 会话有在跑或暂停的运行时 `currentRunId` 是它。
     */
    enqueue: {args: {input: UserInput; mode: InputMode}; value: {inputId: string; position: number; currentRunId?: string; runId?: string; placement: Placement}};
    /** 只放行、不送新话（输出 106）；空闲时开运行或接着跑中断与暂停的运行。 */
    resume: {args: {mode?: ReleaseMode}; value: {runId: string | null; released: string[]}};
    /** 按条放行（输出 107）。 */
    release: {args: {inputIds: string[]}; value: {runId: string | null; released: string[]}};
    edit: {args: {inputId: string; input: UserInput}; value: {}};
    remove: {args: {inputId: string}; value: {}};
    /** 交给会话一条提醒，下一次对话请求带上（runtime.md 输出 112）；只给会话与宿主。`replaced` 是被它替换掉的那条。 */
    /** `senderOnly`：只有发出者能撤回（后台任务的回执），用户身份撤回得 `not-allowed`（runtime.md 输出 112）。 */
    notice: {args: {text: string; key?: string; wake?: boolean; senderOnly?: boolean}; value: {noticeId: string; replaced?: string}};
    /** 撤回或取消一条还没取走的提醒：用户能取消任何一条，会话与宿主只能撤回自己发的。 */
    removeNotice: {args: {noticeId: string}; value: {}};
    /** 应答等用户的事项。`answer` 只给提问；`note` 是拒绝时附给模型的话。 */
    /** `runId`：受理后接着跑的运行（被叫醒的、开的或续的）；没有运行时不给（runtime.md 输出 88）。 */
    resolve: {args: {id: string; decision: "allow" | "allow-session" | "deny" | "answer"; answer?: {text: string; data?: JsonValue}; note?: string}; value: {runId?: string}};
    /** 缓冲区空时是没有新输入的“继续”运行；末尾已是完整回复时失败 `nothing-to-continue`。 */
    start: {args: {}; value: {runId: string}};
    /** 幂等：没有运行时 `aborted: false`。缺省清空缓冲区，`keepQueue` 保留。 */
    /** `runId`：只停这次运行，在跑的不是它时 `aborted: false`（runtime.md 输出 120）。 */
    abort: {args: {keepQueue?: boolean; runId?: string}; value: {aborted: boolean}};
    /** 回退到 `rewindTargets()` 给出的边界；运行中得 `running`，先 `abort`。`resend` 回退后入队并开始（编辑重发）。 */
    rewind: {args: {to: string | null; resend?: UserInput}; value: {leaf: string | null; inputId?: string; runId?: string}};
    /** 落到那条分支最近写入的末端。 */
    switchBranch: {args: {node: string}; value: {leaf: string}};
    /** 复制到 `leaf`（缺省当前叶子）为止的路径成新会话。 */
    fork: {args: {leaf?: string | null}; value: {sessionId: string}};
    compact: {args: {requirement?: string}; value: {scheduled: "now" | "next-boundary"; runId?: string}};
    /** 补丁按扩展 id 分组（核心设置组是 `core`）；整体校验，有一项不合法就都不改。运行中到下一个边界生效。 */
    changeSettings: {args: {patch: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>}; value: {changed: string[]; scheduled: "now" | "next-boundary"}};
    /** 空闲时。内容哈希没变时 `changed` 为 false，不写日志。 */
    changeProfile: {args: {profile: string}; value: {changed: boolean; hash: string; diagnostics: number}};
    setTitle: {args: {title: string}; value: {}};
    archive: {args: {archived: boolean}; value: {}};
    /** 宿主写自动生成的标题与说明，不进远程合同；最近一次标题是用户改的时不改标题，`titleApplied` 为 false（runtime.md 输出 72）。 */
    setGeneratedMeta: {args: {title?: string; description?: string}; value: {titleApplied: boolean}};
}
export type CommandName = keyof CommandMap;

/** 放行出来的话怎么跑：`keep` 各保持原模式，`followups` 都转成排队。 */
export type ReleaseMode = "keep" | "followups";

/** `send` 交回的话的去向（runtime.md 输出 110）。 */
export type Placement = "taken" | "later" | "held";

/** 一条输入的结局（`inputFate`）：被哪次运行取走、留着、被移除、还在缓冲区里就绪。 */
export type InputFate = {readonly taken: string | null} | {readonly held: HeldCause} | {readonly removed: string} | {readonly pending: true};
export type CommandErrorCode<K extends CommandName> = CommandErrorTable[K][number];

/** 按码给的失败详情；没列出的码没有 `detail`。 */
export interface CommandErrorDetails {
    "input-rejected": Attributed;
    "already-answered": {by: string; decision: InteractionDecision};
    "invalid-value": {extension: string; key: string; message: string};
    "unknown-key": {extension: string; key: string};
    "already-running": {runId: string};
    running: {runId: string};
    "dependency-missing": {extension: string; dependency: string};
    "nothing-to-release": {ids: string[]};
}
type DetailOf<C extends string> = C extends keyof CommandErrorDetails ? {detail: CommandErrorDetails[C]} : {detail?: undefined};

export interface CommandOk<T> {
    ok: true;
    value: T;
    /** 指令受理后日志的最新 seq：界面等订阅追到它（log 帧的 seq，或有过滤时 progress 帧的 through）再画，就读得到自己刚写的。 */
    seq: number;
    /** 同一个 `commandId` 重发时返回的是第一次的结果。 */
    replayed: boolean;
}
export type CommandFailure<C extends string> = C extends unknown ? {ok: false; code: C} & DetailOf<C> : never;
export type CommandResult<K extends CommandName> = CommandOk<CommandMap[K]["value"]> | CommandFailure<CommandErrorCode<K>>;

/** 界面与远程服务调用的指令。每个都要 `commandId`（客户端生成，重发同一个）。 */
export type SessionCommands = {
    [K in CommandName]: (args: CommandMap[K]["args"] & {commandId: string}) => Promise<CommandResult<K>>;
};

// ====================================================================
// 状态与查询
// ====================================================================

/**
 * 等用户的一个事项。不带请求原文：原文在 `interactionRequested` 事件里，经出站过滤；运行状态不经过滤，带着就会绕过它
 * （runtime.md 输出 54）。界面按 `callId` 把事项挂到工具调用上。
 */
export interface InteractionSummary {
    id: string;
    callId: string;
    kind: "approval" | "question";
}

/** 模型请求失败后在等重发（docs/specs/harness/runtime.md 输出 65）。`resumeAt` 是注入时钟上的毫秒。 */
export interface RetryWait {
    readonly attempt: number;
    readonly max: number;
    readonly resumeAt: number;
}

/** 运行到哪了。`aborting`、`compacting` 这类中间态不进日志，由服务端给。 */
export type RunStatus =
    | {state: "idle"}
    | {state: "running"; runId: string; turnId: string | null; phase: "requesting" | "streaming" | "tools" | "compacting"; request: number | null; retry?: RetryWait}
    | {state: "waiting"; runId: string; pending: InteractionSummary[]}
    | {state: "aborting"; runId: string}
    /** 写日志失败过：会话只能关闭后重开。 */
    | {state: "broken"; code: "log-broken"};

export interface BufferedInput {
    id: string;
    mode: InputMode;
    input: UserInput;
    /** 入队时的 seq，缓冲区按它排。 */
    queuedAt: number;
    edits: number;
    /** 会话或宿主以自己的身份发进来的；用户发的没有（runtime.md 输出 85）。 */
    by?: Issuer;
    /** 受理它的指令；旧日志没有。 */
    commandId?: string;
    /** 就绪的会被运行取走；留着的要放行（runtime.md 输出 103）。旧日志的条目都是就绪的。 */
    state: "ready" | "held";
    /** 留着的原因；只在留着时有。 */
    cause?: HeldCause;
    /** 停止时留下的停的人；只在留着、且是停止留下的时有。 */
    heldBy?: Issuer;
}

/** 待发的提醒（runtime.md 输出 112）：取走之前一直在快照里。 */
export interface PendingNotice {
    id: string;
    by: Issuer;
    key?: string;
    text: string;
    wake: boolean;
    /** 发出时的 seq，按它排。 */
    queuedAt: number;
    commandId?: string;
    /** 只有发出者能撤回。 */
    senderOnly?: true;
}

export interface ExtensionInfo {
    id: string;
    plugin: string | null;
    version: string;
    status: "active" | "revoked" | "failed";
    tags: string[];
}

export interface SessionSnapshot {
    sessionId: string;
    header: SessionHeader;
    /**
     * 日志最新的 seq。首屏与重连不漏不重的接法：先订阅、把帧攒着，再用 `log` 从 0（或已有的 seq）补到这一刻，
     * 丢掉攒着的帧里 seq 不大于补到的 `through` 的，其余按顺序接上。反过来先取 `head` 再订阅，中间写下的会漏。
     */
    head: number;
    leaf: string | null;
    profile: {id: string; hash: string};
    extensions: ExtensionInfo[];
    status: RunStatus;
    /** 这个会话累计的费用与 token。 */
    usage: Spend;
    /** 现在这个会话发对话请求会用哪个模型（runtime.md 输出 77）。 */
    model: {ok: true; id: string; contextWindow: number; efforts: readonly string[]; reasoning?: ModelReasoning; effectiveEffort?: string | null; effortSource?: EffortSource | null; /** 解析走的角色与它的默认档：“用默认”回到哪里由它们定，不看会话的选择。 */ role?: string; defaultEffort?: string} | ({ok: false; code: ModelResolutionCode} & ModelResolutionChoice);
    buffer: BufferedInput[];
    /** 待发的提醒，含正文；同缓冲区的输入，不经出站过滤（runtime.md 输出 118）。 */
    notices: PendingNotice[];
    /** 唤起的门（runtime.md 输出 117）；没有门事件的旧日志 `open: false`、`cause: null`。 */
    wakeGate: {open: boolean; cause: string | null};
    settings: CoreSettings;
    /** 扩展的设置，按扩展 id（Agent 模式这类）。 */
    extensionSettings: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
    title: string | null;
    /** 会话的一句话说明；没写过时为 null。 */
    description: string | null;
    archived: boolean;
    /** 会话为什么只读（Profile 解析不到、必需工具缺失、重新装配失败）；可写时为 null。 */
    readOnly: {code: "unknown-profile" | "tools-missing" | "dependency-missing" | "reassembly-failed"} | null;
    /** 插件装卸之后与当前装配不一致的部分；下一次空闲时自动重新装配。 */
    /** `profile`：Profile 的代码变了、要重新解析（`AgentHost.profilesChanged`）。 */
    pendingReassembly: {added: string[]; removed: string[]; profile?: true} | null;
    diagnostics: {errors: number; warnings: number};
}

/** 会话树的一个节点，只有结构（runtime.md 输出 80）。`label` 是经出站过滤后的文字开头，过滤掉的或没有文字的没有。 */
export interface TreeNode {
    id: string;
    parent: string | null;
    type: string;
    seq: number;
    label?: string;
}

/** 有多于一个孩子的节点（runtime.md 输出 81）。 */
export interface BranchPoint {
    parent: string | null;
    children: {node: string; latestLeaf: string}[];
}

/** `missing`：地址读不到（会话被删了）。`unusable`：读到了但发不了（损坏、格式不支持），`reason` 写进诊断。 */
export type AttachmentRead =
    | {readonly data: string; readonly mime: string; readonly width?: number; readonly height?: number}
    | {readonly missing: true}
    | {readonly unusable: string};

export interface AttachmentPort {
    read(uri: string, options: {readonly signal: AbortSignal}): Promise<AttachmentRead>;
}

export interface RewindTarget {
    /** 传给 `rewind` 的 id。 */
    id: string;
    kind: "before-turn" | "after-turn" | "after-step";
    turnId: string;
    /** 目标处的用户的话（`before-turn` 时是被回退掉的那一条），给界面显示。 */
    inputText: string | null;
}

/** 一次运行的结果（master `TurnResult` 的等价物）。 */
export interface RunResult {
    runId: string;
    reason: EventData<KernelEvents["runEnded"]>["reason"];
    /** 最后一条回复的停止原因；运行以收尾工具结束时为 `finished`。 */
    stopReason: Exclude<StopReason, "tool"> | "finished";
    /** 最后一条回复的文字。 */
    text: string;
    result: RunResultValue | null;
    error: {kind: ModelErrorKind; code?: string; message?: string} | null;
    /** 本次运行的 `assistant` 与 `modelEnded` 的用量之和。 */
    usage: Usage;
    /** 本次运行写下的事件 seq 范围。 */
    entries: {first: number; last: number};
}

export interface SessionQueries {
    snapshot(): Promise<SessionSnapshot>;
    /**
     * 按 seq 分页补日志，重连与首次加载共用；经出站过滤。`head`、`more` 按读取开始的那一刻算；`through` 是这一页扫描到的
     * 最后一条 seq（被过滤掉的也算），下一页传 `afterSeq: through`。`limit` 缺省 500，取整后夹在 1 到 2000 之间（远程层原样转来的
     * 0、负数与小数不会让分页跳过事件）。
     */
    log(args: {afterSeq: number; limit?: number}): Promise<{events: LogEvent[]; head: number; more: boolean; through: number}>;
    rewindTargets(): Promise<RewindTarget[]>;
    /** 从根到 `leaf`（缺省当前叶子）的路径上的事件。 */
    path(args?: {leaf?: string | null}): Promise<LogEvent[]>;
    /** 按 seq 分页读整棵树的结构，不读事件全文。 */
    treeNodes(args?: {afterSeq?: number; limit?: number}): Promise<{nodes: TreeNode[]; more: boolean; through: number}>;
    branchPoints(): Promise<BranchPoint[]>;
    /** 与 `node` 同一个父节点的兄弟（重试与 swipe 的结果）。 */
    siblings(args: {node: string}): Promise<{node: string; latestLeaf: string}[]>;
    runResult(args: {runId: string}): Promise<RunResult | null>;
    /** 一条输入的结局（runtime.md 输出 110）；不是这个会话里入过队的为 null。不经出站过滤。 */
    inputFate(args: {inputId: string}): Promise<InputFate | null>;
    preview(args?: PreviewArgs): Promise<PreviewResult>;
    diagnostics(args?: {afterSeq?: number; extension?: string; level?: DiagnosticLevel}): Promise<Diagnostic[]>;
}

// ====================================================================
// 帧
// ====================================================================

/** 流式增量的一块。不进日志、不算状态；丢了不影响正确性，`assistant` 事件会带来完整回复。 */
export interface DeltaFrame {
    type: "delta";
    request: number;
    /** 发出这次请求的用途：只有 `turn` 是助手的回复，界面画“正在生成的那条”只认它。 */
    purpose: RequestPurpose;
    /** 交给这个订阅者的第几块，同一个 request 里从 1 起递增，出站过滤丢掉的不占号；界面发现不连续就丢掉这条回复的临时内容，等 `assistant` 事件。 */
    n: number;
    part: "text" | "thinking" | "toolArgs";
    callId?: string;
    /** `toolArgs` 的第一块带工具 id（runtime.md 输出 76）。 */
    tool?: string;
    text: string;
}
export type Frame =
    /** 日志事件，seq 严格递增，权威。 */
    | {type: "log"; event: LogEvent}
    | DeltaFrame
    /** 不进日志的状态变化；`afterSeq` 说明它出现在哪条日志事件之后。 */
    | {type: "status"; status: RunStatus; afterSeq: number}
    /** 一个工具调用执行完了（runtime.md 输出 76）。权威仍是这批调用的 `toolResult`：它们要等整批结束才一起写下。 */
    | {type: "tool"; callId: string; status: ToolStatus}
    | {type: "diagnostic"; diagnostic: Diagnostic}
    /**
     * 有出站过滤时，一条事件不给这个读者看：订阅已经扫到 `through`。界面等指令的 `seq`（`CommandOk.seq`）时，log 帧的 seq
     * 或这里的 `through` 追到它就算追上；也用它区分“被滤掉”与“丢了帧”。
     */
    | {type: "progress"; through: number}
    /** 远程层用：服务端丢过帧或重启过，丢掉所有临时内容，用 `log` 补到 `head`。进程内的订阅不会收到。 */
    | {type: "reset"; head: number};

// ====================================================================
// 预览
// ====================================================================

export interface PreviewArgs {
    /** 缺省：当前叶子上的下一次请求。 */
    leaf?: string | null;
    /** 过去的某一次请求（`modelStarted.request`）；第一版不支持，得 `fidelity` 之外的失败。 */
    atRequest?: number;
}

/**
 * 改动的位置。消息按两边相同的前缀与后缀对齐：中间多出来的是插入、少了的是删除（`{area: "messages", message}`，
 * 插入记交出的请求里的下标，删除记收到的请求里的下标），两边都有的逐条比较内容块（`block`）与消息的其余字段（`field`）。
 * 重排表现为删除加插入。`request` 是顶层除系统、消息、参数、头与工具之外的字段。
 */
export type RequestPath =
    | {area: "system"; index: number}
    | {area: "messages"; message: number}
    | {area: "messages"; message: number; block: number}
    | {area: "messages"; message: number; field: "role" | "toolCalls" | "callId" | "isError" | "model"}
    | {area: "params"; key: string}
    | {area: "headers"; key: string}
    | {area: "tools"; index: number}
    | {area: "request"; key: "purpose" | "model" | "effort" | "toolChoice" | "providerOptions"};

/** 模型拦截链对请求做的一处改动：内核比较拦截前后的请求得出，不要求拦截自己报。 */
export interface RequestChange {
    extension: string;
    path: RequestPath;
    op: "replace" | "insert" | "remove";
    before?: RequestBlock | Message | JsonValue;
    after?: RequestBlock | Message | JsonValue;
}

export interface SlotReport {
    name: string;
    extension: string;
    stable: boolean;
    placed: boolean;
    tokens: number;
}

export interface PreviewResult {
    /** `next`：下一次会发的请求；`exact`、`reconstructed` 留给预览过去请求的可选片。 */
    fidelity: "next" | "exact" | "reconstructed";
    hashMatches?: boolean;
    /** 最终请求（拦截之后）。 */
    request: ModelRequest;
    /** 视图直接算出来的，拦截之前。 */
    original: ModelRequest;
    changes: RequestChange[];
    slots: SlotReport[];
    /** 没参与这次预览的扩展：已摘下的、失败的。 */
    skipped: {extension: string; reason: "revoked" | "failed"}[];
    tokens: {estimated: number; window: number; threshold: number; byArea: {system: number; opening: number; history: number; turn: number; tools: number}};
    diagnostics: Diagnostic[];
}

// ====================================================================
// 诊断
// ====================================================================

export interface Diagnostic {
    /** 同一个（码、扩展、入口、事件类型）的合并键。 */
    id: string;
    level: DiagnosticLevel;
    code: DiagnosticCode;
    extension: string | null;
    entry: EntryPoint | "assembly" | "storage" | "host";
    event?: {id: string; type: string; seq: number};
    request?: number;
    /** 结构化参数（槽名、片名、限时……），界面本地化时代入。 */
    params: Record<string, string | number | boolean>;
    /** 英文，给开发者读，不用来分支。 */
    message: string;
    /** 英文，下一步该做什么。 */
    hint?: string;
    cause?: {name: string; message: string; stack?: string};
    count: number;
    firstSeq: number;
    lastSeq: number;
    /** 是否也写成了 `extensionFailed` 事件（重启后还看得到）。 */
    persisted: boolean;
}

// ====================================================================
// SessionEnv：宿主注入
// ====================================================================

/** 工具在一个会话里的上下文：声明每个边界取一次，实现每个会话每个工具建一次、懒建。 */
export interface ToolSessionContext {
    readonly sessionId: string;
    readonly profile: string;
    readonly project?: string;
    /** 后台会话：没有人在看，工具不要等用户回答。 */
    readonly background?: true;
    /** 会话头的归属（session.md 输出 25）；fork 出来的与子会话没有。 */
    readonly owner?: SessionOwner;
}

/** 审批钩子看到的信息：工具声明、按参数求得的等级、核心设置、批准记忆。 */
export interface ApprovalInfo {
    readonly tool: ToolInfo;
    readonly effect: ToolEffect;
    readonly mode: ApprovalMode;
    readonly readOnly: boolean;
    /** “本会话都批准”过的工具 id。 */
    readonly remembered: readonly string[];
    /** “本会话都批准”记下的规则，原样（`scope: "rule"` 的 `approvalRemembered`）。 */
    readonly rememberedRules: readonly JsonValue[];
    /** 这是一次嵌套调用（runtime.md 输出 92）：父调用的工具与 `invocation`，钩子据此在询问里写明来源。 */
    readonly within?: {readonly tool: string; readonly invocation: string};
}
export interface ApprovalCtx {
    readonly signal: AbortSignal;
    readonly sessionId: string;
    /** 与工具拿到的同一份：钩子要展开地址时按它算。 */
    readonly context: ToolSessionContext;
    readonly model: ModelCaller;
    /** 读某个扩展的导出（例如会话处在计划模式），判定这一刻的值：重判时要看到中途改的设置，所以不是 `ToolContext.read` 那份批开始时的快照；没装时 undefined。 */
    read<C extends Contract<string, any, any>>(contract: C): ExportsOfContract<C> | undefined;
}
/** 工具拦截链的最里层：判定对象是全部拦截之后的调用。必填，没有缺省；“全部放行”只给测试用。 */
export type ApproveHook = (call: ToolCall, info: ApprovalInfo, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;

/**
 * 出站过滤：推帧与日志查询之前调用（nb-story 的防剧透）。返回 null 表示不给这个读者看。可以是异步的：内核按日志顺序
 * 逐条等、订阅的帧排队过滤，先后不变（docs/specs/harness/runtime.md 输出 54）。
 */
export interface OutboundFilter {
    /** 换内容用 `mapEventContent`：它按字段走遍内核事件里带内容的地方，宿主只写对一段文字怎么办。 */
    event(event: LogEvent, reader: Issuer, context: OutboundContext): LogEvent | null | Promise<LogEvent | null>;
    delta?(frame: DeltaFrame, reader: Issuer, context: DeltaContext): DeltaFrame | null | Promise<DeltaFrame | null>;
}
/** 过滤时可查的东西：一个宿主常给多个会话共用一个过滤器，不必自己按会话记状态。 */
export interface OutboundContext {
    readonly sessionId: string;
    /** 一次工具调用实际执行的参数（有 `toolStarted` 时用它，否则用回复里的）：过滤工具结果时按调用查，从中途开始读也查得到。 */
    toolCall(callId: string): {readonly tool: string; readonly args: Readonly<Record<string, JsonValue>>} | undefined;
}
export interface DeltaContext extends OutboundContext {
    /** 这个订阅者此前收到的同一次请求、同一部分（`toolArgs` 按调用分）的原文：一个词拆在两块里时拼起来查。 */
    readonly before: string;
}

/** 模型请求的重发（docs/specs/harness/runtime.md 输出 62）。 */
export interface RetryPolicy {
    /** 一次请求最多再发几次；0 表示不重发。 */
    readonly maxRetries: number;
}

export interface SessionEnv {
    readonly store: LogStore;
    readonly profiles: {resolve(key: string): AnyProfile | undefined | Promise<AnyProfile | undefined>};
    /** 插件经 `agent.extensions` 贡献的扩展（Profile 可按标签排除）。 */
    readonly extensions?: () => readonly ContributedExtension[];
    readonly models: ModelPort;
    /** 读用户附件的图片（runtime.md 输出 82）：交回能发给模型的样子（缩放由宿主做）。没有时图片换一行文字。 */
    readonly attachments?: AttachmentPort;
    /** 每次失败时现读，设置改了下一次失败就生效。不给就不重发。 */
    readonly retry?: () => RetryPolicy;
    readonly tools: {
        declarations(context: ToolSessionContext): readonly ToolDeclaration[];
        create(id: string, context: ToolSessionContext): ToolImplementation | Promise<ToolImplementation>;
    };
    readonly resources: (context: ToolSessionContext) => Resources;
    /** 本进程已打开的会话；没开则由宿主打开并登记。多 Agent 的“交给目标会话的写入队列”经它。 */
    readonly sessions: {get(id: string, issuer: Issuer): Promise<SessionApi>};
    readonly clock: Clock;
    readonly approve: ApproveHook;
    readonly outbound?: OutboundFilter;
    /**
     * 压缩：方法表（按名字）、缺省顺序（Profile 的 `compaction` 写了的优先）与压缩之后放回的内容（最近读过的文件、计划，
     * 每段一条给模型的文字）。不给时压缩方法都算没有，压缩总是失败（docs/specs/harness/runtime.md 输出 46–52）。
     */
    readonly compaction?: {
        readonly methods?: Readonly<Record<string, CompactionMethodImpl>>;
        readonly order?: {readonly onThreshold?: readonly string[]; readonly onOverflow?: readonly string[]};
        restore?(context: ToolSessionContext, args: CompactionRestoreArgs): Promise<CompactionRestored> | CompactionRestored;
    };
}

/** 放回时知道的这次压缩的情况（docs/specs/harness/runtime.md 输出 48）。 */
export interface CompactionRestoreArgs {
    /** 在运行被中止时触发；不理会它也不会挡住中止（内核不再等）。 */
    readonly signal: AbortSignal;
    readonly method: string;
    readonly replacement: string | null;
    /** 压缩前的路径。 */
    readonly path: readonly LogEvent[];
    /** 这次压缩按哪个模型算的窗口；未知是 0。 */
    readonly contextWindow: number;
    /**
     * 压缩前路径上的这条事件在压缩之后是否仍在上下文里（runtime.md 输出 48）：在保留的切点之后、没被省略。宿主用它跳过仍在上下文
     * 里的内容，不放第二份。
     */
    readonly kept: (entryId: string) => boolean;
}

export interface CompactionRestored {
    /** 每段一条给模型的文字。 */
    readonly notices: readonly string[];
    /** 放回了什么，写进 `compaction` 事件给界面看；不进请求。 */
    readonly restored?: JsonValue;
}

// ====================================================================
// 会话
// ====================================================================

/** 一个会话对外的全部：指令、查询、订阅。远程服务就是把它逐个方法暴露出去。 */
export interface SessionApi extends SessionCommands, SessionQueries {
    readonly id: string;
    /** 当前视图的发出者（缺省用户）。 */
    readonly issuer: Issuer;
    /** 带另一个发出者的视图（父会话应答提问时用）。 */
    as(issuer: Issuer): SessionApi;
    /** 进程内订阅（远程服务里是 `frames` 事件）。 */
    subscribe(listener: (frame: Frame) => void): () => void;
    /**
     * 等这次运行结束。句柄坏了（写日志失败）时：日志里已有这次运行的收口就交回它，否则以
     * `{reason: "error", error: {kind: "local", code: "log-broken"}}` 完成（harness/runtime.md 输出 13）。
     */
    waitRun(runId: string): Promise<RunResult>;
}

export interface CreateSessionOptions {
    readonly profile: string;
    readonly initial?: JsonValue;
    readonly project?: string;
    readonly caller?: SessionHeader["caller"];
    readonly questions?: SessionHeader["questions"];
    /** 运行结果的 schema；Profile 声明了的不必再给。 */
    readonly result?: SessionHeader["result"];
    readonly id?: string;
    /** 后台会话：写进会话头，列表缺省不列（`agent.startTask`）。 */
    readonly background?: boolean;
    /** 归属（session.md 输出 25）：照写进会话头；不合规则得 `invalid-owner`，不落盘。宿主负责按调用方盖章。 */
    readonly owner?: SessionOwner;
}
export type CreateSession = (env: SessionEnv, options: CreateSessionOptions) => Promise<StorageResult<SessionApi> | {ok: false; code: "profile-invalid" | "invalid-initial" | "invalid-owner"}>;
export type OpenSession = (env: SessionEnv, id: string) => Promise<StorageResult<SessionApi>>;

/** 不带工具的单次请求：不读写会话日志；只接受不声明工具的 Profile。 */
export type Complete = (env: Pick<SessionEnv, "models" | "resources" | "clock" | "profiles" | "retry">, options: {readonly profile: string; readonly input: UserInput; readonly initial?: JsonValue; readonly signal?: AbortSignal}) =>
    Promise<{ok: true; result: Omit<RunResult, "runId" | "entries">} | {ok: false; code: "profile-has-tools" | "unknown-profile" | ModelResolutionCode}>;

// ====================================================================
// 插件宿主：agent.extensions 贡献点
// ====================================================================

/** 清单里的声明：只放序列化得了的部分，内核不激活插件就能排序、按标签排除、画开关。 */
export interface ExtensionDeclaration {
    tags?: string[];
    dependsOn?: string[];
    /** `on-request`：不自动装，Profile 按 id 引用（`referencedExtensions`）才装（extensions.md 的“按需扩展”）。 */
    install?: "on-request";
}
/** 平台 `ContributionHandle` 的对应：`implementation()` 在撤回后抛错，宿主不缓存它。 */
export interface ExtensionHandle {
    id: string;
    plugin: string;
    declaration: ExtensionDeclaration;
    implementation(): AnyExtension;
}
export type RevokeReason = "deactivated" | "uninstalled" | "activation-failed";

/** `agent.extensions` 的接收者。 */
export interface ExtensionReceiver {
    /** 事务里预占：id 格式与前缀、重复、依赖成环在这里否决，整个插件的激活随之失败。 */
    prepare(handle: ExtensionHandle): void;
    /** 生效：之后新开的会话装上它；已打开的会话进 `pendingReassembly`。 */
    published(handle: ExtensionHandle): void;
    /**
     * 撤回，幂等。运行中的会话这次运行里调它的入口得 `extension-revoked` 诊断并跳过，空闲时重新装配。交回的 Promise 在各会话
     * 摘下它（清理函数跑完；运行中的等这次运行结束）或关闭之后完成，平台在这之后释放插件自己的资源。
     */
    revoke(handle: ExtensionHandle, reason: RevokeReason): Promise<void>;
}

export interface AgentHost {
    readonly extensions: ExtensionReceiver;
    list(): ExtensionInfo[];
    create(options: CreateSessionOptions): Promise<StorageResult<SessionApi> | {ok: false; code: "profile-invalid" | "invalid-initial" | "invalid-owner"}>;
    open(sessionId: string): Promise<StorageResult<SessionApi>>;
    /** 只读会话头（session.md 输出 26）：不打开会话、不取锁；交回的会话头深冻结。 */
    header(sessionId: string): Promise<StorageResult<SessionHeader>>;
    /** `reason: "interrupted"`：进程或插件停止时的收口，运行写 `interrupted`（runtime.md 输出 53）。 */
    close(sessionId: string, options?: {readonly reason?: "interrupted"}): Promise<void>;
    /**
     * 这些 key 的 Profile 代码变了或提供方撤回了：用它们的打开着的会话重新调 `profiles.resolve`、重新装配。哈希变了写
     * `profileChanged{code-updated}`，没变也换上新对象；解析不到进只读 `unknown-profile`，回来后再调一次即解除。运行中的等
     * 这次运行结束。交回的 Promise 在各会话做完后完成。
     */
    profilesChanged(keys: readonly string[]): Promise<void>;
    /** 全局的诊断（装配、插件装卸）；会话里的诊断在 `SessionQueries.diagnostics`。 */
    diagnostics(): Diagnostic[];
}
