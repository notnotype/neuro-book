/**
 * 模型服务的核心，只在 Bun 进程里用：选择顺序 `chooseModel`、服务核心 `createModelsCore`、它读写配置的接口
 * `ModelsConfigStore`（由应用把自己的设置服务适配成它）与来源文件的存放 `SourceStore`。
 */

export {chooseModel} from "./choice";
export type {ModelChoice} from "./choice";
export {createModelsCore} from "./core";
export type {IconStore, ModelsCore, ModelsCoreDeps} from "./core";
export {ICON_NAME} from "./icons";
export {SOURCE_STALE_MS} from "./sources";
export type {SourceStore} from "./sources";
export {listTemplates, templateOf} from "./templates";
export type {ConfigKey, ConfigSlot, ModelsConfigStore, SlotLayer, SlotWriteResult} from "./store";
