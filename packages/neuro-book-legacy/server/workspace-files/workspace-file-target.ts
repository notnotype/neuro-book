import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRelativePath} from "nbook/server/workspace-files/project-identity";

/**
 * Workspace文件操作目标。
 *
 * HTTP/CLI/进程入口必须先把单段 Project root 与 Workspace 种类解析成这个类型；
 * 文件操作、tree index与History核心只消费已经确定的物理根，不再读取cwd或环境变量。
 */
export type WorkspaceFileTarget =
    | Readonly<{
        kind: "project-workspace";
        root: AbsoluteFsPath;
        projectRoot: WorkspaceRelativePath;
    }>
    | Readonly<{
        kind: "user-assets";
        root: AbsoluteFsPath;
    }>
    | Readonly<{
        kind: "workspace-root";
        root: AbsoluteFsPath;
    }>;

/** 返回目标在公开Workspace Interface中的逻辑标识。 */
export function workspaceFileTargetRef(target: WorkspaceFileTarget): string {
    if (target.kind === "project-workspace") {
        return target.projectRoot;
    }
    return target.kind === "user-assets" ? "workspace/.nbook" : "workspace";
}
