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

- 2026-10-08 计划起草，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 交三个 omp 审查。
