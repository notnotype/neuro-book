import {createError} from "h3";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    isIgnoredProjectFileIndexPath,
    projectFileIndexAdapter,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import type {
    WorkspaceFileNode,
    WorkspaceScanOptions,
} from "nbook/server/workspace-files/workspace-files";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import type {WorkspaceTreeSnapshotDto} from "nbook/shared/dto/workspace-tree.dto";

type ProjectWorkspaceTarget = Extract<WorkspaceFileTarget, {kind: "project-workspace"}>;
type PlainWorkspaceTarget = Exclude<WorkspaceFileTarget, {kind: "project-workspace"}>;
type WorkspaceTreeScanOptions = Omit<WorkspaceScanOptions, "root" | "signal">;

/** Project tree 数据面必须携带 ReadyProjectSession 当前 generation 的精确 File Index handle。 */
export type ProjectWorkspaceTreeIndexOptions = WorkspaceTreeScanOptions & {
    readonly target: ProjectWorkspaceTarget;
    readonly fileIndex: ProjectFileIndexHandle;
};

/** plain Workspace 不建立 ProjectSession，读取与 SSE ownership 直接由 Adapter 管理。 */
export type PlainWorkspaceTreeIndexOptions = WorkspaceTreeScanOptions & {
    readonly target: PlainWorkspaceTarget;
};

export type WorkspaceTreeIndexOptions = ProjectWorkspaceTreeIndexOptions | PlainWorkspaceTreeIndexOptions;
type WorkspaceTreeIndexSubscriber = (event: WorkspaceFileStreamEventDto) => void | Promise<void>;

/**
 * 将路由层union target收窄为File Index公开读取/订阅合同。
 * Project必须携带当前generation handle，plain Workspace保持无ProjectSession路径。
 */
export function workspaceTreeIndexOptionsForTarget(
    target: WorkspaceFileTarget,
    fileIndex: ProjectFileIndexHandle | undefined,
): WorkspaceTreeIndexOptions {
    if (target.kind === "project-workspace") {
        if (!fileIndex) {
            throw new Error("Project File Index读取缺少当前ReadyProjectSession generation handle");
        }
        return {target, fileIndex};
    }
    return {target};
}

/**
 * 读取统一 workspace tree snapshot。
 *
 * Project 分支只消费调用方显式传入的 generation handle；plain 分支是不会 activation 的 one-shot read。
 */
export async function readWorkspaceTreeSnapshot(
    options: WorkspaceTreeIndexOptions,
): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    if (options.target.kind === "project-workspace") {
        if (!("fileIndex" in options)) {
            throw new Error("Project File Index读取缺少当前ReadyProjectSession generation handle");
        }
        return options.fileIndex.read();
    }
    return projectFileIndexAdapter.readPlain(options.target);
}

/** 保留既有 Project tree 入口名称，内部不再按 path 查找或创建 cache entry。 */
export async function readProjectWorkspaceTreeSnapshot(
    options: ProjectWorkspaceTreeIndexOptions,
): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    return readWorkspaceTreeSnapshot(options);
}

/** plain Workspace one-shot tree 入口；不会隐式打开 watcher。 */
export async function readPlainWorkspaceTreeSnapshot(
    options: PlainWorkspaceTreeIndexOptions,
): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    return projectFileIndexAdapter.readPlain(options.target);
}

/**
 * 订阅 watcher ready 与稳定 snapshot commit，不等待 watcher ready 才交付unsubscribe。
 * Project activation 由 Module 持有；plain activation 由首末 SSE consumer 引用计数持有。
 */
export async function subscribeWorkspaceTreeIndex(
    options: WorkspaceTreeIndexOptions,
    handler: WorkspaceTreeIndexSubscriber,
): Promise<() => void> {
    let unsubscribe: (() => void);
    let ready: Promise<void>;
    if (options.target.kind === "project-workspace") {
        if (!("fileIndex" in options)) {
            throw new Error("Project File Index订阅缺少当前ReadyProjectSession generation handle");
        }
        unsubscribe = options.fileIndex.subscribe(handler);
        ready = options.fileIndex.ready;
    } else {
        unsubscribe = projectFileIndexAdapter.subscribePlain(options.target, handler);
        ready = projectFileIndexAdapter.waitPlainReady(options.target);
    }
    void ready.catch(() => {
        unsubscribe();
    });
    return unsubscribe;
}

/** 关闭 plain Workspace root；Project entry 只能由其 Module handle 关闭。 */
export async function closeWorkspaceTreeIndex(root: AbsoluteFsPath): Promise<void> {
    await projectFileIndexAdapter.closePlain({kind: "workspace-root", root});
}

/** Nitro shutdown/HMR 最终关闭唯一生产 cache。 */
export async function closeAllWorkspaceTreeIndexes(): Promise<void> {
    await projectFileIndexAdapter.closeAll();
}

/** watcher 与完整扫描共用的 runtime artifact/控制目录忽略合同。 */
export function isIgnoredWorkspaceWatchPath(value: string): boolean {
    return isIgnoredProjectFileIndexPath(value);
}

/** 当前 Adapter 只发布完整 tree，拒绝悄悄改变 cache identity 的过滤参数。 */
export function assertFullTreeSnapshotQuery(input: {targets: string[]; type: string | null; depth: number | null}): void {
    if (input.targets.length > 0 || input.type || input.depth !== null) {
        throw createError({
            statusCode: 400,
            message: "tree snapshot 暂不支持 target/type/depth 过滤查询，请请求完整 Project Workspace tree",
        });
    }
}
