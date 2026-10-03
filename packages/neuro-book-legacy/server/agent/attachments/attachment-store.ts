import {createHash} from "node:crypto";
import type {AttachmentId, AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";
import {AttachmentError, isAttachmentError, type AttachmentBlobAdapter, type SaveAttachmentInput} from "nbook/server/agent/attachments/types";

const ATTACHMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MIME_TYPE_PATTERN = /^[^\s/]+\/[^\s/]+$/;

/**
 * 通用 Attachment 领域存储。
 *
 * Store 统一负责内容寻址与引用校验；Adapter 只负责 opaque key 与 bytes。
 */
export class AttachmentStore {
    constructor(private readonly adapter: AttachmentBlobAdapter) {}

    /** 保存 bytes，并返回与存储后端无关的稳定引用。 */
    async save(input: SaveAttachmentInput): Promise<AttachmentRef> {
        if (!MIME_TYPE_PATTERN.test(input.mimeType)) {
            throw new AttachmentError("invalid_reference", "Attachment MIME type 非法。");
        }
        const hash = createHash("sha256").update(input.bytes).digest("hex");
        const id = `sha256:${hash}` as AttachmentId;
        try {
            await this.adapter.put(this.key(id), input.bytes);
        } catch (error) {
            if (isAttachmentError(error)) {
                throw error;
            }
            throw new AttachmentError("storage_failed", "Attachment 保存失败。", {cause: error});
        }
        return {
            id,
            mimeType: input.mimeType,
            bytes: input.bytes.byteLength,
        };
    }

    /** 读取引用指向的原始 bytes。 */
    async load(ref: AttachmentRef): Promise<Uint8Array> {
        this.assertRef(ref);
        let bytes: Uint8Array | null;
        try {
            bytes = await this.adapter.get(this.key(ref.id));
        } catch (error) {
            if (isAttachmentError(error)) {
                throw error;
            }
            throw new AttachmentError("storage_failed", "Attachment 读取失败。", {cause: error});
        }
        if (!bytes) {
            throw new AttachmentError("not_found", "Attachment 不存在。");
        }
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (bytes.byteLength !== ref.bytes || `sha256:${hash}` !== ref.id) {
            throw new AttachmentError("corrupt", "Attachment 内容与引用不一致。");
        }
        return bytes;
    }

    /** Attachment ID 到 Adapter opaque key 的唯一映射。 */
    private key(id: AttachmentId): string {
        const hash = id.slice("sha256:".length);
        return `sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
    }

    /** 所有 Adapter I/O 前验证 durable 引用，避免坏数据进入路径映射。 */
    private assertRef(ref: AttachmentRef): void {
        if (!ATTACHMENT_ID_PATTERN.test(ref.id)
            || !MIME_TYPE_PATTERN.test(ref.mimeType)
            || !Number.isSafeInteger(ref.bytes)
            || ref.bytes < 0) {
            throw new AttachmentError("invalid_reference", "Attachment 引用非法。");
        }
    }
}
