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

- 第 1 片已提交（`69e1dbfad`）：实时布局里来源收起后回到原处（判为原位）就展开回原位，判定换回拿起时的几何；按下时布局还在过渡，先走到终点再按坐标找按到的元素（nb-layout `createDragSession` 加 `settleMotion`）。Spec：`ui/workbench-layout` 输出 38、`ui/layout-drag` 输出 2 与选项签名（条目级 planned）。单元测试 `live-drag.test.ts`、`drag-session.dom.test.ts`；e2e `workbench-live-drag` 新用例“同一个容器里拖走前一节再回到原处……”，两处修正各自去掉时都失败。验证：工作台与 Lab 570 项、nb-layout 530 + 190 项、`vue-tsc` web 通过；e2e `workbench-live-drag`、`workbench-containers`、`workbench-dnd` 69 条全过。
  - 复现时注意：e2e 默认减少动效，拖动一律是落点指示；量实时布局要先 `emulateMedia({reducedMotion: "no-preference"})`。
  - “松手后马上再拖”在开发者的步骤里，回到原处展开以后松手时外框已在原位，本来就不再落空；按下先走完过渡的修正覆盖的是取消、放到别处之后邻居还在滑的情形。

## 下一步

第 2 片：内容随外框长出（`grid-motion.ts` 的 `enteringRects`）。之后空区域（先写 ADR、派设计审查），动画逐个做、逐个给开发者看。
