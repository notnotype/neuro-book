---
schema: nbook.task/v2
taskId: t66-workbench-shell-views
---

# NeuroBook v2 外壳二：容器与视图

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳二：视图注册表、落位与呈现模型、意图合成；ActivityBar 与 AuxiliaryBar、Panel 的 Switcher；隐式容器与标题回落（声明式容器、自建容器不在本 Task）；容器 empty、single、multiple 三种模式与单轴排列；容器与视图两个实例层；生命周期矩阵与三种失败；`nbook.view.move-view` 与“移动到”菜单。插件面向的视图合同（贡献点 `workbench.views`）按推荐提前到本 Task（待确认）。拖放属于外壳三。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 新建或修订）：[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)（新建）、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

外壳一 [t65](../t65-workbench-shell-layout/README.md)。

## 当前状态

- 2026-10-08 计划起草，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 交三个 omp 审查；26 条意见按推荐并入计划（见计划“审查处理”），5 项记入[待确认清单](../../pending-confirmations.md)。下一步 S0。
