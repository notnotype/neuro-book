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

在 worktree `.worktree/w00026-t25-container-feedback`（分支 `fix/w00026-t25-container-feedback`，从 master `b5f894ed8` 开）实施，计划 [`plan.md`](plan.md) 开发者 2026-11-12 确认（“可以，开始吧”）。

- 第 1 片（`69e1dbfad`）与第 2 片（`4c9cacfe8`）已提交：
  - 实时布局里来源收起后回到原处（判为原位）就展开回原位，判定换回拿起时的几何（Spec `ui/workbench-layout` 输出 38，条目级 planned）。单元测试 `live-drag.test.ts`；e2e `workbench-live-drag`“同一个容器里拖走前一节再回到原处……松手后马上再按，照常拿起”，去掉展开时失败。
  - 停放过的内容随刚长出来的叶一起长：切回容器、侧栏显示时内容不再先于外框整块出现。根因是内容是早就挂着的元素，起点样式带着过渡标记写上去，浏览器开始一段到起点的过渡，紧接着写终点就地反向取消；现在起点那一帧不带标记。Spec `ui/nested-grid` 的“内容层”写明停放过的内容同样。单元测试 `grid-motion.test.ts`；e2e `workbench-containers`“切回容器、侧栏从隐藏到显示……每一帧都不超出外框”，两处改动各自去掉时都失败。
  - 计划里的“过渡中按下先走到终点”第 1 片做了、第 2 片撤回，理由见 [`plan.md`](plan.md)。
  - 验证：工作台与 Lab 570 项、nb-layout 531 + 190 项、两份类型检查通过；e2e `workbench-containers`、`workbench-views`、`workbench-shell`、`workbench-live-drag`、`workbench-float`、`workbench-dnd`、`lab-workbench-surface` 149 条在撤回前 148 过（失败的就是被撤回那项弄坏的 `float:295`），撤回后重跑 `workbench-live-drag`、`workbench-float` 与新用例 38 条全过。
  - 复现时注意：e2e 默认减少动效，拖动一律是落点指示；量实时布局与过渡要先 `emulateMedia({reducedMotion: "no-preference"})`。

## 下一步

第 3 片：空区域能打开（先写 ADR、派设计审查）。之后动画逐个做、逐个给开发者看。
