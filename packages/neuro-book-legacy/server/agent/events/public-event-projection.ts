import {randomUUID} from "node:crypto";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AssistantMessage, AssistantMessageEvent, ToolCall, Usage} from "@earendil-works/pi-ai";
import {
    CHAT_ENTRY_PREVIEW_BYTES,
    LIVE_TOOL_PREVIEW_BYTES,
    LIVE_TOOL_PROGRESS_BYTES,
    PUBLIC_PATH_MAX_BYTES,
    PUBLIC_RUNTIME_TOOL_CALLS,
    PUBLIC_RUNTIME_TOOL_PREVIEW_BYTES,
} from "nbook/server/agent/events/public-event-policy";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import {
    createPublicProjectionBudget,
    projectPublicToolArgs,
    projectPublicToolName,
    projectPublicToolResult,
    publicToolArgsOmitted,
    textPreview,
} from "nbook/server/agent/events/public-tool-projection";
import type {UserInputFormSpec} from "nbook/server/agent/tools/types";
import {publicAgentUserInputFormSpec} from "nbook/server/agent/events/public-user-input-form";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";

type ExtendedAgentEvent = AgentEvent | {
    type: "tool_user_input_required";
    toolCallId: string;
    toolName: string;
    args: unknown;
    formSpec?: UserInputFormSpec;
};

type PublicToolCallStreamState = {
    streamBytes: number;
    lastMilestone: number;
    nextProjectionBytes: number;
    lastArgsSignature: string;
    previewBytes: number;
    observedTextCodeUnits: number;
    observedTextBytes: number;
    observedTextTail: string;
};

/**
 * 单次 RunFrame 的公开事件投影状态。只保存有界公开数据和计数，不保存 provider partial。
 */
export type PublicRuntimeProjectionState = {
    runStreamId: string;
    nextMessageSequence: number;
    activeMessageId?: string;
    toolCalls: Map<number, PublicToolCallStreamState>;
    /** 当前 assistant message 尚未分配给 tool-call preview 的 aggregate 预算。 */
    toolPreviewBytesRemaining: number;
};

/**
 * 创建单次 run 的公开事件投影状态。
 */
export function createPublicRuntimeProjectionState(): PublicRuntimeProjectionState {
    return {
        runStreamId: randomUUID(),
        nextMessageSequence: 0,
        toolCalls: new Map(),
        toolPreviewBytesRemaining: PUBLIC_RUNTIME_TOOL_PREVIEW_BYTES,
    };
}

/**
 * 把 provider/tool 原始事件投影成 immutable、delta-first 的公开事件。
 */
export function projectRuntimeEvent(
    state: PublicRuntimeProjectionState,
    event: ExtendedAgentEvent,
): AgentRuntimeStreamEventDto | null {
    if (event.type === "message_start") {
        const message = assistantMessage(event.message);
        if (!message) {
            return null;
        }
        const messageId = nextMessageId(state);
        state.activeMessageId = messageId;
        state.toolCalls.clear();
        state.toolPreviewBytesRemaining = PUBLIC_RUNTIME_TOOL_PREVIEW_BYTES;
        return {
            type: "message_start",
            messageId,
            role: "assistant",
            timestamp: message.timestamp,
            model: textPreview(message.model, 1024).preview,
        };
    }
    if (event.type === "message_update") {
        const message = assistantMessage(event.message);
        if (!message) {
            return null;
        }
        const messageId = state.activeMessageId ?? nextMessageId(state);
        state.activeMessageId = messageId;
        const update = projectAssistantUpdate(state, event.assistantMessageEvent);
        return update ? {
            type: "message_update",
            messageId,
            update,
        } : null;
    }
    if (event.type === "message_end") {
        const message = assistantMessage(event.message);
        if (!message) {
            return null;
        }
        const messageId = state.activeMessageId ?? nextMessageId(state);
        state.activeMessageId = undefined;
        state.toolCalls.clear();
        state.toolPreviewBytesRemaining = PUBLIC_RUNTIME_TOOL_PREVIEW_BYTES;
        return {
            type: "message_end",
            messageId,
            stopReason: message.stopReason,
            usage: cloneUsage(message.usage),
            ...(message.responseModel ? {responseModel: textPreview(message.responseModel, 1024).preview} : {}),
            ...(message.errorMessage ? {errorMessage: textPreview(message.errorMessage, 16 * 1024).preview} : {}),
        };
    }
    if (event.type === "tool_execution_start") {
        const toolCallId = assertPublicToolCallId(event.toolCallId);
        return {
            type: "tool_execution_start",
            toolCallId,
            toolName: projectPublicToolName(event.toolName),
            args: projectPublicToolArgs(event.toolName, event.args),
        };
    }
    if (event.type === "tool_execution_update") {
        const toolCallId = assertPublicToolCallId(event.toolCallId);
        return {
            type: "tool_execution_update",
            toolCallId,
            toolName: projectPublicToolName(event.toolName),
            partialResult: projectPublicToolResult(event.toolName, event.partialResult),
        };
    }
    if (event.type === "tool_execution_end") {
        const toolCallId = assertPublicToolCallId(event.toolCallId);
        return {
            type: "tool_execution_end",
            toolCallId,
            toolName: projectPublicToolName(event.toolName),
            result: projectPublicToolResult(event.toolName, event.result),
            isError: event.isError,
        };
    }
    if (event.type === "tool_user_input_required") {
        const toolCallId = assertPublicToolCallId(event.toolCallId);
        let formSpec: ReturnType<typeof publicAgentUserInputFormSpec> | undefined;
        if (event.toolName !== "request_user_input" && event.formSpec?.form) {
            formSpec = publicAgentUserInputFormSpec(event.formSpec);
        }
        return {
            type: "tool.user-input-required",
            toolCallId,
            toolName: projectPublicToolName(event.toolName),
            args: projectPublicToolArgs(event.toolName, event.args),
            ...(formSpec ? {formSpec} : {}),
        };
    }
    return null;
}

