import {validateBody} from "nbook/server/utils/novel-chapter";
import {deleteProfileSource} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSourceRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";

/**
 * 删除用户 profile 文件，用于恢复系统版本或移除用户覆盖。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSourceRequestDtoSchema);
    const harness = useAgentHarness();
    return deleteProfileSource(harness.profiles, body, profileWorkbenchRootsFromRuntime(harness.runtimePaths));
});
