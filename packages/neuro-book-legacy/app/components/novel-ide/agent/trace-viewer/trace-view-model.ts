/**
 * Pi 请求 trace 查看器的纯视图模型：列表分组、pi 规范化 context 的形状探测、格式化。
 *
 * 只依赖 trace DTO 类型，不碰 store / API / session 概念——List/Detail 组件与本文件
 * 是查看器的「可分离核心」，将来可随 recorder/reader 一起抽成独立库。
 */
import type {AgentTraceIndexEntryDto, AgentTraceStatusDto} from "nbook/shared/dto/agent-trace.dto";

/** 列表分组：同一 invocationId 的连续条目折成一组（一次 run 的多次调用）；无 invocationId 的条目各自成组。 */
export type TraceGroup<T extends AgentTraceIndexEntryDto = AgentTraceIndexEntryDto> = {
    /** 组内条目共享的 invocationId；独立条目为空。 */
    invocationId?: string;
    entries: T[];
};

export function groupTraceEntries<T extends AgentTraceIndexEntryDto>(entries: T[]): Array<TraceGroup<T>> {
    const groups: Array<TraceGroup<T>> = [];
    for (const entry of entries) {
        const last = groups[groups.length - 1];
        if (entry.invocationId && last?.invocationId === entry.invocationId) {
            last.entries.push(entry);
        } else {
            groups.push({invocationId: entry.invocationId, entries: [entry]});
        }
    }
    return groups;
}

/** 列表行唯一键：「最近请求」聚合视图里 id 是各 bucket 独立的 seq，必须带 bucket 前缀防跨 bucket 撞键。 */
export function traceEntryKey(entry: {id: string; bucket?: string}): string {
    return entry.bucket ? `${entry.bucket}/${entry.id}` : entry.id;
}

/** 轻量结构化渲染的消息块。探测不出形状的内容降级为 json 块透传 JsonViewer。 */
export type TraceMessageBlock =
    | {kind: "text"; text: string}
    | {kind: "thinking"; text: string}
    | {kind: "toolCall"; name: string; args: unknown}
    | {kind: "json"; value: unknown};

export type TraceMessageView = {
    role: string;
    /** 补充说明，如 toolResult 的 toolCallId / 错误标记；可空。 */
    note?: string;
    blocks: TraceMessageBlock[];
};

export type TraceToolView = {
    name: string;
    description?: string;
    /** 原始 tool 定义（含 schema），透传 JsonViewer。 */
    raw: unknown;
};

/** pi 规范化 context（{systemPrompt, messages, tools}）的形状探测结果。 */
export type TraceContextView = {
    systemPrompt?: string;
    messages: TraceMessageView[];
    tools: TraceToolView[];
};

/**
 * 探测 trace 的 request.context。context 在 DTO 里是任意 JSON（unknown），
 * 这里按 pi 规范化形状尽力解析，解析不了的部分降级为 json 块，绝不 throw。
 */
export function normalizeTraceContext(context: unknown): TraceContextView | null {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
        return null;
    }
    const raw = context as {systemPrompt?: unknown; messages?: unknown; tools?: unknown};
    return {
        systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : undefined,
        messages: Array.isArray(raw.messages) ? raw.messages.map(normalizeTraceMessage) : [],
        tools: Array.isArray(raw.tools) ? raw.tools.map(normalizeTraceTool) : [],
    };
}

function normalizeTraceMessage(message: unknown): TraceMessageView {
    if (!message || typeof message !== "object") {
        return {role: "unknown", blocks: [{kind: "json", value: message}]};
    }
    const raw = message as {role?: unknown; content?: unknown; toolCallId?: unknown; toolName?: unknown; isError?: unknown};
    const role = typeof raw.role === "string" ? raw.role : "unknown";
    const noteParts: string[] = [];
    if (typeof raw.toolName === "string") {
        noteParts.push(raw.toolName);
    }
    if (typeof raw.toolCallId === "string") {
        noteParts.push(raw.toolCallId);
    }
    if (raw.isError === true) {
        noteParts.push("error");
    }
    return {
        role,
        note: noteParts.length ? noteParts.join(" · ") : undefined,
        blocks: normalizeContentBlocks(raw.content),
    };
}

function normalizeContentBlocks(content: unknown): TraceMessageBlock[] {
    if (typeof content === "string") {
        return [{kind: "text", text: content}];
    }
    if (!Array.isArray(content)) {
        return content === undefined ? [] : [{kind: "json", value: content}];
    }
    return content.map((block): TraceMessageBlock => {
        if (!block || typeof block !== "object") {
            return {kind: "json", value: block};
        }
        const raw = block as {type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown};
        if (raw.type === "text" && typeof raw.text === "string") {
            return {kind: "text", text: raw.text};
        }
        if (raw.type === "thinking" && typeof raw.thinking === "string") {
            return {kind: "thinking", text: raw.thinking};
        }
        if (raw.type === "toolCall" && typeof raw.name === "string") {
            return {kind: "toolCall", name: raw.name, args: raw.arguments};
        }
        return {kind: "json", value: block};
    });
}

function normalizeTraceTool(tool: unknown): TraceToolView {
    const raw = tool && typeof tool === "object" ? tool as {name?: unknown; description?: unknown} : {};
    return {
        name: typeof raw.name === "string" ? raw.name : "(unnamed)",
        description: typeof raw.description === "string" ? raw.description : undefined,
        raw: tool,
    };
}

/** 毫秒 → 人读时长；缺省显示 —（compaction 无 TTFT 等）。 */
export function formatMs(ms?: number): string {
    if (ms === undefined) {
        return "—";
    }
    return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/** token 数 → 人读计数；缺省显示 —。 */
export function formatTokens(count?: number): string {
    if (count === undefined) {
        return "—";
    }
    return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`;
}

/** ISO 时间戳 → 本地 HH:MM:SS。 */
export function formatTraceTime(ts: string): string {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? ts : date.toLocaleTimeString();
}

/** 状态圆点配色。 */
export function traceStatusDotClass(status: AgentTraceStatusDto): string {
    if (status === "ok") {
        return "bg-[var(--status-success)]";
    }
    return status === "error" ? "bg-[var(--status-danger)]" : "bg-[var(--status-warning)]";
}
