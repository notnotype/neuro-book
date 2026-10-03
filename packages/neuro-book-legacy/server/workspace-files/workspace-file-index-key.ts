import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectWorkspaceKey} from "nbook/server/workspace-files/project-identity";

/**
 * NeuroBook File Index 的进程内 cache identity。
 *
 * Project 使用 Lifecycle 已解析的 ProjectWorkspaceKey；plain Workspace 使用确定的
 * 绝对 root。scanPolicy 进入 identity，扫描规则升级时不会复用旧 snapshot。
 */
export type WorkspaceFileIndexKey =
    | Readonly<{
        kind: "project";
        projectKey: ProjectWorkspaceKey;
        scanPolicy: "project-v1";
    }>
    | Readonly<{
        kind: "plain-workspace";
        root: AbsoluteFsPath;
        scanPolicy: "plain-v1";
    }>;

/** 为已解析 Project identity 建立当前版本的 File Index key。 */
export function projectFileIndexKey(projectKey: ProjectWorkspaceKey): WorkspaceFileIndexKey {
    return Object.freeze({
        kind: "project",
        projectKey,
        scanPolicy: "project-v1",
    });
}

/** 为 plain Workspace 物理根建立当前版本的 File Index key。 */
export function plainFileIndexKey(root: AbsoluteFsPath): WorkspaceFileIndexKey {
    return Object.freeze({
        kind: "plain-workspace",
        root,
        scanPolicy: "plain-v1",
    });
}

/**
 * 把领域 key 编码为 SnapshotCache 使用的稳定 entry id。
 *
 * ProjectWorkspaceKey 必须来自 Symbol.for registry；禁止回退到 symbol description，
 * 以免把伪造 identity 或裸路径意外带入 cache namespace。
 */
export function workspaceFileIndexKeyId(key: WorkspaceFileIndexKey): string {
    if (key.kind === "project") {
        const projectKeyId = Symbol.keyFor(key.projectKey);
        if (!projectKeyId) {
            throw new Error("Project File Index key 必须使用全局 ProjectWorkspaceKey");
        }
        return `${key.kind}\0${projectKeyId}\0${key.scanPolicy}`;
    }
    return `${key.kind}\0${key.root}\0${key.scanPolicy}`;
}
