/**
 * 宿主面：指令与查询、向外吐的帧、预览、诊断、`SessionEnv`、插件宿主。
 *
 * 与 NeuroBook 平台的对应（只对形状，不导入 nb-runtime）：每个指令是远程服务的一个 `write` 方法，`commandErrors` 里的码就是
 * 方法的 `errors`；写请求帧发出后链路断了得到路由层的“结果未知”，所以每个指令带 `commandId`，重发同一个得到同一个结果
 * （`commandAccepted`）。`frames` 是远程服务的一个事件，断线重连用 `log` 按 seq 补。
 */

import type {Attributed, Clock, Issuer, JsonValue, UserInput} from "./basics.js";
import type {CommandErrorTable, DiagnosticCode, DiagnosticLevel} from "./codes.js";
import type {Resources} from "./ctx.js";
import type {EntryPoint, InteractionDecision, KernelEvents, LogEvent, RunResultValue, SessionHeader, EventData} from "./events.js";
import type {AnyExtension, CompactionMethodImpl, ContributedExtension} from "./extension.js";
import type {ApprovalMode, CoreSettings, Message, ModelCaller, ModelErrorKind, ModelPort, ModelRequest, RequestBlock, RequestPurpose, StopReason, Usage} from "./model.js";
import type {AnyProfile} from "./profile.js";
import type {LogStore, StorageResult} from "./storage.js";
import type {ApprovalVerdict, ToolCall, ToolDeclaration, ToolEffect, ToolImplementation, ToolInfo} from "./tool.js";

// ====================================================================
// 指令
// ====================================================================

export type InputMode = "steer" | "followup";

/** 指令的参数与成功时的值（不含 `commandId`）。`value` 里引用的 id 都在受理批里写出。 */
export interface CommandMap {
    /** 入队，空闲时同时开始运行（对话框的发送按钮）；运行中回车是 followup，另一个操作是 steer。 */
    send: {args: {input: UserInput; mode?: InputMode}; value: {inputId: string; runId: string | null}};
    /** 只入队，不开始。 */
    enqueue: {args: {input: UserInput; mode: InputMode}; value: {inputId: string; position: number}};
    edit: {args: {inputId: string; input: UserInput}; value: {}};
    remove: {args: {inputId: string}; value: {}};
    /** 应答等用户的事项。`answer` 只给提问；`note` 是拒绝时附给模型的话。 */
    resolve: {args: {id: string; decision: "allow" | "allow-session" | "deny" | "answer"; answer?: {text: string; data?: JsonValue}; note?: string}; value: {}};
    /** 缓冲区空时是没有新输入的“继续”运行；末尾已是完整回复时失败 `nothing-to-continue`。 */
    start: {args: {}; value: {runId: string}};
    /** 幂等：没有运行时 `aborted: false`。缺省清空缓冲区，`keepQueue` 保留。 */
    abort: {args: {keepQueue?: boolean}; value: {aborted: boolean}};
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
}
export type CommandName = keyof CommandMap;
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
}
type DetailOf<C extends string> = C extends keyof CommandErrorDetails ? {detail: CommandErrorDetails[C]} : {detail?: undefined};

export interface CommandOk<T> {
    ok: true;
    value: T;
    /** 指令受理后日志的最新 seq：界面等订阅追到它再画，就读得到自己刚写的。 */
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

export interface InteractionSummary {
    id: string;
    callId: string;
    kind: "approval" | "question";
    request: JsonValue;
}

/** 运行到哪了。`aborting`、`compacting` 这类中间态不进日志，由服务端给。 */
export type RunStatus =
    | {state: "idle"}
    | {state: "running"; runId: string; turnId: string | null; phase: "reacting" | "requesting" | "streaming" | "tools" | "compacting"; request: number | null; pendingTools: string[]}
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
    /** 日志最新的 seq。订阅从这里往后接，不会漏也不会重。 */
    head: number;
    leaf: string | null;
    profile: {id: string; hash: string};
    extensions: ExtensionInfo[];
    status: RunStatus;
    buffer: BufferedInput[];
    settings: CoreSettings;
    title: string | null;
    archived: boolean;
    /** 会话为什么只读（Profile 解析不到、必需工具缺失、重新装配失败）；可写时为 null。 */
    readOnly: {code: "unknown-profile" | "tools-missing" | "dependency-missing" | "reassembly-failed"} | null;
    /** 插件装卸之后与当前装配不一致的部分；下一次空闲时自动重新装配。 */
    pendingReassembly: {added: string[]; removed: string[]} | null;
    diagnostics: {errors: number; warnings: number};
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
    /** 与 `node` 同一个父节点的兄弟（重试与 swipe 的结果）。 */
    siblings(args: {node: string}): Promise<{node: string; latestLeaf: string}[]>;
    runResult(args: {runId: string}): Promise<RunResult | null>;
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
    text: string;
}
export type Frame =
    /** 日志事件，seq 严格递增，权威。 */
    | {type: "log"; event: LogEvent}
    | DeltaFrame
    /** 不进日志的状态变化；`afterSeq` 说明它出现在哪条日志事件之后。 */
    | {type: "status"; status: RunStatus; afterSeq: number}
    | {type: "diagnostic"; diagnostic: Diagnostic}
    /** 服务端丢过帧或重启过：丢掉所有临时内容，用 `log` 补到 `head`。 */
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
}

