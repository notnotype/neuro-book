import {requireAgentSessionId, updateAgentSessionCurrentProject} from "nbook/server/agent/http";
import {AgentCurrentProjectRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/** 重新绑定或清除Session Current Project。 */
export default defineEventHandler(async (event) => withProjectHttpError(async () => {
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentCurrentProjectRequestDtoSchema);
    return updateAgentSessionCurrentProject(sessionId, body);
}));
