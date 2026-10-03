import {requireAgentSessionId, resolveAgentSessionAttachments} from "nbook/server/agent/http";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {AgentSessionAttachmentResolveRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";

/** 原子批量解析 1–8 个不重复 Attachment ID；任一未授权时整体失败。 */
export default defineEventHandler(async (event) => withProjectHttpError(async () => {
    const body = await validateBody(event, AgentSessionAttachmentResolveRequestDtoSchema, {maxBytes: 4 * 1024});
    return resolveAgentSessionAttachments(requireAgentSessionId(event), body.attachmentIds);
}));
