# Agent Harness

Agent Harness 是 NeuroBook 的 Agent 运行内核。它负责创建 session、准备 profile context、调用模型、执行工具、写入 JSONL session、处理 linked agents、队列、SSE 和 runtime hooks。

普通作者不需要先理解 Harness。你只有在调试 Agent 行为、编写 profile、分析 session 事件或设计新 runtime 机制时才需要读这一页。

## 运行链路

一次普通 invocation 大致经过：

1. 创建或恢复 session。
2. 校验 profile initial。
3. 执行 profile `context()`，生成 `ProfileTurnPlan`。
4. 组合 system、history、model context、appending context 和当前用户输入。
5. 调用 provider。
6. 执行工具或 linked agent。
7. 写入 transcript、runtime state、session projection。
8. 通过 SSE 向前端发布状态。

## Runtime Hooks

Runtime hooks 把 profile prompt、session context、transcript persistence、report_result 和 compact 等行为拆成可组合机制。多阶段旁路工作不再由 runtime hook 内嵌执行，而是交给显式 Workflow 与后台 Job。

这让 profile 不需要把所有运行逻辑塞进提示词，也让 Harness 能在 prepareRun、prepareTurn、ingestTurn、prepareNextTurn、settleRun 等阶段做明确处理。

## Session 与 SSE

Agent session 使用 JSONL append-only 存储，前端通过 snapshot + SSE event 同步当前状态。重连、waiting、follow-up、steer、abort 等行为都由 Harness 维护一致的 runtime projection。

## 继续阅读

- [Runtime Hooks](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/runtime-hooks.md)：五个生命周期阶段的实现参考。
- [Agent SSE](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/sse.md)：前端同步事件合同。
- [Harness Black-Box Contract](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)：prompt / continue / steer / followup 的外部行为合同。
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/context.md)：一次 invocation 的上下文如何拼装。
