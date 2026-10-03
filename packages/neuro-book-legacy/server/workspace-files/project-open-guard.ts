import {createError} from "h3";
import {ZodError} from "zod";
import {
    requireReadyModuleHandle,
    requireActiveReadyProject,
    requireReadyProjectByPublicId,
    runReadyProjectOperation,
    startReadyProjectOperation,
    type ProjectOperationStart,
} from "nbook/server/runtime/product-project";
import {throwProjectHttpError, withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {
    ProjectLifecycleError,
    projectWorkspaceRef,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    projectFileIndexAdapter,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {parseWorkspaceFileBinding} from "nbook/shared/dto/workspace-file-binding.dto";
import type {WorkspaceFileBindingDto} from "nbook/shared/dto/workspace-file-binding.dto";

/** HTTP Project数据面一次捕获的required handles，全部属于同一 ready generation。 */
export type ProjectDataPlaneHandles = Readonly<{
    ready: ReadyProjectSessionRef;
    fileIndex: ProjectFileIndexHandle;
    history: ProjectHistoryHandle;
}>;

/** 文件 HTTP 边界将缺失、混用或无效的根/代次标识归类为输入错误。 */
export function parseWorkspaceFileHttpBinding(input: Record<string, unknown>): WorkspaceFileBindingDto {
    try {
        return parseWorkspaceFileBinding(input);
    } catch (error) {
        if (error instanceof ZodError) {
            throw createError({statusCode: 400, message: "工作区文件绑定无效：Project 需要 projectRoot 和 publicId，用户资产需要 workspaceKind"});
        }
        throw error;
    }
}

/**
 * 路由层Project open守卫：只有明确的Project Workspace目标需要显式open。
 */
export function assertProjectOpenForTarget(target: WorkspaceFileTarget): void {
    if (target.kind === "project-workspace") {
        requireActiveReadyProject(projectWorkspaceRef(target.projectRoot));
    }
}

/** Project target一次解析为结构化ref；plain Workspace返回null。 */
export function projectRefForTarget(target: WorkspaceFileTarget): ProjectWorkspaceRef | null {
    return target.kind === "project-workspace"
        ? projectWorkspaceRef(target.projectRoot)
        : null;
}

/** Project mutation/read入口一次取得当前generation的required handles；plain target返回undefined。 */
export function projectHandlesForTarget(target: WorkspaceFileTarget): ProjectDataPlaneHandles | undefined {
    if (target.kind !== "project-workspace") {
        return undefined;
    }
    const ready = requireActiveReadyProject(projectWorkspaceRef(target.projectRoot));
    return Object.freeze({
        ready,
        fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
        history: requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN),
    });
}

/** 文件 HTTP 请求只允许其自身携带的 exact Project generation；禁止按路径选中后来重开的实例。 */
function boundProjectHandles(target: WorkspaceFileTarget, binding: WorkspaceFileBindingDto): ProjectDataPlaneHandles | undefined {
    if (target.kind !== "project-workspace") {
        if (!("workspaceKind" in binding) || target.kind !== "user-assets") {
            throw new Error("文件目标与请求绑定不一致");
        }
        return undefined;
    }
    if (!("projectRoot" in binding) || binding.projectRoot !== target.projectRoot) {
        throw new Error("文件目标与请求绑定不一致");
    }
    const ready = requireReadyProjectByPublicId(projectWorkspaceRef(binding.projectRoot), binding.publicId);
    if (ready.workspace.root !== target.root) {
        throw new ProjectLifecycleError("PROJECT_ROOT_REPLACED", "Project 文件目标与精确 ready 物理根不一致");
    }
    return Object.freeze({
        ready,
        fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
        history: requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN),
    });
}

export function withBoundProjectTargetOperation<TResult>(
    target: WorkspaceFileTarget,
    binding: WorkspaceFileBindingDto,
    handler: (handles: ProjectDataPlaneHandles | undefined) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectHttpError(async () => {
        const handles = boundProjectHandles(target, binding);
        return handles
            ? runReadyProjectOperation(handles.ready, async (_signal, _assertTarget, revalidateTarget) => {
                await revalidateTarget();
                return handler(handles);
            })
            : handler(undefined);
    });
}

