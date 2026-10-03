/**
 * World Engine 工作台内部尺寸的产品定义（Nitro 与 app 共用）。
 *
 * 归属判定见 [storage.persistence](../../../../docs/specs/storage/persistence.md):95
 * 「主工作台左右侧栏尺寸、World Engine 内部尺寸」= **project/local**
 * （[storage.boundaries](../../../../docs/specs/storage/boundaries.md):121）：随 Project 的有效上下文恢复，
 * 切项目保留旧记录。改动前这三处尺寸是组件自持 ref（每次打开回默认 320/420/292），本次只补归属，
 * 没有旧值需要迁移，也没有另开 `localStorage`。
 *
 * 与外壳布局同一个 owner（`workbench.layout`）但独立寻址：外壳记录键是 grid 快照 `layout`，
 * 这里是三个面板尺寸，二者互不覆盖（`boundaries.md:116`）。
 *
 * 本文件只放**定义**：不读存储、不认识 Vue——读取会话在
 * `app/utils/workbench/world-engine-session.ts`。
 */

import type {StorageLimits} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import {WORKBENCH_LAYOUT_OWNER} from "nbook/shared/storage/workbench-state";

/** World Engine 内部尺寸记录键；`records: "single"`：一个 Project 一份。 */
export const WORKBENCH_WORLD_ENGINE_SIZES_KEY = "world-engine-sizes";

export const WORKBENCH_WORLD_ENGINE_SIZES_SCHEMA_VERSION = 1;

/**
 * 默认尺寸的唯一来源：与改动前组件里的 `defaultSidebarWidth`/`defaultInspectorWidth`/
 * `defaultMutationEditorHeight` 逐字段相同（320/420/292），只用于"缺失记录时的显示回落"，不产生记录。
 */
export const WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES = {
    sidebarWidth: 320,
    inspectorWidth: 420,
    mutationEditorHeight: 292,
} as const;

/** 像素上界：只用于拒绝明显无意义的数值，不作为产品策略。 */
const PANEL_SIZE_MAX = 100_000;

/**
 * 三个面板尺寸记录。
 *
 * 每个字段都可缺省：缺失表示"该字段没有已确认值"，不是 0，也不代表需要补默认值记录；
 * 保留未知字段（未来版本新增），读取回来的原件不会被本模块重写。
 */
export type WorkbenchWorldEnginePanelSizes = {
    /** 左侧 subject 栏宽度（子组件的手柄把 min/max 夹在 220/420）。 */
    readonly sidebarWidth?: number;
    /** 右侧 Inspector 宽度（手柄夹在 300/560）。 */
    readonly inspectorWidth?: number;
    /** 底部 Mutation Editor 高度（手柄夹在 160/520）。 */
    readonly mutationEditorHeight?: number;
};

/** 单个尺寸值是否合法：正的安全整数像素，且在拒绝无意义数值的上界内。 */
function isPanelSize(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= PANEL_SIZE_MAX;
}

export function isWorkbenchWorldEnginePanelSizes(value: unknown): value is WorkbenchWorldEnginePanelSizes {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {
        readonly sidebarWidth?: unknown;
        readonly inspectorWidth?: unknown;
        readonly mutationEditorHeight?: unknown;
    };
    const fields = [candidate.sidebarWidth, candidate.inspectorWidth, candidate.mutationEditorHeight];
    return fields.every((field) => field === undefined || isPanelSize(field));
}

export type WorkbenchWorldEngineDefinitionOptions = {
    readonly limits?: Partial<StorageLimits>;
};

/** 建立 World Engine 内部尺寸定义。 */
export function defineWorkbenchWorldEnginePanelSizesState(
    options: WorkbenchWorldEngineDefinitionOptions = {},
): DefinedStorageState<WorkbenchWorldEnginePanelSizes> {
    return defineStorageState<WorkbenchWorldEnginePanelSizes>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_WORLD_ENGINE_SIZES_KEY,
        scope: "project",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_WORLD_ENGINE_SIZES_SCHEMA_VERSION,
        defaultValue: WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES,
        validate: isWorkbenchWorldEnginePanelSizes,
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}
