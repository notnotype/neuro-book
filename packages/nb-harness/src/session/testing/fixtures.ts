/**
 * 测试用的条目构造器。消息按 `@oh-my-pi/pi-ai` 的完整类型构造（不用断言绕过），这样测试里的条目和运行时真实写入的形状一致。
 */

import type {AssistantMessage, Message, StopReason, ToolCall} from "@oh-my-pi/pi-ai";
import type {EntryInput, InteractionResponse, InvocationPhase, JsonValue} from "../types";

export function userMessage(text: string, timestamp = 1): EntryInput {
    return {type: "message", message: {role: "user", content: text, timestamp}};
}

export function developerMessage(text: string, timestamp = 1): EntryInput {
    return {type: "message", message: {role: "developer", content: text, timestamp}};
}

export function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
    return {type: "toolCall", id, name, arguments: args};
}

export function assistantMessage(
    content: AssistantMessage["content"],
    options: {stopReason?: StopReason; timestamp?: number} = {},
): EntryInput {
    const message: AssistantMessage = {
        role: "assistant",
        content,
        api: "openai-responses",
        provider: "test",
        model: "test-model",
        usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
        stopReason: options.stopReason ?? "stop",
        timestamp: options.timestamp ?? 1,
    };
    return {type: "message", message};
}

export function toolResult(toolCallId: string, toolName: string, text: string, isError = false, timestamp = 1): EntryInput {
    const message: Message = {role: "toolResult", toolCallId, toolName, content: [{type: "text", text}], isError, timestamp};
    return {type: "message", message};
}

export function titleChange(title: string, source: "auto" | "user" = "auto"): EntryInput {
    return {type: "title_change", title, source};
}

export function invocation(invocationId: string, phase: InvocationPhase): EntryInput {
    return {type: "custom", customType: "harness/invocation", data: {invocationId, phase}};
}

export function interactionRequest(interactionId: string, assistantEntryId: string, toolCallId: string, toolName = "edit"): EntryInput {
    return {
        type: "custom",
        customType: "harness/interaction",
        data: {interactionId, kind: "approval", phase: "request", request: {assistantEntryId, toolCallId, toolName, tier: "write"}},
    };
}

export function interactionResponse(interactionId: string, response: InteractionResponse): EntryInput {
    return {type: "custom", customType: "harness/interaction", data: {interactionId, kind: "approval", phase: "response", response: response as unknown as JsonValue}};
}

export function seed(text: string, options: {role?: "user" | "developer"; once?: boolean} = {}): EntryInput {
    return {type: "custom_message", customType: "harness/seed", content: text, display: true, details: {role: options.role ?? "user", ...(options.once === undefined ? {} : {once: options.once})}};
}

export function reminder(text: string): EntryInput {
    return {type: "custom_message", customType: "harness/reminder", content: `<system-reminder>\n${text}\n</system-reminder>`, display: false};
}
