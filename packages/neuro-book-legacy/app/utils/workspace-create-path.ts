export type WorkspaceCreatePathKind = "file" | "directory" | "lorebook";

const DEFAULT_LOREBOOK_TYPE = "location";

/**
 * 生成工作区新建入口的默认路径。
 */
export function buildDefaultWorkspaceCreatePath(kind: WorkspaceCreatePathKind, baseDir: string | null): string {
    if (kind === "file") {
        return joinWorkspacePath(baseDir ?? "", "new-file.md");
    }
    if (kind === "directory") {
        return joinWorkspacePath(baseDir ?? "", "new-folder");
    }
    return joinWorkspacePath(resolveLorebookCreateBaseDir(baseDir), "new-entry");
}

/**
 * 解析 Lorebook 条目的默认创建目录。
 */
function resolveLorebookCreateBaseDir(baseDir: string | null): string {
    if (baseDir === null) {
        return `lorebook/${DEFAULT_LOREBOOK_TYPE}/`;
    }

    const normalizedBaseDir = normalizeWorkspaceDirectoryPath(baseDir);
    if (normalizedBaseDir === "lorebook/") {
        return `lorebook/${DEFAULT_LOREBOOK_TYPE}/`;
    }
    return normalizedBaseDir;
}

/**
 * 拼接 Workspace Root 相对路径。
 */
function joinWorkspacePath(dirPath: string, fileName: string): string {
    return dirPath ? `${dirPath.replace(/\/$/, "")}/${fileName}` : fileName;
}

/**
 * 将目录路径归一化为 `/` 分隔并保留尾随 `/`。
 */
function normalizeWorkspaceDirectoryPath(dirPath: string): string {
    const normalizedPath = dirPath.replace(/\\/g, "/").replace(/^workspace\//, "").replace(/^\.\//, "").replace(/\/+$/, "");
    return normalizedPath ? `${normalizedPath}/` : "";
}
