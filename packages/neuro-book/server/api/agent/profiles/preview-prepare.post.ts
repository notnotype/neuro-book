import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireAgentSessionIdValue, useAgentHarness, withAgentHttpError} from "nbook/server/agent/http";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-http-service";
import {useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {profileWorkbenchRootsFromRuntime} from "nbook/server/agent/profiles/profile-workbench-roots";
import {AgentProfilePreparePreviewRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/**
 * 调用真实 profile.prepare 生成 TSX Profile 预览。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfilePreparePreviewRequestDtoSchema);
    const requestSessionId = requireAgentSessionIdValue(body.sessionId);
    const operation = () => withProjectHttpError(async () => {
        const harness = useAgentHarness();
        if (!body.sourceOverride) {
            return previewAgentProfilePrepare(harness, body);
        }
        const runtimePaths = harness.runtimePaths;
        if (!runtimePaths) {
            throw new Error("Profile preview API 需要显式 RuntimePaths。");
        }
        const roots = profileWorkbenchRootsFromRuntime(runtimePaths);
        const result = await useProfileCompileWorker(roots.profileRoot, runtimePaths, "workspace/.nbook/agent/profiles").compile({
            fileName: body.sourceOverride.fileName,
            source: body.sourceOverride.source,
            dryRun: true,
            preview: true,
            sessionId: body.sessionId,
            initial: body.initial,
            initialOverrides: body.initialOverrides,
        });
        if (result.preview) {
            return result.preview;
        }
        return {
            profileKey: body.profileKey,
            ok: false,
            issues: result.issues,
            messages: [],
            persistedMessageCount: 0,
            variables: [],
            reportResultSchema: null,
        };
    });
    return withAgentHttpError(requestSessionId, operation);
});
