---
schema: nbook.task/v2
taskId: t64-plugin-settings
---

# NeuroBook v2 第 5 步 K6：配置插件 `nbook.settings`

## 目标与范围

按 [插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（2026-10-07 `accepted`）第 6、7 节与 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 11 节的 K6：插件声明配置项，按默认值、用户层、项目层合成有效值并推到各实例，所有已声明项可读、只写自己的；第一批使用者是界面语言与主题。设计轮的决定由开发者 2026-10-08 确认，记在计划的 Context。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 新建或修订）：[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)（新建）、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)、[`state/store.md`](../../../../../docs/specs/state/store.md)、[`storage/boundaries.md`](../../../../../docs/specs/storage/boundaries.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

K5 [t56](../t56-plugin-state/README.md)（store 的读配置辅助函数建在它上面）；[t61](../t61-kernel-catalog-failure-codes/README.md) 的失败码。

## 当前状态

- 2026-10-08 计划起草；三个 omp 交叉审查（对照 VS Code、架构与授权、文件层实验与使用场景）共 32 条，主 Agent 逐条核实后全部并入计划（[审查处理](plan.md#审查处理)，报告见 `evidences/plan-review-*.txt`）。开发者授权按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进，本该开发者确认的点记入 [待确认清单](../../pending-confirmations.md)。
- S0（Spec 与文档）`1abde4fa`。
- S1（只含声明的定义可以登记；`pluginsAt`、`definitionAt` 统一三个宿主与浏览器引导的插件集合；宿主能力 `clockKey`、`windowConnectionKey`）：内核 301 例、应用 338 例与组件 57 例、三份 typecheck 通过，新判据做了变异检查。
