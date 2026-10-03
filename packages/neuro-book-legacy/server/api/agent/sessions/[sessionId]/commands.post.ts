import {requireAgentSessionId, runAgentSessionCommand} from "nbook/server/agent/http";
import {AgentCommandRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 执行前端识别后的 Agent session command。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentCommandRequestDtoSchema);
    return runAgentSessionCommand(sessionId, body, undefined, timing);
});
