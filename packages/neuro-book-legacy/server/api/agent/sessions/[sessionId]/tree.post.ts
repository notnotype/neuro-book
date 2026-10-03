import {moveAgentSessionTree, requireAgentSessionId} from "nbook/server/agent/http";
import {AgentTreeRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 切换 session tree，并可在切换后立即 invoke。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentTreeRequestDtoSchema);
    return moveAgentSessionTree(sessionId, body);
});