/**
 * 投影一条 provider assistant update；累计 partial 只用于读取当前有界结构，不进入返回值。
 */
function projectAssistantUpdate(
    state: PublicRuntimeProjectionState,
    event: AssistantMessageEvent,
): Extract<AgentRuntimeStreamEventDto, {type: "message_update"}>["update"] | null {
    if (event.type === "text_start"
        || event.type === "text_end"
        || event.type === "thinking_start"
        || event.type === "thinking_end") {
        return {
            type: event.type,
            contentIndex: event.contentIndex,
        };
    }
    if (event.type === "text_delta" || event.type === "thinking_delta") {
        const delta = textPreview(event.delta, CHAT_ENTRY_PREVIEW_BYTES);
        return {
            type: event.type,
            contentIndex: event.contentIndex,
            delta: delta.preview,
            deltaBytes: delta.bytes,
            deltaOmitted: delta.omitted,
        };
    }
    if (event.type === "toolcall_start") {
        const toolCall = partialToolCall(event);
        if (!toolCall) {
            return null;
        }
        const toolCallId = assertPublicToolCallId(toolCall.id);
        if (state.toolCalls.has(event.contentIndex)) {
            return {
                type: "toolcall_start",
                contentIndex: event.contentIndex,
                toolCallId,
                ...(toolCall.name ? {toolName: projectPublicToolName(toolCall.name)} : {}),
            };
        }
        if (state.toolCalls.size >= PUBLIC_RUNTIME_TOOL_CALLS) {
            return {
                type: "toolcall_start",
                contentIndex: event.contentIndex,
                toolCallId,
                ...(toolCall.name ? {toolName: projectPublicToolName(toolCall.name)} : {}),
            };
        }
        const previewBytes = Math.min(LIVE_TOOL_PREVIEW_BYTES, state.toolPreviewBytesRemaining);
        state.toolPreviewBytesRemaining = Math.max(0, state.toolPreviewBytesRemaining - previewBytes);
        state.toolCalls.set(event.contentIndex, {
            streamBytes: 0,
            lastMilestone: -1,
            nextProjectionBytes: LIVE_TOOL_PREVIEW_BYTES,
            lastArgsSignature: "",
            previewBytes,
            observedTextCodeUnits: 0,
            observedTextBytes: 0,
            observedTextTail: "",
        });
        return {
            type: "toolcall_start",
            contentIndex: event.contentIndex,
            toolCallId,
            ...(toolCall?.name ? {toolName: projectPublicToolName(toolCall.name)} : {}),
        };
    }
    if (event.type === "toolcall_delta") {
        const toolCall = partialToolCall(event);
        if (!toolCall) {
            return null;
        }
        const toolCallId = assertPublicToolCallId(toolCall.id);
        const current = state.toolCalls.get(event.contentIndex);
        if (!current) {
            return null;
        }
        current.streamBytes += Buffer.byteLength(event.delta, "utf8");
        if (current.streamBytes > LIVE_TOOL_PREVIEW_BYTES && current.streamBytes < current.nextProjectionBytes) {
            state.toolCalls.set(event.contentIndex, current);
            return null;
        }
        const args = projectStreamingToolArgs(toolCall?.name ?? "unknown", toolCall?.arguments ?? {}, current);
        const argsSignature = publicArgsPreviewSignature(args);
        const milestone = Math.floor(current.streamBytes / LIVE_TOOL_PROGRESS_BYTES);
        const omitted = publicToolArgsOmitted(args);
        if (omitted && argsSignature === current.lastArgsSignature && milestone === current.lastMilestone) {
            state.toolCalls.set(event.contentIndex, current);
            return null;
        }
        current.lastArgsSignature = argsSignature;
        current.lastMilestone = milestone;
        if (omitted && current.streamBytes >= LIVE_TOOL_PREVIEW_BYTES) {
            current.nextProjectionBytes = Math.max(
                current.streamBytes + LIVE_TOOL_PROGRESS_BYTES,
                current.streamBytes * 2,
            );
        }
        state.toolCalls.set(event.contentIndex, current);
        return {
            type: "toolcall_args",
            contentIndex: event.contentIndex,
            toolCallId,
            ...(toolCall?.name ? {toolName: projectPublicToolName(toolCall.name)} : {}),
            args,
            streamBytes: current.streamBytes,
            omitted,
        };
    }
    if (event.type === "toolcall_end") {
        const toolCallId = assertPublicToolCallId(event.toolCall.id);
        state.toolCalls.delete(event.contentIndex);
        return {
            type: "toolcall_end",
            contentIndex: event.contentIndex,
            toolCallId,
            toolName: projectPublicToolName(event.toolCall.name),
            args: projectPublicToolArgs(event.toolCall.name, event.toolCall.arguments),
        };
    }
    return null;
}

