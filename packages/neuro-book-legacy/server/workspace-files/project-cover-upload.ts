import {
    canonicalImageMime,
    imageMimeType,
    isSharpPixelLimitError,
    isUnspecifiedImageMime,
    MAX_RASTER_IMAGE_PIXELS,
} from "nbook/server/media/raster-image";
import type {
    ProjectCoverExtension,
    ProjectCoverUpload,
} from "nbook/server/workspace-files/project-cover-store";

export type ProjectCoverUploadErrorCode =
    | "PROJECT_COVER_TYPE_UNSUPPORTED"
    | "PROJECT_COVER_MIME_MISMATCH"
    | "PROJECT_COVER_DECODE_FAILED"
    | "PROJECT_COVER_PIXEL_LIMIT";

/** 上传内容校验失败；错误不携带 filename、原始 bytes 或物理路径。 */
export class ProjectCoverUploadError extends Error {
    /** 建立稳定上传错误。 */
    constructor(readonly code: ProjectCoverUploadErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ProjectCoverUploadError";
    }
}

/**
 * 完整解码 PNG、JPEG 或 WebP，并返回保持原始 bytes 的 Lifecycle 输入。
 *
 * stats 会实际扫描像素，不把只读 header 当成“可解码”证据；任何转换结果都不会持久化。
 */
export async function validateProjectCoverUpload(input: {
    readonly bytes: Uint8Array;
    readonly declaredMimeType?: string;
}): Promise<ProjectCoverUpload> {
    const detected = imageMimeType(input.bytes);
    if (!detected || detected === "image/gif") {
        throw new ProjectCoverUploadError(
            "PROJECT_COVER_TYPE_UNSUPPORTED",
            "封面只支持 PNG、JPEG 或 WebP",
        );
    }
    if (!isUnspecifiedImageMime(input.declaredMimeType)) {
        const declared = canonicalImageMime(input.declaredMimeType!);
        if (declared !== detected) {
            throw new ProjectCoverUploadError(
                "PROJECT_COVER_MIME_MISMATCH",
                "封面 MIME 与文件内容不一致",
            );
        }
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
        if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_RASTER_IMAGE_PIXELS) {
            throw new ProjectCoverUploadError("PROJECT_COVER_PIXEL_LIMIT", "封面像素超过 64 MP 限制");
        }
        await image.stats();
        return Object.freeze({
            bytes: Buffer.from(input.bytes),
            extension: extensionForMime(detected),
        });
    } catch (error) {
        if (error instanceof ProjectCoverUploadError) {
            throw error;
        }
        if (isSharpPixelLimitError(error)) {
            throw new ProjectCoverUploadError(
                "PROJECT_COVER_PIXEL_LIMIT",
                "封面像素超过 64 MP 限制",
                {cause: error},
            );
        }
        throw new ProjectCoverUploadError(
            "PROJECT_COVER_DECODE_FAILED",
            "封面无法完整解码",
            {cause: error},
        );
    }
}

/** 把已识别 MIME 映射到唯一 canonical 文件扩展名。 */
function extensionForMime(mimeType: "image/jpeg" | "image/png" | "image/webp"): ProjectCoverExtension {
    if (mimeType === "image/jpeg") {
        return "jpg";
    }
    return mimeType === "image/png" ? "png" : "webp";
}
