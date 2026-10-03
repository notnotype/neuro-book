import type {SessionEntry, SessionEntryId} from "nbook/server/agent/session/types";
import {projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import type {AgentChatEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import type {AgentChatHistoryPageDto} from "nbook/shared/dto/agent-session.dto";

/** 分页显示组的服务端策略；不暴露给 HTTP 客户端。 */
export const AGENT_HISTORY_PAGE_MAX_GROUPS = 30;
export const AGENT_HISTORY_PAGE_TARGET_BYTES = 256 * 1024;
const HISTORY_CURSOR_VERSION = 1;
const HISTORY_CURSOR_MAX_BYTES = 2048;

export type AgentHistoryCursor = {
    version: 1;
    sessionId: number;
    activePathRevision: string | null;
    beforeEntryId: SessionEntryId;
};

export class AgentHistoryQueryError extends Error {
    readonly code: "INVALID_HISTORY_CURSOR" | "ACTIVE_PATH_CHANGED";
    readonly statusCode: 400 | 409;

    constructor(code: "INVALID_HISTORY_CURSOR" | "ACTIVE_PATH_CHANGED", message: string) {
        super(message);
        this.name = "AgentHistoryQueryError";
        this.code = code;
        this.statusCode = code === "ACTIVE_PATH_CHANGED" ? 409 : 400;
    }
}

type HistoryGroup = {
    rawStartEntryId: SessionEntryId;
    entries: AgentChatEntryDto[];
};

type ProjectedHistoryEntry = {
    entry: SessionEntry;
    projected: AgentChatEntryDto | null;
    invocationId?: string;
};

type HistorySpan = {
    start: number;
    end: number;
};

export type BuildAgentHistoryPageInput = {
    sessionId: number;
    activePathRevision: string | null;
    activePath: SessionEntry[];
    cursor?: string;
};

/**
 * 从 active path 尾部向前生成有界 history page。cursor 只定位显示组边界，
 * 不携带正文；不可见账本 entry 会被跨过且不会阻塞 cursor 推进。
 */
export function buildAgentHistoryPage(input: BuildAgentHistoryPageInput): AgentChatHistoryPageDto {
    const groups = buildHistoryGroups(input.activePath);
    let endExclusive = groups.length;
    if (input.cursor !== undefined) {
        const cursor = decodeAgentHistoryCursor(input.cursor);
        if (cursor.sessionId !== input.sessionId) {
            throw new AgentHistoryQueryError("INVALID_HISTORY_CURSOR", "history cursor 不属于当前 session");
        }
        if (cursor.activePathRevision !== input.activePathRevision) {
            throw new AgentHistoryQueryError("ACTIVE_PATH_CHANGED", "active path 已发生变化，请重新加载 session");
        }
        const boundaryIndex = groups.findIndex((group) => group.rawStartEntryId === cursor.beforeEntryId);
        if (boundaryIndex < 0) {
            throw new AgentHistoryQueryError("INVALID_HISTORY_CURSOR", "history cursor 不是当前 active path 的合法分页边界");
        }
        endExclusive = boundaryIndex;
    }

    const selected: HistoryGroup[] = [];
    let bytes = 2;
    for (let index = endExclusive - 1; index >= 0; index -= 1) {
        const group = groups[index];
        if (!group) {
            continue;
        }
        const groupBytes = Buffer.byteLength(JSON.stringify(group.entries), "utf8");
        if (selected.length > 0 && (selected.length >= AGENT_HISTORY_PAGE_MAX_GROUPS || bytes + groupBytes > AGENT_HISTORY_PAGE_TARGET_BYTES)) {
            break;
        }
        selected.push(group);
        bytes += groupBytes;
        if (selected.length >= AGENT_HISTORY_PAGE_MAX_GROUPS) {
            break;
        }
    }
    selected.reverse();
    const entries = selected.flatMap((group) => group.entries);
    const oldestIndex = endExclusive - selected.length;
    const previousCursor = oldestIndex > 0 && groups[oldestIndex]
        ? encodeAgentHistoryCursor({
            version: HISTORY_CURSOR_VERSION,
            sessionId: input.sessionId,
            activePathRevision: input.activePathRevision,
            beforeEntryId: groups[oldestIndex].rawStartEntryId,
        })
        : null;
    return {entries, previousCursor};
}

/** 编码服务端 opaque cursor；编码不提供完整性保护，解码后仍做全部语义校验。 */
export function encodeAgentHistoryCursor(cursor: AgentHistoryCursor): string {
    const value = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    if (Buffer.byteLength(value, "utf8") > HISTORY_CURSOR_MAX_BYTES) {
        throw new AgentHistoryQueryError("INVALID_HISTORY_CURSOR", "history cursor 过长");
    }
    return value;
}

/** 严格解析 cursor，拒绝非 base64url、未知版本和额外字段。 */
export function decodeAgentHistoryCursor(value: string): AgentHistoryCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.byteLength(value, "utf8") > HISTORY_CURSOR_MAX_BYTES) {
        throw new AgentHistoryQueryError("INVALID_HISTORY_CURSOR", "history cursor 格式无效");
    }
    try {
        const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (!isRecord(parsed)) {
            throw new Error("invalid cursor");
        }
        const sessionId = parsed.sessionId;
        const beforeEntryId = parsed.beforeEntryId;
        if (parsed.version !== HISTORY_CURSOR_VERSION
            || typeof sessionId !== "number"
            || !Number.isInteger(sessionId)
            || sessionId <= 0
            || (typeof parsed.activePathRevision !== "string" && parsed.activePathRevision !== null)
            || typeof beforeEntryId !== "string"
            || beforeEntryId.length === 0
            || Object.keys(parsed).some((key) => !["version", "sessionId", "activePathRevision", "beforeEntryId"].includes(key))) {
            throw new Error("invalid cursor");
        }
        return parsed as AgentHistoryCursor;
    } catch {
        throw new AgentHistoryQueryError("INVALID_HISTORY_CURSOR", "history cursor 格式无效");
    }
}

