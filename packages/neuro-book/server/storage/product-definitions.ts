/**
 * 产品状态定义的唯一定义清单。
 *
 * `registerStorageStateDefinitions` 是运行期策略的唯一来源：请求不能登记定义。之前没有任何生产调用方，
 * 浏览器因此拿不到 `workbench.migration` 备份边界与布局记录，真实应用里的迁移与工作台记录都不可达。
 *
 * 约定（后续切片沿用，不新建第二个注册插件）：
 * - 新 owner 的定义**追加到构建函数里**，定义实例只构造一次；
 * - 定义实例存放在 `globalThis` 槽里：注册表按**实例身份**判定（`StorageStateRegistry.register`），
 *   而注册表自己跨 HMR 存活（`host.ts` 的 `__nbookStorageHostV4` 槽）。如果每次模块重载都新建实例，
 *   重载后的注册必然被既有注册表拒绝（`STORAGE_DEFINITION_INVALID`：另一个模块实例的实例集合不认它）。
 *   槽位让重载复用同一批实例，注册因此幂等，宿主内已有等价定义继续服务；
 *   代价是同一进程内修改定义清单需要真正重启 Nitro（与宿主的 HMR 交接同一取舍）。
 * - 定义所在的模块必须能被 Nitro 与浏览器同时 import（`shared/storage/**`），不引入 Vue/Pinia/Nuxt。
 *
 * scope/locality 划分见 [storage.persistence](../../../../docs/specs/storage/persistence.md)：
 * 迁移原件与元数据是 `workbench.migration` 的 user/local 专用备份边界；
 * 未开项目/用户资产尺寸、书架模式与两个普通窗口尺寸是 `workbench.layout` 的 user/local 记录；
 * 主工作台的 Project 内 grid 布局记录与 World Engine 内部尺寸是同 owner 的 project/local 记录（各占一键）。
 */

import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {defineWorkbenchShellLayoutState} from "nbook/shared/storage/workbench-shell-layout";
import {defineWorkbenchMigrationStates} from "nbook/shared/storage/workbench-migration";
import {defineWorkbenchFileTreeExpandedPathsState} from "nbook/shared/storage/workbench-files";
import {defineWorkbenchWorldEnginePanelSizesState} from "nbook/shared/storage/workbench-world-engine";
import {
    defineWorkbenchCreateProjectWindowSizeState,
    defineWorkbenchSettingsWindowSizeState,
} from "nbook/shared/storage/workbench-window-sizes";
import {defineWorkbenchShelfModeState, defineWorkbenchSurfaceSizesState} from "nbook/shared/storage/workbench-state";
import {registerStorageStateDefinitions} from "nbook/server/storage/host";

/**
 * 跨 HMR 的定义槽。
 *
 * 与 `host.ts` 的宿主槽同一套做法：模块重载后仍然复用第一次构造的实例，
 * 因此"同一实例重复登记"这条幂等合同在重载后依然成立。
 */
const globalForProductDefinitions = globalThis as typeof globalThis & {
    __nbookProductStorageDefinitionsV1?: readonly DefinedStorageState<unknown>[];
};

/** 构造全部产品定义；只应由槽位初始化调用一次。 */
function buildProductStorageStates(): readonly DefinedStorageState<unknown>[] {
    return Object.freeze([
        ...defineWorkbenchMigrationStates(),
        defineWorkbenchSurfaceSizesState() as DefinedStorageState<unknown>,
        defineWorkbenchShelfModeState() as unknown as DefinedStorageState<unknown>,
        defineWorkbenchShellLayoutState() as unknown as DefinedStorageState<unknown>,
        // `files` 视图的展开项（user/local）：旧裸键 `nbook.workspaceFilePanel.expandedPaths` 的正式归属。
        defineWorkbenchFileTreeExpandedPathsState() as unknown as DefinedStorageState<unknown>,
        // World Engine 内部尺寸（project/local，`persistence.md:95`）：组件自持 ref 的正式归属。
        defineWorkbenchWorldEnginePanelSizesState() as unknown as DefinedStorageState<unknown>,
        // 两个普通窗口尺寸（user/local，`persistence.md:97`）：旧裸键 `nbook.settingsDialog.size` 与
        // `nbook.projectCreateDialog.size.v2` 的正式归属，与书架模式同 owner。
        defineWorkbenchSettingsWindowSizeState() as unknown as DefinedStorageState<unknown>,
        defineWorkbenchCreateProjectWindowSizeState() as unknown as DefinedStorageState<unknown>,
    ]);
}

globalForProductDefinitions.__nbookProductStorageDefinitionsV1 ??= buildProductStorageStates();

export function productStorageDefinitions(): readonly DefinedStorageState<unknown>[] {
    return globalForProductDefinitions.__nbookProductStorageDefinitionsV1!;
}

/** 生产注册入口；Nitro 插件只调用它。模块重载后重复调用是幂等的（同一批实例）。 */
export function registerProductStorageDefinitions(): void {
    registerStorageStateDefinitions(productStorageDefinitions());
}
