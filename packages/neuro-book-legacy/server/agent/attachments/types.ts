import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";

/** Attachment blob 后端只处理 opaque key 与 bytes，不理解 Agent 领域语义。 */
export interface AttachmentBlobAdapter {
    /** 幂等发布 bytes；返回后同一 Adapter 必须能够立即读到相同内容。 */
    put(key: string, bytes: Uint8Array): Promise<void>;

    /** key 不存在时返回 null。 */
    get(key: string): Promise<Uint8Array | null>;
}

export type AttachmentErrorCode =
    | "invalid_input"
    | "limit_exceeded"
    | "invalid_reference"
    | "not_found"
    | "corrupt"
    | "storage_failed";

/** Attachment 领域的稳定错误；错误信息不得包含存储后端的绝对路径。 */
export class AttachmentError extends Error {
    constructor(readonly code: AttachmentErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "AttachmentError";
    }
}

/** 确认未知错误是否已是 Attachment 稳定错误。 */
export function isAttachmentError(error: unknown): error is AttachmentError {
    return error instanceof AttachmentError;
}

/** Store 对外保存输入。 */
export type SaveAttachmentInput = {
    bytes: Uint8Array;
    mimeType: AttachmentRef["mimeType"];
};
