---
schema: nbook.task/v2
taskId: t56-plugin-state
---

# NeuroBook v2 第 5 步 K5：插件状态 store 与公开状态

## 目标与范围

按 [插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（2026-10-07 `accepted`）第 3、4 节与 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 11 节的 K5：插件作者用 `defineStore` 统一声明内存、持久化、派生、公开状态与 action；公开键在声明层静态声明、激活时绑定；命令的 `when` 读公开状态。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 新建或修订）：`docs/specs/state/public-state.md`、`docs/specs/state/store.md`（新建）、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)。

## 前置

K4 [t55](../t55-plugin-storage/README.md)（`nbook.storage`，持久化字段建在它上面）。

## 当前状态

2026-10-08 计划起草；omp 计划审查（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）阻断 2、重要 10，全部成立并已并入计划。同日开发者同意先改计划：store 改为 setup 写法、不用 Pinia（计划第 3 节、待确认第 2 项）。开发者确认计划与 6 项推荐（计划“已确认”一节）；排在 t59 之后实施。
