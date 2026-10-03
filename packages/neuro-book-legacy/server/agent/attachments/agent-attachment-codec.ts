import type {ImageContent, Message, Model, TextContent} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage, StoredAttachmentContent, StoredContent} from "nbook/server/agent/messages/stored-types";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import {attachmentMarker, storedMessagesForText} from "nbook/server/agent/messages/stored-message-presentation";
import {AGENT_IMAGE_POLICY} from "nbook/server/agent/attachments/agent-attachment-policy";
import {
    canonicalImageMime,
    imageMimeType,
    isSharpPixelLimitError,
    isUnspecifiedImageMime,
    MAX_RASTER_IMAGE_PIXELS,
} from "nbook/server/media/raster-image";

export {attachmentMarker, storedMessagesForText} from "nbook/server/agent/messages/stored-message-presentation";
export {canonicalImageMime, imageMimeType} from "nbook/server/media/raster-image";
export type {RasterImageMimeType as StoredImageMimeType} from "nbook/server/media/raster-image";

/** Agent 消息与通用 Attachment Store 之间的图片领域 Codec。 */
export class AgentAttachmentCodec {
    constructor(private readonly store: AttachmentStore) {}

    /** 保存已经读取的图片 bytes，并生成 stored attachment block。 */
    async saveImage(input: {bytes: Uint8Array; mimeType?: string; name?: string}): Promise<StoredAttachmentContent> {
        if (input.bytes.byteLength > AGENT_IMAGE_POLICY.maxImageBytes) {
            throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
        }
        const mimeType = imageMimeType(input.bytes);
        if (!mimeType || (!isUnspecifiedImageMime(input.mimeType) && canonicalImageMime(input.mimeType!) !== mimeType)) {
            throw new AttachmentError("invalid_input", "图片 MIME 与文件内容不一致。");
        }
        try {
            const {default: sharp} = await import("sharp");
            const image = sharp(input.bytes, {
                animated: false,
                failOn: "error",
                limitInputPixels: MAX_RASTER_IMAGE_PIXELS,
                sequentialRead: true,
            });
            const metadata = await image.metadata();
            if (!metadata.width || !metadata.height) {
                throw new Error("图片缺少有效尺寸");
            }
            if (metadata.width * metadata.height > MAX_RASTER_IMAGE_PIXELS) {
                throw new AttachmentError("limit_exceeded", "图片像素超过 64 MP 限制。");
            }
            await image.stats();
        } catch (error) {
            if (error instanceof AttachmentError) {
                throw error;
            }
            if (isSharpPixelLimitError(error)) {
                throw new AttachmentError("limit_exceeded", "图片像素超过 64 MP 限制。", {cause: error});
            }
            throw new AttachmentError("invalid_input", "图片无法完整解码。", {cause: error});
        }
        const attachment = await this.store.save({bytes: input.bytes, mimeType});
        return {
            type: "attachment",
            attachment,
            ...(input.name ? {name: input.name} : {}),
        };
    }

    /**
     * 在单次 Provider 调用前临时 hydrate stored messages。
     * 同一 attachment ID 在本次调用内只读取和编码一次。
     */
    async hydrateForProvider(messages: readonly StoredAgentMessage[], model: Model<any>): Promise<Message[]> {
        const supportsImage = model.input.includes("image");
        if (!supportsImage) {
            return storedMessagesForText(messages);
        }
        const attachmentBlocks = messages.flatMap((message) => message.role !== "assistant" && Array.isArray(message.content)
            ? message.content.filter((block): block is StoredAttachmentContent => block.type === "attachment")
            : []);
        const providerBytes = attachmentBlocks.reduce((total, block) => total + block.attachment.bytes, 0);
        if (attachmentBlocks.length > AGENT_IMAGE_POLICY.maxProviderBlocks
            || providerBytes > AGENT_IMAGE_POLICY.maxProviderSourceBytes) {
            throw new AttachmentError("limit_exceeded", "Provider 图片上下文超过允许预算。");
        }
        const images = new Map<string, ImageContent>();
        const result: Message[] = [];
        for (const message of messages) {
            if (message.role === "assistant") {
                result.push(message);
                continue;
            }
            if (typeof message.content === "string") {
                result.push(message as Message);
                continue;
            }
            const content: Array<TextContent | ImageContent> = [];
            for (const block of message.content) {
                if (block.type === "text") {
                    content.push(block);
                    continue;
                }
                const mimeType = canonicalImageMime(block.attachment.mimeType);
                if (!supportsImage || !mimeType) {
                    content.push({type: "text", text: attachmentMarker(block)});
                    continue;
                }
                let image = images.get(block.attachment.id);
                if (!image) {
                    const bytes = await this.store.load(block.attachment);
                    const detected = imageMimeType(bytes);
                    if (detected !== mimeType) {
                        throw new AttachmentError("corrupt", "Attachment 图片 MIME 与内容不一致。");
                    }
                    image = {type: "image", mimeType, data: Buffer.from(bytes).toString("base64")};
                    images.set(block.attachment.id, image);
                }
                content.push(image);
            }
            result.push({...message, content} as Message);
        }
        return result;
    }
}
/** 判断 stored content 是否包含 attachment。 */
export function hasStoredAttachment(messages: readonly StoredAgentMessage[]): boolean {
    return messages.some((message) => (message.role === "user" || message.role === "toolResult")
        && Array.isArray(message.content)
        && message.content.some((block: StoredContent) => block.type === "attachment"));
}
