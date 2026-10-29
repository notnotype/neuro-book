/**
 * 宿主侧的公开接口：界面与远程服务调用的命令和查询、向外吐的帧、预览、诊断、插件宿主。
 *
 * 与 NeuroBook 现有平台的对应（只对形状，没有导入 nb-runtime）：
 * - 每个命令是远程服务的一个 `write` 方法，`commandErrors` 里的码就是方法的 `errors`；写请求帧发出后链路断了得到
 *   路由层的 `unknown-outcome`，所以每个命令带 `commandId`，重发同一个 id 得到同一个结果（它就是日志事件的幂等键）。
 * - `frames` 是远程服务的一个事件（payload 是 `Frame`，filter 是 `{sessionId}`）；断线重连用 `log` 按 seq 补。
 * - 程序按码分支，不按文字；`message` 与 `hint` 是英文的开发者文字，界面按“拥有者 + 码”取本地化文案（ADR 0034）。
 */

import type {Attributed, Block, EntryPoint, Event, Extension, FailureCode, KernelEvents, ModelRequest, Origin, Rejection, ToolStatus, UserInput} from "./api.ts";

// ====================================================================
// 1. 命令
// ====================================================================

export type InputMode = "steer" | "followup";

/**
 * 每个命令可能返回的业务失败码，同时是远程方法 `errors` 的来源。
 * 取舍：界面里“手快会撞上”的命令（abort、remove 已经被取走的）要么幂等、要么给出可以区分的码，不让界面解析文字。
 */
export const commandErrors = {
    send: ["empty-input", "input-too-large", "no-model", "no-credentials", "profile-invalid", "session-closed"],
    enqueue: ["empty-input", "input-too-large", "session-closed"],
    edit: ["empty-input", "input-too-large", "input-not-found", "input-consumed", "session-closed"],
    remove: ["input-not-found", "input-consumed", "session-closed"],
    start: ["already-running", "no-model", "no-credentials", "profile-invalid", "session-closed"],
    abort: ["session-closed"],
    rewind: ["running", "unknown-node", "invalid-target", "empty-input", "session-closed"],
    compact: ["nothing-to-compact", "no-compaction-model", "session-closed"],
    changeSettings: ["unknown-extension", "unknown-key", "invalid-value", "session-closed"],
    changeProfile: ["running", "unknown-profile", "extension-missing", "dependency-cycle", "profile-invalid", "session-closed"],
} as const;

/** 命令的参数与成功时的值（不含 commandId，它由 SessionCommands 统一加上）。 */
export interface CommandMap {
    /** 入队，空闲时同时开始运行（对话框的发送按钮）。运行中回车是 followup，另一个操作是 steer。 */
    send: {args: {input: UserInput; mode?: InputMode}; value: {inputId: string; startedRun: boolean}};
    /** 只入队，不开始。 */
    enqueue: {args: {input: UserInput; mode: InputMode}; value: {inputId: string; position: number}};
    edit: {args: {inputId: string; input: UserInput}; value: {}};
    remove: {args: {inputId: string}; value: {}};
    /** 缓冲区空时是没有新输入的“继续”运行。 */
    start: {args: {}; value: {runId: string}};
    /** 幂等：没有运行时返回 aborted: false，不是错误。 */
    abort: {args: {}; value: {aborted: boolean}};
    /**
     * 回退到某个目标（`rewindTargets` 给出的轮或步的边界）。运行中要 `abort: true` 才受理：先中止、等收口、再回退，
     * 在同一个写入队列里做。`resend` 给了就在回退后把它入队并开始运行（“编辑以前的话再发”）。
     */
    rewind: {args: {to: string | null; abort?: boolean; resend?: UserInput}; value: {leaf: string | null; inputId?: string}};
    compact: {args: {requirement?: string}; value: {scheduled: "now" | "next-boundary"}};
    /** 补丁按扩展 id 分组：{"leader.default": {questionStrategy: "concise"}}；整体校验，有一项不合法就都不改。 */
    changeSettings: {args: {patch: Record<string, Record<string, unknown>>}; value: {changed: string[]}};
    /** 空闲时。换 Profile 或插件清单变了之后重新装配；内容哈希没变时 changed 为 false，不写日志。 */
    changeProfile: {args: {profile: string}; value: {changed: boolean; hash: string; diagnostics: number}};
}
export type CommandName = keyof CommandMap;
export type CommandErrorCode<K extends CommandName> = (typeof commandErrors)[K][number];

