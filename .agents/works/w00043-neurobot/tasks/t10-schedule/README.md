---
schema: nbook.task/v2
taskId: t10-schedule
status: planned
updated: 2026-11-18
---

# 日程与周期任务（`nbook.schedule`）

## 目标与范围

[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 6 小节：
- `nbook.schedule` 插件：条目（cron 库选型、时区、最小间隔、用户确认）、三种排法（Agent 只能排自己所在的会话、日程视图、插件服务）、到点往目标会话的缓冲区发宿主消息（规则见 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md)）、输入快照与幂等键、目标忙时跳过、出错后放行自己排的、过时的自己取消、发送失败、目标的状态表、错过与补发、日程视图；
- 宿主消息的含义：来源盖章、给模型的来源行、审批模型的材料按发出者分四类（用户亲手打的字、用户写下或确认过的条目、派你的 Agent 写的、其余宿主的）、循环守卫只认用户的新话、宿主消息开的一轮的期限。

合同：新建 `docs/specs/bots/schedule.md`；改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（来源行）、[`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md)（审批材料）、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md) 输出 20、[`agent/run-guards.md`](../../../../../docs/specs/agent/run-guards.md) 输出 10。

依赖：t14、t06、t07；日程视图的设计在 t03。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（2026-11-18 按已接受的 [bot 提案](../../../../../docs/proposals/neurobot.md) 与 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 重排）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工；2026-11-18 改成往缓冲区注入宿主消息，单独的任务会话与工具清单不做。

## 下一步

等 t14、t06。
