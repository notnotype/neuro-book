import {validateBody} from "nbook/server/utils/novel-chapter";
import {useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {AgentProfileCompileAllRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";

/**
 * 手动编译全部用户 profile 源码。真实编译在后台 worker 中执行。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileCompileAllRequestDtoSchema);
    const harness = useAgentHarness();
    const runtimePaths = harness.runtimePaths;
    if (!runtimePaths) {
        throw new Error("Profile compile-all API 需要显式 RuntimePaths。");
    }
    const roots = profileWorkbenchRootsFromRuntime(runtimePaths);
    return useProfileCompileWorker(roots.profileRoot, runtimePaths, "workspace/.nbook/agent/profiles").compileAll(body, {
        mode: "in_process",
        registry: harness.profiles,
    });
});
