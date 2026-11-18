---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-18
superseded-by: null
---

# ADR 0055：输入缓冲区的每条话带状态，状态由会话级事件决定，取与放行只在内核

- 日期：2026-11-18
- 决策者：开发者
- 关联工作：[w00043 t14](../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/README.md)
- 相关文档：[提案：输入缓冲区](../proposals/agent-input-buffer-states.md)、[`harness/runtime.md`](../specs/harness/runtime.md)、[`harness/session.md`](../specs/harness/session.md)
- 补充：[ADR 0035](0035-harness-log-driven-kernel.md) 决策 1 的“一个会话的全部状态都由日志归约”：缓冲区条目的状态同样写进日志；ADR 0035 的决定不变

## 背景

周期任务与 bot 要往会话的输入缓冲区发话（[NeuroBook 的 bot](../proposals/neurobot.md)）。原来缓冲区里的话没有状态，运行收口后归谁取由各处分别判断：只压缩的运行、交出结果、文字收口、收口前的一瞬间、停止进行中，都有话卡在空闲的会话里，或被下一次不管谁开的运行顺手带走。开发者 2026-11-18 选了“直接改内核的缓冲区逻辑”，提案经三稿三轮审查后接受。

## 决策

缓冲区里的话是就绪或留着。会话回到空闲时剩下的就绪的话转成留着，与收口写在同一个写入批；运行只取就绪的；留着的只有用户或排它的发出者能放行，放行跟着新话走。条目的状态只由 `inputQueued`、`inputHeld`、`inputReleased`、`inputRemoved`、`inputConsumed` 这几种会话级事件归约，内核外的代码与界面都读这份状态，不各自推断。行为见 [`harness/runtime.md`](../specs/harness/runtime.md) 输出 103–110。

理由：周期任务与 bot 要往会话里发话之后，“收口后缓冲区里的话归谁取”在三轮审查里每轮都找出新的漏洞（只压缩、交出结果、文字收口、收口前的一瞬间、停止进行中），按收口方式逐个补救收不了口；把规则放在“回到空闲”一处、状态写进日志，新的收口方式不会漏，重启后照样成立，也符合决策 1 的“状态都由日志归约”。

代价：日志多三种事件、几种事件多字段，内核按发出者校验指令；宿主要如实给发出者，权限才有意义（NeuroBook 按调用方门面盖章）。普通会话的行为跟着变：停止、出错、重启后排着的话不再被下一次运行顺手带走，要用户发话或点继续。

## 后果

- 内核加 `inputHeld`、`inputReleased`、`runResumed` 三种事件，`inputQueued`、`inputRemoved`、`runStarted` 等多字段；旧日志的条目都是就绪的，旧内核读到新事件得 `log-corrupt`（不支持降级）。
- 宿主应用要按调用方给发出者：NeuroBook 的 `agentKey` 改为按调用方门面盖章（[`agent/sessions.md`](../specs/agent/sessions.md)）。
- 让这条决定失效的条件：缓冲区要跨会话共享，或放行要由内核外的调度器决定。
