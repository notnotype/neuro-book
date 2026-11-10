---
schema: nbook.task/v2
taskId: t07-agent-ui-for-bot
status: planned
updated: 2026-11-10
---

# nb-agent-ui 为 NeuroBot 做的调整

## 目标与范围

nb-agent-ui 加由事件开启的轮次（提醒、任务结果）、按天的分隔线、“你离开后”的未读分隔线；与 w00032 t14 对同一个包的改动错开。

合同：改 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)：由事件开启的轮次（来源角色，例如“日程”“任务”）、按天的分隔线、未读分隔线。

依赖：t03 定稿；改的是共享包 nb-agent-ui，开工前核对 [w00032 t14](../../../w00032-agent-integration/tasks/t14-multi-agent/README.md) 对它的改动，错开。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等 t03 定稿。
