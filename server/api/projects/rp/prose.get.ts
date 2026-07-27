import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {assertProjectOpen, markProjectActivity, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {createProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {listTickProse} from "nbook/server/rp/prose-store";

/**
 * RP 模式正文聚合：按 Tick 升序返回 `rp/ticks/<NNNNNN>-<slug>/prose.md` 列表，
 * 供 RP 界面右侧正文阅读面板做"小说式"连续展示。
 */
export default defineEventHandler(async (event) => {
    try {
        const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
        const projectPath = await assertProjectWorkspaceDirectory(workspaceRoot, requireProjectPathQuery(event));
        assertProjectOpen(projectPath);
        markProjectActivity(projectPath);
        const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, projectPath);
        return {items: await listTickProse(projectRoot)};
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
});
