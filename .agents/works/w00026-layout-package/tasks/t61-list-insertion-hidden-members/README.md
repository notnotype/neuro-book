---
schema: nbook.task/v2
taskId: t61-list-insertion-hidden-members
status: planned
updated: 2026-11-26
---

# 列表插入位认滚出去的成员；README 写 TS 6 的 types（摩擦 3、8）

## 目标与范围

resolveListInsertion 过了最后一个看得见的成员、后面还有滚出去的成员时插到第一个滚出去的前面；标签编组示例的标签条能滚动；README 安装一节写 types: [] 在 TS 6 下的报错

合同：列表插入位的规则在包文档 [DropFeedbackOverlay](../../../../../packages/nb-layout/src/vue/DropFeedbackOverlay.md)（没有 Spec 条目）；t50 摩擦第 3、8 条。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-26 开发者定 w00026 收尾后继续自主优化；主会话写计划，派 coder 实施，与 t60 并行（文件不重叠，CHANGELOG 合入时变基）。

## 下一步

按计划两片实施，主会话验收合入。