function buildHistoryGroups(path: SessionEntry[]): HistoryGroup[] {
    let activeInvocationId: string | undefined;
    const projected: ProjectedHistoryEntry[] = path.map((entry) => {
        if (entry.type === "invocation_lifecycle"
            && (entry.status === "start" || entry.status === "resumed" || entry.status === "waiting")) {
            activeInvocationId = entry.invocationId;
        }
        const item = {
            entry,
            projected: projectAgentChatEntry(entry, {invocationId: activeInvocationId}),
            ...(activeInvocationId ? {invocationId: activeInvocationId} : {}),
        };
        if (entry.type === "invocation_lifecycle"
            && (entry.status === "end" || entry.status === "error" || entry.status === "aborted" || entry.status === "interrupted")) {
            activeInvocationId = undefined;
        }
        return item;
    });

    const spansByAssistant = new Map<number, HistorySpan>();
    const ownerByInvocationToolCall = new Map<string, number>();
    for (let index = 0; index < projected.length; index += 1) {
        const current = projected[index];
        if (!current?.projected) {
            continue;
        }
        if (current.projected.type === "assistant") {
            for (const toolCall of current.projected.toolCalls) {
                const ownerKey = `${current.invocationId ?? ""}\n${toolCall.id}`;
                if (!ownerByInvocationToolCall.has(ownerKey)) {
                    ownerByInvocationToolCall.set(ownerKey, index);
                }
            }
            continue;
        }
        if (current.projected.type !== "tool_result") {
            continue;
        }
        const ownerIndex = ownerByInvocationToolCall.get(`${current.invocationId ?? ""}\n${current.projected.toolCallId}`);
        if (ownerIndex === undefined) {
            continue;
        }
        const span = spansByAssistant.get(ownerIndex) ?? {start: ownerIndex, end: ownerIndex};
        span.end = index;
        spansByAssistant.set(ownerIndex, span);
    }

    const mergedSpans: HistorySpan[] = [];
    for (const span of [...spansByAssistant.values()].sort((left, right) => left.start - right.start)) {
        const previous = mergedSpans.at(-1);
        if (previous && span.start <= previous.end) {
            previous.end = Math.max(previous.end, span.end);
        } else {
            mergedSpans.push({...span});
        }
    }
    const spanByStart = new Map(mergedSpans.map((span) => [span.start, span]));

    const groups: HistoryGroup[] = [];
    for (let index = 0; index < projected.length; index += 1) {
        const current = projected[index];
        if (!current?.projected) {
            continue;
        }
        const span = spanByStart.get(index);
        if (span) {
            groups.push({
                rawStartEntryId: current.entry.id,
                entries: projected
                    .slice(span.start, span.end + 1)
                    .flatMap((item) => item.projected ? [item.projected] : []),
            });
            index = span.end;
            continue;
        }
        groups.push({rawStartEntryId: current.entry.id, entries: [current.projected]});
    }
    return groups;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
