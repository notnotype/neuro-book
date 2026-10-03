import {invokeAgentSession, requireAgentSessionId} from "nbook/server/agent/http";
import {AgentInvokeRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

/**
 * 阻塞式调用 Agent session。slash command 会被视为普通文本。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentInvokeRequestDtoSchema, {
        maxBytes: AGENT_IMAGE_POLICY.maxRequestBytes,
    });
    return invokeAgentSession(sessionId, body);
});
