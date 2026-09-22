import {retireLegacyBucketWriterWhenPreserved} from "nbook/app/utils/workbench/legacy-bucket-retirement";
import {storageMigrationController} from "nbook/app/utils/workbench/storage-migration";

/**
 * 旧桶原件保护与导入的启动接线。
 *
 * 顺序是这个任务的核心合同：`novel.ide.local` 的完整原件必须在旧 Pinia 持久化插件可能重写它之前固化。
 * 两条依据都来自实际加载路径，不是按文件名字排序的推断：
 *
 * 1. `pinia-plugin-persistedstate` 只在 store 首次实例化时水合并注册写回订阅
 *    （`createPersistence` 里 `hydrateStore` 紧接 `store.$subscribe`），因此"旧 writer 存在"的唯一前提是
 *    某个组件调用了 `useNovelIdeStore()`——即应用挂载之后。
 * 2. Nuxt 的客户端插件在挂载前被逐个 await：`nuxt/dist/app/entry.js` 先 `await applyPlugins(...)`，
 *    然后才 `app:beforeMount` 与 `vueApp.mount(...)`；插件顺序由 `enforce` 决定（`nuxt/dist/index.mjs` 的
 *    `orderMap`），`pre` 排在所有默认插件之前。
 *
 * 因此这里用 `enforce: "pre"` 并把 `setup` 等到暂存结算：应用挂载时写回门禁已经生效。
 * data 备份与逐项导入不阻塞启动（后端不可达不能扩大为整桶不可持久化），状态由迁移快照观察。
 * 旧桶三字段此时还在 `novel.ide.local` 里（`pick` 已不含它们，但序列化器继续从捕获原件补齐），
 * 只有在原件确实安全保留之后才退役——见下。
 */

export default defineNuxtPlugin({
    name: "storage-migration",
    enforce: "pre",
    async setup() {
        const migration = storageMigrationController();
        retireLegacyBucketWriterWhenPreserved(migration);
        void migration.start();
        await migration.staged;
        return {provide: {storageMigration: migration}};
    },
});
