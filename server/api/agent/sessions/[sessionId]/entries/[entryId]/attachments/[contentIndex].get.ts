import {createError, getRequestHeader, getRouterParam, setResponseHeader, setResponseStatus} from "h3";
import {canonicalImageMime, imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";
import {isAgentSessionNotFoundHttpError, mapAgentHttpError, requireAgentSessionId, useAgentHarness} from "nbook/server/agent/http";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {ImageVariantError, type ImageVariantSpec} from "nbook/server/media/image-variant-contract";
import {imageVariantHttpError, imageVariantSpecFromEvent} from "nbook/server/media/image-variant-http";
import {isProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {encodeRfc5987Filename} from "nbook/server/utils/rfc5987";

/** 按公开 Chat Flow locator 返回完整 Attachment；hash 本身不构成授权。 */
export default defineEventHandler(async (event) => withProjectHttpError(async () => {
    const startedAt = performance.now();
    const sessionId = requireAgentSessionId(event);
    const entryId = getRouterParam(event, "entryId");
    const contentIndex = Number(getRouterParam(event, "contentIndex"));
    if (!entryId || !Number.isSafeInteger(contentIndex) || contentIndex < 0 || contentIndex > 1024) {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 400, message: "Attachment locator 无效", data: {code: "INVALID_ATTACHMENT_LOCATOR"}});
    }

    const harness = useAgentHarness();
    let locator: Awaited<ReturnType<typeof harness.resolveSessionAttachment>>;
    try {
        locator = await harness.resolveSessionAttachment(sessionId, entryId, contentIndex);
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            throw error;
        }
        const mapped = mapAgentHttpError(error);
        if (isAgentSessionNotFoundHttpError(mapped)) {
            throw mapped;
        }
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 404, message: "Attachment 不存在", data: {code: "ATTACHMENT_NOT_FOUND"}});
    }

    const locatorMs = performance.now() - startedAt;
    let variantSpec: ImageVariantSpec | null;
    try {
        variantSpec = imageVariantSpecFromEvent(event);
    } catch (error) {
        if (error instanceof ImageVariantError) {
            return imageVariantHttpError(event, error);
        }
        throw error;
    }
    const declaredImageMime = canonicalImageMime(locator.ref.mimeType);
    if (variantSpec) {
        if (!declaredImageMime) {
            return imageVariantHttpError(event, new ImageVariantError(
                "UNSUPPORTED_IMAGE_TYPE",
                "Attachment 不是支持的图片",
            ));
        }
        const variantStartedAt = performance.now();
        try {
            const {useImageVariantModule} = await import("nbook/server/media/image-variant-runtime");
            const variant = await useImageVariantModule().render(Object.freeze({
                identity: `attachment:${locator.ref.id}`,
                revision: locator.ref.id,
                read: async () => {
                    let bytes: Uint8Array;
                    try {
                        bytes = await locator.read();
                    } catch {
                        throw createError({
                            statusCode: 410,
                            message: "Attachment 已损坏或不可用",
                            data: {code: "ATTACHMENT_UNAVAILABLE"},
                        });
                    }
                    if (imageMimeType(bytes) !== declaredImageMime) {
                        throw createError({
                            statusCode: 410,
                            message: "Attachment 图片类型已损坏",
                            data: {code: "ATTACHMENT_CORRUPT"},
                        });
                    }
                    return bytes;
                },
            }), variantSpec);
            setResponseHeader(event, "ETag", variant.etag);
            setResponseHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
            setResponseHeader(event, "X-Content-Type-Options", "nosniff");
            setResponseHeader(
                event,
                "Server-Timing",
                `attachment_locator;dur=${locatorMs.toFixed(2)}, image_variant;dur=${(performance.now() - variantStartedAt).toFixed(2)};desc="${variant.cache}", attachment_total;dur=${(performance.now() - startedAt).toFixed(2)}`,
            );
            if (getRequestHeader(event, "if-none-match") === variant.etag) {
                setResponseStatus(event, 304);
                return null;
            }
            setResponseHeader(event, "Content-Type", "image/webp");
            setResponseHeader(event, "Content-Length", variant.bytes.byteLength);
            setResponseHeader(event, "Content-Disposition", "inline");
            return variant.bytes;
        } catch (error) {
            if (error instanceof ImageVariantError) {
                return imageVariantHttpError(event, error);
            }
            throw error;
        }
    }

    const etag = `"${locator.ref.id}"`;
    setResponseHeader(event, "ETag", etag);
    setResponseHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    if (getRequestHeader(event, "if-none-match") === etag) {
        setResponseHeader(event, "Server-Timing", `attachment_locator;dur=${locatorMs.toFixed(2)}, attachment_total;dur=${(performance.now() - startedAt).toFixed(2)}`);
        setResponseStatus(event, 304);
        return null;
    }

    let bytes: Uint8Array;
    try {
        bytes = await locator.read();
    } catch {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 410, message: "Attachment 已损坏或不可用", data: {code: "ATTACHMENT_UNAVAILABLE"}});
    }
    if (declaredImageMime && imageMimeType(bytes) !== declaredImageMime) {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 410, message: "Attachment 图片类型已损坏", data: {code: "ATTACHMENT_CORRUPT"}});
    }
    const inline = declaredImageMime !== null;
    const name = locator.name ?? "attachment";
    setResponseHeader(event, "Content-Type", locator.ref.mimeType);
    setResponseHeader(event, "Content-Length", bytes.byteLength);
    setResponseHeader(event, "Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeRfc5987Filename(name)}`);
    setResponseHeader(event, "Server-Timing", `attachment_locator;dur=${locatorMs.toFixed(2)}, attachment_blob;dur=${(performance.now() - startedAt - locatorMs).toFixed(2)}, attachment_total;dur=${(performance.now() - startedAt).toFixed(2)}`);
    return Buffer.from(bytes);
}));
