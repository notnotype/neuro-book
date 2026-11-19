/**
 * 核心入口：工作台的布局文档、它到 nb-layout 布局树的投影、落点规则。纯 TS，不依赖 Vue 与 DOM：服务端经应用的
 * `workbench/shared/` 也导入这里。标签条在 `@notnotype/nb-workbench-layout/vue`。
 */
export * from "./layout-doc";
export * from "./layout-project";
export * from "./layout-drop";
// 意图回写只导出两个说清时机的入口，底下的 `rebaseIntents`、`fixedNodesOf` 不导出（模块头注释）。
export {applyGestureCommit, rebaseForOperation} from "./intent-writeback";
export type {IntentWritebackRejection} from "./intent-writeback";
