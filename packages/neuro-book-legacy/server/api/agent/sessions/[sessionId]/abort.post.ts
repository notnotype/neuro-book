import {abortAgentSession, requireAgentSessionId} from "nbook/server/agent/http";
import {AgentAbortRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 中断当前 Agent invocation。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentAbortRequestDtoSchema);
    return abortAgentSession(sessionId, body);
});
