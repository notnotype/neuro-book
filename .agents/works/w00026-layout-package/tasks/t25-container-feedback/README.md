---
schema: nbook.task/v2
taskId: t25-container-feedback
status: active
updated: 2026-11-12
---

# 视图容器试用反馈：拖动与显隐的三个问题、四处动画

## 目标与范围

开发者 2026-11-12 在开发服务上试用 t24（视图容器第一步）后的反馈：侧栏容器里拖走一节再移回原处不让位；松手后马上再拖拖不起来；动画时内容先于外框出来；右栏拖空后打不开；四处动画（设置窗口的关闭、侧栏展开、视图浮动、标签与容器切换），一个一个来。

不做：右栏、底部面板的入口条（视图容器第二步）。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 11、22、38、43 与验收 8，[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的内容层；空区域要另写 ADR 部分取代 [ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md) 决策 1。

## 当前状态

在 worktree `.worktree/w00026-t25-container-feedback`（分支 `fix/w00026-t25-container-feedback`，从 master `b5f894ed8` 开）里用临时探针复现了三个问题，原因与开发者的决定见 [`plan.md`](plan.md) 的 Context。计划已写，等开发者确认后实施。

## 下一步

开发者确认计划后按切片实施：拖动两处 → 内容随外框长出 → 空区域（先写 ADR、派设计审查）→ 动画逐个做、逐个给开发者看。
