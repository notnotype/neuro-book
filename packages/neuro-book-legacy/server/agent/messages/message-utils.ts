import type {AgentMessage, AgentUserMessageInput, AssistantMessage, Message, TextContent, ToolResultMessage, Usage} from "nbook/server/agent/messages/types";
import type {NeuroToolResult} from "nbook/server/agent/tools/types";
import {attachmentMarker, storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {StoredAgentMessage, StoredContent, StoredToolResultMessage, StoredUserMessage} from "nbook/server/agent/messages/stored-types";
import type {JsonValue} from "nbook/server/agent/messages/types";

export const EMPTY_USAGE: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
    },
};

/**
 * 累加多次 assistant provider usage。
 */
export function sumUsage(usages: Array<Usage | undefined>): Usage | undefined {
    const presentUsages = usages.filter((usage): usage is Usage => Boolean(usage));
    if (presentUsages.length === 0) {
        return undefined;
    }

    const hasReasoning = presentUsages.some((usage) => usage.reasoning !== undefined);
    const hasCacheWrite1h = presentUsages.some((usage) => usage.cacheWrite1h !== undefined);
    const total = presentUsages.reduce<Usage>((sum, usage) => ({
        input: sum.input + usage.input,
        output: sum.output + usage.output,
        cacheRead: sum.cacheRead + usage.cacheRead,
        cacheWrite: sum.cacheWrite + usage.cacheWrite,
        totalTokens: sum.totalTokens + usage.totalTokens,
        cost: {
            input: sum.cost.input + usage.cost.input,
            output: sum.cost.output + usage.cost.output,
            cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
            cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
            total: sum.cost.total + usage.cost.total,
        },
    }), EMPTY_USAGE);
    return {
        ...total,
        ...(hasReasoning ? {reasoning: presentUsages.reduce((sum, usage) => sum + (usage.reasoning ?? 0), 0)} : {}),
        ...(hasCacheWrite1h ? {cacheWrite1h: presentUsages.reduce((sum, usage) => sum + (usage.cacheWrite1h ?? 0), 0)} : {}),
    };
}

/**
 * 汇总 session 消息里的所有 assistant provider usage。
 */
export function sumAssistantUsage(messages: AgentMessage[]): Usage | undefined {
    return sumUsage(messages.map((message) => message.role === "assistant" ? message.usage : undefined));
}

/**
 * 当前时间戳。集中封装，测试中可以用显式 timestamp 覆盖。
 */
export function now(): number {
    return Date.now();
}

/**
 * 构造 Pi user message。
 */
export function createUserMessage(input: AgentUserMessageInput, timestamp = now()): Message & StoredUserMessage {
    const textBlock: TextContent = {
        type: "text",
        text: input.text,
    };

    return {
        role: "user",
        content: [textBlock],
        timestamp,
    };
}

/**
 * 构造纯文本 tool result。
 */
export function createTextToolResult(input: {
    toolCallId: string;
    toolName: string;
    text: string;
    isError?: boolean;
    details?: unknown;
    timestamp?: number;
}): ToolResultMessage & StoredToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: [{type: "text", text: input.text}],
        ...(input.details === undefined ? {} : {details: normalizeToolResultDetails(input.details)}),
        isError: input.isError ?? false,
        timestamp: input.timestamp ?? now(),
    };
}

/**
 * 从工具原始结果构造 toolResult，保留图片等非文本 content。
 */
export function createToolResultFromResult(input: {
    toolCallId: string;
    toolName: string;
    result: NeuroToolResult;
    isError?: boolean;
    timestamp?: number;
}): ToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        // 该函数只用于 Pi AgentEvent seam。attachment 在这里显式投影为稳定 marker；
        // durable 结果必须使用 createStoredToolResultFromResult 保留引用。
        content: input.result.content.map((block: StoredContent) => block.type === "text"
            ? block
            : {type: "text" as const, text: attachmentMarker(block)}),
        ...(input.result.details === undefined ? {} : {details: normalizeToolResultDetails(input.result.details)}),
        isError: input.isError ?? false,
        timestamp: input.timestamp ?? now(),
    };
}

