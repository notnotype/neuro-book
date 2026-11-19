---
schema: nbook.task/v2
taskId: t37-drag-controller-tidy
status: active
updated: 2026-11-19
---

# 整理拖动控制器，纯的部分抽进库

## 目标与范围

按提案第一档第 6 项（手感引擎分两步的第一步）：按 t26 design-09、10 把每场拖动的状态收进一个对象、判定拆成纯函数、补单元测试；卡片的缩放与追赶、帧调度、卡片坐标换算抽进 nb-layout；工作台手感不变

合同：
- 工作台的行为合同不变，判据是 [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 一族的 e2e 与 Lab 场景对照基线不变。
- 抽进库的两样写成 [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 20（拖动卡片）、21（帧循环），先标 planned。

## 当前状态

2026-11-19 写计划第 1 稿（[`plan.md`](plan.md)），先按 advisor 的意见补了几处：
- 每片要跑的 e2e；
- `run` 的寿命写成“下一次拿起前一定换掉”；
- `collapseSource` 返回假时的完整分支；
- 几何测试的期望值手算、不和实现共用一个式子；
- 两条输出先写进 Spec；
- “卡片位置的换算”的读法记进待确认清单。

worktree `.worktree/w00026-t37-drag-tidy`（分支 `w00026/t37-drag-tidy`）已开，未改动。

只读盘点：[`evidences/inventory.txt`](evidences/inventory.txt)。基线：master 上 `workbench-live-drag`、`workbench-dnd`、`workbench-float` 共 76 条全过。

## 下一步

设计审查（前端：应用的 `web/` 与 nb-layout，派 Claude Sonnet），阻塞等结论；处理完按切片实施。
