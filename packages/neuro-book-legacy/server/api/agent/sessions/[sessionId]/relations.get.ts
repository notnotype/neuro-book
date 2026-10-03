import {getAgentSessionRelations, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 读取 Agent session 的关联 Agent 关系。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    const sessionId = requireAgentSessionId(event);
    return getAgentSessionRelations(sessionId, undefined, timing);
});
