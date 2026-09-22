import path from "node:path";
import {lstat} from "node:fs/promises";
import {
    relativeFilePathInside,
    relativeRealPathInside,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {STORAGE_DIRECTORY_NAME} from "nbook/server/storage/storage-address";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";

/** Project 与 user-assets 根下承载 Storage 的控制目录名。 */
const NBOOK_DIRECTORY_NAME = ".nbook";

/**
 * 普通文件接口对 Storage 的访问语义。
 *
 * `mutation` 额外覆盖 Storage 根的祖先目录：rename/delete 搬动祖先会把 Storage 一起移走。
 */
export type WorkspaceStorageAccess = "read" | "mutation";

/**
 * 普通 Workspace 文件接口触及 Storage 根时的 typed 失败。
 *
 * Storage 数据由 Storage 服务独占写入，HTTP 层按 `statusCode` 返回 403，而不是当成普通 I/O 错误。
 */
export class WorkspaceStorageBoundaryError extends Error {
    readonly statusCode = 403;

    constructor(relativePath: string) {
        super(`Storage 数据由 Storage 服务独占，普通文件接口不能访问：${relativePath}`);
        this.name = "WorkspaceStorageBoundaryError";
    }
}

/**
 * 判断一条相对路径是否指向该目标的 Storage 根内部。
 *
 * 只按 `WorkspaceFileTarget` 的显式种类翻译相对地址，不从绝对路径 basename 猜根类别，
 * 所以 `notes/storage` 这类同名普通目录不受影响。普通文件树、索引与事件消费者共用该判定。
 */
export function isWorkspaceStoragePath(target: WorkspaceFileTarget, relativePath: string): boolean {
    return storageVerdict(target.kind, comparableSegments(relativePath)) === "inside";
}

/**
 * 判断一条相对路径是否落在 user-assets 根（`WorkspaceRoot/.nbook`）的 Storage 下。
 *
 * 受管资产同步只持有同一个根，没有 Project target，因此直接复用同一种类判定。
 */
export function isUserAssetsStoragePath(relativePath: string): boolean {
    return storageVerdict("user-assets", comparableSegments(relativePath)) === "inside";
}

/**
 * 校验一次普通 Workspace 文件操作不会读写 Storage。
 *
 * 先按目标种类比较显式相对地址，再用真实路径复核 symlink/junction 别名：同一个 Storage 目录
 * 即使被别处链接进来也必须拦住。目标不存在时使用最近已存在父级的真实路径，与核心入口的
 * `assertRealPathContained()` 语义一致。解析失败必须上抛；稍后的父目录 containment 检查不能
 * 代替这里对 Storage 别名的判定。
 */
export async function assertWorkspaceStorageBoundary(
    target: WorkspaceFileTarget,
    relativePath: string,
    access: WorkspaceStorageAccess,
): Promise<void> {
    const absolutePath = resolveContainedFilePath(target.root, relativePath);
    const lexicalRelativePath = relativeFilePathInside(target.root, absolutePath);
    if (lexicalRelativePath === ".") {
        if (access === "mutation") throw new WorkspaceStorageBoundaryError(relativePath);
        return;
    }
    if (lexicalRelativePath === null) throw new WorkspaceStorageBoundaryError(relativePath);
    if (access === "mutation"
        ? await isMutationReachableStorage(target.kind, absolutePath, lexicalRelativePath)
        : isWorkspaceStoragePath(target, lexicalRelativePath)) {
        throw new WorkspaceStorageBoundaryError(relativePath);
    }
    const realRelativePath = await relativeRealPathInside(target.root, absolutePath);
    if (realRelativePath === null || realRelativePath === lexicalRelativePath) {
        return;
    }
    if (access === "mutation"
        ? await isMutationReachableStorage(target.kind, absolutePath, realRelativePath)
        : isWorkspaceStoragePath(target, realRelativePath)) {
        throw new WorkspaceStorageBoundaryError(relativePath);
    }
}

/**
 * mutation 侧判定：Storage 根内部、Storage 根祖先，或需要按真实目录种类确认的单段路径。
 *
 * `workspace-root` 下的单段地址既可能是某个 Project 目录（`<project>/.nbook/storage` 的祖先），
 * 也可能是普通目录或文件。只有真实目录且真的承载 Storage 根时才拦截；普通一级目录不能被
 * 当成 Storage 独占，否则 rename/delete 会屏蔽所有 Project 之外的一级目录。
 */
async function isMutationReachableStorage(
    kind: WorkspaceFileTarget["kind"],
    absolutePath: AbsoluteFsPath,
    relativePath: string,
): Promise<boolean> {
    const verdict = storageVerdict(kind, comparableSegments(relativePath));
    if (verdict === "inside" || verdict === "ancestor") {
        return true;
    }
    if (verdict !== "ambiguous-project-dir") {
        return false;
    }
    try {
        if (!(await lstat(absolutePath)).isDirectory()) {
            return false;
        }
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
    return await directoryCarriesStorageRoot(absolutePath);
}

/**
 * 单段目录是否真的承载 Storage 根。
 *
 * 只探测 Storage 根的准确地址，普通一级目录因此不被误判；缺失之外的真实 I/O 失败
 * （权限、链接解析等）继续上抛，不退化成 fail-open。
 */
async function directoryCarriesStorageRoot(directoryPath: string): Promise<boolean> {
    try {
        await lstat(path.join(directoryPath, NBOOK_DIRECTORY_NAME, STORAGE_DIRECTORY_NAME));
        return true;
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}

/** 同步路径分类：`inside` 与 `ancestor` 已确定命中，`ambiguous-project-dir` 需要文件系统确认。 */
type StoragePathVerdict = "none" | "inside" | "ancestor" | "ambiguous-project-dir";

/**
 * 按目标种类翻译一条归一化相对地址。
 *
 * 分段统一斜线、去掉首尾空段，并在 Windows 上与大小写不敏感文件系统保持一致。
 */
function storageVerdict(kind: WorkspaceFileTarget["kind"], segments: readonly string[]): StoragePathVerdict {
    switch (kind) {
        case "project-workspace":
            if (segments[0] !== NBOOK_DIRECTORY_NAME) {
                return "none";
            }
            if (segments.length === 1) {
                return "ancestor";
            }
            return segments[1] === STORAGE_DIRECTORY_NAME ? "inside" : "none";
        case "user-assets":
            return segments[0] === STORAGE_DIRECTORY_NAME ? "inside" : "none";
        case "workspace-root":
            if (segments[0] === NBOOK_DIRECTORY_NAME) {
                if (segments.length === 1) {
                    return "ancestor";
                }
                return segments[1] === STORAGE_DIRECTORY_NAME ? "inside" : "none";
            }
            if (segments.length === 1) {
                return "ambiguous-project-dir";
            }
            if (segments[1] !== NBOOK_DIRECTORY_NAME) {
                return "none";
            }
            if (segments.length === 2) {
                return "ancestor";
            }
            return segments[2] === STORAGE_DIRECTORY_NAME ? "inside" : "none";
    }
}

/** 归一为可比较分段；Windows 文件系统大小写不敏感，比较前统一小写。 */
function comparableSegments(relativePath: string): string[] {
    const segments = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
    if (process.platform !== "win32") {
        return segments;
    }
    return segments.map((segment) => segment.toLowerCase());
}

/** 判断 Node 文件系统错误是否表示路径不存在。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
