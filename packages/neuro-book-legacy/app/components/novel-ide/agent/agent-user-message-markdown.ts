import type {AgentMessage, AgentMessageContentBlock} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {AgentChatUserEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import {
    attachmentIdFromMarkdownTarget,
    attachmentMarkdownTarget,
    parseAgentImageMarkdown,
    serializeAgentImageMarkdown,
} from "nbook/shared/agent/agent-image-markdown";

const UTF8_ENCODER = new TextEncoder();

export type AgentUserContentIdentity = {
    /** 所有公开 block 完整时存在，用于精确消费乐观消息。 */
    exact?: string;
    /** 正文被公开预算截断时，使用文本字节数与图片序列兜底匹配。 */
    fallback: string;
};

/** 从 Composer Markdown 构造保序的乐观用户消息。 */
export function optimisticUserMessage(input: {
    id: string;
    clientMessageId: string;
    markdown: string;
    attachments: readonly AgentSessionAttachmentItemDto[];
    timestamp: string;
    deliveryMode?: "prompt" | "steer" | "followup";
}): AgentMessage {
    const attachmentById = new Map(input.attachments.map((item) => [item.attachment.attachmentId, item]));
    const contentBlocks: AgentMessageContentBlock[] = [];
    let contentIndex = 0;
    let text = "";
    let textBytes = 0;

    for (const part of parseAgentImageMarkdown(input.markdown)) {
        if (part.type === "text") {
            const bytes = UTF8_ENCODER.encode(part.text).byteLength;
            contentBlocks.push({
                type: "text",
                contentIndex,
                content: {preview: part.text, bytes, omitted: false},
            });
            text += part.text;
            textBytes += bytes;
            contentIndex += 1;
            continue;
        }
        const attachmentId = attachmentIdFromMarkdownTarget(part.target);
        const item = attachmentId ? attachmentById.get(attachmentId) : undefined;
        if (!item) {
            const bytes = UTF8_ENCODER.encode(part.raw).byteLength;
            contentBlocks.push({
                type: "text",
                contentIndex,
                content: {preview: part.raw, bytes, omitted: false},
            });
            text += part.raw;
            textBytes += bytes;
            contentIndex += 1;
            continue;
        }
        contentBlocks.push({
            type: "attachment",
            contentIndex,
            attachment: {
                ...item.attachment,
                ...(part.label ? {name: part.label} : {}),
            },
            locator: {...item.locator},
        });
        contentIndex += 1;
    }

    const attachments = contentBlocks.flatMap((block) => block.type === "attachment"
        ? [{
            contentIndex: block.contentIndex,
            attachment: {...block.attachment},
            ...(block.locator ? {locator: {...block.locator}} : {}),
        }]
        : []);
    const identity = messageBlocksIdentity(contentBlocks, textBytes);
    return {
        id: input.id,
        clientMessageId: input.clientMessageId,
        deliveryState: "pending",
        deliveryMode: input.deliveryMode ?? "prompt",
        type: "user",
        content: text,
        contentBytes: textBytes,
        contentOmitted: false,
        attachments,
        contentBlocks,
        omittedContentBlocks: 0,
        ...(identity.exact === undefined ? {} : {userContentIdentity: identity.exact}),
        userContentFallbackIdentity: identity.fallback,
        status: "done",
        timestamp: input.timestamp,
    };
}

/** 将 durable user entry 重建为完整 Markdown；公开预算截断时返回 null。 */
export function userEntryMarkdown(entry: AgentChatUserEntryDto): string | null {
    if (entry.omittedBlocks > 0 || entry.blocks.some((block) => block.type === "text" && block.content.omitted)) {
        return null;
    }
    return [...entry.blocks]
        .sort((left, right) => left.contentIndex - right.contentIndex)
        .map((block) => block.type === "text"
            ? block.content.preview
            : serializeAgentImageMarkdown(
                block.attachment.name?.trim() || "图片",
                attachmentMarkdownTarget(block.attachment.attachmentId),
            ))
        .join("");
}

/** 返回复制/编辑使用的完整 Markdown；不完整的 durable user 消息交给 user-content API。 */
export function agentMessageMarkdown(message: AgentMessage): string | null {
    if (message.type !== "user") {
        return message.contentOmitted ? null : message.content;
    }
    if (message.contentBlocks?.length) {
        if ((message.omittedContentBlocks ?? 0) > 0
            || message.contentBlocks.some((block) => block.type === "text" && block.content.omitted)) {
            return null;
        }
        return [...message.contentBlocks]
            .sort((left, right) => left.contentIndex - right.contentIndex)
            .map((block) => block.type === "text"
                ? block.content.preview
                : serializeAgentImageMarkdown(
                    block.attachment.name?.trim() || "图片",
                    attachmentMarkdownTarget(block.attachment.attachmentId),
                ))
            .join("");
    }
    if (message.contentOmitted) {
        return null;
    }
    return [
        message.content,
        ...(message.attachments ?? []).map((item) => serializeAgentImageMarkdown(
            item.attachment.name?.trim() || "图片",
            attachmentMarkdownTarget(item.attachment.attachmentId),
        )),
    ].join("");
}

/** 生成 durable entry 的精确/兜底身份，用于纯图片与交错内容的乐观消息消费。 */
export function userEntryContentIdentity(entry: AgentChatUserEntryDto): AgentUserContentIdentity {
    const sorted = [...entry.blocks].sort((left, right) => left.contentIndex - right.contentIndex);
    const fallback = JSON.stringify({
        textBytes: entry.textSummary.bytes,
        images: sorted.flatMap((block) => block.type === "attachment"
            ? [[block.attachment.attachmentId, block.attachment.name ?? ""]]
            : []),
    });
    if (entry.omittedBlocks > 0 || sorted.some((block) => block.type === "text" && block.content.omitted)) {
        return {fallback};
    }
    return {
        exact: JSON.stringify(sorted.map((block) => block.type === "text"
            ? ["text", block.content.preview]
            : ["attachment", block.attachment.attachmentId, block.attachment.name ?? ""])),
        fallback,
    };
}

function messageBlocksIdentity(
    blocks: readonly AgentMessageContentBlock[],
    textBytes: number,
): AgentUserContentIdentity {
    return {
        exact: JSON.stringify(blocks.map((block) => block.type === "text"
            ? ["text", block.content.preview]
            : ["attachment", block.attachment.attachmentId, block.attachment.name ?? ""])),
        fallback: JSON.stringify({
            textBytes,
            images: blocks.flatMap((block) => block.type === "attachment"
                ? [[block.attachment.attachmentId, block.attachment.name ?? ""]]
                : []),
        }),
    };
}
