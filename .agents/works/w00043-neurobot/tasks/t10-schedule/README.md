---
schema: nbook.task/v2
taskId: t10-schedule
status: planned
updated: 2026-11-10
---

# 日程与周期任务插件

## 目标与范围

一次性与周期的条目及工具；提醒到点先进原始记录与页面内提示，只在主对话空闲时写进会话（幂等键是条目 id 加计划时刻），运行收口时写出排着的扩展事件（nb-harness 内核改动）；周期任务每次在新会话里跑（工具集按清单裁剪、shell 缺省不放行、花费与轮数上限、不能写核心记忆），结果与失败发进主对话，中断按失败处理；只读的联网抓取工具；“待你处理”的待处理项（gateway 持久保存）；错过的合并补跑；时区；web 的日程页与“待你处理”。

合同：新建 `docs/specs/bot/schedule.md`（还不存在）；“待你处理”写进 `bot/web.md`；运行收口时写出排着的扩展事件，改 [`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)。提醒与任务结果在对话视图里自成一轮，依赖 t07 改的 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。

依赖：t06、t07（提醒与任务结果要“由事件开启的轮次”）、t09（任务运行不能写核心记忆）。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等上面几项。
