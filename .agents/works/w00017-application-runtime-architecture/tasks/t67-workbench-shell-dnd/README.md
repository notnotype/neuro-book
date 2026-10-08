---
schema: nbook.task/v2
taskId: t67-workbench-shell-dnd
---

# NeuroBook v2 外壳三：拖放

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳三：视图与容器两类拖动源、Switcher 插入位、容器内容的边缘并入与空 Part 整区三类落点；自建容器 `custom:<UUID>`、整组并入、半区按来源比例分配；键盘拖放；拖影与落点反馈；“移动到”菜单补上新建容器。之后是第 6 步 Files。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三。

## 前置

外壳二 [t66](../t66-workbench-shell-views/README.md)。

## 当前状态

- 2026-10-08 计划起草，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 交三个 omp 审查（对照 Spec 与旧应用、意图与多窗口不变量、可实现性与测试）；14 条意见按推荐并入计划（见计划“审查处理”），拖放的保存冲突政策记入[待确认清单](../../pending-confirmations.md)。下一步 S0。
