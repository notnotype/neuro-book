/**
 * 面板尺寸记录的产品定义（Nitro 与浏览器共用）。
 *
 * 两个轴各自保存**用户主动结束的手势意图**：高度轴是水平位置（top/bottom）的落点，宽度轴是
 * 左右位置（left/right）的落点（见 `workbench-shell-layout.ts` 的默认树注释与
 * `app/utils/workbench/layout-session.ts` 的提交路由）。两轴独立记忆——换位置不以当前高度
 * 覆盖宽度；某个轴没有已确认值时按产品默认显示，不为了补齐而写一条默认记录。
 *
 * 两个键分属两个工作面，互不 fallback：
 * - `panel-size`：Project 内面板尺寸（project/local，单例，与外壳 grid 记录同 owner 同分区）；
 * - `surface-panel-size`：未开 Project / 用户资产工作面的面板尺寸（user/local，按工作面 id 寻址）。
 *
 * 两个键都属于既有的 `workbench.layout` owner：**不声明显式 limits**——同一 owner 在同一
 * scope/locality 下共用一个实际分区，容量声明必须与已登记的同分区定义完全一致，否则注册失败。
 */

import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import {WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_IDS} from "nbook/shared/storage/workbench-state";

/** Project 内面板尺寸键。 */
export const WORKBENCH_PANEL_SIZE_KEY = "panel-size";

/** 显式 user 工作面的面板尺寸键；资源标识是工作面 id。 */
export const WORKBENCH_SURFACE_PANEL_SIZE_KEY = "surface-panel-size";

export const WORKBENCH_PANEL_SIZE_SCHEMA_VERSION = 1;

/** 合法尺寸值的取值边界：正有限数；上界只用于拒绝明显无意义的数值，不作为产品策略（两轴同一把尺）。 */
const PANEL_SIZE_MAX = 1_000_000;

/**
 * 面板尺寸记录。两个轴都可缺省：缺失表示"没有已确认值"，消费者回落到产品默认显示，
 * 但不为了补齐而写一条默认值记录。未知字段保留。
 */
export type WorkbenchPanelSize = {
    readonly height?: number;
    readonly width?: number;
    readonly [field: string]: unknown;
};

/** 单个轴的尺寸值是否合法：正有限数且在拒绝无意义数值的上界内。 */
export function isWorkbenchPanelSizeValue(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= PANEL_SIZE_MAX;
}

export function isWorkbenchPanelSize(value: unknown): value is WorkbenchPanelSize {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {readonly height?: unknown; readonly width?: unknown};
    return (candidate.height === undefined || isWorkbenchPanelSizeValue(candidate.height))
        && (candidate.width === undefined || isWorkbenchPanelSizeValue(candidate.width));
}

/** 缺失记录时的显示回落：空记录由几何层用产品默认尺寸呈现，不落盘。 */
export const WORKBENCH_PANEL_SIZE_DEFAULT: WorkbenchPanelSize = Object.freeze({});

/** 建立 Project 内面板尺寸定义（project/local，单例）。 */
export function defineWorkbenchPanelSizeState(): DefinedStorageState<WorkbenchPanelSize> {
    return defineStorageState<WorkbenchPanelSize>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_PANEL_SIZE_KEY,
        scope: "project",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_PANEL_SIZE_SCHEMA_VERSION,
        defaultValue: WORKBENCH_PANEL_SIZE_DEFAULT,
        validate: isWorkbenchPanelSize,
    });
}

/** 建立显式 user 工作面面板尺寸定义（user/local，按工作面 id 寻址）。 */
export function defineWorkbenchSurfacePanelSizeState(): DefinedStorageState<WorkbenchPanelSize> {
    return defineStorageState<WorkbenchPanelSize>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_SURFACE_PANEL_SIZE_KEY,
        scope: "user",
        locality: "local",
        records: "identified",
        schemaVersion: WORKBENCH_PANEL_SIZE_SCHEMA_VERSION,
        defaultValue: WORKBENCH_PANEL_SIZE_DEFAULT,
        validate: isWorkbenchPanelSize,
    });
}

/** 合法的工作面资源标识：与 `workbench.layout/surface-sizes` 同一张表。 */
export {WORKBENCH_SURFACE_IDS};
