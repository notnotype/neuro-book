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

2026-10-08 计划起草；omp 计划审查（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）阻断 2、重要 10，全部成立并已并入计划。同日开发者同意先改计划：store 改为 setup 写法、不用 Pinia（计划第 3 节、待确认第 2 项）。开发者确认计划与 6 项推荐（计划“已确认”一节）。S0–S8 已实现，omp 实现审查 11 条已修正；两份新 Spec 保持 `planned`，待开发者批准晋升。实施中的调整记在计划“验收映射”前。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `34033b24` | 新 Spec `state/public-state.md`、`state/store.md`（`planned`）；`commands.md`、`plugins.md`、`plugin-manifest.md`、`plugin-api.md` 修订；两份提案追加决策记录（提案正文冻结，不改示例） |
| S4、S5 | `48cbc7fb` | `src/shared/store/`：setup 写法、只读视图与 action、公开绑定、持久化字段与保存队列；`@vue/reactivity` 直接依赖并进 Vite 预构建；多实例的 Storage 测试场地 `src/plugins/storage/testing/world.ts`；`store.test.ts` 14 例，冲突不重放、unknown 后重算、去掉已落盘视为完成、释放不经 flush 四个变异各被抓住 |
| S1 | `7b3d6d7b`、`0cec1e46` | 内核的已接受声明查询与环判定（`declarations.test.ts`）；接收者可选的 `published` 回调（`owner-contribution-points.test.ts` 增补 3 例）；各自的变异被抓住 |
| S2 | `bf22b11d` | 内置插件 `nbook.state`，进产品清单与三个宿主；`state.test.ts` 7 例，四个变异各被抓住 |
| S3 | `d1fa5eca` | 命令的键来源接口，产品命令表读公开状态，Lab 包本地表；`plugin.test.ts` 增补，两个变异被抓住 |
| S6 | `3bc2006f` | `nbook.commands/remote`（`remote.test.ts` 2 例），三个变异各被抓住 |
| S7 | `a8aa3729` | 探针与 `e2e/state.e2e.ts`（3 例） |
| S8 | （待提交） | Spec 证据与已实现条目（`1e381563`）；omp 实现审查（[evidences/impl-review.txt](evidences/impl-review.txt)）阻断 1、重要 6、建议 4，全部成立并修正：`change` 抛错按 `change-threw` 失败（原来提交永不结算、停止卡住）；`change` 拿到的值冻结（原来就地修改会被算两次）；读取错误也暂停队首、可 `reopen`；嵌套的持久化字段在 `create` 时拒绝；释放时固定只读视图第一层的值（`effectScope` 停不了 computed）；释放路径用 `finally` 收口；停止中的公开读取按未就绪；内核在一次最外层推导里复用已得出的结果（无环共享依赖原来指数展开）；Spec 补环判定的前提、删去旧条款，证据只写实际覆盖。新增的用例各有对应变异被抓住 |

收口验证（[test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)、[test-e2e.txt](evidences/test-e2e.txt)、[smoke-server.txt](evidences/smoke-server.txt)）：审查修正后内核 294 例、应用 310 例与组件 57 例、两包类型检查，e2e 48 例，`smoke:server` S1–S8 全部通过；`docs:check`、`governance:check` 无失败。

未验证的边界：提供方在同一绑定里停而复起后 `reopen` 成功（产品里只有热插拔会这样；读取错误后的 `reopen` 成功已有用例）；“迟到的保存结果不倒退”由结构保证、未单独测；停止时字段还没拿到首个快照、排队的修改等快照到了再发的分支没有用例；浏览器两个标签页的冲突是否发生取决于时序，确定的冲突重放只在合同测试里验证。
