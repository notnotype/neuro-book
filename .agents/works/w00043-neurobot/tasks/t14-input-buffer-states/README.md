---
schema: nbook.task/v2
taskId: t14-input-buffer-states
status: active
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

2026-11-18 经 nbdev 新建；同日开工。

开工前先用真实内核跑探针，列出全部路径（[清单](evidences/kernel-path-inventory.txt)、[探针 1](evidences/probe-p1-idle-paths.test.ts.txt)、[探针 2](evidences/probe-p2-entries.test.ts.txt)、[输出](evidences/probe-outputs.txt)）：会话从有运行变成空闲 14 条路径（写 `runEnded` 的 8 种、不写却空闲的 5 种、正常结束接着跑 1 种），读缓冲区内核 11 处、内核外 4 处，放话进缓冲区的指令 5 个、调用方 12 处，16 条指令里只有 3 条收发出者。

清单第 6 节与提案假设冲突的 6 条，写 Spec 时按下面的实现定义落（主 Agent 定，与提案的意思一致，开发者有异议再改）：

1. 空闲判断以写下 `runEnded` 的那个队列项为准：`control.idle` 与 `runEnded`、`inputHeld` 在同一个队列项里翻转，之后受理的话按空闲处理（提案说的窗口实际延到收口批的反应写完之后）。
2. 停止时，清空列表在停止受理的那个队列项里读，与收口同批写 `inputRemoved`，不在空闲之后另排一项。
3. 异步提问的回答在空闲又开不起运行时，回答照样结算、提问不卡；这句回答转成留着，原因是开不起来的码，不让 `resolve` 失败（NeuroBook 的 `agent_answer` 依赖它成功）。
4. “中断或失败的那一轮”指叶子上最后一次没有正常结束的运行（中断、出错或暂停）；`start`、用户的 `resume` 接着跑它，宿主只能接着跑 `runStarted.by` 是它自己的那次，或会话头 `owner` 归它的会话。
5. 任务中心停子代理（远程的 `killJob`）按用户停的记，`children.ts` 不再换成父会话的身份。
6. kit 的标题会话以宿主身份发话，它缓冲区里留着的由它自己取消，不提示用户；不带原因的 `closeSession` 按中断处理（留着，原因“关闭”）。

## 下一步

按提案与上面的清单、实现定义改 `planned` Spec 与 ADR，再写计划（内核与对话视图分开审）；计划审查用真实内核验证第三轮那 11 条与清单里的探针。
