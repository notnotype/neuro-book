import {createError, getRequestHeader} from "h3";
import {
    preflightAgentSessionAttachmentRegistration,
    requireAgentSessionId,
    uploadAgentSessionAttachment,
} from "nbook/server/agent/http";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {
    readSingleMultipartFile,
    SingleFileMultipartError,
} from "nbook/server/media/single-file-multipart";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** 严格流式接收一个名为 file 的 multipart 图片，并登记到当前 Session。 */
export default defineEventHandler(async (event) => withProjectHttpError(async () => {
    const sessionId = requireAgentSessionId(event);
    await preflightAgentSessionAttachmentRegistration(sessionId);

    const contentLength = Number.parseInt(getRequestHeader(event, "content-length") ?? "", 10);
    if (Number.isFinite(contentLength)
        && contentLength > AGENT_IMAGE_POLICY.maxImageBytes + MULTIPART_OVERHEAD_BYTES) {
        throw imageLimitError();
    }

    try {
        const file = await readSingleMultipartFile(event.node.req, {
            fieldName: "file",
            maxBytes: AGENT_IMAGE_POLICY.maxImageBytes,
        });
        return uploadAgentSessionAttachment(sessionId, file);
    } catch (error) {
        if (error instanceof SingleFileMultipartError) {
            if (error.code === "FILE_TOO_LARGE") {
                throw imageLimitError();
            }
            if (error.code === "REQUEST_ABORTED") {
                throw createError({statusCode: 400, message: "上传请求已中止"});
            }
            throw invalidMultipartError();
        }
        throw error;
    }
}));

function invalidMultipartError(): Error {
    return createError({
        statusCode: 400,
        message: "multipart 必须且只能包含一个 file",
        data: {code: "INVALID_ATTACHMENT_MULTIPART"},
    });
}

function imageLimitError(): Error {
    return createError({
        statusCode: 413,
        message: "单张图片超过允许大小",
        data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED"},
    });
}
