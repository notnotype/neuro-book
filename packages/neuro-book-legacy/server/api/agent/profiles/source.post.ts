import {validateBody} from "nbook/server/utils/novel-chapter";
import {useAgentHarness} from "nbook/server/agent/http";
import {readProfileSource} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSourceRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";

/**
 * 按 fileName 读取用户 profile 源码与 diagnostics。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSourceRequestDtoSchema);
    const harness = useAgentHarness();
    return readProfileSource(harness.profiles, body, profileWorkbenchRootsFromRuntime(harness.runtimePaths));
});
