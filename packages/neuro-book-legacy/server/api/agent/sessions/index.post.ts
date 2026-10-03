import {createAgentSession} from "nbook/server/agent/http";
import {AgentCreateSessionRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 创建 Agent session。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentCreateSessionRequestDtoSchema);
    return createAgentSession(body);
});
