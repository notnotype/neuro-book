import path from "node:path";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {resolveApplicationRoot} from "nbook/server/workspace-files/system-workspace-assets";

const WORKSPACE_CONTAINER_DIRECTORY = "workspace";

/** 用户Runtime Workspace Root测试覆盖；生产代码不得设置。 */
export type WorkspaceRuntimeRootContext = {
    /** 非空时覆盖当前用户Workspace Root。 */
    workspaceRoot?: string;
    /** 非空时覆盖当前用户Workspace Root `.nbook`。 */
    userNbookRoot?: string;
};

let workspaceRuntimeRootContext: WorkspaceRuntimeRootContext | null = null;

/** 测试专用：覆盖用户Runtime Workspace Root。 */
export function setWorkspaceRuntimeRootContextForTest(context: WorkspaceRuntimeRootContext | null): void {
    workspaceRuntimeRootContext = context
        ? {
            workspaceRoot: context.workspaceRoot ? path.resolve(context.workspaceRoot) : undefined,
            userNbookRoot: context.userNbookRoot ? path.resolve(context.userNbookRoot) : undefined,
        }
        : null;
}

/** 测试专用：读取当前用户Runtime Workspace Root覆盖值。 */
export function getWorkspaceRuntimeRootContextForTest(): WorkspaceRuntimeRootContext | null {
    return workspaceRuntimeRootContext ? {...workspaceRuntimeRootContext} : null;
}

/** 测试专用：在临时用户Runtime Workspace Root中执行任务。 */
export async function withWorkspaceRuntimeRootContextForTest<T>(
    context: WorkspaceRuntimeRootContext,
    task: () => Promise<T>,
): Promise<T> {
    const previous = workspaceRuntimeRootContext;
    setWorkspaceRuntimeRootContextForTest(context);
    try {
        return await task();
    } finally {
        workspaceRuntimeRootContext = previous;
    }
}

/**
 * 运行环境Adapter：解析当前用户Workspace Root。
 *
 * Manager/Product环境始终使用RuntimePaths；无根环境下的祖先`workspace`搜索只为
 * 源码CLI和测试保留，生产核心Module应优先显式接收`RuntimePaths.workspaceRoot`。
 */
export function resolveRuntimeWorkspaceRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (workspaceRuntimeRootContext?.workspaceRoot) {
        return absoluteFsPath(workspaceRuntimeRootContext.workspaceRoot);
    }
    if (process.env.NEURO_BOOK_STATE_ROOT?.trim() || process.env.NEURO_BOOK_APPLICATION_ROOT?.trim()) {
        return runtimePathsFromEnv(startPath).workspaceRoot;
    }
    let currentPath = path.resolve(startPath);
    while (true) {
        if (path.basename(currentPath) === WORKSPACE_CONTAINER_DIRECTORY) {
            return absoluteFsPath(currentPath);
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            break;
        }
        currentPath = parentPath;
    }

    return absoluteFsPath(resolveStateWorkspaceRoot(resolveApplicationRoot(startPath)));
}

/** 解析当前用户Workspace Root `.nbook`覆盖层。 */
export function resolveUserNbookRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (workspaceRuntimeRootContext?.userNbookRoot) {
        return absoluteFsPath(workspaceRuntimeRootContext.userNbookRoot);
    }
    return absoluteFsPath(path.join(resolveRuntimeWorkspaceRoot(startPath), ".nbook"));
}
