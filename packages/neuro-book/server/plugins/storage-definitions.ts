import {defineNitroPlugin} from "nitropack/runtime";
import {registerProductStorageDefinitions} from "nbook/server/storage/product-definitions";

/**
 * 启动时登记产品状态定义。
 *
 * 没有这一步，运行期注册表是空的：浏览器的每个值动作都会以 `STORAGE_STATE_UNREGISTERED` 失败，
 * 旧值迁移的备份边界与工作台布局记录在真实应用里不可达。
 */
export default defineNitroPlugin(() => {
    registerProductStorageDefinitions();
});
