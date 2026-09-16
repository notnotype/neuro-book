/**
 * 产品状态定义的唯一定义清单。
 *
 * `registerStorageStateDefinitions` 是运行期策略的唯一来源：请求不能登记定义。之前没有任何生产调用方，
 * 浏览器因此拿不到 `workbench.migration` 备份边界与布局记录，真实应用里的迁移与工作台记录都不可达。
 *
 * 约定（后续切片沿用，不新建第二个注册插件）：
 * - 新 owner 的定义**追加到本文件的数组**，定义实例只在这里构造一次；
 * - 同一实例重复登记是幂等操作，因此 dev HMR 重新执行插件不会产生重复注册冲突；
 * - 定义所在的模块必须能被 Nitro 与浏览器同时 import（`shared/storage/**`），不引入 Vue/Pinia/Nuxt。
 *
 * scope/locality 划分见 [storage.persistence](../../../../docs/specs/storage/persistence.md)：
 * 迁移原件与元数据是 `workbench.migration` 的 user/local 专用备份边界；
 * 未开项目/用户资产尺寸与书架模式是 `workbench.layout` 的 user/local 记录。
 * 主工作台的 Project 内 grid 布局记录由工作台宿主在自己的切片里追加到这里。
 */

import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {defineWorkbenchMigrationStates} from "nbook/shared/storage/workbench-migration";
import {defineWorkbenchShelfModeState, defineWorkbenchSurfaceSizesState} from "nbook/shared/storage/workbench-state";
import {registerStorageStateDefinitions} from "nbook/server/storage/host";

/**
 * 启动必须注册的全部产品定义。
 *
 * 只构造一次：模块级实例让重复注册保持幂等，也让浏览器侧消费的定义与服务端注册的定义保持同一份声明来源。
 */
const productStorageStates: readonly DefinedStorageState<unknown>[] = Object.freeze([
    ...defineWorkbenchMigrationStates(),
    defineWorkbenchSurfaceSizesState() as DefinedStorageState<unknown>,
    defineWorkbenchShelfModeState() as unknown as DefinedStorageState<unknown>,
]);

export function productStorageDefinitions(): readonly DefinedStorageState<unknown>[] {
    return productStorageStates;
}

/** 生产注册入口；Nitro 插件只调用它。 */
export function registerProductStorageDefinitions(): void {
    registerStorageStateDefinitions(productStorageStates);
}
