/** JSON 值：nb-session 自带，不依赖任何外部 JSON 类型。 */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | {readonly [key: string]: JsonValue};

/** 会话条目的公共字段：`seq` 由 log 打戳（1 起、单调递增），`at` 为 ISO 字符串。 */
export interface SessionEntryBase {
    readonly seq: number;
    readonly at: string;
}

export interface MessageEntry extends SessionEntryBase {
    readonly kind: "message";
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
}

export interface ToolCallEntry extends SessionEntryBase {
    readonly kind: "tool_call";
    readonly callId: string;
    readonly toolName: string;
    readonly argsJson: string;
}

export interface ToolResultEntry extends SessionEntryBase {
    readonly kind: "tool_result";
    readonly callId: string;
    readonly isError: boolean;
    readonly text: string;
}

export interface CompactionEntry extends SessionEntryBase {
    readonly kind: "compaction";
    readonly summary: string;
    readonly replacedThroughSeq: number;
}

export interface MetaEntry extends SessionEntryBase {
    readonly kind: "meta";
    readonly key: string;
    readonly value: JsonValue;
}

export type SessionEntry = MessageEntry | ToolCallEntry | ToolResultEntry | CompactionEntry | MetaEntry;

/** `append` 的入参：不含 `seq`/`at`，由 log 打戳。 */
export type SessionEntryInput =
    | {readonly kind: "message"; readonly role: MessageEntry["role"]; readonly text: string}
    | {readonly kind: "tool_call"; readonly callId: string; readonly toolName: string; readonly argsJson: string}
    | {readonly kind: "tool_result"; readonly callId: string; readonly isError: boolean; readonly text: string}
    | {readonly kind: "compaction"; readonly summary: string; readonly replacedThroughSeq: number}
    | {readonly kind: "meta"; readonly key: string; readonly value: JsonValue};

/** 可读写的会话 id 形状；用于文件名，避免路径穿越。 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidSessionId(sessionId: string): boolean {
    return SESSION_ID_PATTERN.test(sessionId);
}

/** 把一条入参打戳成完整条目。 */
export function materializeEntry(input: SessionEntryInput, seq: number, at: string): SessionEntry {
    switch (input.kind) {
        case "message":
            return {kind: "message", seq, at, role: input.role, text: input.text};
        case "tool_call":
            return {kind: "tool_call", seq, at, callId: input.callId, toolName: input.toolName, argsJson: input.argsJson};
        case "tool_result":
            return {kind: "tool_result", seq, at, callId: input.callId, isError: input.isError, text: input.text};
        case "compaction":
            return {kind: "compaction", seq, at, summary: input.summary, replacedThroughSeq: input.replacedThroughSeq};
        case "meta":
            return {kind: "meta", seq, at, key: input.key, value: input.value};
    }
}

const KINDS = new Set(["message", "tool_call", "tool_result", "compaction", "meta"]);
const ROLES = new Set(["user", "assistant", "system"]);

/** 解析一行 JSONL；字段不合法或 JSON 损坏时返回 null（调用方据此判定中断尾）。 */
export function parseEntryLine(line: string): SessionEntry | null {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Record<string, unknown>;
    const kind = candidate.kind;
    const seq = candidate.seq;
    const at = candidate.at;
    if (typeof kind !== "string" || !KINDS.has(kind)) return null;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return null;
    if (typeof at !== "string") return null;
    switch (kind) {
        case "message":
            return typeof candidate.role === "string" && ROLES.has(candidate.role) && typeof candidate.text === "string"
                ? (value as MessageEntry)
                : null;
        case "tool_call":
            return typeof candidate.callId === "string" && typeof candidate.toolName === "string" && typeof candidate.argsJson === "string"
                ? (value as ToolCallEntry)
                : null;
        case "tool_result":
            return typeof candidate.callId === "string" && typeof candidate.isError === "boolean" && typeof candidate.text === "string"
                ? (value as ToolResultEntry)
                : null;
        case "compaction":
            return typeof candidate.summary === "string" && typeof candidate.replacedThroughSeq === "number"
                ? (value as CompactionEntry)
                : null;
        case "meta":
            return typeof candidate.key === "string" ? (value as MetaEntry) : null;
        default:
            return null;
    }
}