export type CommandDetail = Record<string, string | number | boolean | null>;
export interface CommandOk<T> {
    ok: true;
    value: T;
    /** 命令受理后日志的最新 seq：界面等订阅追到这个 seq 再画，就读得到自己刚写的。 */
    seq: number;
    /** 同一个 commandId 重发，返回的是第一次的结果。 */
    replayed?: true;
}
export interface CommandFailure<C extends string> {
    ok: false;
    code: C;
    detail?: CommandDetail;
}
export type CommandResult<K extends CommandName> = CommandOk<CommandMap[K]["value"]> | CommandFailure<CommandErrorCode<K>>;

/** 界面与远程服务调用的命令。每个都要 commandId（客户端生成，重发同一个）。 */
export type SessionCommands = {
    [K in CommandName]: (args: CommandMap[K]["args"] & {commandId: string}) => Promise<CommandResult<K>>;
};

// ====================================================================
// 2. 状态与查询
// ====================================================================

/** 运行到哪了。大部分能从日志推出来，`aborting` 与 `compacting` 的中间态不进日志，所以由服务端给。 */
export type RunStatus =
    | {state: "idle"}
    | {state: "running"; runId: string; turnId: string | null; phase: "reacting" | "requesting" | "streaming" | "tools" | "compacting"; request: number | null; pendingTools: string[]}
    | {state: "aborting"; runId: string};

export interface BufferedInput {
    id: string;
    mode: InputMode;
    input: UserInput;
    /** 入队时的 seq，缓冲区按它排。 */
    queuedAt: number;
    /** 被改过几次。 */
    edits: number;
}

export interface ExtensionInfo {
    id: string;
    plugin: string | null;
    status: "active" | "revoked" | "failed";
    tags: string[];
}

export interface SessionSnapshot {
    sessionId: string;
    /** 日志最新的 seq。订阅从这里往后接，不会漏也不会重。 */
    head: number;
    leaf: string | null;
    profile: {id: string; hash: string};
    extensions: ExtensionInfo[];
    status: RunStatus;
    buffer: BufferedInput[];
    /** 插件装卸之后与当前装配不一致的部分；下一次空闲时自动重新装配（写 profileChanged），或界面调 changeProfile。 */
    pendingReassembly: {added: string[]; removed: string[]} | null;
    diagnostics: {errors: number; warnings: number};
}

export interface RewindTarget {
    /** 传给 rewind 的 id。 */
    id: string;
    kind: "before-turn" | "after-turn" | "after-step";
    turnId: string;
    /** 目标处的用户的话（before-turn 时是被回退掉的那一条），给界面显示。 */
    inputText: string | null;
}

export interface SessionQueries {
    snapshot(): Promise<SessionSnapshot>;
    /** 按 seq 补日志，重连与首次加载共用。 */
    log(args: {afterSeq: number; limit?: number}): Promise<{events: Event[]; head: number; more: boolean}>;
    rewindTargets(): Promise<RewindTarget[]>;
    preview(args?: PreviewArgs): Promise<PreviewResult>;
    diagnostics(args?: {afterSeq?: number; extension?: string; level?: Diagnostic["level"]}): Promise<Diagnostic[]>;
}

// ====================================================================
// 3. 向外吐的帧
// ====================================================================

/** 流式增量的一块。不进日志、不算状态；丢了不影响正确性，因为 `assistant` 事件会带来完整回复。 */
export interface DeltaFrame {
    type: "delta";
    /** 与 modelStarted.request、assistant.request 对应。 */
    request: number;
    /** 同一个 request 里从 1 起递增；界面发现不连续就丢弃这条回复的临时内容，等 assistant 事件。 */
    n: number;
    part: "text" | "thinking" | "toolArgs";
    /** part 是 toolArgs 时是正在组装的工具调用。 */
    callId?: string;
    text: string;
}
export type Frame =
    /** 日志事件，seq 严格递增。权威。 */
    | {type: "log"; event: Event}
    | DeltaFrame
    /** 不进日志的状态变化（aborting、phase）。afterSeq 说明它出现在哪条日志事件之后。 */
    | {type: "status"; status: RunStatus; afterSeq: number}
    | {type: "diagnostic"; diagnostic: Diagnostic}
    /** 服务端丢过帧或重启过：丢掉所有临时内容与未确认的状态，用 log 补到 head。 */
    | {type: "reset"; head: number};

