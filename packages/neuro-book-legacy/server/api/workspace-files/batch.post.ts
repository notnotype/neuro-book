import {withProductWorkspaceFiles} from "nbook/server/runtime/product-startup";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {withBoundProjectTargetMutation, parseWorkspaceFileHttpBinding} from "nbook/server/workspace-files/project-open-guard";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {WorkspaceFileOperationRequestSchema} from "nbook/shared/dto/workspace-file-operation.dto";

defineRouteMeta({openAPI: {tags: ["Workspace Files"], summary: "Batch copy or move workspace paths"}} as never);

const BatchBodySchema = WorkspaceFileOperationRequestSchema;

export default defineEventHandler(async (event) => {
    const raw = await readBody(event);
    const body = BatchBodySchema.parse(raw);
    const binding = parseWorkspaceFileHttpBinding(body);
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), binding);
    return withBoundProjectTargetMutation(target, binding, (handles, revalidateTarget) =>
        withProductWorkspaceFiles({target, handles}, async files => ({
            kind: body.kind,
            destination: body.destination,
            items: await files.batch({
                kind: body.kind,
                sources: body.sources,
                destination: body.destination,
                targetNames: body.targetNames,
                expectedSources: body.expectedSources,
                revalidateTarget,
            }),
        })));
});
