import {createError, getRouterParam} from "h3";
import {getAgentSessionUserContent, isAgentSessionNotFoundHttpError, requireAgentSessionId} from "nbook/server/agent/http";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {isProjectNotOpenError} from "nbook/server/workspace-files/project-session";

/** 按需返回被公开预算截断的完整用户消息 Markdown。 */
export default defineEventHandler(async (event) => withProjectHttpError(async () => {
    const entryId = getRouterParam(event, "entryId");
    if (!entryId) {
        throw createError({statusCode: 400, message: "entryId 不能为空", data: {code: "INVALID_ENTRY_ID"}});
    }
    try {
        return await getAgentSessionUserContent(requireAgentSessionId(event), entryId);
    } catch (error) {
        if (isProjectNotOpenError(error) || isAgentSessionNotFoundHttpError(error)) {
            throw error;
        }
        throw createError({statusCode: 404, message: "用户消息不存在", data: {code: "USER_MESSAGE_NOT_FOUND"}});
    }
}));
