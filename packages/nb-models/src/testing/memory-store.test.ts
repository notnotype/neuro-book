/** 内存实现对过存储合同：服务核心的测试用它代替应用的设置存储。 */

import {memoryModelsConfig} from "./memory-store";
import {runModelsConfigStoreContract} from "./store-contract";

runModelsConfigStoreContract("内存实现", async () => {
    const store = memoryModelsConfig();
    return {
        store,
        writeExternally: async (key, value) => store.writeExternally(key, value),
        settle: () => store.catchUp(),
        breakLayer: async (state) => store.setLayer(state),
        close: async () => undefined,
    };
});