/**
 * write 的累计正文按新增 suffix 统计 bytes，只复制固定大小前缀作为预览，避免每个
 * toolcall delta 都重新扫描完整章节。其他工具继续走中央通用投影。
 */
function projectStreamingToolArgs(
    toolName: string,
    args: unknown,
    state: PublicToolCallStreamState,
): ReturnType<typeof projectPublicToolArgs> {
    if (toolName !== "write" || args === null || typeof args !== "object" || Array.isArray(args)) {
        return projectPublicToolArgs(toolName, args, createPublicProjectionBudget(state.previewBytes));
    }
    const record = args as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content : "";
    const previousStart = Math.max(0, state.observedTextCodeUnits - state.observedTextTail.length);
    const appendOnly = content.length >= state.observedTextCodeUnits
        && content.slice(previousStart, state.observedTextCodeUnits) === state.observedTextTail;
    state.observedTextBytes = appendOnly
        ? state.observedTextBytes + Buffer.byteLength(content.slice(state.observedTextCodeUnits), "utf8")
        : Buffer.byteLength(content, "utf8");
    state.observedTextCodeUnits = content.length;
    state.observedTextTail = content.slice(Math.max(0, content.length - 32));
    const preview = textPreview(content.slice(0, state.previewBytes), state.previewBytes);
    const previewBytes = Buffer.byteLength(preview.preview, "utf8");
    return {
        kind: "write",
        ...(typeof record.path === "string" ? {path: textPreview(record.path, PUBLIC_PATH_MAX_BYTES).preview} : {}),
        contentPreview: preview.preview,
        contentBytes: state.observedTextBytes,
        contentOmitted: state.observedTextBytes > previewBytes,
    };
}

/**
 * 只比较用户可见预览形状；原始 byte counter 单独由 milestone 控制，避免正文
 * 达到预览上限后每个 token 都因 contentBytes 变化而继续发布。
 */
function publicArgsPreviewSignature(args: ReturnType<typeof projectPublicToolArgs>): string {
    return JSON.stringify(args, (key, value) => {
        return key === "bytes" || key.endsWith("Bytes") || key === "streamBytes"
            ? 0
            : value;
    });
}

/**
 * 返回 partial 当前 contentIndex 的 tool call；不保存其引用。
 */
function partialToolCall(event: Extract<AssistantMessageEvent, {contentIndex: number}>): ToolCall | null {
    if (!("partial" in event)) {
        return null;
    }
    const block = event.partial.content[event.contentIndex];
    return block?.type === "toolCall" ? block : null;
}

/**
 * provider message 只接受 assistant；其他角色不是公开 streaming message。
 */
function assistantMessage(message: unknown): AssistantMessage | null {
    return message !== null
        && typeof message === "object"
        && "role" in message
        && message.role === "assistant"
        ? message as AssistantMessage
        : null;
}

/**
 * 为当前 run 分配稳定、不会因 timestamp 冲突的 live message ID。
 */
function nextMessageId(state: PublicRuntimeProjectionState): string {
    const sequence = state.nextMessageSequence;
    state.nextMessageSequence += 1;
    return `${state.runStreamId}:message:${String(sequence)}`;
}

/**
 * Usage 含嵌套 cost，需要完整复制才能脱离 provider message。
 */
function cloneUsage(usage: Usage): Usage {
    return {
        ...usage,
        cost: {...usage.cost},
    };
}
