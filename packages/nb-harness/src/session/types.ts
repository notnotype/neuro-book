/**
 * 会话模块的公开类型，逐字对应 docs/specs/harness/session.md 的“输入与前置条件”。
 *
 * 条目是 OMP `@oh-my-pi/pi-agent-core` 压缩模块 `SessionEntry` 的子集：这里的每个变体都能赋给 OMP 的同名变体，
 * 所以条目可以直接交给 OMP 的压缩函数（Spec 输出 23）。改动字段前先确认 OMP 那边的形状。
 */

import type {ImageContent, Message, TextContent} from "@oh-my-pi/pi-ai";

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export type SessionHeader = {type: "session"; version: 1; id: string; createdAt: string; parentSession?: string};

export type EntryBase = {id: string; parentId: string | null; timestamp: string};

export type SessionEntry = EntryBase & (
    | {type: "message"; message: Message}
    | {type: "custom_message"; customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details?: JsonValue}
    | {type: "custom"; customType: string; data?: JsonValue}
    | {type: "model_change"; model: string; role?: string}
    | {type: "thinking_level_change"; thinkingLevel: string | null}
    | {type: "title_change"; title: string; source: "auto" | "user"}
    | {type: "compaction"; summary: string; firstKeptEntryId: string; tokensBefore: number; shortSummary?: string;
       details?: JsonValue; preserveData?: {[key: string]: JsonValue}; providerReplayThroughEntryId?: string}
);

export type InvocationPhase = "start" | "waiting" | "resumed" | "end" | "error" | "aborted" | "interrupted";
export type InvocationData = {invocationId: string; phase: InvocationPhase; detail?: JsonValue};

export type InteractionRequest = {assistantEntryId: string; toolCallId: string; toolName: string; tier?: "read" | "write" | "exec"; data?: JsonValue};
export type InteractionResponse = {decision: "approve" | "reject" | "answer"; scope?: "once" | "session"; decidedBy: "user" | "approver"; note?: string; data?: JsonValue};
export type InteractionData = {interactionId: string; kind: "approval" | "question"; phase: "request" | "response";
    request?: InteractionRequest; response?: InteractionResponse};

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EntryInput = DistributiveOmit<SessionEntry, "id" | "parentId" | "timestamp">;

export type SessionFailure = "invalid-session-id" | "session-exists" | "session-not-found" | "corrupt-session" | "unsupported-version"
    | "invalid-entry" | "damaged-tail" | "store-failed" | "log-broken" | "log-closed" | "invalid-cursor" | "entry-not-found";

export type Result<T> = {ok: true; value: T} | {ok: false; code: SessionFailure; detail: string; line?: number; index?: number};

export type LogEndReason = "closed" | "broken" | "listener-error";

export interface SessionLog {
    readonly header: SessionHeader;
    /** 按序号排列；每次追加换成新的冻结数组，旧引用不变。 */
    readonly entries: readonly SessionEntry[];
    /** 打开时发现的中断尾；`repair` 成功后为 null。 */
    readonly damagedTail: {bytes: number} | null;
    append(inputs: readonly EntryInput[]): Promise<Result<readonly SessionEntry[]>>;
    subscribe(
        listener: (event: {seq: number; entry: SessionEntry}) => void,
        options?: {afterSeq?: number; onEnd?(reason: LogEndReason): void},
    ): {release(): void};
    repair(): Promise<Result<{droppedBytes: number}>>;
    close(): void;
}

export type SessionSummary = {id: string; createdAt: string; parentSession?: string; title?: string; updatedAt: string};

export interface SessionStore {
    create(header: SessionHeader): Promise<Result<void>>;
    open(id: string): Promise<Result<{header: SessionHeader; entries: SessionEntry[]; damagedTail: {bytes: number} | null}>>;
    append(id: string, entries: readonly SessionEntry[]): Promise<Result<void>>;
    repair(id: string): Promise<Result<{droppedBytes: number}>>;
    list(): Promise<Result<SessionSummary[]>>;
}
