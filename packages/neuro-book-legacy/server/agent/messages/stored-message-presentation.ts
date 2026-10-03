import type {AgentMessage, ImageContent, Message, TextContent} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage, StoredAttachmentContent, StoredContent} from "nbook/server/agent/messages/stored-types";

// 本模块会进 profile artifact 依赖图，必须保持零 npm 运行时依赖；
// pi-agent-core 的 token 估算器在 `stored-message-tokens.ts`。

/**
 * Pi 的图片估算器使用约 4800 个字符作为单张图片的保守成本。
 * stored message 不读取 blob，而是复用同一个固定成本，避免估算路径重新引入 IO。
 */
export const STORED_ATTACHMENT_ESTIMATED_CHARS = 4_800;

export type StoredMessageLike = AgentMessage | StoredAgentMessage;

/** 非视觉模型、compaction 和文本摘要共用的稳定附件 marker。 */
export function attachmentMarker(block: StoredAttachmentContent): string {
    return `[attachment omitted: ${block.attachment.mimeType}, ${String(block.attachment.bytes)} bytes${block.name ? `, ${block.name}` : ""}]`;
}

/** 将 stored message 转成不读取附件的文本展示消息。 */
export function storedMessageForText(message: StoredMessageLike): Message {
    if (message.role !== "user" && message.role !== "toolResult") {
        return message as Message;
    }
    if (typeof message.content === "string") {
        return message as Message;
    }
    const content: TextContent[] = (message.content as Array<StoredContent | ImageContent>).map((block) => {
        if (block.type === "text") {
            return block;
        }
        return {
            type: "text",
            text: block.type === "attachment"
                ? attachmentMarker(block)
                : `[image omitted: ${block.mimeType}]`,
        };
    });
    return {...message, content} as Message;
}

/** 将一组 stored message 转成不读取附件的文本展示消息。 */
export function storedMessagesForText(messages: readonly StoredMessageLike[]): Message[] {
    return messages.map(storedMessageForText);
}

/**
 * 从 message 中提取人类可读文本。
 * attachment 会按原 content 顺序变成 marker；该函数不会读取 blob。
 */
export function storedMessageText(message: StoredMessageLike, options?: {stripThinking?: boolean} | number): string {
    const stripThinking = (options && typeof options === "object") ? options.stripThinking : false;
    const standard = storedMessageForText(message);
    if (standard.role === "user") {
        if (typeof standard.content === "string") {
            return standard.content;
        }
        return standard.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    }
    if (standard.role === "assistant") {
        return standard.content.map((block) => {
            if (block.type === "text") {
                return block.text;
            }
            if (block.type === "thinking") {
                return stripThinking ? "" : block.thinking;
            }
            return `[tool:${block.name}]`;
        }).filter(Boolean).join("\n");
    }
    if (standard.role === "toolResult") {
        return standard.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    }
    const custom = message as {content?: unknown};
    return typeof custom.content === "string" ? custom.content : "";
}

/**
 * 将 stored message 转成估算专用的轻量 Pi message。
 * attachment 使用空 data 的 image block，只触发 Pi 固定图片成本，不创建 base64。
 */
export function storedMessageForEstimate(message: StoredMessageLike): Message {
    if (message.role !== "user" && message.role !== "toolResult") {
        return message as Message;
    }
    if (typeof message.content === "string") {
        return message as Message;
    }
    const content = (message.content as Array<StoredContent | ImageContent>).map((block): TextContent | ImageContent => {
        if (block.type === "text" || block.type === "image") {
            return block;
        }
        return {type: "image", data: "", mimeType: block.attachment.mimeType};
    });
    return {...message, content} as Message;
}
