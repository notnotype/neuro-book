/**
 * 日志：事件的声明、内核事件表、日志里的一条事件与会话头。落盘格式（写入批、大块内容、校验）见
 * docs/specs/harness/session.md；事件名与字段一经写进日志就是长期合同，只加不改，改语义要升格式版本。
 */

import type {Actor, JsonValue, Scope, UserInput} from "./basics.js";
import type {ContentBlock, ModelErrorKind, RequestPurpose, StopReason, Usage} from "./model.js";
import type {ToolCall, ToolStatus} from "./tool.js";

// ====================================================================
// 事件的声明
// ====================================================================

/** 事件的声明：作用域、种类、版本与数据；数据只用于类型推断。 */
export interface EventSpec<S extends Scope, K extends EventKind, D> {
    readonly scope: S;
    readonly kind: K;
    readonly version: number;
    readonly _data?: D;
}
/**
 * `conv`：进当前这一轮，永远在 path，内核写入时盖位置章；`ext`：不变成消息，只给扩展归约；
 * `ctrl`：内核事件里不变成消息的那些。扩展只能声明 `conv` 与 `ext`。
 */
export type EventKind = "conv" | "ext" | "ctrl";
export type AnyEventSpec = EventSpec<Scope, EventKind, any>;
export type EventsDecl = Record<string, AnyEventSpec>;

/** 事件声明里的数据类型。 */
export type EventData<S> = S extends EventSpec<Scope, EventKind, infer D> ? D : never;
export type EventScope<S> = S extends EventSpec<infer Sc, EventKind, any> ? Sc : never;
export type EventKindOf<S> = S extends EventSpec<Scope, infer K, any> ? K : never;

// ====================================================================
// 内核事件
// ====================================================================

/** 扩展可能出错的入口。 */
export type EntryPoint =
    | "reduce" | "on" | "mount" | "contribute" | "render" | "prompt" | "system" | "turn" | "commit"
    | "intercept.input" | "intercept.model" | "intercept.tool" | "intercept.compaction";
export type FailureCode = "threw" | "timeout" | "invalid-output" | "emit-after-settle" | "revoked" | "aborted";

/** 一次运行的结果（收尾工具交回的值，或强制结构化时以最后一条回复作结果）。 */
export interface RunResultValue {
    readonly via: "tool" | "text";
    readonly tool?: string;
    readonly value: JsonValue;
    readonly valid: boolean;
    /** `valid` 为 false 时的校验错误（JSON Pointer 与码）。 */
    readonly errors?: readonly {readonly path: string; readonly code: string}[];
}

/** 等用户的事项怎样了结。系统结算（`interrupted`、`aborted`、`unavailable`，及拒绝里的系统码）带 `code`。 */
export type InteractionDecision = "allow" | "allow-session" | "deny" | "answer" | "interrupted" | "aborted" | "unavailable";

type K<S extends Scope, Kd extends "conv" | "ctrl", D> = EventSpec<S, Kd, D>;

/** 用户的话的内容：入队与改时存拦截之后的文字；被改写过时原文记在 `original`，标了 `redacted` 时只记哈希。 */
interface QueuedText {
    readonly input: UserInput;
    readonly original?: string;
    readonly originalHash?: string;
}

/** 内核事件（驼峰，日志里的类型名就是处理函数的键）。`conv` 的进对话；`ctrl` 的只给扩展看。 */
export interface KernelEvents {
    sessionCreated: K<"path", "ctrl", {initial: JsonValue}>;

    // ---- 输入缓冲区（session）----
    inputQueued: K<"session", "ctrl", QueuedText & {id: string; mode: "steer" | "followup"}>;
    inputEdited: K<"session", "ctrl", QueuedText & {id: string}>;
    inputRemoved: K<"session", "ctrl", {id: string; reason: "user" | "aborted"}>;
    /** 与 `turnStarted`、`input`（或 `steer`）在同一个写入批里写，崩溃不会丢掉用户的话。 */
    inputConsumed: K<"session", "ctrl", {id: string}>;

    // ---- 会话级（session）----
    /** 被受理的指令；重发同一个 `commandId` 查它，返回第一次的 `value`。`value` 引用的 id 都在同一批里写出。 */
    /** `argsHash`：指令参数（去掉 `commandId`）按键排序后的 SHA-256，重发时核对是不是同一条指令。 */
    commandAccepted: K<"session", "ctrl", {commandId: string; name: string; value: JsonValue; argsHash?: string}>;
    /** 设置按扩展分开（核心设置组的 `extension` 是 `core`）；只派发给设置所属的扩展。 */
    settingsChanged: K<"session", "ctrl", {extension: string; patch: Readonly<Record<string, JsonValue>>}>;
    leafChanged: K<"session", "ctrl", {leaf: string | null}>;
    /**
     * 装配变了。`code-updated`：打开会话时 Profile 哈希与路径上最后一条不同（提示词或扩展的代码改了）；
     * `manifest` 是装配序里每个扩展的 id、版本与所属插件。
     */
    profileChanged: K<"session", "ctrl", {
        profile: string;
        hash: string;
        from: string | null;
        reason: "created" | "user" | "code-updated" | "plugin-added" | "plugin-removed" | "plugin-updated";
        manifest: readonly {id: string; version: string; plugin: string | null}[];
    }>;
    /** “本会话都批准”：批准记忆只从它归约，回退不撤销。 */
    approvalRemembered: K<"session", "ctrl", {tool: string; scope: "tool"; by: Actor}>;
    titleChanged: K<"session", "ctrl", {title: string; by: "user" | "auto"}>;
    archived: K<"session", "ctrl", {archived: boolean}>;

