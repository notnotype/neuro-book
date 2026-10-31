/**
 * 请求的提纲：一行一条消息，块以来源标出（docs/specs/harness/profile.md 输出 20）。测试与预览按它断言请求的结构，
 * 不比拼接后的字符串。
 */

import type {Message, ModelRequest, Origin} from "../api/index.js";

export function originLabel(origin: Origin): string {
    switch (origin.kind) {
        case "fixed":
            return `fixed:${origin.by}`;
        case "event":
            return `event:${origin.type}`;
        case "slot":
            return `slot:${origin.name}@${origin.extension}`;
        case "summary":
            return `summary:${origin.compactionId}`;
        case "intercept":
            return `intercept:${origin.extension}`;
    }
}

function line(role: string, message: {content: Message["content"]; toolCalls?: Message["toolCalls"]}): string {
    return `${role}: ${[...message.content.map((block) => originLabel(block.origin)), ...(message.toolCalls ?? []).map((call) => `call:${call.tool}`)].join(" | ")}`;
}

export function outline(request: Pick<ModelRequest, "system" | "messages">): string[] {
    return [...(request.system.length === 0 ? [] : [line("system", {content: request.system})]), ...request.messages.map((message) => line(message.role, message))];
}
