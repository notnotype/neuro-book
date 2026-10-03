import {createHash} from "node:crypto";
import path from "node:path";
import {createError, getRequestHeader, setResponseHeader, setResponseStatus} from "h3";
import {requireProjectRefQuery} from "nbook/server/api/projects/project-control-plane";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {ImageVariantError} from "nbook/server/media/image-variant-contract";
import {imageVariantHttpError, imageVariantSpecFromEvent} from "nbook/server/media/image-variant-http";
import {listProjects} from "nbook/server/runtime/product-project";
import {authorizeProjectCover, ProjectCoverError} from "nbook/server/workspace-files/project-cover";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {encodeRfc5987Filename} from "nbook/server/utils/rfc5987";

/** 返回 project.yaml 已授权的封面图片；客户端不能指定任意文件路径。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const ref = requireProjectRefQuery(event);
    const snapshot = await listProjects();
    const project = snapshot.projects.find((item) => item.projectRoot === ref.projectRoot);
    if (!project?.cover) {
        throw coverHttpError(new ProjectCoverError("PROJECT_COVER_UNAVAILABLE"));
    }

    try {
        const authorized = await authorizeProjectCover(resolveRuntimeWorkspaceRoot(), ref, project.cover);
        const spec = imageVariantSpecFromEvent(event);
        if (spec) {
            const variantStartedAt = performance.now();
            const {useImageVariantModule} = await import("nbook/server/media/image-variant-runtime");
            const variant = await useImageVariantModule().render(authorized.source, spec);
            setResponseHeader(event, "ETag", variant.etag);
            setResponseHeader(event, "Cache-Control", "private, max-age=0, must-revalidate");
            setResponseHeader(event, "X-Content-Type-Options", "nosniff");
            setResponseHeader(
                event,
                "Server-Timing",
                `image_variant;dur=${(performance.now() - variantStartedAt).toFixed(2)};desc="${variant.cache}"`,
            );
            if (getRequestHeader(event, "if-none-match") === variant.etag) {
                setResponseStatus(event, 304);
                return null;
            }
            setResponseHeader(event, "Content-Type", "image/webp");
            setResponseHeader(event, "Content-Length", variant.bytes.byteLength);
            setResponseHeader(event, "Content-Disposition", "inline");
            return variant.bytes;
        }

        const bytes = Buffer.from(await authorized.source.read());
        const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
        setResponseHeader(event, "ETag", etag);
        setResponseHeader(event, "Cache-Control", "private, max-age=0, must-revalidate");
        setResponseHeader(event, "X-Content-Type-Options", "nosniff");
        if (getRequestHeader(event, "if-none-match") === etag) {
            setResponseStatus(event, 304);
            return null;
        }
        setResponseHeader(event, "Content-Type", authorized.mimeType);
        setResponseHeader(event, "Content-Length", bytes.byteLength);
        const filename = encodeRfc5987Filename(path.posix.basename(project.cover));
        setResponseHeader(event, "Content-Disposition", `inline; filename*=UTF-8''${filename}`);
        return bytes;
    } catch (error) {
        if (error instanceof ImageVariantError) {
            return imageVariantHttpError(event, error);
        }
        if (error instanceof ProjectCoverError) {
            throw coverHttpError(error);
        }
        throw error;
    }
}));

/** 将封面领域错误映射为不泄漏路径的稳定 HTTP 错误。 */
function coverHttpError(error: ProjectCoverError): ReturnType<typeof createError> {
    const statusCode = error.code === "PROJECT_COVER_TOO_LARGE" ? 413 : error.code === "PROJECT_COVER_CORRUPT" ? 422 : 404;
    return createError({
        statusCode,
        message: error.message,
        data: {code: error.code},
    });
}
