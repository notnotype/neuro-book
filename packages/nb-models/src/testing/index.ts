/**
 * 测试用：配置存储的合同测试与内存实现、本机的 OpenAI 兼容假端点。只给测试引用。
 */

export {runModelsConfigStoreContract} from "./store-contract";
export type {LayerState, ModelsConfigFixture} from "./store-contract";
export {memoryModelsConfig} from "./memory-store";
export type {MemoryModelsConfig, MemoryModelsConfigOptions} from "./memory-store";
export {startFakeOpenAiEndpoint} from "./fake-endpoint";
export type {FakeOpenAiEndpoint} from "./fake-endpoint";
