/**
 * 普通窗口尺寸的产品定义（Nitro 与 app 共用）。
 *
 * 归属判定见 [storage.persistence](../../../../docs/specs/storage/persistence.md):97
 * 「书架显示模式、普通设置窗口尺寸」= **user/local**：窗口尺寸是客户端偏好，既不进 Config
 * （[storage.boundaries](../../../../docs/specs/storage/boundaries.md):28-40），也不随 Project 变化。
 * 与书架模式同 owner（`workbench.layout`），各键独立寻址。
 *
 * 旧实现在裸 `localStorage`（`nbook.settingsDialog.size`、`nbook.projectCreateDialog.size.v2`），
 * 违反 [storage.boundaries](../../../../docs/specs/storage/boundaries.md):103；迁移后由这两条记录承担。
 *
 * 本文件只放**定义**：不读存储、不认识 Vue，也不做迁移——读取会话与旧键的一次性迁移在
 * `app/utils/workbench/window-size-session.ts`。
 */

import type {StorageLimits} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import {WORKBENCH_LAYOUT_OWNER} from "nbook/shared/storage/workbench-state";

/** 设置窗口尺寸记录键；`records: "single"`（一个客户端一份）。 */
export const WORKBENCH_SETTINGS_WINDOW_SIZE_KEY = "settings-dialog-size";

/** 新建作品对话框尺寸记录键；与设置窗口各占一键，互不覆盖。 */
export const WORKBENCH_CREATE_PROJECT_WINDOW_SIZE_KEY = "create-project-dialog-size";

export const WORKBENCH_SETTINGS_WINDOW_SIZE_SCHEMA_VERSION = 1;
export const WORKBENCH_CREATE_PROJECT_WINDOW_SIZE_SCHEMA_VERSION = 1;

/**
 * 窗口默认尺寸的唯一来源：与旧实现写入前的回落值逐字段相同
 * （`NovelIdeSettingsDialog.vue` 的 1120×640、`ProjectCreateDialog.vue` 的 580×360）。
 */
export const WORKBENCH_SETTINGS_WINDOW_DEFAULT_SIZE = {width: 1120, height: 640} as const;
export const WORKBENCH_CREATE_PROJECT_WINDOW_DEFAULT_SIZE = {width: 580, height: 360} as const;

/**
 * 窗口最小尺寸的唯一来源（显示夹紧，不是记录校验的边界）：与旧实现的
 * `MIN_SETTINGS_WINDOW_SIZE` / `MIN_WINDOW_SIZE` 逐字段相同。
 */
export const WORKBENCH_SETTINGS_WINDOW_MIN_SIZE = {width: 720, height: 420} as const;
export const WORKBENCH_CREATE_PROJECT_WINDOW_MIN_SIZE = {width: 320, height: 330} as const;

/** 像素上界：只用于拒绝明显无意义的数值，不作为产品策略。 */
const WINDOW_SIZE_MAX = 100_000;

export type WorkbenchWindowSize = {
    readonly width: number;
    readonly height: number;
};

/** 尺寸值是否合法：正的安全整数像素，且在拒绝无意义数值的上界内。 */
function isWindowSizeValue(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= WINDOW_SIZE_MAX;
}

export function isWorkbenchWindowSize(value: unknown): value is WorkbenchWindowSize {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {readonly width?: unknown; readonly height?: unknown};
    return isWindowSizeValue(candidate.width) && isWindowSizeValue(candidate.height);
}

export type WorkbenchWindowSizeDefinitionOptions = {
    readonly limits?: Partial<StorageLimits>;
};

/** 建立设置窗口尺寸定义；默认值只用于"缺失记录时的显示回落"，不产生记录。 */
export function defineWorkbenchSettingsWindowSizeState(
    options: WorkbenchWindowSizeDefinitionOptions = {},
): DefinedStorageState<WorkbenchWindowSize> {
    return defineStorageState<WorkbenchWindowSize>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_SETTINGS_WINDOW_SIZE_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_SETTINGS_WINDOW_SIZE_SCHEMA_VERSION,
        defaultValue: WORKBENCH_SETTINGS_WINDOW_DEFAULT_SIZE,
        validate: isWorkbenchWindowSize,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}

/** 建立新建作品对话框尺寸定义；默认值同样只用于显示回落。 */
export function defineWorkbenchCreateProjectWindowSizeState(
    options: WorkbenchWindowSizeDefinitionOptions = {},
): DefinedStorageState<WorkbenchWindowSize> {
    return defineStorageState<WorkbenchWindowSize>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_CREATE_PROJECT_WINDOW_SIZE_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_CREATE_PROJECT_WINDOW_SIZE_SCHEMA_VERSION,
        defaultValue: WORKBENCH_CREATE_PROJECT_WINDOW_DEFAULT_SIZE,
        validate: isWorkbenchWindowSize,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}
