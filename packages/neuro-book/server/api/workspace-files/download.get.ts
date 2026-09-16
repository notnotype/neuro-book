import {createError, sendStream, setResponseHeader} from "h3";
import {
    createProjectWorkspaceZipStream,
    createWorkspaceZipStream,
    type WorkspaceArchive,
} from "nbook/server/workspace-files/workspace-archive";
import {
    resolveWorkspaceFileTarget,
    USER_ASSETS_WORKSPACE_KIND,
} from "nbook/server/workspace-files/novel-workspace";
import {
    withProjectTargetOperation,
} from "nbook/server/workspace-files/project-open-guard";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {encodeRfc5987Filename} from "nbook/server/utils/rfc5987";

/**
 * 打包下载当前 Project Workspace；user-assets 入口打包 Workspace Root .nbook。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const projectRoot = typeof query.projectRoot === "string" ? query.projectRoot : undefined;
    const workspaceKind = query.workspaceKind === USER_ASSETS_WORKSPACE_KIND ? query.workspaceKind : undefined;
    if (workspaceKind !== USER_ASSETS_WORKSPACE_KIND && !projectRoot?.trim()) {
        throw createError({statusCode: 400, message: "projectRoot 不能为空"});
    }

    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectRoot, workspaceKind});
    return withProjectTargetOperation(target, async (projectHandles) => {
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
