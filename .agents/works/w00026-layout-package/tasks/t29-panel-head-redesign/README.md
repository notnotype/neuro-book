---
schema: nbook.task/v2
taskId: t29-panel-head-redesign
status: active
updated: 2026-11-17
---

# 面板头与分节全部收起的样子

## 目标与范围

开发者 2026-11-17：侧栏一个容器里的视图全部收起时样式不对，要重新设计；面板头有点丑，收起后更丑。出静态稿逐轮评审，定了再写 Spec 与计划。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 11（收成标题行、一列全部收起时“标题行排在上面，下面留空”）、输出 20（工具面板的面板头）；[`workbench/views`](../../../../../docs/specs/workbench/views.md) 输出 10、12（视图动作随鼠标显示）。定稿后按决定改。

和 [t28](../t28-panel-entry-strips/README.md) 的关系：t28 并成一行的头用的就是这个面板头，所以 t28 第 2 片（画出入口条与并成一行）排在本 Task 定稿之后；t28 第 1 片（nb-layout 的入口条叶与交换规则）不受影响。

## 当前状态

2026-11-17 经 nbdev 新建、开工。

- 现状（e2e 环境截的产品页，浅色）：全部收起时卡片缩成两行、下面露出窗体底，活动栏一直到底，像断开的一列；头 32px，标题 12px 粗体次要字色，浮动、收起、最大化三个按钮常在，收起的行只靠收起按钮按下的底色区分。
- 第 1 轮评审板 [`artifacts/review`](artifacts/review/index.html) 已发布（v1，三题：全部收起的画法、头的画法、点标题行做什么），草稿在 worktree `.worktree/w00026-t29-drafts`（分支 `w00026-t29/drafts`，不合并），Lab 场景 `SidebarMock`。

## 下一步

等开发者答第 1 轮；答复写进本节后定 Spec 与计划。