/** 构造只含文本的 durable user message；附件入口由 AgentAttachmentCodec 负责。 */
export function createStoredUserMessage(text: string, timestamp = now()): StoredUserMessage {
    return {
        role: "user",
        content: [{type: "text", text}],
        timestamp,
    };
}

/**
 * 构造可直接进入 RunToolBatch/JSONL 的纯文本 tool result。
 *
 * Pi `ToolResultMessage` 与 stored tool result 的 text block 当前结构相同，但二者的
 * content 联合不同，必须通过该构造器显式选择 durable 边界，不能依赖类型强转。
 */
export function createStoredTextToolResult(input: {
    toolCallId: string;
    toolName: string;
    text: string;
    isError?: boolean;
    details?: unknown;
    timestamp?: number;
}): StoredToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: [{type: "text", text: input.text}],
        ...(input.details === undefined ? {} : {details: normalizeToolResultDetails(input.details)}),
        isError: input.isError ?? false,
        timestamp: input.timestamp ?? now(),
    };
}

/** 构造不含 Pi image/base64 的 durable tool result。 */
export function createStoredToolResultFromResult(input: {
    toolCallId: string;
    toolName: string;
    result: NeuroToolResult;
    isError?: boolean;
    timestamp?: number;
}): StoredToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: input.result.content,
        ...(input.result.details === undefined ? {} : {details: normalizeToolResultDetails(input.result.details)}),
        isError: input.isError ?? false,
        timestamp: input.timestamp ?? now(),
    };
}

/**
 * 把工具执行期 details 收口为 JSONL 可持久化值。
 * undefined object 字段按 JSON 语义省略，array 中的 undefined 变为 null；bigint
 * 使用十进制字符串，避免 JSON.stringify 在 durable write 时才抛错。
 */
export function normalizeToolResultDetails(value: unknown): JsonValue {
    const seen = new WeakSet<object>();
    const normalize = (current: unknown, inArray: boolean): JsonValue | undefined => {
        if (current === undefined) {
            return inArray ? null : undefined;
        }
        if (current === null || typeof current === "string" || typeof current === "boolean") {
            return current;
        }
        if (typeof current === "number") {
            return Number.isFinite(current) ? current : null;
        }
        if (typeof current === "bigint") {
            return current.toString();
        }
        if (typeof current !== "object") {
            throw new Error(`工具 details 包含不可持久化类型：${typeof current}`);
        }
        if (seen.has(current)) {
            throw new Error("工具 details 包含循环引用");
        }
        seen.add(current);
        try {
            if (Array.isArray(current)) {
                return current.map((item) => normalize(item, true) ?? null);
            }
            const result: Record<string, JsonValue> = {};
            for (const [key, item] of Object.entries(current)) {
                const normalized = normalize(item, false);
                if (normalized !== undefined) {
                    result[key] = normalized;
                }
            }
            return result;
        } finally {
            seen.delete(current);
        }
    };
    return normalize(value, true) ?? null;
}

/**
 * 构造测试或兜底用 assistant message。
 */
export function createAssistantTextMessage(input: {
    text: string;
    model?: string;
    api?: string;
    provider?: string;
    stopReason?: AssistantMessage["stopReason"];
    usage?: Usage;
    timestamp?: number;
}): AssistantMessage {
    return {
        role: "assistant",
        content: [{type: "text", text: input.text}],
        api: input.api ?? "neuro-book",
        provider: input.provider ?? "neuro-book",
        model: input.model ?? "neuro-agent",
        usage: input.usage ?? EMPTY_USAGE,
        stopReason: input.stopReason ?? "stop",
        timestamp: input.timestamp ?? now(),
    };
}

/**
 * 从 message 中提取人类可读文本。
 */
export function messageText(message: AgentMessage | StoredAgentMessage, options?: { stripThinking?: boolean } | number): string {
    // 统一由 stored presentation policy 处理 attachment marker；number 兼容 map(messageText) 回调。
    return storedMessageText(message, options);
}

/**
 * 判断 assistant message 是否包含指定 tool call。
 */
export function hasToolCall(message: Message, toolName?: string): boolean {
    return message.role === "assistant" && message.content.some((block) => {
        return block.type === "toolCall" && (!toolName || block.name === toolName);
    });
}
