import {validateBody} from "nbook/server/utils/novel-chapter";
import {createProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileCreateRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";

/**
 * 从系统模板创建用户 profile。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileCreateRequestDtoSchema);
    const harness = useAgentHarness();
    const result = await createProfileSourceDraft(body, profileWorkbenchRootsFromRuntime(harness.runtimePaths));
    await harness.profiles.enqueueBuild({
        fileName: body.fileName ?? `${body.profileKey}.profile.tsx`,
        reason: "profile_source_created",
    });
    return result;
});
