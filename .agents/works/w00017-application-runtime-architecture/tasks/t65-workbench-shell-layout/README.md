---
schema: nbook.task/v2
taskId: t65-workbench-shell-layout
---

# NeuroBook v2 外壳一：外壳与布局

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳一：七个 Part 的外壳几何、面板四位置与四对齐、四种“消失”形态、紧凑呈现、三条布局记录经插件状态 store 持久化、工作台公开状态与五条面板命令；`/` 页换成外壳。容器、视图与拖放属于外壳二、外壳三。旧应用的外壳经开发者 2026-10-08 人工验证，作为几何与组件的参照。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)。

## 前置

K5 [t56](../t56-plugin-state/README.md)（store 与公开状态）、K6 [t64](../t64-plugin-settings/README.md)（主题与界面语言）。

## 当前状态

- 2026-10-08 计划起草；三个 omp 审查（对照旧应用与设计稿、状态与多窗口、可实现性与测试）合并去重 13 条，全部并入计划（[审查处理](plan.md#审查处理)，报告见 `evidences/plan-review-*.txt`）；三项记入 [待确认清单](../../pending-confirmations.md)。按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 进入实施。
- S0（Spec）：`ui/workbench-shell.md` 按 v2 重写（外壳一的行为写成可判定的 14 条输出与 13 条验收，外壳二、三保留已批准的合同，旧验收 24 条逐条给去向，旧口径原文归档到 `docs/archived/specs/ui/workbench-shell.md`）；`workbench/commands.md` 第二批改为读公开状态的 `when`、四条面板命令参数可省略；平台设计 P7 追加决策记录。`storage/persistence.md` 没有“首批消费者”一节，不需要改。`docs:check`、`governance:check` 无失败。
