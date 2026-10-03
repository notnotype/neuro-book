import {validateBody} from "nbook/server/utils/novel-chapter";
import {readProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSourceDraftRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";
import {useAgentHarness} from "nbook/server/agent/http";

/**
 * 轻量解析用户 profile 源码草稿。只更新 DSL tree，不触发 TSX runtime 编译。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSourceDraftRequestDtoSchema);
    const harness = useAgentHarness();
    return readProfileSourceDraft(body, profileWorkbenchRootsFromRuntime(harness.runtimePaths));
});