/** 订阅（远程事件的 filter）。 */
export interface FrameFilter {
    sessionId: string;
}

// ====================================================================
// 4. 预览
// ====================================================================

export interface PreviewArgs {
    /** 缺省：当前叶子上的下一次请求。 */
    leaf?: string | null;
    /** 看过去的某一次请求（modelStarted.request）：没录制时由日志重建，fidelity 说明可信程度。 */
    atRequest?: number;
}

export type RequestPath =
    | {area: "system"; index: number}
    | {area: "messages"; message: number; block: number}
    | {area: "params"; key: string}
    | {area: "headers"; key: string}
    | {area: "tools"; index: number};

/** 模型拦截链对请求做的一处改动。内核比较拦截前后的块（块不可变，按引用比），不要求拦截器自己报。 */
export interface RequestChange {
    extension: string;
    path: RequestPath;
    op: "replace" | "insert" | "remove";
    before?: Block | string;
    after?: Block | string;
}

export interface SlotReport {
    name: string;
    extension: string;
    stable: boolean;
    placed: boolean;
    tokens: number;
}

export interface PreviewResult {
    /**
     * next：下一次会发的请求（预览实际跑一遍视图与模型拦截链，最里层截下）；
     * exact：过去的请求，有录制，逐字相同；
     * reconstructed：过去的请求，由日志按当时的设置重建，`hashMatches` 说明与 modelStarted.hash 是否一致。
     */
    fidelity: "next" | "exact" | "reconstructed";
    hashMatches?: boolean;
    /** 最终请求（拦截之后）。 */
    request: ModelRequest;
    /** 视图直接算出来的，拦截之前。 */
    original: ModelRequest;
    changes: RequestChange[];
    slots: SlotReport[];
    /** 没参与这次预览的扩展：preview: "skip" 的、已摘下的、失败的。预览不完整时界面要说。 */
    skipped: {extension: string; reason: "preview-skip" | "revoked" | "failed"}[];
    tokens: {estimated: number; window: number; threshold: number; byArea: {system: number; opening: number; history: number; turn: number; tools: number}};
    diagnostics: Diagnostic[];
}

// ====================================================================
// 5. 诊断
// ====================================================================

/** 诊断码：key 是码，值是缺省级别。程序按码分支（ADR 0034）。 */
export const diagnosticCodes = {
    // 归约
    "reduce-threw": "error",
    "state-not-plain": "error",
    // 处理函数
    "handler-threw": "error",
    "handler-timeout": "error",
    "handler-invalid-output": "error",
    "reaction-depth-limit": "warn",
    "continue-limit": "warn",
    "late-result-dropped": "info",
    // 视图
    "slot-unplaced": "warn",
    "slot-collision": "error",
    "slot-volatile-in-system": "warn",
    "prefix-unstable": "warn",
    "commit-differs": "warn",
    "request-invalid": "error",
    // 拦截
    "intercept-threw": "error",
    // 装配与生命周期
    "unknown-event-handler": "error",
    "event-never-fires": "info",
    "unknown-slice": "error",
    "bad-extension-id": "error",
    "duplicate-extension-id": "error",
    "dependency-missing": "error",
    "dependency-cycle": "error",
    "render-foreign-event": "error",
    "mount-failed": "error",
    "extension-revoked": "warn",
} as const;
export type DiagnosticCode = keyof typeof diagnosticCodes;

export interface Diagnostic {
    /** 同一个 (code, extension, entry, 事件类型) 的合并键。 */
    id: string;
    level: "error" | "warn" | "info";
    code: DiagnosticCode;
    extension: string | null;
    entry: EntryPoint | "assembly";
    /** 引出它的事件。 */
    event?: {id: string; type: string; seq: number};
    request?: number;
    /** 结构化参数（槽名、片名、限时、猜测的名字……），界面本地化时代入。 */
    params: Record<string, string | number | boolean>;
    /** 英文，给开发者读，不用来分支。 */
    message: string;
    /** 英文，下一步该做什么。 */
    hint?: string;
    /** 原错（保留 Error.cause 链）。 */
    cause?: {name: string; message: string; stack?: string};
    count: number;
    firstSeq: number;
    lastSeq: number;
    /** 是否也写成了 extensionFailed 事件（重启后还看得到）。 */
    persisted: boolean;
}

