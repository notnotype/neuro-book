import path from "node:path";
import {
    relativeFilePathInside,
    resolveContainedFilePath,
} from "nbook/server/runtime/paths/file-path";
import {
    STORAGE_DIRECTORY_NAME,
    STORAGE_LOCK_DIRECTORY_NAME,
} from "nbook/server/storage/storage-address";
import {isStorageTempFileName} from "nbook/server/storage/record-codec";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import {isProjectLifecycleTempName} from "nbook/server/workspace-files/project-lifecycle-manifest";
import {isRuntimeGeneratedWorkspacePath} from "nbook/server/workspace-files/runtime-generated-path";

/** Project 控制目录名；Storage 根固定位于其下。 */
const NBOOK_DIRECTORY_NAME = ".nbook";

/** Project Workspace 路径策略的三个数据面消费者。 */
export type ProjectWorkspacePathConsumer = "file-index" | "history" | "archive";

/** 路径来源类别；staging/tombstone 属于 Workspace Root Lifecycle 控制面，不在此联合类型内。 */
export type ProjectWorkspacePathCategory =
    | "content"
    | "recovery"
    | "rebuildable-runtime"
    | "lifecycle-temp"
    | "storage"
    | "storage-runtime";

/** 消费者对当前路径采取的明确动作。 */
export type ProjectWorkspacePathDisposition = "consume" | "ignore" | "preserve";

/** 单次 Project Workspace 路径策略查询。 */
export type ProjectWorkspacePathPolicyInput = {
    readonly workspace: ResolvedProjectWorkspace;
    readonly relativePath: string;
    readonly consumer: ProjectWorkspacePathConsumer;
};

/** 路径类别与消费者动作必须一起返回，禁止退化为共享布尔排除值。 */
export type ProjectWorkspacePathPolicyResult = Readonly<{
    category: ProjectWorkspacePathCategory;
    disposition: ProjectWorkspacePathDisposition;
}>;

/**
 * 返回当前 ProjectSession generation 中某条 Project-relative 路径的消费策略。
 *
 * 本 Policy 不处理 Workspace Root Lifecycle staging/tombstone；它们没有 Project-relative
 * 地址，继续由 Lifecycle 控制面按私有 ownership 规则管理。
 */
export function projectWorkspacePathPolicy(
    input: ProjectWorkspacePathPolicyInput,
): ProjectWorkspacePathPolicyResult {
    const portableInput = input.relativePath.replaceAll("\\", "/");
    if (path.posix.isAbsolute(portableInput) || path.win32.isAbsolute(input.relativePath)) {
        throw new Error(`Project-relative path 不能是绝对路径：${input.relativePath}`);
    }
    let normalized: string | null;
    try {
        const absolutePath = resolveContainedFilePath(input.workspace.root, portableInput);
        normalized = relativeFilePathInside(input.workspace.root, absolutePath);
    } catch (error) {
        throw new Error(`Project-relative path 越过当前 Project Workspace：${input.relativePath}`, {cause: error});
    }
    if (!normalized || normalized === ".") {
        throw new Error("Project-relative path 不能为空");
    }
    const comparable = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    const segments = comparable.split("/");
    const fileName = segments[segments.length - 1] ?? "";
    if (segments[0] === NBOOK_DIRECTORY_NAME && segments[1] === STORAGE_DIRECTORY_NAME) {
        // Storage 分区锁与同目录临时文件是可重建的运行期产物；正式记录、墓碑、原件与身份域元数据不是。
        const isStorageRuntime = segments[2] === STORAGE_LOCK_DIRECTORY_NAME || isStorageTempFileName(fileName);
        if (isStorageRuntime) {
            return Object.freeze({category: "storage-runtime", disposition: "ignore"});
        }
        return Object.freeze({
            category: "storage",
            disposition: input.consumer === "archive" ? "preserve" : "ignore",
        });
    }
    const lifecycleTempLocation = segments.length === 1
        || (segments.length === 3 && segments[0] === ".nbook" && segments[1] === "recovery");
    if (lifecycleTempLocation && isProjectLifecycleTempName(fileName)) {
        return Object.freeze({category: "lifecycle-temp", disposition: "ignore"});
    }
    if (normalized === ".nbook/recovery" || normalized.startsWith(".nbook/recovery/")) {
        return Object.freeze({
            category: "recovery",
            disposition: input.consumer === "archive" ? "preserve" : "ignore",
        });
    }
    if (isRuntimeGeneratedWorkspacePath(normalized)) {
        return Object.freeze({category: "rebuildable-runtime", disposition: "ignore"});
    }
    return Object.freeze({category: "content", disposition: "consume"});
}
