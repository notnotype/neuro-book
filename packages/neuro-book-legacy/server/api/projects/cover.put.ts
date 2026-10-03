import {createError, getRequestHeader} from "h3";
import {requireProjectRefQuery, toProjectMetadataDto} from "nbook/server/api/projects/project-control-plane";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {
    readSingleMultipartFile,
    SingleFileMultipartError,
} from "nbook/server/media/single-file-multipart";
import type {ProjectMutationResponseDto} from "nbook/shared/dto/project.dto";
import {ProjectLifecycleError} from "nbook/server/workspace-files/project-lifecycle";
import {listProjects, updateProjectCover} from "nbook/server/runtime/product-project";
import {
    ProjectCoverUploadError,
    validateProjectCoverUpload,
} from "nbook/server/workspace-files/project-cover-upload";

const PROJECT_COVER_MAX_BYTES = 20 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** 上传并设置 Project 封面；客户端不能提交目标路径。 */
export default defineEventHandler(async (event): Promise<ProjectMutationResponseDto> => {
    const ref = requireProjectRefQuery(event);
    const snapshot = await listProjects();
    if (!snapshot.projects.some((project) => project.projectRoot === ref.projectRoot)) {
        throwProjectHttpError(new ProjectLifecycleError("PROJECT_NOT_FOUND", "Project 不存在"));
    }
    const contentLength = Number.parseInt(getRequestHeader(event, "content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > PROJECT_COVER_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
        throw coverUploadHttpError("PROJECT_COVER_FILE_TOO_LARGE", 413, "封面超过 20 MiB 大小限制");
    }

    try {
        const file = await readSingleMultipartFile(event.node.req, {
            fieldName: "file",
            maxBytes: PROJECT_COVER_MAX_BYTES,
        });
        const cover = await validateProjectCoverUpload({
            bytes: file.bytes,
            ...(file.mimeType ? {declaredMimeType: file.mimeType} : {}),
        });
        const result = await updateProjectCover({ref, cover});
        return {
            revision: result.revision,
            project: toProjectMetadataDto(result.project),
        };
    } catch (error) {
        if (error instanceof SingleFileMultipartError) {
            if (error.code === "FILE_TOO_LARGE") {
                throw coverUploadHttpError("PROJECT_COVER_FILE_TOO_LARGE", 413, "封面超过 20 MiB 大小限制");
            }
            if (error.code === "REQUEST_ABORTED") {
                throw coverUploadHttpError("PROJECT_COVER_UPLOAD_ABORTED", 400, "封面上传请求已中止");
            }
            throw coverUploadHttpError("INVALID_PROJECT_COVER_MULTIPART", 400, error.message);
        }
        if (error instanceof ProjectCoverUploadError) {
            const statusCode = error.code === "PROJECT_COVER_TYPE_UNSUPPORTED"
                || error.code === "PROJECT_COVER_MIME_MISMATCH"
                ? 415
                : 422;
            throw coverUploadHttpError(error.code, statusCode, error.message);
        }
        throwProjectHttpError(error);
    }
});

/** 建立不泄漏文件名、bytes 或物理路径的上传 HTTP 错误。 */
function coverUploadHttpError(code: string, statusCode: number, message: string): never {
    throw createError({statusCode, message, data: {code}});
}
