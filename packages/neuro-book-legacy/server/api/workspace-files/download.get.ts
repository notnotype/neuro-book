import {sendStream, setResponseHeader} from "h3";
import {
    createProjectWorkspaceZipStream,
    createWorkspaceZipStream,
    type WorkspaceArchive,
} from "nbook/server/workspace-files/workspace-archive";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {withBoundProjectTargetOperation, parseWorkspaceFileHttpBinding} from "nbook/server/workspace-files/project-open-guard";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {encodeRfc5987Filename} from "nbook/server/utils/rfc5987";

/**
 * 打包下载当前 Project Workspace；user-assets 入口打包 Workspace Root .nbook。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const binding = parseWorkspaceFileHttpBinding(query);
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), binding);
    return withBoundProjectTargetOperation(target, binding, async (projectHandles) => {
        let archive: WorkspaceArchive;
        if (target.kind === "project-workspace") {
            if (!projectHandles) {
                throw new Error("Project Workspace target缺少ready generation");
            }
            archive = await createProjectWorkspaceZipStream(projectHandles.ready.workspace);
        } else {
            archive = await createWorkspaceZipStream(target);
        }
        return sendArchive(event, archive);
    });
});

/**
 * 发送当前挂载目标压缩包。
 */
function sendArchive(event: Parameters<typeof setResponseHeader>[0], archive: WorkspaceArchive) {
    const filename = encodeRfc5987Filename(archive.filename);

    setResponseHeader(event, "Content-Type", "application/zip");
    setResponseHeader(event, "Content-Disposition", `attachment; filename="${archive.filename}"; filename*=UTF-8''${filename}`);
    return sendStream(event, archive.stream);
}
