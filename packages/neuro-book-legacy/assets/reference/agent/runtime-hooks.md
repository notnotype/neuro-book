# Agent Runtime Hooks

Runtime hooks 是 profile 和 harness 之间的运行时扩展层。它让 profile 可以声明“本次 run 如何准备、每轮如何进入模型、turn 如何落盘、run 如何收尾”，同时不直接写 session、不直接发事件、不绕过 Run Kernel。

## Core Model

Agent runtime 分三层：

| Layer | Meaning |
| --- | --- |
| `SessionLog` | append-only 持久事实，包含消息、lifecycle、projection 和 custom state。 |
| `RunFrame` | 一次 invocation 的运行态，包含 live messages、pending writes、runtime state 和 queue drain 结果。 |
| `TurnSnapshot` | 单次 provider request 的冻结快照，provider 只能读取它。 |

所有持久化都通过 `SessionWritePlan` / `SessionWriteExecutor`。hook 只返回 plan 或 runtime patch，不能自己 append session 或 publish event。

## Hook Stages

当前稳定可讨论的 stage：

- `prepareRun`：run 开始时准备 profile prompt、runtime messages、工具策略和写入计划。
- `prepareTurn`：每个 provider request 前构造 turn snapshot。
- `ingestTurn`：一个 assistant / toolResult turn 完成后决定 transcript 是否持久化。
- `prepareNextTurn`：turn save point 后、下一轮前处理 steer、report_result reminder、compaction 等 continuation。
- `settleRun`：run 结束后处理 report_result、projection 或后续写入。

## Built-In Runtime

普通 profile 默认组合内置 runtime bundle：

- `builtin.profilePrompt`：启用 profile `systemPrompt` 注入 provider 和 snapshot。
- `builtin.sessionContext`：启用 `HistorySet` / `AppendingSet` / `ModelContext` appending 写入，以及 `modelContextMessages` 注入 provider；正式消息顺序固定为 `History → ModelContext → AppendingSet → CurrentUserInput`。
- `builtin.transcriptPersistence`：持久化普通 assistant / toolResult transcript。
- `builtin.compact`：允许自动 compaction。
- `builtin.reportResult`：允许缺失 `report_result` 的 reminder retry。

自定义 runtime 不组合某个 built-in 时，对应默认行为不会隐式发生。

## Runtime-Only Transcript

`ingestTurn` 可以返回 `transcript: "runtime_only"`。这会让 assistant / toolResult 留在当前 `RunFrame`，但不写入 session history。

适合：

- summarizer 的隐藏运行。
- 明确不应进入产品历史的 profile 内部处理。
- 不希望污染主对话的 profile 内部处理。

不适合 waiting turn，因为 approval / user input resume 需要 durable pending tool call。

`runtime_only` 只描述 transcript 的持久化策略。需要独立执行检索、反思或维护任务时，使用普通 agent invocation、Agent Workflow 或后台 Job。

## Profile Turn Context

Profile 可通过 `ProfileTurnPlan.turnContexts` 声明依赖运行时外部数据的本轮上下文。第一版实现是 `<FileChangeNotice />`：

1. Profile DSL 在 `AppendingSet` 中记录节点模式、Agent 小 diff 字符预算和 `appendingIndex`。
2. Harness prepare 阶段调用通用物化器，把运行时消息插回声明位置。物化器施加系统硬保护：最多 4 个 diff 详情、50 个逐项文件、`min(8192, diffMaxChars × 4)` inline 总额和 12,288 字符 notice 上限。
3. provider turn ingest 成功后执行 settlement；失败、abort 或 provider error 不结算。

文件变更查询、notice 正文和 history cursor 语义都属于 profile turn context 模块，不属于 Harness。Harness 不读取 profile setting 来猜默认模式，也不为未声明节点的 profile 注入 fallback。

文件数超过逐项上限时，准确遗漏数量摘要视为已向模型交付；settlement 仍推进全部 unseen groups 的最大 entry id，避免大批量变更永久重复。reference 分支不携带 diff 正文，删除文件不生成当前文件引用。

## Design Rules

- hook context 使用 facade，不暴露 raw repo。
- hook `runtimeState` 按 hook name namespace 隔离；同名 hook 的 object patch 浅合并。
- tool-side save point writes 排入当前 `RunFrame.pendingWritePlans`，在 turn save point 与 transcript 同 batch flush。
- provider context、runtime messages、session history 必须分开理解。
- 当前用户输入是 Harness durable prompt，不是 Profile `AppendingSet` 数据；Profile 不应复制 `ctx.invocation.message`。
- 新 hook 能力要先对照 [Agent Runtime 与 Profile 当前规范入口](../../../../../docs/specs/README.md) 和相邻 Harness 合同测试检查外部行为。

- 历史设计过程见 [`.agents/tasks/18-agent-runtime-pipeline-hooks/README.md`](../../../.agents/tasks/18-agent-runtime-pipeline-hooks/README.md)。