export function withBoundProjectTargetMutation<TResult>(
    target: WorkspaceFileTarget,
    binding: WorkspaceFileBindingDto,
    handler: (handles: ProjectDataPlaneHandles | undefined, revalidateTarget?: () => Promise<void>) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectHttpError(async () => {
        if (target.kind !== "project-workspace") {
            boundProjectHandles(target, binding);
            return projectFileIndexAdapter.mutatePlain(target, () => handler(undefined));
        }
        const handles = boundProjectHandles(target, binding);
        if (!handles) throw new Error("Project mutation 缺少 ready handles");
        return runReadyProjectOperation(handles.ready, async (_signal, _assertTarget, revalidateTarget) => {
            await revalidateTarget();
            return handles.fileIndex.mutate(() => handler(handles, revalidateTarget));
        });
    });
}

/** SSE 直到连接完成才归还精确 Project operation。 */
export function startBoundProjectTargetOperation<TResult>(
    target: WorkspaceFileTarget,
    binding: WorkspaceFileBindingDto,
    start: (handles: ProjectDataPlaneHandles | undefined, signal: AbortSignal) => ProjectOperationStart<TResult>,
): TResult {
    try {
        const handles = boundProjectHandles(target, binding);
        if (handles) {
            return startReadyProjectOperation(handles.ready, (signal, assertTarget, _revalidateTarget) => {
                assertTarget();
                return start(handles, signal);
            });
        }
        const started = start(undefined, new AbortController().signal);
        void started.completion.catch(() => undefined);
        return started.result;
    } catch (error) {
        throwProjectHttpError(error);
    }
}

/**
 * History HTTP seam：单段 Project root 只在这里解析一次，两个 required handle
 * 都绑定到同一个 ready generation。
 */
export function requireProjectHandles(projectRoot: string): ProjectDataPlaneHandles {
    const ready = requireActiveReadyProject(projectWorkspaceRef(projectRoot));
    return Object.freeze({
        ready,
        fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
        history: requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN),
    });
}

/**
 * Workspace Files HTTP统一数据面边界。Project target从exact ready捕获到handler settle始终在场；
 * plain Workspace/user-assets不属于ProjectSession，直接执行同一个handler。
 */
export function withProjectTargetOperation<TResult>(
    target: WorkspaceFileTarget,
    handler: (handles: ProjectDataPlaneHandles | undefined) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectHttpError(async () => {
        const handles = projectHandlesForTarget(target);
        if (!handles) {
            return handler(undefined);
        }
        return runReadyProjectOperation(handles.ready, async () => handler(handles));
    });
}

/**
 * Workspace Files HTTP统一mutation边界。
 *
 * Project mutation同时持有当前ready generation operation与File Index entry gate；plain Workspace
 * 不建立ProjectSession，但仍与相同cache entry的完整树构建串行。mutation settle后cache自动失效。
 */
export function withProjectTargetMutation<TResult>(
    target: WorkspaceFileTarget,
    handler: (handles: ProjectDataPlaneHandles | undefined) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectHttpError(async () => {
        if (target.kind !== "project-workspace") {
            return projectFileIndexAdapter.mutatePlain(target, () => handler(undefined));
        }
        const handles = projectHandlesForTarget(target);
        if (!handles) {
            throw new Error("Project mutation缺少当前ReadyProjectSession generation handles");
        }
        return runReadyProjectOperation(handles.ready, () => (
            handles.fileIndex.mutate(() => handler(handles))
        ));
    });
}

/** History HTTP统一数据面边界：解析一次 Project root 并持有同一generation直到请求settle。 */
export function withProjectHandlesOperation<TResult>(
    projectRoot: string,
    handler: (handles: ProjectDataPlaneHandles) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectHttpError(async () => {
        const handles = requireProjectHandles(projectRoot);
        return runReadyProjectOperation(handles.ready, async () => handler(handles));
    });
}

/**
 * SSE等流式响应的Project边界。result可立即交给H3，completion必须在连接真正关闭后settle；
 * Project close会通过signal要求流主动收尾，并等待completion释放。
 */
export function startProjectTargetOperation<TResult>(
    target: WorkspaceFileTarget,
    start: (
        handles: ProjectDataPlaneHandles | undefined,
        signal: AbortSignal,
    ) => ProjectOperationStart<TResult>,
): TResult {
    try {
        const handles = projectHandlesForTarget(target);
        if (!handles) {
            const started = start(undefined, new AbortController().signal);
            void started.completion.catch(() => undefined);
            return started.result;
        }
        return startReadyProjectOperation(handles.ready, (signal) => start(handles, signal));
    } catch (error) {
        throwProjectHttpError(error);
    }
}
