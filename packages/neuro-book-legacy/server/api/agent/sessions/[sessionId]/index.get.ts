import {createError, getQuery} from "h3";
import {getAgentSessionQuery, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {AgentSessionQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

/**
 * 查询 Agent session recovery、history 或 system prompt。
 */
export default defineEventHandler(async (event) => {
    return withProjectHttpError(async () => {
        const timing = createServerTiming(event);
        const sessionId = requireAgentSessionId(event);
        const parsed = AgentSessionQueryDtoSchema.safeParse(getQuery(event));
        if (!parsed.success) {
            throw createError({
                statusCode: 400,
                message: "Agent session query 参数无效",
                data: {code: "INVALID_SESSION_QUERY", issues: parsed.error.issues},
            });
        }
        const query = parsed.data;
        return getAgentSessionQuery(sessionId, query, undefined, timing);
    });
});
