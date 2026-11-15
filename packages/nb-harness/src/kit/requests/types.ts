/**
 * 请求记录器交给宿主的数据形状（docs/specs/agent/request-trace.md）。宿主把它们经自己的远程层交给界面；
 * nb-agent-ui 的核心按结构声明同样的形状，契约测试核对两边一致。
 */

import type {JsonValue, ModelErrorKind, RequestPurpose, StopReason, Usage} from "../../kernel/contracts.js";

/** `running` 是进行中；进程在进行中退出，下次打开时记为 `interrupted`。 */
export type RequestStatus = "running" | "ok" | "error" | "aborted" | "interrupted";

/** 列表的一行：只有索引里的事实，不读内容。 */
export interface RequestRow {
    readonly id: string;
    readonly session: string;
    /** 会话里的请求序号与请求哈希，与 `modelStarted` 的相同。 */
    readonly request: number;
    readonly hash: string;
    readonly purpose: RequestPurpose;
    readonly model: string;
    readonly effort?: string;
    /** 轮外（手动压缩）没有。`input` 是开这一轮的用户的话。 */
    readonly turn?: {readonly id: string; readonly index: number; readonly input?: string};
    readonly startedAt: number;
    readonly firstContentAt?: number;
    readonly endedAt?: number;
    readonly status: RequestStatus;
    readonly stopReason?: StopReason;
    readonly usage?: Usage;
    /** 实际作答的模型（适配器交回的）。 */
    readonly answeredBy?: string;
    readonly error?: {readonly kind: ModelErrorKind; readonly code?: string; readonly status?: number};
    /** 与同一会话、同一用途的前一次内容完全相同时，这是第几次发送（从 2 起）。 */
    readonly resend?: number;
    /** 工具声明与同一会话、同一用途的前一次不同。第一次不算。 */
    readonly toolsChanged: boolean;
    /** 最后一次 HTTP 尝试的状态；没有尝试（不经 HTTP）时没有。 */
    readonly http?: number;
    readonly attempts: number;
}

export interface RequestAttempt {
    readonly url: string;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly status?: number;
    readonly error?: string;
    /** 只在设置开着时有；凭据类的值已换成 `[REDACTED]`。 */
    readonly requestHeaders?: Readonly<Record<string, string>>;
    readonly responseHeaders?: Readonly<Record<string, string>>;
}

/** 一条消息的大纲：全文按 `hash` 另取（`content`）。 */
export interface MessageOutline {
    readonly hash: string;
    readonly role: "user" | "assistant" | "tool";
    /** 文字的开头（一行，最多 `PREVIEW_CHARS` 字）。 */
    readonly preview: string;
    readonly tokens: number;
    readonly toolCalls?: readonly {readonly id: string; readonly tool: string; readonly args: Readonly<Record<string, JsonValue>>}[];
    readonly callId?: string;
    readonly isError?: boolean;
    readonly images: number;
    /** 内容文件读不出（清理与读取同时发生，或文件损坏）：只有哈希，其余是空的。 */
    readonly missing?: true;
}

export interface BlockOutline {
    readonly hash: string;
    readonly preview: string;
    readonly tokens: number;
    readonly missing?: true;
}

export interface ToolOutline {
    readonly hash: string;
    readonly id: string;
    readonly description: string;
    readonly missing?: true;
}

export type PayloadState =
    | {readonly state: "present"; readonly bytes: number}
    /** 设置关着、适配器拿不到、或因总量上限删掉了。 */
    | {readonly state: "disabled" | "unavailable" | "pruned"};

export interface RequestDetail extends RequestRow {
    readonly modifiedBy: readonly {readonly extension: string; readonly fields: readonly string[]}[];
    readonly params: Readonly<Record<string, JsonValue>>;
    readonly system: readonly BlockOutline[];
    readonly messages: readonly MessageOutline[];
    readonly tools: readonly ToolOutline[];
    readonly reply?: MessageOutline;
    readonly errorMessage?: string;
    readonly attemptList: readonly RequestAttempt[];
    readonly payload: PayloadState;
}

export interface RequestQuery {
    readonly sessions?: readonly string[];
    readonly purposes?: readonly RequestPurpose[];
    /** `resend` 是重发过，`cache-miss` 是成功但没读到缓存。 */
    readonly statuses?: readonly (RequestStatus | "resend" | "cache-miss")[];
    readonly models?: readonly string[];
    /** 开始时间不早于它（毫秒）。 */
    readonly since?: number;
    readonly sort?: "time" | "duration" | "input" | "cost";
    readonly cursor?: string;
    readonly limit?: number;
}

export interface RequestTotals {
    readonly count: number;
    readonly input: number;
    readonly cacheRead: number;
    /** 没有一条有价格时为 null。 */
    readonly cost: number | null;
}

export interface RequestPage {
    readonly rows: readonly RequestRow[];
    /** 还有下一页时给。 */
    readonly next?: string;
    /** 这一页对应的事件序号：界面丢掉不大于它的事件。 */
    readonly seq: number;
    readonly totals: RequestTotals;
    readonly facets: {readonly sessions: readonly {readonly id: string; readonly count: number}[]; readonly models: readonly {readonly id: string; readonly count: number}[]};
}

export type RequestChange =
    | {readonly seq: number; readonly kind: "added" | "settled"; readonly row: RequestRow}
    | {readonly seq: number; readonly kind: "removed"; readonly ids: readonly string[]};

export interface RequestUsage {
    readonly bytes: number;
    readonly payloadBytes: number;
}