    // ---- 运行与轮（path）----
    runStarted: K<"path", "ctrl", {runId: string; kind: "chat" | "compact"}>;
    runEnded: K<"path", "ctrl", {
        runId: string;
        reason: "finished" | "completed" | "error" | "interrupted" | "aborted";
        result?: RunResultValue;
        /** `error` 收口的原因：模型失败的类别，或内核的码（`tools-missing`、`profile-failed`……）。 */
        error?: {kind: ModelErrorKind; code?: string};
    }>;
    /** 没有新输入的“继续”运行，`inputId` 为 null。每轮一次的提醒挂在这里，“继续”运行也收得到。 */
    turnStarted: K<"path", "ctrl", {turnId: string; inputId: string | null}>;
    turnEnded: K<"path", "ctrl", {turnId: string; reason: "completed" | "error" | "interrupted" | "aborted"}>;

    // ---- 对话（path、conv）----
    /** 开新一轮的用户的话；`queued` 是缓冲区里的 id，原文字段在 `inputQueued`、`inputEdited`。 */
    input: K<"path", "conv", {text: string; payload?: JsonValue; attachments?: UserInput["attachments"]; queued: string}>;
    /** 运行中途插进当前这一轮的用户的话。 */
    steer: K<"path", "conv", {text: string; payload?: JsonValue; attachments?: UserInput["attachments"]; queued: string}>;
    /** `request` 与 `modelStarted`、流式增量的 `request` 对得上。 */
    assistant: K<"path", "conv", {
        request: number;
        content: readonly ContentBlock[];
        toolCalls: readonly ToolCall[];
        stopReason: Exclude<StopReason, "error" | "aborted">;
        usage: Usage;
        model: string;
        effort?: string;
        responseId?: string;
    }>;
    /**
     * `ctx.continue` 写的“接着做”：内核按这一轮、这个扩展数次数。内核自己催模型交结果时 `by` 是 `core`。
     * `text` 是写给模型的，界面按 `by` 显示自己的文案。
     */
    continued: K<"path", "conv", {text: string; by: string; count: number}>;
    /**
     * 内核写给模型的提醒：工具集变了、会话要求交回结果（docs/specs/harness/runtime.md 输出 16、27）。
     * `text` 是写给模型的（带 `<system-reminder>` 这类标签），界面按 `code` 显示自己的文案。
     */
    notice: K<"path", "conv", {text: string; code: "tools-changed" | "result-requested" | "restored"}>;

    // ---- 模型请求（path）----
    modelStarted: K<"path", "ctrl", {
        request: number;
        purpose: RequestPurpose;
        model: string;
        /** 最终请求按块链式累加的 SHA-256。 */
        hash: string;
        now: number;
        invocation: string;
        modifiedBy: readonly {extension: string; fields: readonly string[]}[];
    }>;
    /** 非对话的请求（审批、压缩、后台）成功时写；对话请求的成功就是 `assistant`。 */
    modelEnded: K<"path", "ctrl", {request: number; purpose: Exclude<RequestPurpose, "turn">; stopReason: StopReason; usage: Usage; model: string}>;
    /** `aborted`：用户中止；`interrupted`：进程中断后恢复时写。 */
    modelFailed: K<"path", "ctrl", {
        request: number;
        kind: ModelErrorKind | "aborted" | "interrupted";
        code?: string;
        status?: number;
        message?: string;
        partial?: readonly ContentBlock[];
        usage?: Usage;
    }>;

    // ---- 工具（path）----
    /** 告诉过模型的工具集（t04 决定 6）：边界比对，不同就写新的一条并提醒模型。 */
    toolsAnnounced: K<"path", "ctrl", {tools: readonly {id: string; version: string}[]}>;
    /** 审批之后、执行之前写；`args` 是全部拦截之后实际执行的参数，`approval.by` 是放行的判定来源。 */
    toolStarted: K<"path", "ctrl", {callId: string; tool: string; args: Readonly<Record<string, JsonValue>>; invocation: string; approval?: {by: string}}>;
    /** `details` 给程序看、不进请求；工具拦截改过结果时原本的文字记在 `raw`（`redacted` 时只记哈希）。 */
    toolResult: K<"path", "conv", {
        callId: string;
        tool: string;
        text: string;
        status: ToolStatus;
        code?: string;
        /** `denied`、`blocked` 的署名。 */
        by?: string;
        details?: JsonValue;
        raw?: string;
        rawHash?: string;
    }>;

