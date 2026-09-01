/**
 * Provider 请求前的上下文预算估算、工具结果裁剪与门禁。
 *
 * Pi 的 provider 最终收到的是 system prompt、tools 和已 hydrate 的 messages；
 * 只估算 durable messages 会漏掉固定开销，也无法覆盖附件 hydrate 后的请求形状。
 * 这里沿用 Pi 的 chars/4 估算口径，并把裁剪限定在 toolResult 文本，避免静默丢掉用户输入。
 */
import type {Message, Tool} from "nbook/server/agent/messages/types";
import {estimateStoredContextTokens, estimateStoredMessageTokens} from "nbook/server/agent/messages/stored-message-tokens";
import type {StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";

export type ProviderContextEstimate = {
    tokens: number;
    systemTokens: number;
    toolTokens: number;
    messageTokens: number;
};

export type ProviderContextInput = {
    systemPrompt?: string;
    messages: readonly StoredMessageLike[];
    tools?: readonly Tool[];
};

/** 与 Pi estimateTextTokens 保持一致的保守文本估算。 */
export function estimateProviderTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** 估算最终 provider context；不读取附件 blob。 */
export function estimateProviderContextTokens(input: ProviderContextInput): ProviderContextEstimate {
    const systemTokens = input.systemPrompt ? estimateProviderTextTokens(input.systemPrompt) : 0;
    const toolTokens = input.tools && input.tools.length > 0
        ? estimateProviderTextTokens(JSON.stringify(input.tools))
        : 0;
    const messageEstimate = estimateStoredContextTokens(input.messages);
    const directMessageTokens = input.messages.reduce(
        (total, message) => total + estimateStoredMessageTokens(message),
        0,
    );
    // Pi usage 代表上一轮真实请求，可能包含当时的 system/tools；当前请求的固定前缀
    // 可能已经变化。取 usage 口径与当前请求全量保守估算的较大值，既不重复相加，
    // 也不会在动态工具集合变化时把当前前缀成本漏成 0。
    const messageTokens = Math.max(messageEstimate.tokens, directMessageTokens);
    return {
        tokens: Math.max(messageEstimate.tokens, directMessageTokens + systemTokens + toolTokens),
        systemTokens,
        toolTokens,
        messageTokens,
    };
}

export class ProviderContextOverflowError extends Error {
    readonly tokens: number;
    readonly contextWindow: number;
    readonly modelId: string;

    constructor(input: {tokens: number; contextWindow: number; modelId: string}) {
        super(`Provider 请求上下文 ${input.tokens} tokens 超过模型 ${input.modelId} 的 ${input.contextWindow} token 限制。`);
        this.name = "ProviderContextOverflowError";
        this.tokens = input.tokens;
        this.contextWindow = input.contextWindow;
        this.modelId = input.modelId;
    }
}

/** 最终 provider 请求统一门禁；调用方应在 streamSimple/completeSimple 前调用。 */
export function assertProviderContextWithinWindow(
    input: ProviderContextInput & {contextWindow: number; modelId: string},
): ProviderContextEstimate {
    const estimate = estimateProviderContextTokens(input);
    if (estimate.tokens > input.contextWindow) {
        throw new ProviderContextOverflowError({
            tokens: estimate.tokens,
            contextWindow: input.contextWindow,
            modelId: input.modelId,
        });
    }
    return estimate;
}

export type ProviderMessagePruneResult = {
    messages: Message[];
    pruned: boolean;
};

const INITIAL_TOOL_RESULT_MAX_CHARS = 2_000;
const MIN_TOOL_RESULT_CHARS = 128;
const TOOL_RESULT_TRUNCATION_MARKER = "\n\n[tool result truncated to fit the model context window]";

/**
 * 在不删除消息、不改变 toolCall/toolResult 配对的前提下，逐步压缩 toolResult 文本。
 * 返回的数组是 provider 临时输入；session 中的完整工具结果不被改写。
 */
export function pruneProviderMessagesForWindow(input: ProviderContextInput & {
    contextWindow: number;
}): ProviderMessagePruneResult {
    const originalMessages = input.messages as Message[];
    const fixedTokens = (input.systemPrompt ? estimateProviderTextTokens(input.systemPrompt) : 0)
        + (input.tools && input.tools.length > 0 ? estimateProviderTextTokens(JSON.stringify(input.tools)) : 0);
    const messageBudget = Math.max(0, input.contextWindow - fixedTokens);
    let maxToolResultChars = INITIAL_TOOL_RESULT_MAX_CHARS;
    let messages = originalMessages;
    let pruned = false;

    for (let attempt = 0; attempt < 8; attempt += 1) {
        messages = originalMessages.map((message) => {
            if (message.role !== "toolResult") {
                return message;
            }
            let remaining = maxToolResultChars;
            let changed = false;
            const content = message.content.map((block) => {
                if (block.type !== "text") {
                    return block;
                }
                if (remaining <= 0) {
                    changed = changed || block.text.length > 0;
                    return {type: "text" as const, text: ""};
                }
                if (block.text.length <= remaining) {
                    remaining -= block.text.length;
                    return block;
                }
                changed = true;
                const available = Math.max(0, remaining - TOOL_RESULT_TRUNCATION_MARKER.length);
                remaining = 0;
                return {
                    type: "text" as const,
                    text: `${block.text.slice(0, available)}${TOOL_RESULT_TRUNCATION_MARKER}`,
                };
            });
            return changed ? {...message, content} : message;
        });
        pruned = pruned || messages.some((message, index) => message !== originalMessages[index]);
        const estimate = estimateStoredContextTokens(messages as never).tokens;
        if (estimate <= messageBudget) {
            return {messages, pruned};
        }
        if (maxToolResultChars <= MIN_TOOL_RESULT_CHARS) {
            break;
        }
        maxToolResultChars = Math.max(MIN_TOOL_RESULT_CHARS, Math.floor(maxToolResultChars * 0.5));
    }

    return {messages, pruned};
}

/** 单消息估算的公开 seam，供 compaction budget 与边界测试共用。 */
export function estimateProviderMessageTokens(message: StoredMessageLike): number {
    return estimateStoredMessageTokens(message);
}
