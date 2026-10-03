import {rm} from "node:fs/promises";
import {closeProject, openProject} from "nbook/server/runtime/product-project";
import {
    projectWorkspaceRef,
    resolveProjectWorkspaceRoot,
} from "nbook/server/workspace-files/project-identity";
import {isProjectLifecycleError} from "nbook/server/workspace-files/project-identity";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {getWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** 取得测试显式声明的隔离Workspace Root；拒绝回退到源码仓库真实数据根。 */
function requireTestWorkspaceRoot(): AbsoluteFsPath {
    const context = getWorkspaceRuntimeRootContextForTest();
    if (!context?.workspaceRoot) {
        throw new Error("Project测试必须先设置隔离WorkspaceRuntimeRootContext，禁止使用默认Workspace Root");
    }
    return absoluteFsPath(context.workspaceRoot);
}

/**
 * 测试专用：按后台 job opener 打开 Project，会触发 openProject 的目录校验与一次性数据库初始化。
 */
export async function openProjectForTest(projectRoot: string): Promise<ReadyProjectSessionRef> {
    const workspaceRoot = requireTestWorkspaceRoot();
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await openProject(
                projectWorkspaceRef(projectRoot),
                {kind: "job", source: "test"},
                workspaceRoot,
            );
        } catch (error) {
            // 测试通常先直接搭建fixture再open；Workspace Root watcher可能仍在收敛这批已完成写入。
            if (!isProjectLifecycleError(error) || error.code !== "PROJECT_ROOT_REPLACED" || attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error(`Project测试打开失败：${projectRoot}`);
}

/**
 * 测试专用：关闭 Project 会话并释放所有 Project 级资源。
 */
export async function closeProjectForTest(projectRoot: string): Promise<void> {
    await closeProject(projectWorkspaceRef(projectRoot), "shutdown");
}

/** 关闭并严格删除当前隔离Workspace Root内的测试Project Workspace。 */
export async function removeProjectWorkspaceForTest(projectRoot: string): Promise<void> {
    const workspaceRoot = requireTestWorkspaceRoot();
    const projectDirectory = resolveProjectWorkspaceRoot(workspaceRoot, projectWorkspaceRef(projectRoot));
    await closeProjectForTest(projectRoot);
    collectReleasedSqliteHandles({force: true});
    await rm(projectDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
}
