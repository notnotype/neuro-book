/**
 * 内容的大纲：消息页一行要的角色、预览、token 数与工具调用摘要（docs/specs/agent/request-trace.md 输出 19）。
 * 只从去过图的内容算（`sanitize.ts`），token 与压缩、上下文检查器同一个估算口径。
 */

import {estimateImageTokens, estimateTokens} from "../../kernel/index.js";
import type {ContentBlock, JsonValue, Message, RequestBlock, ToolCall, ToolDeclaration} from "../../kernel/contracts.js";
import type {BlockOutline, MessageOutline, ToolOutline} from "./types.js";

/** 预览最多这么多字：一行放得下，多了界面也会截。 */
export const PREVIEW_CHARS = 160;
/** 工具调用参数里的字符串只留开头：写一整章的参数不进大纲。 */
const ARG_CHARS = 200;

export function previewOf(text: string): string {
    const line = text.trim().split("\n", 1)[0] ?? "";
    return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS)}…` : line;
}

/** 文字类块的全文（思考也算：它占 token，也可能是查找的对象）。 */
function textOf(blocks: readonly ContentBlock[]): string {
    return blocks.flatMap((block) => (block.kind === "text" || block.kind === "thinking" ? [block.text] : [])).join("\n");
}

function imageTokens(blocks: readonly ContentBlock[]): number {
    return blocks.reduce((sum, block) => sum + (block.kind === "image" || block.kind === "imageRef" ? estimateImageTokens(block) : 0), 0);
}

function clip(value: unknown): JsonValue {
    if (typeof value === "string") return value.length > ARG_CHARS ? `${value.slice(0, ARG_CHARS)}…` : value;
    const text = JSON.stringify(value) ?? "null";
    return text.length > ARG_CHARS ? `${text.slice(0, ARG_CHARS)}…` : (value as JsonValue);
}

function callSummary(call: ToolCall): NonNullable<MessageOutline["toolCalls"]>[number] {
    return {id: call.id, tool: call.tool, args: Object.fromEntries(Object.entries(call.args).map(([key, value]) => [key, clip(value)]))};
}

function messageLike(role: MessageOutline["role"], content: readonly ContentBlock[], toolCalls: readonly ToolCall[] | undefined, hash: string, extra: Pick<MessageOutline, "callId" | "isError" | "summary">): MessageOutline {
    const text = textOf(content);
    const calls = toolCalls ?? [];
    const firstCall = calls[0];
    return {
        hash,
        role,
        // 只有工具调用、没有文字的回复：预览写第一个调用，界面另把调用逐个列出。
        preview: text.trim() !== "" ? previewOf(text) : firstCall !== undefined ? firstCall.tool : "",
        tokens: estimateTokens(text) + imageTokens(content) + (calls.length === 0 ? 0 : estimateTokens(JSON.stringify(calls.map((call) => call.args)))),
        ...(calls.length === 0 ? {} : {toolCalls: calls.map(callSummary)}),
        ...extra,
        images: content.filter((block) => block.kind === "image" || block.kind === "imageRef").length,
    };
}

export function messageOutline(hash: string, message: Message): MessageOutline {
    // 压缩留下的摘要：比较两次请求时据此写“历史被压缩”（docs/specs/agent/request-trace.md 输出 21）。
    const summary = message.content.some((block) => block.origin?.kind === "summary");
    return messageLike(message.role, message.content, message.toolCalls, hash, {
        ...(message.callId === undefined ? {} : {callId: message.callId}),
        ...(message.isError === undefined ? {} : {isError: message.isError}),
        ...(summary ? {summary: true as const} : {}),
    });
}

/** 回复：内容块与工具调用，作为最后一条助手消息显示。 */
export function replyOutline(hash: string, reply: {readonly content: readonly ContentBlock[]; readonly toolCalls: readonly ToolCall[]}): MessageOutline {
    return messageLike("assistant", reply.content, reply.toolCalls, hash, {});
}

export function blockOutline(hash: string, block: RequestBlock): BlockOutline {
    const text = textOf([block]);
    return {hash, preview: previewOf(text), tokens: estimateTokens(text) + imageTokens([block])};
}

export function toolOutline(hash: string, tool: ToolDeclaration): ToolOutline {
    return {hash, id: tool.id, description: previewOf(tool.description)};
}
