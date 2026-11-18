---
schema: nbook.task/v2
taskId: t14-input-buffer-states
status: planned
updated: 2026-11-18
---

# Agent 内核的输入缓冲区：每条带状态

## 目标与范围

按已接受的 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 改 nb-harness 内核与 NeuroBook，对所有会话生效：
- 缓冲区条目的就绪与留着、回到空闲时剩下的留着（与收口同批写 `inputHeld`）、决定收口与写下收口在同一步、暂停的运行与 `runResumed`；
- 放行跟着新话走（编辑重发除外）、用户本人空闲时排的等于发送、压缩期间用户发的话压完接着跑、`resume`、`release`、`send` 的 `replaces` 与 `release` 及交回的去向、失败码；
- 宿主发出者、指令按发出者的权限、`runStarted` 与 `inputEdited` 记发出者；
- NeuroBook：`agentKey` 按调用方盖章且不收自填身份、`startTask` 与任务中心停止的发出者、`jobs/steer.ts` 只认就绪的插话；
- 对话视图：排队区的“已暂停 · 原因 · 继续”、输入框的入口、停止的两个选项、乐观消息按 `commandId` 确认、恢复方式的用户设置。

提案第三轮审查的 11 条（[处理](../t01-direction/evidences/buffer-proposal-review-r3-disposition.md)）是必须落下的项。

合同：改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)；给 [ADR 0035](../../../../../docs/adr/0035-harness-log-driven-kernel.md) 补一条。

依赖：无。宿主 `start` 的“在自己持有的会话里”要用 t06 加的会话头 `owner`，那一处随 t06 补。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（2026-11-18 按已接受的 [bot 提案](../../../../../docs/proposals/neurobot.md) 与 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 重排）。

## 当前状态

2026-11-18 经 nbdev 新建，尚未开工。

## 下一步

开工时先按提案改 `planned` Spec 与 ADR，再写计划（内核与对话视图分开审）；计划审查用真实内核验证第三轮那 11 条。
