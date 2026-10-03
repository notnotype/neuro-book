/**
 * `files` 视图的状态定义（Nitro 与 app 共用）。
 *
 * 归属判定见 [storage.persistence](../../../../docs/specs/storage/persistence.md):98：文件树展开项与
 * 展示模式都是 **user/local** 视图偏好，不属于 Project，也不是编辑器恢复态（打开的标签 / 活动文件
 * 留给领域 Store）。
 * 旧实现在裸 `localStorage`（`nbook.workspaceFilePanel.expandedPaths`），违反
 * [storage.boundaries](../../../../docs/specs/storage/boundaries.md):103，迁移后由本记录承担。
 *
 * 本文件只放**定义**：不读存储、不认识 Vue；旧展开键迁移在 `app/utils/workbench/files-view-session.ts`。
 */

import type {StorageLimits} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";

/** `files` 视图状态的 owner；与布局记录分开分区（展开项不是尺寸 / 位置）。 */
export const WORKBENCH_FILES_OWNER = "workbench.files";

/**
 * 文件树展开路径记录键。
 *
 * `records: "single"`：旧键就是一份跨 Project 的客户端偏好，记录沿用同一可见范围，
 * 不按 Project 拆键（按 Project 拆会改变用户已习惯的恢复范围，不是本次迁移的目的）。
 */
export const WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY = "expanded-paths";

export const WORKBENCH_FILE_TREE_EXPANDED_PATHS_SCHEMA_VERSION = 1;

/** 同一文件树的两种呈现方式；不改变文件数据或目录关系。 */
export type WorkspaceFilesViewMode = "ordinary" | "content";

export const WORKBENCH_FILES_VIEW_MODE_KEY = "view-mode";
export const WORKBENCH_FILES_VIEW_MODE_SCHEMA_VERSION = 1;

export type WorkbenchFilesViewModeRecord = {
    readonly mode: WorkspaceFilesViewMode;
};
export function isWorkbenchFilesViewModeRecord(value: unknown): value is WorkbenchFilesViewModeRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("mode" in value)) {
        return false;
    }
    return value.mode === "ordinary" || value.mode === "content";
}

/** 单条路径的长度上限：只为拒绝明显无意义的输入，不作为产品策略。 */
const EXPANDED_PATH_MAX_LENGTH = 4096;

/** 路径条数上限：本地偏好记录不该被当成数据面。 */
const EXPANDED_PATH_MAX_COUNT = 4096;

/**
 * 展开路径记录。
 *
 * 只存路径数组而不存树：目录是否存在、是否还有子节点由读取时的树决定
 * （`WorkspaceFileTree` 的 `sanitizeExpandedPaths` 负责把失效路径清掉）。
 */
export type WorkbenchFileTreeExpandedPaths = {
    readonly paths: readonly string[];
};

function isExpandedPath(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= EXPANDED_PATH_MAX_LENGTH;
}

export function isWorkbenchFileTreeExpandedPaths(value: unknown): value is WorkbenchFileTreeExpandedPaths {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {readonly paths?: unknown};
    if (!Array.isArray(candidate.paths) || candidate.paths.length > EXPANDED_PATH_MAX_COUNT) {
        return false;
    }
    return candidate.paths.every(isExpandedPath);
}

export type WorkbenchFilesDefinitionOptions = {
    readonly limits?: Partial<StorageLimits>;
};

/** 建立文件树展开项定义；默认值是不展开，且只用于"缺失记录时的显示回落"，不产生记录。 */
export function defineWorkbenchFileTreeExpandedPathsState(
    options: WorkbenchFilesDefinitionOptions = {},
): DefinedStorageState<WorkbenchFileTreeExpandedPaths> {
    return defineStorageState<WorkbenchFileTreeExpandedPaths>({
        owner: WORKBENCH_FILES_OWNER,
        key: WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_FILE_TREE_EXPANDED_PATHS_SCHEMA_VERSION,
        defaultValue: {paths: []},
        validate: isWorkbenchFileTreeExpandedPaths,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}

/** 缺失记录只显示普通模式，不因此初始化偏好记录。 */
export function defineWorkbenchFilesViewModeState(
    options: WorkbenchFilesDefinitionOptions = {},
): DefinedStorageState<WorkbenchFilesViewModeRecord> {
    return defineStorageState<WorkbenchFilesViewModeRecord>({
        owner: WORKBENCH_FILES_OWNER,
        key: WORKBENCH_FILES_VIEW_MODE_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_FILES_VIEW_MODE_SCHEMA_VERSION,
        defaultValue: {mode: "ordinary"},
        validate: isWorkbenchFilesViewModeRecord,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}
