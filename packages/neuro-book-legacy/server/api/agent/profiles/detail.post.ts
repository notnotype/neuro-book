import {validateBody} from "nbook/server/utils/novel-chapter";
import {useAgentHarness} from "nbook/server/agent/http";
import {readAgentProfileDetail} from "nbook/server/agent/profiles/profile-http-service";
import {AgentProfileDetailRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 读取新 Agent Profile 详情。低代码 root 暂不重建，只返回源码、schema 与问题。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileDetailRequestDtoSchema);
    return readAgentProfileDetail(useAgentHarness().profiles, body);
});
