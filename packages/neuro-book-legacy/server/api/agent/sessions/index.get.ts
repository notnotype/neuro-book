import {getQuery} from "h3";
import {listAgentSessions} from "nbook/server/agent/http";
import {AgentSessionListQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

/**
 * 列出 Agent session。默认隐藏 archived session。
 */
export default defineEventHandler(async (event) => {
    const query = AgentSessionListQueryDtoSchema.parse(getQuery(event));
    return listAgentSessions(query);
});
