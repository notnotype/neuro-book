import * as z from "zod";

/** 公开与 durable tool-call identity 的 UTF-8 硬上限。 */
export const PUBLIC_TOOL_CALL_ID_BYTES = 512;

/** 经过公共身份合同验证的 tool-call ID。 */
declare const publicToolCallIdBrand: unique symbol;
export type PublicToolCallId = string & {readonly [publicToolCallIdBrand]: "public-tool-call-id"};

/** tool-call identity 不满足公共持久化与传输合同。 */
export class PublicToolIdentityError extends Error {
    readonly code = "invalid_public_tool_identity" as const;

    constructor() {
        super(`Tool call identity 无效：必须是非空字符串且 UTF-8 长度不超过 ${String(PUBLIC_TOOL_CALL_ID_BYTES)} bytes。`);
        this.name = "PublicToolIdentityError";
    }
}

/** 浏览器与服务端共用的 UTF-8 identity 判定。 */
export function isPublicToolCallId(value: unknown): value is PublicToolCallId {
    return typeof value === "string"
        && value.trim().length > 0
        && new TextEncoder().encode(value).byteLength <= PUBLIC_TOOL_CALL_ID_BYTES;
}

/** 在 HTTP、durable 或 public serialization Seam 前 fail closed。 */
export function assertPublicToolCallId(value: unknown): PublicToolCallId {
    if (!isPublicToolCallId(value)) {
        throw new PublicToolIdentityError();
    }
    return value;
}

/** 公共 DTO 使用的唯一 tool-call identity Schema。 */
export const PublicToolCallIdSchema = z.string().refine((value): boolean => isPublicToolCallId(value), {
    message: `toolCallId 必须非空且 UTF-8 长度不超过 ${String(PUBLIC_TOOL_CALL_ID_BYTES)} bytes`,
});
