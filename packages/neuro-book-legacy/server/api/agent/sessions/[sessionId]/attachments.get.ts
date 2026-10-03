import {createError, getQuery} from "h3";
import {listAgentSessionAttachments, requireAgentSessionId} from "nbook/server/agent/http";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {AgentSessionAttachmentListQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

/** 搜索并分页返回当前 Session 全分支附件目录。 */
export default defineEventHandler(async (event) => withProjectHttpError(async () => {
    const sessionId = requireAgentSessionId(event);
    const parsed = AgentSessionAttachmentListQueryDtoSchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "Session Attachment query 参数无效",
            data: {code: "INVALID_SESSION_ATTACHMENT_QUERY", issues: parsed.error.issues},
        });
    }
    return listAgentSessionAttachments(sessionId, parsed.data);
}));
