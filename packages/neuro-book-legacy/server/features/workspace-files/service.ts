import {stat as statFile} from "node:fs/promises";
import {createError} from "h3";
import type {WorkspaceFileSourceIdentity} from "nbook/shared/dto/workspace-file-operation.dto";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectDataPlaneHandles} from "nbook/server/workspace-files/project-open-guard";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {
    assertFullTreeSnapshotQuery,
    readPlainWorkspaceTreeSnapshot,
    readProjectWorkspaceTreeSnapshot,
    subscribeWorkspaceTreeIndex,
    workspaceTreeIndexOptionsForTarget,
} from "nbook/server/workspace-files/project-workspace-index";
import {assertWorkspaceStorageBoundary} from "nbook/server/workspace-files/workspace-storage-boundary";
import {readWorkspaceTextFile, statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {buildWorkspaceWriteConflict} from "nbook/server/workspace-files/workspace-file-conflict";
import {USER_LOCAL_ACTOR, writeWorkspaceTextFileTracked, createWorkspaceFileTracked, createWorkspaceDirectoryTracked, renameWorkspacePathTracked, deleteWorkspacePathTracked, batchWorkspacePathsTracked, convertWorkspaceFileToDirectoryTracked} from "nbook/server/workspace-history/tracked-workspace-files";

export type WorkspaceFilesBinding = Readonly<{
    target: WorkspaceFileTarget;
    handles: ProjectDataPlaneHandles | undefined;
}>;

export type WorkspaceTreeRequest = Readonly<{
    targets: string[];
    type: string | null;
    depth: number | null;
}>;

export type WorkspaceWriteRequest = Readonly<{
    path: string;
    content: string;
    baseContent?: string;
    expectedMtimeMs?: number | null;
    force?: boolean;
}>;

/**
 * 已捕获一次 Project ready operation 的数据面。只消费该代的 Index/History，
 * 不按路径重新解析 Project，也不在 mutation 内部重新进入非重入的 File Index gate。
 */
export function createWorkspaceFilesService(binding: WorkspaceFilesBinding) {
    const {target, handles} = binding;
    if ((target.kind === "project-workspace") !== Boolean(handles)) {
        throw new Error("Project Files 需要同代 ready handles；非 Project 不接受它们");
    }
    return {
        subscribe(onEvent: Parameters<typeof subscribeWorkspaceTreeIndex>[1]) {
            return subscribeWorkspaceTreeIndex(workspaceTreeIndexOptionsForTarget(target, handles?.fileIndex), onEvent);
        },
        createFile(filePath: string, content?: string) {
            return createWorkspaceFileTracked({target, history: handles?.history, filePath, content, actor: USER_LOCAL_ACTOR});
        },
        createDirectory(dirPath: string, indexContent?: string | null) {
            return createWorkspaceDirectoryTracked({target, history: handles?.history, dirPath, indexContent, actor: USER_LOCAL_ACTOR});
        },
        convertToDirectory(filePath: string) {
            return convertWorkspaceFileToDirectoryTracked({target, history: handles?.history, filePath, actor: USER_LOCAL_ACTOR});
        },
        rename(fromPath: string, toPath: string) {
            return renameWorkspacePathTracked({target, history: handles?.history, fromPath, toPath, actor: USER_LOCAL_ACTOR});
        },
        delete(filePath: string, recursive: boolean) {
            return deleteWorkspacePathTracked({target, history: handles?.history, filePath, recursive, actor: USER_LOCAL_ACTOR});
        },
        batch(request: Omit<Parameters<typeof batchWorkspacePathsTracked>[0], "target" | "history" | "actor">) {
            return batchWorkspacePathsTracked({...request, target, history: handles?.history, actor: USER_LOCAL_ACTOR});
        },
        async tree(request: WorkspaceTreeRequest) {
            assertFullTreeSnapshotQuery(request);
            if (target.kind !== "project-workspace") {
                return readPlainWorkspaceTreeSnapshot({target, ...request});
            }
            if (!handles) throw new Error("Project Files 缺少同代 Index handle");
            return readProjectWorkspaceTreeSnapshot({target, fileIndex: handles.fileIndex, ...request});
        },
        async stat(filePath: string) {
            await assertWorkspaceStorageBoundary(target, filePath, "read");
            try {
                const node = await statWorkspacePath(target.root, filePath);
                const info = await statFile(node.absolutePath);
                if (!Number.isFinite(info.dev) || !Number.isFinite(info.ino) || info.ino === 0 || !Number.isFinite(info.birthtimeMs)) {
                    return node;
                }
                const sourceIdentity: WorkspaceFileSourceIdentity = {
                    dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs,
                    mtimeMs: info.mtimeMs, size: info.size,
                };
                return {...node, sourceIdentity};
            } catch (error) {
                if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                    throw createError({statusCode: 404, message: "工作区文件不存在", data: {code: "ENOENT"}});
                }
                throw error;
            }
        },
        async read(filePath: string) {
            await assertWorkspaceStorageBoundary(target, filePath, "read");
            const [node, content] = await Promise.all([
                statWorkspacePath(target.root, filePath),
                readWorkspaceTextFile(target.root, filePath),
            ]);
            return {
                path: node.path,
                absolutePath: node.absolutePath,
                entryType: node.entryType,
                editable: node.editable,
                mtimeMs: node.mtimeMs,
                content,
            };
        },
        async write(request: WorkspaceWriteRequest) {
            await assertWorkspaceStorageBoundary(target, request.path, "mutation");
            let knownBefore: string | null | undefined;
            if (!request.force && request.expectedMtimeMs !== undefined) {
                const remoteState = await readRemoteState(target.root, request.path);
                knownBefore = remoteState.node === null ? null : remoteState.content;
                const actualMtimeMs = remoteState.node?.mtimeMs ?? null;
                if (actualMtimeMs !== request.expectedMtimeMs) {
                    const conflict = await buildWorkspaceWriteConflict({
                        path: request.path,
                        expectedMtimeMs: request.expectedMtimeMs,
                        actualMtimeMs,
                        baseContent: request.baseContent ?? "",
                        localContent: request.content,
                        remoteContent: remoteState.content,
                        remoteExists: remoteState.node !== null,
                        node: remoteState.node,
                    });
                    throw createError({
                        statusCode: 409,
                        statusMessage: "Workspace file write conflict",
                        message: "真实文件已被修改，请先处理冲突",
                        data: conflict,
                    });
                }
            }
            await writeWorkspaceTextFileTracked({
                target,
                history: handles?.history,
                filePath: request.path,
                content: request.content,
                actor: USER_LOCAL_ACTOR,
                knownBefore,
            });
            return statWorkspacePath(target.root, request.path);
        },
    };
}

async function readRemoteState(root: AbsoluteFsPath, filePath: string) {
    try {
        const [node, content] = await Promise.all([
            statWorkspacePath(root, filePath),
            readWorkspaceTextFile(root, filePath),
        ]);
        return {node, content};
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {node: null, content: ""};
        }
        throw error;
    }
}
