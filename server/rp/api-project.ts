import type {H3Event} from "h3";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {createProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {assertProjectOpen, markProjectActivity, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

export type RpApiProjectContext = {
    workspaceRoot: AbsoluteFsPath;
    projectPath: string;
};

/** 解析并校验 RP API 的 Project Workspace，统一处理 project-not-open 错误。 */
export async function withRpApiProject<T>(event: H3Event, action: (projectRoot: string, context: RpApiProjectContext) => Promise<T>): Promise<T> {
    try {
        const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
        const projectPath = await assertProjectWorkspaceDirectory(workspaceRoot, requireProjectPathQuery(event));
        assertProjectOpen(projectPath);
        markProjectActivity(projectPath);
        return await action(resolveProjectWorkspaceRoot(workspaceRoot, projectPath), {workspaceRoot, projectPath});
    } catch (error) {
        if (error instanceof ProjectNotOpenError) throw createProjectNotOpenHttpError(error);
        throw error;
    }
}
