/**
 * 场景图的上传（docs/specs/theme/editor.md 的“上传场景图”与“写场景素材”）：浏览器先把图缩到最长边 2560px 以内、转成 WebP，
 * 上传在 `asset-upload.ts`。只在浏览器里用（画布）。
 */

/** 最长边上限（像素）：宽屏上够清楚，又不让一张图大到拖慢整套主题。 */
export const SCENE_MAX_EDGE = 2560;
/** 单张建议的体积（字节）；超出只提示，不拒绝。 */
export const SCENE_SUGGESTED_BYTES = 300 * 1024;

export interface PreparedImage {
    readonly blob: Blob;
    readonly width: number;
    readonly height: number;
}

/** 读图、缩小、转 WebP；浏览器不支持 WebP 编码时落成 PNG（路由两种都收）。读不了的文件抛错。 */
export async function prepareImage(file: Blob, maxEdge = SCENE_MAX_EDGE): Promise<PreparedImage> {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("浏览器没有给出画布");
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
        if (blob !== null && blob.type === "image/webp") return {blob, width, height};
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (png === null) throw new Error("浏览器编码不出图片");
        return {blob: png, width, height};
    } finally {
        bitmap.close();
    }
}