/** 审批钩子看到的信息：工具声明、按参数求得的等级、核心设置、批准记忆。 */
export interface ApprovalInfo {
    readonly tool: ToolInfo;
    readonly effect: ToolEffect;
    readonly mode: ApprovalMode;
    readonly readOnly: boolean;
    /** “本会话都批准”过的工具 id。 */
    readonly remembered: readonly string[];
}
export interface ApprovalCtx {
    readonly signal: AbortSignal;
    readonly sessionId: string;
    readonly model: ModelCaller;
}
/** 工具拦截链的最里层：判定对象是全部拦截之后的调用。必填，没有缺省；“全部放行”只给测试用。 */
export type ApproveHook = (call: ToolCall, info: ApprovalInfo, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;

/**
 * 出站过滤：推帧与日志查询之前调用（nb-story 的防剧透）。返回 null 表示不给这个读者看。可以是异步的：内核按日志顺序
 * 逐条等、订阅的帧排队过滤，先后不变（docs/specs/harness/runtime.md 输出 54）。
 */
export interface OutboundFilter {
    event(event: LogEvent, reader: Issuer): LogEvent | null | Promise<LogEvent | null>;
    delta?(frame: DeltaFrame, reader: Issuer): DeltaFrame | null | Promise<DeltaFrame | null>;
}

export interface SessionEnv {
    readonly store: LogStore;
    readonly profiles: {resolve(key: string): AnyProfile | undefined | Promise<AnyProfile | undefined>};
    /** 插件经 `agent.extensions` 贡献的扩展（Profile 可按标签排除）。 */
    readonly extensions?: () => readonly ContributedExtension[];
    readonly models: ModelPort;
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
     * 压缩：方法表（按名字，Profile 的 `compaction` 给顺序）与压缩之后放回的内容（最近读过的文件、计划、Skill，
     * 每段一条给模型的文字）。不给时压缩方法都算没有，压缩总是失败（docs/specs/harness/runtime.md 输出 46–52）。
     */
    readonly compaction?: {
        readonly methods?: Readonly<Record<string, CompactionMethodImpl>>;
        /** `signal` 在运行被中止时触发；不理会它也不会挡住中止（内核不再等）。 */
        restore?(context: ToolSessionContext, signal: AbortSignal): Promise<readonly string[]> | readonly string[];
    };
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
    /** 等这次运行结束；写日志失败时以 `{reason: "error", error: {kind: "local", code: "log-broken"}}` 完成。 */
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
}
export type CreateSession = (env: SessionEnv, options: CreateSessionOptions) => Promise<StorageResult<SessionApi> | {ok: false; code: "profile-invalid" | "invalid-initial"}>;
export type OpenSession = (env: SessionEnv, id: string) => Promise<StorageResult<SessionApi>>;

/** 不带工具的单次请求：不读写会话日志；只接受不声明工具的 Profile。 */
export type Complete = (env: Pick<SessionEnv, "models" | "resources" | "clock" | "profiles">, options: {readonly profile: string; readonly input: UserInput; readonly initial?: JsonValue; readonly signal?: AbortSignal}) =>
    Promise<{ok: true; result: Omit<RunResult, "runId" | "entries">} | {ok: false; code: "profile-has-tools" | "unknown-profile" | "no-model" | "no-credentials"}>;

// ====================================================================
// 插件宿主：agent.extensions 贡献点
// ====================================================================

/** 清单里的声明：只放序列化得了的部分，内核不激活插件就能排序、按标签排除、画开关。 */
export interface ExtensionDeclaration {
    tags?: string[];
    dependsOn?: string[];
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
    create(options: CreateSessionOptions): Promise<StorageResult<SessionApi> | {ok: false; code: "profile-invalid" | "invalid-initial"}>;
    open(sessionId: string): Promise<StorageResult<SessionApi>>;
    close(sessionId: string): Promise<void>;
    /** 全局的诊断（装配、插件装卸）；会话里的诊断在 `SessionQueries.diagnostics`。 */
    diagnostics(): Diagnostic[];
}
