export type ImageVariantFit = "cover" | "contain";

/** 图片变体的规范化最终规格；preset 必须先展开为此结构。 */
export type ImageVariantSpec = Readonly<{
    /** 未提供时按原比例计算，但最终输出仍不会超过 2048。 */
    width?: number;
    /** 未提供时按原比例计算，但最终输出仍不会超过 2048。 */
    height?: number;
    fit: ImageVariantFit;
    quality: number;
}>;

/** 已经由领域入口授权的图片源；核心 Module 不接收或理解文件路径。 */
export type ImageVariantSource = Readonly<{
    /** 同一 canonical 原图跨 revision 稳定，用于每源预算。 */
    identity: string;
    /** 原图内容变化时必须变化；参与缓存键。 */
    revision: string;
    read(): Promise<Uint8Array>;
}>;

/** 图片变体响应；bytes 始终是剥离 metadata 的静态 WebP。 */
export type ImageVariantResult = Readonly<{
    bytes: Buffer;
    etag: string;
    cache: "hit" | "generated";
}>;

export type ImageVariantErrorCode =
    | "INVALID_IMAGE_VARIANT"
    | "UNSUPPORTED_IMAGE_TYPE"
    | "IMAGE_VARIANT_DECODE_FAILED"
    | "IMAGE_VARIANT_SOURCE_TOO_LARGE"
    | "IMAGE_VARIANT_QUEUE_SATURATED";

/** 可由领域 HTTP Adapter 稳定映射的图片变体错误。 */
export class ImageVariantError extends Error {
    /** 建立不泄漏物理路径或缓存内部信息的领域错误。 */
    constructor(
        readonly code: ImageVariantErrorCode,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "ImageVariantError";
    }
}

export const IMAGE_VARIANT_PRESETS = Object.freeze({
    "project-cover": Object.freeze({width: 384, height: 576, fit: "cover", quality: 80}),
    "attachment-grid": Object.freeze({width: 384, height: 216, fit: "contain", quality: 80}),
    "attachment-chat": Object.freeze({width: 768, fit: "contain", quality: 80}),
} satisfies Record<string, ImageVariantSpec>);

export type ImageVariantPreset = keyof typeof IMAGE_VARIANT_PRESETS;