// ====================================================================
// 6. 插件宿主：agent.extensions 贡献点
// ====================================================================

/** 清单里的声明：只放序列化得了的部分，内核不激活插件就能排序、按标签排除、画开关。 */
export interface ExtensionDeclaration {
    tags?: string[];
    dependsOn?: string[];
}
/** 平台的 ContributionHandle 的对应：implementation() 在撤回后抛错，宿主不缓存它。 */
export interface ExtensionHandle {
    id: string;
    plugin: string;
    declaration: ExtensionDeclaration;
    implementation(): Extension;
}
export type RevokeReason = "deactivated" | "uninstalled" | "activation-failed";

/** agent.extensions 的接收者（拥有者入口在激活产出里提供，对应平台的 ContributionReceiver）。 */
export interface ExtensionReceiver {
    /** 事务里预占：id 格式、重复、依赖成环在这里否决，整个插件的激活随之失败。 */
    prepare(handle: ExtensionHandle): void;
    /** 生效：之后新开的会话装上它；已打开的会话进 pendingReassembly。 */
    published(handle: ExtensionHandle): void;
    /** 撤回，幂等。正在运行的会话先跑完这一次运行再摘（运行中调用它的入口会得到 extension-revoked 诊断）。 */
    revoke(handle: ExtensionHandle, reason: RevokeReason): void;
}

/** 贡献点声明（放进插件描述）；内置插件由扩展对象导出，第三方插件由构建步骤写进清单。 */
export interface ExtensionContribution {
    capability: "agent.extensions";
    id: string;
    declaration: ExtensionDeclaration;
}
export declare function declarationsOf(...list: readonly Extension[]): ExtensionContribution[];

export interface AgentHost {
    readonly extensions: ExtensionReceiver;
    list(): ExtensionInfo[];
    create(args: {sessionId: string; profile: string; initial?: unknown}): Promise<SessionApi>;
    open(sessionId: string): Promise<SessionApi>;
    close(sessionId: string): Promise<void>;
    /** 全局的诊断（装配、插件装卸）；会话里的诊断在 SessionQueries.diagnostics。 */
    diagnostics(): Diagnostic[];
}

/** 一个会话对外的全部：命令、查询、订阅。远程服务就是把它逐个方法暴露出去。 */
export interface SessionApi extends SessionCommands, SessionQueries {
    readonly id: string;
    /** 进程内订阅（远程服务里是 `frames` 事件）。 */
    subscribe(listener: (frame: Frame) => void): () => void;
}

// ====================================================================
// 7. 界面端的镜像：纯函数，浏览器与 nb-story 共用（对应 nb-agent-ui 的 createHarnessTranscript）
// ====================================================================

export interface StreamingReply {
    request: number;
    text: string;
    thinking: string;
    toolArgs: Record<string, string>;
}
export interface AttentionItem {
    kind: "unknown-tool-outcome" | "interrupted-run" | "rejected-input" | "model-failed" | "extension-failed";
    /** 日志事件的 seq，界面据此跳转。 */
    seq: number;
    /** 是否仍待用户处理（回退或重新开始之后消除）。 */
    open: boolean;
    detail: Record<string, string | number | boolean | null>;
}
export interface SessionMirror {
    /** 只进不退：seq 不大于已见到的日志帧忽略。返回这一帧是否改变了镜像。 */
    apply(frame: Frame): boolean;
    applySnapshot(snapshot: SessionSnapshot): void;
    /** 已见到的最大 seq；重连时从它往后补。 */
    head(): number;
    status(): RunStatus;
    buffer(): readonly BufferedInput[];
    streaming(): StreamingReply | null;
    /** “结果未知”的工具调用、中断的运行、被拒的输入、模型失败、扩展失败：都是日志里的字段，这里只是收齐。 */
    attention(): readonly AttentionItem[];
    diagnostics(): readonly Diagnostic[];
}
export declare function createSessionMirror(): SessionMirror;

// ====================================================================
// 8. 来源的人话（界面和测试共用）
// ====================================================================

export declare function originLabel(origin: Origin): string;
export type { Attributed, FailureCode, KernelEvents, Rejection, ToolStatus };
