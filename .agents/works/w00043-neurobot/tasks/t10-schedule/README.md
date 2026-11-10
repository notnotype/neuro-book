---
schema: nbook.task/v2
taskId: t10-schedule
status: planned
updated: 2026-11-10
---

# 日程与周期任务插件

## 目标与范围

一次性与周期的条目及工具；提醒直接写进主对话、不开运行；周期任务每次在新会话里跑（工具清单、不能写核心记忆），结果与失败发进主对话；错过的合并补跑；时区；web 的日程页、“待你处理”与页面开着时的通知。

合同：新建 `docs/specs/bot/schedule.md`（还不存在）；通知与“待你处理”写进 `bot/web.md`。提醒与任务结果在对话视图里自成一轮，依赖 t07 改的 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。

依赖：t06、t07（提醒与任务结果要“由事件开启的轮次”）、t09（任务运行不能写核心记忆）。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等上面几项。