    // ---- 等用户（path）----
    interactionRequested: K<"path", "ctrl", {id: string; callId: string; kind: "approval" | "question"; request: JsonValue; async: boolean}>;
    interactionResolved: K<"path", "ctrl", {id: string; decision: InteractionDecision; by: Actor; code?: string; data?: JsonValue; note?: string}>;

    // ---- 压缩与失败（path）----
    /**
     * 压缩：半开区间，`firstKeptEntryId` 自身及其后的保留；它是一轮的 `turnStarted`，或进行中这一轮里某一步的 `assistant`。
     * 放回的内容（最近读过的文件、计划、Skill）是同一个写入批里的 `conv` 事件。
     */
    compaction: K<"path", "ctrl", {
        method: string;
        firstKeptEntryId: string | null;
        replacement: string | null;
        omitted: readonly {entryId: string; placeholder: string}[];
        tokensBefore: number;
        tokensAfter: number;
        details?: JsonValue;
    }>;
    /** 改变了结果的扩展失败（输出被丢弃、拦截被跳过、工具被缺省拒绝）：重放不跑处理函数，所以要记在日志里。 */
    extensionFailed: K<"path", "ctrl", {extension: string; entry: EntryPoint; code: FailureCode; dropped?: {events: number; sets: number}}>;
    reactionLimit: K<"path", "ctrl", {root: string; dropped: readonly string[]}>;
}
export type KernelEventName = keyof KernelEvents & string;

// ====================================================================
// 日志里的一条事件
// ====================================================================

/** `conv` 事件在对话里的位置，由内核写入时盖章；投影照章归入，不靠推断。 */
export type Position =
    | {readonly kind: "attachment"; readonly turn: string}
    | {readonly kind: "after-step"; readonly turn: string; readonly step: string}
    | {readonly kind: "next-turn"};

/** 日志里的一条事件。`type` 是全名：内核事件是裸名，扩展事件是“扩展 id/事件名”。 */
export interface LogEvent<T extends string = string, D = unknown> {
    readonly id: string;
    /** 从 1 起，与写入顺序一致；订阅与续传按它。 */
    readonly seq: number;
    readonly at: number;
    /** path 事件的父节点；session 事件为 null。 */
    readonly parent: string | null;
    readonly scope: Scope;
    readonly kind: EventKind;
    readonly type: T;
    readonly version: number;
    /** 写它的扩展 id；内核写的是 `kernel`。 */
    readonly source: string;
    /** 引出它的事件或指令（`commandAccepted` 的 id）。 */
    readonly cause?: string;
    /** 反应链的深度：根事件是 0。 */
    readonly depth?: number;
    /** 幂等键：同一来源同一个键只写一次。 */
    readonly key?: string;
    readonly position?: Position;
    readonly data: D;
}

/** 内核事件带类型的形状。 */
export type KernelEvent<N extends KernelEventName> = LogEvent<N, EventData<KernelEvents[N]>>;

// ====================================================================
// 落盘格式
// ====================================================================

export const LOG_FORMAT = 1;

/** 会话文件的第一行。`result` 由建会话时传入（Profile 声明的也在建会话时抄进来），动态的 `yield` 收尾工具由它生成。 */
export interface SessionHeader {
    readonly format: typeof LOG_FORMAT;
    readonly id: string;
    readonly createdAt: number;
    /** Profile 的 key（t05：`<来源>.<名字>`）。 */
    readonly profile: string;
    readonly project?: string;
    /** fork 的来源：从哪个会话的哪个节点复制了路径。 */
    readonly origin?: {readonly session: string; readonly entry: string | null};
    /** 子会话的调用方（t14）。 */
    readonly caller?: {readonly kind: "session" | "workflow"; readonly id: string; readonly callId: string};
    /** 提问交给谁：`caller` 时父会话也能应答。 */
    readonly questions: "caller" | "user";
    readonly result?: {readonly mode: "optional" | "required"; readonly schema: JsonValue};
}

/** 写入批的标记：一批一次写入后同步到盘；文件里完整的批就是已提交的批。 */
export interface BatchMark {
    readonly id: string;
    /** 从 1 起。 */
    readonly n: number;
    readonly of: number;
}

/** 超过阈值（UTF-8 16 KB）的字符串在日志里的样子：内容在 `blobs/<sha256>`。 */
export interface BlobRef {
    readonly $blob: string;
    readonly size: number;
}

/** 日志文件里的一行（会话头之后）。读回时 `BlobRef` 换回字符串、去掉 `batch`，得到 `LogEvent`。 */
export type LogRecord = LogEvent<string, JsonValue> & {readonly batch: BatchMark};
