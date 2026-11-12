/**
 * 模型服务的核心，只在 Bun 进程里用：选择顺序 `chooseModel`、服务核心 `createModelsCore` 与它读写配置的接口
 * `ModelsConfigStore`（由应用把自己的设置服务适配成它）。
 */

export {chooseModel} from "./choice";
export type {ModelChoice} from "./choice";
export {createModelsCore} from "./core";
export type {ModelsCore, ModelsCoreDeps} from "./core";
export type {ConfigKey, ConfigSlot, ModelsConfigStore, SlotLayer, SlotWriteResult} from "./store";
