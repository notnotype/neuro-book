import sharp from "sharp";
import {describe, expect, it} from "vitest";
import {
    ProjectCoverUploadError,
    validateProjectCoverUpload,
} from "nbook/server/workspace-files/project-cover-upload";

describe("validateProjectCoverUpload", () => {
    it.each([
        ["image/png", "png"],
        ["image/jpeg", "jpg"],
        ["image/webp", "webp"],
    ] as const)("完整解码 %s 并保持原始 bytes", async (mimeType, extension) => {
        const image = sharp({create: {width: 12, height: 8, channels: 4, background: "#336699"}});
        const bytes = mimeType === "image/png"
            ? await image.png().toBuffer()
            : mimeType === "image/jpeg"
                ? await image.jpeg().toBuffer()
                : await image.webp().toBuffer();

        const result = await validateProjectCoverUpload({bytes, declaredMimeType: mimeType});

        expect(result.extension).toBe(extension);
        expect(Buffer.from(result.bytes)).toEqual(bytes);
    });

    it("拒绝 GIF、MIME 不一致与只有魔数的损坏图片", async () => {
        const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
        await expect(validateProjectCoverUpload({bytes: gif, declaredMimeType: "image/gif"}))
            .rejects.toMatchObject<ProjectCoverUploadError>({code: "PROJECT_COVER_TYPE_UNSUPPORTED"});

        const png = await sharp({create: {width: 2, height: 2, channels: 3, background: "#000000"}})
            .png()
            .toBuffer();
        await expect(validateProjectCoverUpload({bytes: png, declaredMimeType: "image/jpeg"}))
            .rejects.toMatchObject<ProjectCoverUploadError>({code: "PROJECT_COVER_MIME_MISMATCH"});

        const broken = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        await expect(validateProjectCoverUpload({bytes: broken}))
            .rejects.toMatchObject<ProjectCoverUploadError>({code: "PROJECT_COVER_DECODE_FAILED"});
    });

    it.each([
        ["image/png", "png"],
        ["image/jpeg", "jpg"],
        ["image/webp", "webp"],
    ] as const)("把 application/octet-stream 视为未声明 MIME，并从 %s bytes 得到 %s", async (mimeType, extension) => {
        const image = sharp({create: {width: 4, height: 3, channels: 4, background: "#224466"}});
        const bytes = mimeType === "image/png"
            ? await image.png().toBuffer()
            : mimeType === "image/jpeg"
                ? await image.jpeg().toBuffer()
                : await image.webp().toBuffer();

        await expect(validateProjectCoverUpload({
            bytes,
            declaredMimeType: "application/octet-stream",
        })).resolves.toMatchObject({extension});
    });

    it("空 MIME 不能让 GIF 或具体非图片声明绕过封面类型限制", async () => {
        const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
        const png = await sharp({create: {width: 2, height: 2, channels: 3, background: "#000000"}})
            .png()
            .toBuffer();

        await expect(validateProjectCoverUpload({bytes: gif, declaredMimeType: "application/octet-stream"}))
            .rejects.toMatchObject<ProjectCoverUploadError>({code: "PROJECT_COVER_TYPE_UNSUPPORTED"});
        await expect(validateProjectCoverUpload({bytes: png, declaredMimeType: "text/plain"}))
            .rejects.toMatchObject<ProjectCoverUploadError>({code: "PROJECT_COVER_MIME_MISMATCH"});
    });
});
