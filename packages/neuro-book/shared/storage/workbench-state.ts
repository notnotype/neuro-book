/**
 * 主工作台布局状态的产品定义（Nitro 与 app 共用）。
 *
 * 这里只放"旧值迁移的目标"：显式 user 工作面的尺寸记录与书架模式记录。它们由迁移适配器条件初始化，
 * 后续由工作台会话宿主消费（`app/utils/workbench/`）。Project 内尺寸与 grid 布局记录属于工作台宿主，
 * 由后续消费者在同一注册入口追加，不在本文件登记。
 *
 * 归属依据 [storage.persistence](../../../../../docs/specs/storage/persistence.md)「数据归属与首批消费者」：
 * 未开项目/用户资产工作面使用**显式 user/local 记录**，与 Project 尺寸独立、不能互为 fallback；
 * 书架显示模式同属 user/local。因此两个键都声明 `user` + `local`，不新增 scope。
 *
 * 缺省字段（`WorkbenchSurfaceSizes`）表示"该字段没有已确认值"：消费者回落到产品默认尺寸显示，
 * 但不得为了补齐而写一条默认值记录（Spec「缺失时不自动落盘」）。
 */

import type {StorageLimits} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";

/** 主工作台布局状态的 owner；同 owner 的 user/local 定义共用同一个实际分区容量。 */
export const WORKBENCH_LAYOUT_OWNER = "workbench.layout";

/** 显式 user 工作面尺寸记录键；`records: "identified"`，资源标识是工作面 id。 */
export const WORKBENCH_SURFACE_SIZES_KEY = "surface-sizes";

/** 书架显示模式记录键；跨 Project 恢复的 user/local 单例。 */
export const WORKBENCH_SHELF_MODE_KEY = "shelf-mode";

export const WORKBENCH_SURFACE_SIZES_SCHEMA_VERSION = 1;
export const WORKBENCH_SHELF_MODE_SCHEMA_VERSION = 1;

/**
 * 面板默认宽度的唯一来源。
 *
 * 外壳几何（`app/utils/workbench/layout.ts`）与迁移目标默认值都读这里：迁移合同要求
 * "默认尺寸从产品唯一常量读取，不在迁移文件中维护另一套数值"，因此数值只声明一次。
 */
export const WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH = 340;
export const WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH = 400;

/** 合法旧尺寸的取值边界：正有限数；上界只用于拒绝明显无意义的数值，不作为产品策略。 */
const PANEL_WIDTH_MAX = 1_000_000;

/** 显式 user 工作面：没有 Project 上下文的工作面各自使用自己的记录，不借用 Project 记录。 */
export const WORKBENCH_SURFACE_IDS = ["idle", "user-assets"] as const;
export type WorkbenchSurfaceId = (typeof WORKBENCH_SURFACE_IDS)[number];

/** 书架显示模式；与 `ProjectPickerLayoutMode` 的持久化取值同表。 */
export const WORKBENCH_SHELF_MODES = ["grid", "compact", "editorial"] as const;
export type WorkbenchShelfMode = (typeof WORKBENCH_SHELF_MODES)[number];

/**
 * 工作面尺寸记录。
 *
 * 两个字段都可缺省：缺失表示"该字段没有已确认值"，不是 0，也不代表需要补默认值记录。
 * 保留未知字段（未来版本新增），读取回来的原件不会被本模块重写。
 */
export type WorkbenchSurfaceSizes = {
    readonly leftPanelWidth?: number;
    readonly agentPanelWidth?: number;
};

/** 单个尺寸值是否合法：正有限数，且在拒绝无意义数值的上界内。 */
export function isWorkbenchPanelWidth(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= PANEL_WIDTH_MAX;
}

export function isWorkbenchSurfaceSizes(value: unknown): value is WorkbenchSurfaceSizes {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {readonly leftPanelWidth?: unknown; readonly agentPanelWidth?: unknown};
    if (candidate.leftPanelWidth !== undefined && !isWorkbenchPanelWidth(candidate.leftPanelWidth)) {
        return false;
    }
    return candidate.agentPanelWidth === undefined || isWorkbenchPanelWidth(candidate.agentPanelWidth);
}

export function isWorkbenchShelfMode(value: unknown): value is WorkbenchShelfMode {
    return typeof value === "string" && (WORKBENCH_SHELF_MODES as readonly string[]).includes(value);
}

export type WorkbenchStateDefinitionOptions = {
    readonly limits?: Partial<StorageLimits>;
};

/**
 * 建立显式 user 工作面尺寸定义。
 *
 * 默认值是两个产品默认宽度：它只用于"缺失记录时的显示回落"，不产生记录（Spec 的缺失语义）。
 */
export function defineWorkbenchSurfaceSizesState(
    options: WorkbenchStateDefinitionOptions = {},
): DefinedStorageState<WorkbenchSurfaceSizes> {
    return defineStorageState<WorkbenchSurfaceSizes>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_SURFACE_SIZES_KEY,
        scope: "user",
        locality: "local",
        records: "identified",
        schemaVersion: WORKBENCH_SURFACE_SIZES_SCHEMA_VERSION,
        defaultValue: {
            leftPanelWidth: WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
            agentPanelWidth: WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
        },
        validate: isWorkbenchSurfaceSizes,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}

/** 建立书架显示模式定义；默认 `grid` 同样只用于显示回落。 */
export function defineWorkbenchShelfModeState(
    options: WorkbenchStateDefinitionOptions = {},
): DefinedStorageState<WorkbenchShelfMode> {
    return defineStorageState<WorkbenchShelfMode>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_SHELF_MODE_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_SHELF_MODE_SCHEMA_VERSION,
        defaultValue: "grid",
        validate: isWorkbenchShelfMode,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}
