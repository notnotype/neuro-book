/** Workspace Root 内按内容寻址的 Attachment ID。 */
export type AttachmentId = `sha256:${string}`;

/**
 * 与存储后端无关的 Attachment 引用。
 *
 * `id` 标识原始 bytes；`mimeType` 和 `bytes` 用于调用侧校验与展示。
 */
export type AttachmentRef = {
    id: AttachmentId;
    mimeType: string;
    bytes: number;
};
