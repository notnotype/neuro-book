import {validateBody} from "nbook/server/utils/novel-chapter";
import {saveProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSaveRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";

/**
 * 保存用户 profile 源码。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSaveRequestDtoSchema);
    const harness = useAgentHarness();
    const result = await saveProfileSourceDraft(body, profileWorkbenchRootsFromRuntime(harness.runtimePaths));
    await harness.profiles.enqueueBuild({fileName: body.fileName, reason: "profile_source_saved"});
    return result;
});
