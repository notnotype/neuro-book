# Agent Runtime Pipeline Hooks

## User Request

- 为 Agent harness 设计一套更强的 runtime hook 架构。
- 让 `compactIfNeeded`、message 落盘、summarizer、后续 profile 运行策略都能通过 hook / plan 统一表达。
- 不要把能力收敛成简单的 `{ persist: false }` 开关。
- 参考 PI `AgentHarness` 的做法，但不要照搬；重新设计成适合 Neuro Book 的 harness。

## Goal

- 把 `NeuroAgentHarness` 重塑成一个小而稳定的 **Run Kernel**。
- 把普通持久化、summarizer runtime-only transcript、compact、queue、approval、turn-level ingest 等能力表达成 **内置 Hook**。
- 明确区分三层状态：
  - `SessionLog`：append-only 持久事实。
  - `RunFrame`：一次 invocation 的运行态。
  - `TurnSnapshot`：一次模型请求使用的冻结快照。
- 所有 hook 只返回 plan，不直接写 session、不直接 publish event、不直接改 repo。
- 第一批消费者是 `summarizer` 和 compaction；summarizer 必须通过普通 profile runtime hooks 表达，不作为 Run Kernel 硬编码特例。

## Target Outcome

18 完成后，项目应该得到这些能力：

- Harness 的外部行为先由黑盒合同约束：用户 invocation 输入经过 Harness 后，只能通过 session writes、SSE events、HTTP invocation response 和 frontend state 变化表现出来。详见 [HARNESS-BLACK-BOX-CONTRACT.md](HARNESS-BLACK-BOX-CONTRACT.md)。
- `NeuroAgentHarness` 的入口调度、run 执行、turn 执行、session 写入各有清晰边界，不再由 `invokeAgent()` 串联所有副作用。
- 所有 session 写入统一走 `SessionWritePlan` / `SessionWriteExecutor`；hook、profile、tool 都不能直接 append repo 或 publish event。
- 普通 profile 的行为与当前一致：HistorySet 初始化、AppendingSet 写入、assistant/toolResult transcript 持久化、compact、steer、follow-up、approval、report_result 都能继续工作。
- profile 作者可以在 `defineAgentProfile()` 里通过 `runtime: { hooks }` 声明运行方式，表达 custom context、custom ingest、custom settle 这类行为；可复用 runtime bundle 再用 `defineAgentRuntime()` 包装。
- summarizer 不作为 Run Kernel 特例；它只是一个普通 profile，通过 runtime hooks 组合完成 source Agent Dialogue Content 摘要。
- waiting/resume 有显式 lifecycle：`start -> waiting -> resumed -> end/error/aborted/interrupted`，同一 logical invocation 复用同一个 `invocationId`。
- source session 的 active-path-specific projection 能稳定表达 title/summary 等展示元数据，后台写入不移动 source active leaf，不污染 tree。
- SSE 恢复合同升级为 `(eventEpoch, seq)` cursor；后端 reload / EventHub 重建后，前端能通过 connected handshake 明确识别 epoch mismatch，拉 snapshot 并允许 event cursor 回退到新 epoch。
- waiting snapshot 能从 session active path hydrate：即使后端 reload 丢失内存 `activeInvocations`，pending approval / user input UI 也能恢复，并且 `continue(resolution)` 继续复用原 logical `invocationId`。

非目标：

- 不在第一版开放任意低层 provider/tool mutation hook。
- 不把所有 session command 塞进 Run Kernel；command/tree/list/snapshot/link 仍属于 Session Control Plane。
- 不把 summarizer 做成 sessionless 或内核分支；它必须用普通 profile 能力表达。

## Design Principles

- 当前 Agent runtime 仍处于开发版。新架构实施时允许硬切、硬删旧合同，不为旧 `profile.ingest()`、旧 summarizer profile key 或旧 harness 内部入口做兼容层。
- 不为了“降低安全风险”牺牲系统表达力。安全边界应通过清晰 capability、facade、tool policy 和 executor 合同表达，而不是削弱 hook / profile 能力。
- 首要服务对象是 runtime 开发者和 profile 作者。外部心智模型要少：profile 作者只理解 profile input、context/prepare、runtime hooks；runtime 开发者只理解 control plane、coordinator、kernel、turn transaction、write executor。
- 灵活度可以高，但隐式行为必须少。跨 session 写入、runtime-only transcript、report_result retry、tool-side writes、lifecycle waiting 都要有显式类型和固定顺序。
- 本文档描述的是目标架构，不承诺兼容当前实现中的临时 API 名称。实现时以本文档为新真相源。

## Current State

- 当前生产入口是自研 `NeuroAgentHarness`，没有直接使用 PI 的 `AgentHarness` class。
- 2026-05-29 第一批实现已落地一条垂直切片：
  - `SessionWritePlan` / `SessionWriteExecutor` 已创建并接入 lifecycle、prompt、turn commit、resolution、steer drain、部分 command、report_result reminder 和 compact lifecycle。
  - `ToolSessionWriteSink` 已创建并接入 harness active 路径的 linked-agent entry、tool custom state、profile prepare writes、variable patch audit、client variable ack、manual/auto compaction entry。
  - session 文件布局已硬切为 `.nbook/agent/sessions/<session-id>.jsonl`，`workspaceKey` 不再参与路径定位。
  - `defineAgentRuntime({ hooks })` 已存在并能在 `prepareRun`、`prepareTurn`、`ingestTurn`、`prepareNextTurn`、`settleRun` 执行自定义 hook；hook 可以返回 write plans、命名空间隔离的 runtimeState、以及有限的 requestOptions/toolKeys patch。
  - `prepareRun` / `prepareNextTurn` hook 已能返回 `runtimeMessages` 注入当前 `RunFrame` 的模型上下文；这些消息不写 session history，适合 summarizer 这类 profile 临时塞入 source Agent Dialogue Content。
  - runtime hook context 已暴露 typed `ctx.input`，并把 `ctx.session` 升级为只读 facade：保留当前 reduce 后的 session context，同时提供 `ctx.session.read(sessionId?)` 和 `ctx.session.agentDialogueContent()`。`runtime: { hooks }` 直接写在 `defineAgentProfile({ inputSchema, ... })` 内时，hook 的 `ctx.input` 可由外层 `inputSchema` 自动推导；单独调用 `defineAgentRuntime()` 定义可复用 bundle 时需要显式泛型。profile 作者不需要接触 raw repo，就能读取 source session active path 并构造 Agent Dialogue Content；写入仍必须返回 `SessionWritePlan`。
  - `ingestTurn` hook 已能返回 `transcript: "runtime_only"` 跳过默认 assistant/toolResult session transcript；本轮消息仍保留在 `RunFrame`，所以同一个 run 的 `report_result` 捕获和 `settleRun` projection 仍可工作。waiting turn 禁止 `runtime_only`，因为 resume 需要持久化 pending tool call。缺失 `report_result` 的 reminder 在 runtime-only transcript 下也只进入 `RunFrame`，不写 session history。
  - `ToolSessionWriteSink` 已支持 `savePointAppend` / `savePointCustomState`。tool-side savePoint writes 会排入当前 `RunFrame.pendingWritePlans`，在 `ingestTurn` 和 assistant/toolResult transcript 连续合并为同一个 session batch 后 flush；`immediate` 写入仍实时走 executor。
  - `RunFrame`、`TurnSnapshot`、`TurnOutcome` 已在 harness 内部落地第一版。`runLoop()` 现在围绕 frame/snapshot/outcome 运转，并把单轮模型请求、工具批次、ingest、continuation / next-turn 准备收敛到 `runTurnTransaction()`。
  - `runLoop()` 返回值已收紧为 `RunLoopResult = completed | waiting | failed` 判别联合；failed 分支携带结构化 `InvocationErrorInfo`，`finalizeInvokeResult()` 不再通过 `finalAssistant.stopReason` 反推运行结果。
  - `prepareNextTurn` 的确定性 reducer 已从 harness 抽到 `server/agent/harness/prepare-next-turn.ts`：负责把 steered messages 和 report_result reminder 应用到 `RunFrame`，并返回需要执行的 reminder `SessionWritePlan`；compact、repo 写入和 custom runtime hook 仍由 harness 在安全点执行。
  - failed `TurnOutcome` 的 partial ingest 草案、RunFrame 失败状态归并和 failed `RunLoopResult` 创建已继续收敛到 `server/agent/harness/turn-failure.ts` / `run-frame-state.ts`，provider partial error 的“只保留文本、剥离 tool calls”规则有独立测试点。
  - Turn Transaction 的 outcome 应用逻辑已抽到 `server/agent/harness/turn-transaction.ts`：successful/waiting/failed outcome 在 ingest 后如何写回 `RunFrame`、如何生成 waiting/failed run result 已有独立 helper 和测试。
  - Run Kernel stage error 的 phase 包装已抽到 `server/agent/harness/run-kernel-error.ts`。`ingestTurn`、下一轮前 compaction、prepare-turn/prepare-next-turn hook 等内部 stage 抛错时会保留 `ingest` / `compaction` / `model` 等结构化 phase，不再全部依赖外层粗粒度 `errorPhase` 推断。
  - hook `runtimeState` 已按 hook name namespace 隔离；同名 hook 跨 stage 返回对象时会浅合并，非对象按后一次返回替换。
  - `defineAgentRuntime()` 已支持展开内置 runtime bundle。普通 profile 未声明 runtime 时会得到 `agentRuntimeBuiltins.defaultSessionRuntime()` 展开的内置 hook：`builtin.profilePrompt`、`builtin.sessionContext`、`builtin.transcriptPersistence`、`builtin.reportResult`。其中 `builtin.profilePrompt` 已成为 profile prepare system prompt 进入 provider request 和 UI snapshot system prompt 的显式开关：自定义 runtime 不组合该 built-in 时，不会因为 `prepare()` 返回 `systemPrompt` 就偷偷注入 provider；`builtin.sessionContext` 已成为 profile prepare 的模型上下文开关：控制 `modelContextMessages` 是否注入 provider context，也控制 `historyInitMessages`、`modelContextAppendingMessages`、`appendingMessages` 是否写入 session history；`stateWrites` 暂不受它控制，仍作为 profile 私有状态写入。`builtin.transcriptPersistence` 已执行并显式返回 `transcript: "persist"`；`commitTurn()` 已硬切为没有 transcript hook 就不隐式持久化 assistant/toolResult transcript。`builtin.reportResult` 已成为 report_result reminder retry 的显式开关：自定义 runtime 不组合该 built-in 时，即使 allowedToolKeys 包含 `report_result`，也不会自动注入缺失 report_result 的 harness reminder。自动 compaction 不再由 runtime built-in 启用，统一由 profile 顶层 `compaction` 配置显式声明。
  - 自动 compaction 已从 invoke pre-loop 迁到 turn save point 后、`prepareNextTurn` 前执行。触发后会写 compaction entry，重新注入一次 `HistorySet` 初始化消息，并用最新 session context 重建 `RunFrame.messages`，确保下一轮 provider context 读到 compact 后的 summary + recent messages + HistorySet；该自动行为现在由 profile `compaction` policy 启用。没有 `compaction` 配置的 profile 不自动压缩，手动 `/compact` 报错，若 provider 前上下文超过模型窗口则返回明确错误。
  - `report_result` reminder retry 已迁入同一个 `RunFrame` 的下一轮 turn；缺少必需 report_result 时由 `resolveTurnContinuation()` 判断继续，再由 `prepareNextTurn()` 写入 harness reminder 并进入下一轮 `TurnSnapshot`，不再由 `finalizeInvokeResult()` 递归重跑旧 `runLoop()`。
  - `profile.ingest()` 旧 API 已从 active profile 类型和 harness 调用路径删除。
  - waiting/resume lifecycle、partial assistant metadata、follow-up queue 对象化已落地；follow-up queue 现在会写入 `agent.followUpQueue` projection custom state，刷新或重建 harness 后 snapshot 可恢复 paused/ready queue。
  - SSE reload recovery 合同已落地：`AgentSessionEventHub` 使用进程内 `eventEpoch` + per-session `seq`，前端通过 connected handshake 识别 epoch mismatch 并以 snapshot 作为恢复真相；后端 reload 后 waiting snapshot 可从 session active path hydrate `activeInvocation.status = "waiting"`。
  - invocation admission 已补 session 级短事务边界：`continue(resolution)` 的 waiting hydrate / active claim 串行执行，active 已经 running/aborting 时拒绝恢复，不创建 unrelated invocation。
  - `SessionWriteExecutor` 已补 per-session write queue：同 session 的 repo append 与 `session_entry` / `session_state_changed` publish 串行执行，`SessionWritePlan` public shape 不变。
  - 旧 hard-coded summarizer 自动运行路径已删除；17 summarizer 等 18 完整重构后重新计划。旧 DTO/状态读取和 dialogue-content helper 暂保留为后续 17 材料。
- 当前还没有完成完整 Kernel 重构：`RunFrame` / `TurnSnapshot` / `TurnOutcome` 已开始拆成独立 kernel 模块，默认内置 runtime 行为已迁入第一批可执行 built-in hooks；完整 failure path、server restart 后自动 drain follow-up queue 和所有 repo append fallback 的全量移除仍是后续 TODO。
- 当前 Run Kernel 类型边界已先抽到 `server/agent/harness/run-kernel-types.ts`：`RunFrame`、`TurnSnapshot`、`RuntimeTurn`、`TurnOutcome`、`RunLoopResult`、`RunTurnTransactionResult`、`TurnContinuationDecision`、hook execution input/result 和 runtime state 都有独立类型模块。turn continuation / shouldStop 的第一层纯判定已抽到 `server/agent/harness/turn-continuation.ts`；partial assistant sanitizer、failed ingest 草案、失败状态归并和 failed run result 创建已抽到 `server/agent/harness/turn-failure.ts`；Turn Transaction 的 outcome 应用已抽到 `server/agent/harness/turn-transaction.ts`；RunFrame 内存状态写回已抽到 `server/agent/harness/run-frame-state.ts`；prepare-next-turn 的 steered message / report_result reminder reducer 已抽到 `server/agent/harness/prepare-next-turn.ts`；stage error phase 包装已抽到 `server/agent/harness/run-kernel-error.ts`。`NeuroAgentHarness.runLoop()` 现在只负责 frame 生命周期和 loop 终态，单轮执行副作用收敛在 `runTurnTransaction()`；后续再继续迁移更完整的 Run Kernel 模块。
- 当前复用 PI 的部分是：
  - message / event / tool 类型。
  - `streamSimple()` provider streaming。
  - `validateToolArguments()` tool 参数校验。
- 当前自研的部分是：
  - session JSONL append-only repo。
  - profile prepare。
  - invocation lifecycle、queue、abort、event hub。
  - 旧 ReAct loop、tool batch、turn commit。
  - tool 执行上下文里的 session custom state 写入、client variable patch ack。
  - compaction、projection entry。
- 当前主要问题：
  - `invokeAgent()` 同时做入口、prepare、持久化、compaction、loop、ingest、summarizer 调度。
  - `prepare()` 既调用 profile，又直接写 session。
  - `commitTurn()` 的 transcript 持久化已由 `ingestTurn` hook result 显式控制；自定义 runtime 不组合 `builtin.transcriptPersistence` 时不会隐式落 assistant/toolResult。
  - provider context、runtime messages、session history 三者边界不够明确。
  - 现有 `profile.ingest()` 是 invocation 结束后处理，不能控制每个 ReAct turn；新架构硬删该旧 API，改为 runtime 内置 `ingestTurn`。

## PI Reference

PI 的 `AgentHarness` 值得借鉴的是边界，不是具体实现。

### 1. Harness Config vs Turn Snapshot

PI 把状态分成：

- 最新 harness config：模型、thinking、tools、resources、stream options、system prompt provider。
- turn snapshot：单次 LLM 请求使用的冻结状态。

运行中更新 config 不会修改正在进行的 provider request，只影响下一次 turn snapshot。

Neuro Book 应借鉴：

- `RunFrame` 保存本次 invocation 的 live runtime。
- 每个 turn 创建 `TurnSnapshot`。
- provider request 只能读取 `TurnSnapshot`，不能读半路变化的 session/config。
- `prepareNextTurn` 或 save point 后才能刷新下一轮 context/model/tool/thinking。

### 2. Save Point

PI 的 save point 出现在 assistant turn 和 tool-result messages 完成之后。

在 save point：

- 先按确定顺序持久化 agent-emitted messages。
- 再 flush pending session writes。
- 如果 loop 继续，重新创建下一轮 turn snapshot。

Neuro Book 应借鉴：

- turn settlement 是唯一允许把本轮 assistant/toolResult 转成 session write plan 的地方。
- pending writes 不能插队到 assistant/toolResult 中间。
- compact、summarizer、ingest 这类写入都走 `SessionWritePlan` executor。
- 术语以本文为准：`Turn Transaction` 表示一次模型请求及其工具批次，不再混用旧文档中的 ReAct Loop 计数。

### 3. Pending Writes

PI 允许 busy 时接受 session write，但先排到 pending writes，并在 save point / settlement / failure cleanup 确定顺序 flush。

Neuro Book 第一阶段不一定马上实现完整 pending writes，但设计上要预留：

- hook 不能直接写 repo。
- hook 返回 `SessionWritePlan`。
- executor 负责排序、落盘、publish、错误归因。

### 4. Low-level Loop Hooks

PI 低层 loop 有几个关键 extension points：

- `transformContext`
- `beforeToolCall`
- `afterToolCall`
- `prepareNextTurn`
- `shouldStopAfterTurn`

Neuro Book 应借鉴这些点，但放在自己的 session/profile 语义上。

### 5. Hook Reducer

PI 的 hooks 设计倾向：

- event 自带 result type。
- observational hook 和 mutation hook 分开。
- result-producing hooks 由 reducer 顺序合并。
- hook context 是 facade，不暴露 raw internals。

Neuro Book 应借鉴：

- hook slot 有明确 result reducer。
- 例如 context transform 是顺序变换，tool call 是 early block，tool result 是 patch accumulation，turn settlement 是 write plan 合并。
- 不允许 hook 自己 append session。

## Redesign Decision

采用 **Neuro Run Kernel + Turn Transaction + Built-in Hooks**。

不再把文档设计成 20 个一等 pipeline stage。核心 pipeline 只保留少量事务边界；功能通过内置 hook 表达。细节可以拆成内部函数和测试点，但不都成为外部 hook slot。

### Black-Box First

Harness 先按黑盒合同设计，再反推内部 pipeline。

黑盒输入第一版只看 `AgentInvokeRequestDtoSchema` 的四种 mode：

```text
prompt | continue | steer | followup
```

黑盒输出只允许从四个通道观察：

```text
session writes
SSE events
HTTP invocation response
frontend state changes
```

粗粒度 runtime state 只有：

```text
Idle | Running | WaitingUser | Aborting
```

`error` 不是 runtime state。Accepted run 失败后，runtime 回到 `Idle`，session 保存 lifecycle `error`，前端按 active path 投影 `ErrorBubble` 或 partial assistant error badge。

这个黑盒合同推出几条硬边界：

- admission / enqueue / reject 发生在 Run Kernel 之前，因此需要 Invocation Coordinator。
- `steer` / `followup` 入队时是 runtime state，不是 session history，只有 drain 并变成 model-visible input 时才写 session。
- `steer` 属于当前 active invocation，必须在 turn-safe point drain；terminal error/aborted/interrupted 后 pending steer 必须清空或标记 failed。
- `followup` 是下一次用户轮次，只能在 completed run 后自动消费；waiting 不消费，error/aborted/interrupted 后 queue 进入 paused 状态。
- provider stream partial content 可以保存为 partial assistant，但必须剥离未闭合 tool calls。
- retry 不复活 terminal error invocation；waiting/resume 才复用同一个 logical `invocationId`。

因此，内部 pipeline 不是先验目标，而是为了满足这个外部合同：

- Coordinator 解释“请求是否开始 run，还是只改变 runtime queue”。
- Run Kernel 解释“accepted invocation 如何有统一 lifecycle 和 cleanup”。
- Turn Transaction 解释“steer drain、tool batch、partial assistant、transcript commit 这些行为为什么必须有 turn-safe boundary”。
- SessionWriteExecutor 解释“session writes 和 SSE publish 为什么必须统一归因、排序和恢复”。

在 Run Kernel 外侧保留一个很薄的 **Invocation Coordinator**。它不是 pipeline stage，而是入口调度器，负责那些“可能根本不会开始一次 run”的请求：

- active invocation lock。
- `prompt` / `continue` / `steer` / `followup` 的入口分流。
- running 时把 `steer` / `followup` 入队并立即返回。
- inactive 时拒绝 `steer` / `followup`。
- abort controller 和 active invocation runtime state。
- run 正常完成后按黑盒合同启动下一条 follow-up；waiting/error/aborted/interrupted 不自动消费 follow-up。

这样 Run Kernel 只处理已经被接受、确实要执行的 invocation。否则 `enterRun` 会同时承担 admission、queue、abort、lifecycle、frame 创建，边界会再次变胖。

```text
Invocation Coordinator
  -> admit or enqueue request
  -> start Run Kernel for accepted runs
  -> release active lock / dispatch queued follow-up only after completed runs

Run Kernel
  -> enterRun
  -> prepareRun
  -> runTurns
  -> settleRun
  -> cleanup

Turn Transaction
  -> prepareTurn
  -> executeTurn
  -> ingestTurn
  -> savePoint
```

其中：

- `enterRun` 只打开已经被 coordinator 接受的 run：写 lifecycle start、创建 abort-aware `RunFrame`、读取初始 session snapshot。
- `prepareRun` 合并 session hydrate、profile prepare、pre-turn write plan 编译。
- `prepareTurn` 合并 queue drain、context build、context transform、turn snapshot 创建。
- `executeTurn` 合并 provider call 和 tool batch；provider/tool 细粒度 hook 后续作为它的子扩展点。
- `ingestTurn` 是每个 ReAct turn 后的核心控制点：决定本轮 assistant/toolResult 进入 runtime、session、projection，还是只用于下一轮 context。
- `settleRun` 只处理整个 run 的最终结果、session update/projection、后台任务触发和 lifecycle close。
- `cleanup` 释放 runtime state，让 coordinator 可以根据 terminal result 决定是否启动 queued follow-up；只有 completed run 可以自动 drain follow-up。
- `SessionWriteExecutor` 不是独立 stage，而是各个安全点调用的服务：`prepareRun` 写 pre-turn plans，`ingestTurn` 写 turn plans，`settleRun` 写最终 plans，`cleanup` flush 剩余 pending plans。

这样牺牲一部分首发细粒度 hook，但显著降低实现复杂度。后续如果某个内部点真的需要开放，再从对应事务边界里拆出来。

### Harness Black-Box State Machine

黑盒 Harness 的实现入口可以先设计成一个状态机，而不是一开始就进入 hook runner。

输入：

```ts
type HarnessInput =
    | {mode: "prompt"; message: string}
    | {mode: "continue"; resolution?: UserResolution}
    | {mode: "steer"; message: string}
    | {mode: "followup"; message: string};
```

粗粒度运行态：

```ts
type HarnessRuntimeState = {
    active: HarnessActiveState;
    steerQueue: QueuedMessage[];
    followUpQueue: FollowUpQueueState;
};

type HarnessActiveState =
    | {kind: "idle"}
    | {kind: "running"; invocationId: string}
    | {kind: "waitingUser"; invocationId: string; pending: PendingUserResolution}
    | {kind: "aborting"; invocationId: string};

type FollowUpQueueState = {
    items: QueuedMessage[];
    status: "ready" | "paused";
    pausedBy?: {
        invocationId: string;
        reason: "error" | "aborted" | "interrupted";
    };
};
```

`active.kind = "idle"` 只表示没有 active invocation，不表示没有 runtime queue。Error / aborted / interrupted 后，follow-up queue 可以在 idle 状态下以 `paused` 保留，等待用户显式处理。

公共 snapshot DTO 也必须使用对象形态表达 follow-up queue，而不是裸数组：

```ts
type AgentRuntimeState = {
    activeInvocation: AgentActiveInvocationDto | null;
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: FollowUpQueueStateDto;
};

type FollowUpQueueStateDto = {
    status: "ready" | "paused";
    pausedBy?: {
        invocationId: string;
        reason: "error" | "aborted" | "interrupted";
    };
    items: AgentQueuedMessageDto[];
};
```

这样 error 后刷新页面仍能恢复 paused queue；用户发送新 prompt 不会隐式解冻旧 follow-up queue。

Coordinator admission 结果：

```ts
type AdmissionResult =
    | {kind: "started"; invocationId: string; runRequest: RunRequest}
    | {kind: "queued"; queue: "steer" | "followup"; item: QueuedMessage}
    | {kind: "rejected"; reason: AdmissionRejectionReason};
```

黑盒规则：

- `Idle + prompt`：`started`，写 user message 和 lifecycle start，然后进入 Run Kernel。
- `Idle + continue`：如果 dialogue tail 可继续则 `started`，否则 `rejected`。
- `Idle + steer/followup`：`rejected`。
- `Running + steer`：`queued(steer)`，只更新 runtime queue 和 SSE/snapshot，不写 session history。
- `Running + followup`：`queued(followup)`，只更新 runtime queue 和 SSE/snapshot，不写 session history。
- `Running + prompt`：第一版兼容为 `queued(followup)`；新前端应显式发送 `followup`。
- `Running + continue`：`rejected`。
- `WaitingUser + continue(resolution)`：`started`，复用同一个 logical `invocationId`，先写 resolution toolResult 和 lifecycle resumed。
- `WaitingUser + steer/followup/prompt`：入对应 queue；prompt 按 follow-up queue 处理。
- `Aborting + any`：`rejected` 或 busy。

Run Kernel terminal result：

```ts
type RunTerminalResult =
    | {kind: "completed"}
    | {kind: "waiting"; pending: PendingUserResolution}
    | {kind: "error"; errorInfo: InvocationErrorInfo}
    | {kind: "aborted"}
    | {kind: "interrupted"};
```

Coordinator 在 `cleanup` 后按 terminal result 更新 runtime state：

- `completed`：runtime 回到 idle；如果 follow-up queue 未暂停且非空，消费一条并启动新的 invocation。
- `waiting`：runtime 进入 `waitingUser`；不触发 summarizer，不消费 follow-up。
- `error`：runtime 回到 idle；清空或标记 failed steer queue；follow-up queue 进入 paused；前端根据 lifecycle error 投影 ErrorBubble。
- `aborted` / `interrupted`：runtime 回到 idle；清空或标记 failed steer queue；follow-up queue 清空或进入 paused，取决于 abort request 策略。

Session/SSE 输出规则：

- `started` 必须产生 lifecycle start；prompt start 还必须写 user message。
- `queued` 不写 session history，只发布 queue event 和 state changed。
- `rejected` 不写 session；通常只通过 HTTP response 表达，必要时发 rejection event。
- terminal result 必须产生 lifecycle terminal write，除非 repo 已不可写。
- provider partial stream error 可以写 partial assistant content，但必须剥离未闭合 tool calls。
- SSE stream 是 live state；`session_entry` 和 snapshot 是 durable/recovery truth。

这个状态机就是 Run Kernel 外部的 harness 黑盒。Run Kernel 只接收 `started` 的 run request；queued/rejected 根本不进入 kernel。

### Black-Box Contract Fit

根据 `HARNESS-BLACK-BOX-CONTRACT.md` 反推后，18 的当前架构可以作为这个 Harness 黑盒的实现骨架，不需要推翻重来。

原因：

- 操作矩阵中的 `queued` / `rejected` 场景不应该进入 Run Kernel，因此 Invocation Coordinator 必须保留在 Kernel 外侧。
- 操作矩阵中的 accepted invocation 都需要统一 lifecycle、abort-aware cleanup 和 terminal result，因此 Run Kernel 必须保留。
- `steer` drain、assistant/toolResult commit、partial assistant 保存、tool-call/result 闭合都要求 turn-safe boundary，因此 Turn Transaction 必须保留。
- 错误矩阵中的 session writes、partial assistant、lifecycle error、SSE publish 和 snapshot recovery 都要求统一写入入口，因此 SessionWriteExecutor 必须保留为服务。

不需要新增一组公开 pipeline stage。需要的是把现有 stage 的合同收紧：

- `executeTurn` 必须返回能表达成功、waiting 和 failed partial output 的 `TurnOutcome`。
- `ingestTurn` 必须 error-aware，可以保存 partial assistant content、剥离 tool calls、或按 profile runtime policy 做 runtime-only transcript。
- Run Kernel 必须有统一 failure path：捕获 stage error / failed `TurnOutcome`，规范化 `InvocationErrorInfo`，先通过 error-aware `ingestTurn` 处理 partial assistant，再尽力写 lifecycle `error`，最后进入 cleanup。
- Coordinator 必须根据 terminal result 处理 queue：completed 后可 drain follow-up；waiting 不 drain；error/aborted/interrupted 清理 steer 并暂停 follow-up。

概念形状：

```ts
type TurnOutcome =
    | {kind: "completed"; turn: RuntimeTurn}
    | {kind: "waiting"; turn: RuntimeTurn; pending: PendingUserResolution}
    | {
        kind: "failed";
        phase: "provider" | "tool" | "approval" | "unknown";
        partialAssistant?: AssistantMessage;
        errorInfo: InvocationErrorInfo;
    };
```

`partialAssistant` 必须是 sanitized 后的消息：

- 只保留已收到的 text/content。
- 去掉未闭合或完整性无法确认的 tool calls。
- 标记 `partial/interrupted/error`。

### Operation Matrix To Pipeline

| Black-box case | Pipeline behavior |
| --- | --- |
| `Idle + prompt(message)` | Coordinator accept；创建 run request；`enterRun` 写 lifecycle `start`；`prepareRun` 写 user message / profile prepare / pre-turn plans；`runTurns` 执行 turn；completed/waiting 由 `settleRun` 写 `end/waiting`；error 由 Kernel failure path 写 lifecycle `error`；`cleanup` 释放 active。 |
| `Idle + continue` | Coordinator 检查 dialogue tail 可继续；accept 后进入 Kernel；`prepareRun` 不写新 user message；`runTurns` 从现有 model-visible dialogue tail 继续。 |
| `Idle + steer(message)` | Coordinator reject；不进入 Kernel；不写 session；HTTP 返回 admission error。 |
| `Idle + followup(message)` | Coordinator reject；不进入 Kernel；不写 session；HTTP 返回 admission error。 |
| `Running + prompt(message)` | Coordinator 第一版兼容为 follow-up queue；不进入当前 Kernel；不写 session history；发 queue event/state changed。 |
| `Running + continue` | Coordinator reject；不进入 Kernel；不写 session。 |
| `Running + steer(message)` | Coordinator 入 steer queue；不写 session history；发 `steer_queued` / state changed；当前 active Kernel 在后续 `prepareTurn` drain steer，写 harness-origin user message。 |
| `Running + followup(message)` | Coordinator 入 follow-up queue；不写 session history；当前 run completed 后，`cleanup` 让 Coordinator 启动下一条 queued invocation。 |
| `WaitingUser + continue(resolution)` | Coordinator accept，同一个 logical `invocationId`；`prepareRun` 第一件事写 resolution toolResult 和 lifecycle `resumed`，刷新 snapshot 后再 profile prepare；`runTurns` 继续。 |
| `WaitingUser + prompt(message)` | Coordinator 当 follow-up 入队；不写 session history；waiting UI 保持；当前 invocation completed 后才可消费。 |
| `WaitingUser + steer(message)` | Coordinator 入 steer queue；waiting UI 保持；resolution 后下一次 `prepareTurn` drain 并写 harness-origin user message。 |
| `WaitingUser + followup(message)` | Coordinator 入 follow-up queue；不写 session history；当前 invocation completed 后才可消费。 |
| `Aborting + any invocation mode` | Coordinator reject/busy；不进入 Kernel；abort cleanup 负责写 `aborted/interrupted` lifecycle 和 state changed。 |

### Error Matrix To Pipeline

| Error case | Pipeline behavior |
| --- | --- |
| Admission validation error | API/Coordinator reject；不创建 invocation；不写 session；通常只返回 HTTP 4xx。 |
| State admission error | Coordinator reject；不进入 Kernel；不写 session；HTTP 409/400。 |
| Queue admission error | Coordinator reject queued request；不发 queued event；不写 session；队列保持不变。 |
| `prepareRun` runtime error | Kernel failure path 捕获；保留已 durable 写入的 user message；写 lifecycle `error`；`cleanup` 释放 active；HTTP `status: "error"`。 |
| Provider request error before stream | `executeTurn` 返回 failed outcome，无 `partialAssistant`；`ingestTurn` 不写 assistant；failure path 写 lifecycle `error`。 |
| Provider stream error after partial content | `executeTurn` 返回 failed outcome，携带 sanitized `partialAssistant`；`ingestTurn` 写 partial assistant；failure path 写 lifecycle `error`。 |
| Provider stream error after incomplete tool call | `executeTurn` 返回 failed outcome；sanitizer 剥离 tool calls，只保留 text/content；`ingestTurn` 可写 partial assistant；failure path 写 lifecycle `error`。 |
| Recoverable tool execution error | `executeTurn` 生成正常 toolResult，toolResult 表达失败；`ingestTurn` 正常提交 assistant/toolResult；run 可继续。 |
| Fatal tool execution error before turn commit | `executeTurn` 返回 failed outcome；如果本轮 tool call 尚未 durable commit，则不写该 tool call；failure path 写 lifecycle `error`。 |
| Fatal tool execution error after tool call durable commit | 必须生成 harness error toolResult 闭合已提交 tool call；`SessionWriteExecutor` 写 error toolResult；failure path 写 lifecycle `error`。 |
| Approval / waiting setup error | `executeTurn` / approval hook 返回 failed outcome；不进入 waiting；不能合法闭合的 pending tool call 不提交；failure path 写 lifecycle `error`。 |
| Session write error | `SessionWriteExecutor` 报错；Kernel 尽力写 lifecycle `error`；repo 完全不可写时返回 unrecoverable/500；可发 `snapshot_required`。 |
| SSE publish error | `SessionWriteExecutor` 不回滚 session；断开失败 subscriber；当前 invocation 不因单个 subscriber 失败而失败。 |
| `settleRun` error | Kernel failure path 捕获；已提交 turns 保留；写 lifecycle `error`，`errorInfo.phase = "settleRun"`；HTTP `status: "error"`。 |
| Background summarizer error | 不改变 source invocation terminal result；summarizer 自己写 dirty/error state 或静默失败；source UI 通过 state changed/snapshot 恢复。 |

### Complexity Reduction Tradeoffs

为了降低首发复杂度，做这些取舍：

- 不把 route、operation gate、lifecycle start、frame 创建拆成多个公开 stage；统一放进 `enterRun`。
- active invocation gate、`steer` / `followup` 入队、abort 这类入口调度放在 Invocation Coordinator，不进入 hook runtime。
- 不把 session hydrate、profile prepare、pre-turn writes 拆成多个公开 stage；统一放进 `prepareRun`。
- 不把 queue drain、context build、context transform、model/tool snapshot 拆成多个公开 stage；统一放进 `prepareTurn`。
- 不把 provider call 和 tool batch 拆成首发公开 hook；统一放进 `executeTurn`，等 provider payload 或 tool gate 真需要扩展时再拆。
- 不把 turn persistence 称为 `settleTurn`；统一叫 `ingestTurn`，强调它是“吸收本轮 turn 输出”的策略点。
- 不把 `flushWrites` 做成独立 pipeline stage；写入执行器是服务，在安全点被调用。
- 不在第一阶段实现完整 semi-durable pending writes；先由 `SessionWriteExecutor` 保证当前进程内顺序，恢复能力后续再补。
- 第一阶段开放 `defineAgentRuntime({ hooks })`，但 hook 必须绑定到固定事务边界，避免让 profile 作者面对完整 kernel 内部状态。

代价：

- 首发无法在 provider/tool 的每个细点上自定义行为。
- 某些内置 hook 的事件对象会稍大，因为多个内部步骤合并在一个事务边界中。
- 如果后续确实需要 provider payload inspection、tool argument mutation、tool result patch，需要从 `executeTurn` 里拆子 hook。

收益：

- kernel 心智更小，只有 run 和 turn 两层。
- summarizer、compact、普通 persistence 都能用同一套 turn ingest / runtime hook 语义表达。
- 实现顺序更直接：先统一写入和 turn ingest，再逐步开放更细 hook。

## Current Harness Capability Audit

当前 `NeuroAgentHarness` 里有几类能力会影响新 pipeline 设计。

### Invocation Admission

现状：

- `invokeAgent()` 直接检查 `activeInvocations`。
- session 正在运行时，`steer` 会进入 `steerQueues`，`prompt` / `followup` 会进入 `followUpQueues`。
- 没有 active invocation 时，`steer` / `followup` 直接拒绝。
- 真正开始 run 后才写 `invocation_lifecycle:start`，设置 `activeInvocations`、`steerableSessions`、`abortControllers`。

新架构落位：

- 这部分放在 **Invocation Coordinator**，不放在 hook slot。
- Coordinator 可以返回三种结果：`started`、`queued`、`rejected`。
- 只有 `started` 才进入 Run Kernel。

理由：

- `steer` / running `followup` 入队不是一次完整 run。
- 如果把它塞进 `enterRun`，`enterRun` 会不得不支持“创建了 invocationId 但没有 RunFrame”的半状态。

### Approval / User Input Waiting

现状：

- `runToolBatch()` 遇到 approval tool 时把它当 batch barrier。
- approval tool 之前的 tool result 保留。
- approval tool 之后的 tool call 生成 skipped tool result，避免 turn 中出现悬空普通 tool call。
- `commitTurn()` 允许唯一一个未闭合 approval tool call，其他未闭合 tool call 拒绝落盘。
- `finalizeInvokeResult()` 把 active invocation 标成 `waiting`，不执行后续完成态处理。
- `continue + resolution` 会先 `appendResolution()` 写 approval tool result，再调用 `prepare()`，保证 tool call / tool result 邻接性不被 appending message 打断。

新架构落位：

- `executeTurn`：approval tool 是 tool batch 的内置 barrier rule。
- `ingestTurn`：落 assistant、已完成 tool result、skipped tool result；允许单个 pending approval。
- `settleRun`：如果 `RuntimeTurn.waiting` 存在，run 结果是 `waiting`，active invocation 保持 waiting，不触发 summarizer / follow-up drain。
- `prepareRun`：处理 `continue + resolution` 的第一件事必须是写 resolution tool result，然后刷新 snapshot，再执行 profile prepare 和 pre-turn writes。

关键约束：

- resolution write 必须早于 `profile.prepare()` 产生的 `appendingMessages`。
- waiting run 不能触发 summarizer，也不能 drain follow-up。
- snapshot 的 `pendingApproval` 仍然由 session active path 推导，不应从 runtime map 人工拼出来。
- resume 不创建新的用户可见 invocation；它只是同一 active invocation 从 `waiting` 转回 `running`。

### Recovery / Resume

这里有两种“恢复”，需要分开。

第一种是 approval resume：

- 用户提交 resolution 后，`continue` 从同一个 session 继续跑。
- 这是 Run Kernel 的正常输入，属于 `prepareRun` 的 resolution restore。

第二种是 UI / SSE recovery：

- `AgentSessionEventHub` 维护 bounded replay 和 per-session seq。
- replay buffer 不够时只给落后的 subscriber 发送 `snapshot_required`。
- 前端收到 `snapshot_required` 后以 `getSessionSnapshot()` 的结果作为真相；`session_state_changed` 只携带 lightweight live state，不携带完整 snapshot。
- 新合同中，EventHub 还维护 `eventEpoch`。前端保存的 cursor 是 `(eventEpoch, lastSeq)`，其中 `lastSeq` 是当前 session stream cursor，不是全局 stream cursor。
- `connected` 是 stream handshake，不是普通增量事件。它必须告诉前端当前 `eventEpoch` 和 `latestSeq`。

新架构落位：

- approval resume 在 `prepareRun`，并复用同一个 logical `invocationId` 写入 `resumed` lifecycle。
- UI recovery 不进入 Run Kernel stage；它属于 SessionLog + EventHub + Snapshot projection。
- `SessionWriteExecutor` 每次落盘后负责 publish entry/state，保证 snapshot 永远可以恢复 UI。

关键约束：

- event stream 是增量优化，snapshot 是恢复真相。
- `seq` 只在同一个 `eventEpoch` + session 内有意义。后端 reload / EventHub 重建后，前端必须通过 epoch mismatch 触发 snapshot，而不是继续用旧 `lastSeq` 过滤新事件。
- 同 epoch 下的 `after > latestSeq` 也必须触发 snapshot recovery；这是客户端 cursor 来自当前 EventHub 无法证明的未来。
- snapshot apply 需要能在 epoch 改变时重置 event cursor，不能再用 `Math.max(oldLastSeq, snapshot.lastSeq)` 保守保留旧 seq。
- pipeline hook 不能直接 publish event；只能返回 write plan，由 executor 统一 publish。

### Event Epoch / Snapshot Recovery

这次 dev reload bug 的根因是：事件流缺少身份。

当前实现里：

```text
旧前端 lastSeq = 426
后端 dev reload -> 新 EventHub seq = 0
前端 reconnect /events?after=426
server connected(seq=426)
后续新事件 seq=1,2,3
前端因为 seq <= 426 全部丢弃
UI 继续停在旧 running / waiting
```

系统性修法是把 SSE cursor 从一个数字升级成对象：

```ts
type AgentEventCursor = {
    eventEpoch: string;
    seq: number;
};
```

DTO 调整：

- `AgentSessionEventDto` 增加 `eventEpoch: string`。
- `AgentSessionSnapshotDto` 增加 `eventEpoch: string`，继续保留 `lastSeq`。
- `AgentSessionEventsQueryDto` 增加 `eventEpoch?: string`，`after?: number` 继续表示该 epoch 下的 seq。
- `connected` control event 增加 `eventEpoch` / `latestSeq`，或至少保证 envelope 上有当前 `eventEpoch`，并把 connected envelope 的 `seq` 设为当前 `latestSeq`。

后端规则：

- `AgentSessionEventHub` 构造时生成一个进程内 `eventEpoch`。
- `publish()` 给每个事件写入当前 `eventEpoch` 和递增 `seq`。
- `subscribe(sessionId, cursor)`：
  - cursor epoch 缺失或不同：不 replay 旧事件；先发送 connected handshake，前端随后 snapshot。
  - cursor epoch 相同且 `after` 太旧：发送 `snapshot_required(reason="event replay buffer expired")`。
  - cursor epoch 相同且 `after > lastSeq`：发送 `snapshot_required(reason="event cursor is ahead of server")`。
  - cursor epoch 相同且 replay 可覆盖：发送 `seq > after` 的 buffered events。
- `/events` 路由不再手写一个 `seq = query.after ?? 0` 的 connected event；它应从 EventHub 读取当前 cursor 生成 handshake。

前端规则：

- `useAgentSession` 保存 `eventEpoch: Ref<string | null>` 和 `lastSeq`。
- `connected` 必须在普通 `seq <= lastSeq` 过滤之前处理。
- 如果 connected / event 的 `eventEpoch` 和本地不同：
  - 标记 `needsSnapshot("event_epoch_changed")`。
  - snapshot 成功后把本地 cursor 设置为 snapshot 的 `(eventEpoch, lastSeq)`。
  - 允许 `lastSeq` 从旧 epoch 的大数字回退到新 epoch 的小数字。
- 如果 event 同 epoch 且 `seq > lastSeq + 1`，继续走 `seq_gap` snapshot。
- 如果 snapshot 与当前本地 epoch 相同，`lastSeq` 可以继续取 `Math.max(old, snapshot.lastSeq)`；如果 epoch 不同，必须以 snapshot 为准。

这不是前端 hack，而是 SessionLog + EventHub + Snapshot projection 的恢复合同。Run Kernel 不需要知道 SSE epoch。

### Waiting Hydration After Backend Reload

后端 reload 后，内存运行态会消失：

- `activeInvocations`
- AbortController
- EventHub replay buffer
- 正在执行的 provider / tool promise
- 未持久化的 steer queue

但 session active path 仍然能说明某些 waiting 状态：

- assistant message 中有未闭合的 approval / request_user_input tool call。
- lifecycle 中有同一 invocation 的 `waiting` 状态。
- 尚未出现对应 resolution toolResult / `resumed` / terminal lifecycle。

因此 `getSessionSnapshot()` 应做一层 hydrate：

```text
pendingApproval = findPendingApprovalCall(activePathMessages)
memoryActive = activeInvocations.get(sessionId)

if memoryActive exists:
  activeInvocation = memoryActive
else if pendingApproval exists and waiting lifecycle can be found:
  activeInvocation = {
    invocationId: lifecycle.invocationId,
    sessionId,
    status: "waiting",
    mode: original lifecycle mode ?? "continue",
    startedAt: lifecycle.createdAt
  }
else:
  activeInvocation = null
```

约束：

- hydrate 只恢复用户可见的 waiting shell，不恢复已丢失的 running provider/tool 执行。
- resume admission 也不能只看内存 `activeInvocations`。如果内存没有 waiting active，但 session active path 能 hydrate waiting，就应接受 `continue(resolution)`，写入同一 `invocationId` 的 `resumed` lifecycle。
- 如果找不到 reliable `invocationId`，应该返回结构化 admission error，提示刷新/重试，而不是创建新 invocation 随便续跑。
- abort after reload 第一版可以只关闭 pending approval：写 harness error toolResult + `aborted` lifecycle；不能假装能 abort 已不存在的 provider request。
- ready follow-up queue reload 后是否自动 drain 仍保持不做。它和 waiting hydration 是不同问题：waiting 是用户正在回答一个已持久化 suspend point，follow-up 自动 drain 是后台调度策略。

### Invocation Identity For Waiting / Resume

推荐合同：approval / user-input waiting 和后续 resume 使用同一个用户可见的 logical `invocationId`。

原因：

- 对用户和前端来说，waiting 不是一次 run 结束，而是同一次 run 暂停在“等待外部输入”的状态。
- 同一个 `invocationId` 可以表达清楚的生命周期：`start -> waiting -> resumed -> end/error/aborted`。
- pending approval、active invocation、abort、queued steer 都可以继续挂在同一个逻辑运行上，不需要把“恢复”伪装成新 run。
- follow-up 才是新的用户轮次，所以 follow-up 应该拿新的 `invocationId`。

技术上仍可增加内部 `attemptId` / `resumeId`：

- `invocationId`：用户可见的逻辑运行身份，跨 waiting/resume 不变。
- `attemptId`：一次实际执行片段，例如初始 provider request、approval resolution 后的 resume provider request、失败重试。它服务日志、trace、metrics，不作为 session active invocation 身份。

因此 resume 的 lifecycle write 应该是：

```text
invocation_lifecycle { invocationId, status: "waiting" }
invocation_lifecycle { invocationId, status: "resumed", attemptId? }
invocation_lifecycle { invocationId, status: "end" }
```

不要把 approval resume 建模为“新 invocation link 到旧 invocation”。那样日志上看似简单，但 UI 会把一次暂停恢复切成两段，abort/follow-up/steer/pending approval 也会变成跨 invocation 协议，心智负担更高。

### Steer

现状：

- 只有 active 且 steerable 的 session 接受 `steer`。
- `steer` 入 `steerQueues` 后立即返回 queued。
- `runLoop()` 在每个模型请求前 drain steer，写成 `origin: "harness"` 的 user message。
- steer 文本被包装为 `<user_steer>...</user_steer>`，前端 projection 再识别为“引导”。
- 当前实现也会在 tool batch 后再 drain 一次 steer，用来决定是否继续下一轮。

新架构落位：

- 入队：Invocation Coordinator。
- 消费：`prepareTurn` 的 Queue Hook。
- 持久化：Queue Hook 返回 write plan，写入 `origin: "harness"` user message。
- 是否继续：`shouldStop` 或 `prepareNextTurn` 检查 queue 是否还有 steer；有则继续下一轮，由下一轮 `prepareTurn` drain。

建议调整：

- 不需要保留“tool batch 后立刻 drain steer”作为独立 stage。
- 更简单的语义是：每轮只在 `prepareTurn` drain；turn 结束时只检查 queue 是否非空来决定是否开下一轮。

### Follow-Up

现状：

- running 时新的 `prompt` / `followup` 被放入 `followUpQueues`。
- 当前 run 非 waiting 结束后，`finishInvocation()` 释放 active lock，然后 `drainFollowUps()` 用下一条 queued message 启动新的 `prompt` invocation。
- follow-up 是新的用户轮次，不是当前 ReAct turn 的中途 steer。

这只是当前实现行为。新黑盒合同收紧为 completed-only 自动 drain：error / aborted / interrupted 后不自动消费 follow-up，而是 pause queue 等待用户显式处理。

新架构落位：

- 入队：Invocation Coordinator。
- 启动下一条：Coordinator 在 Run Kernel `cleanup` 释放 active lock 后调度。
- 具体执行仍然是一条新的 Run Kernel invocation，mode 可以规范化成 `prompt`。

关键约束：

- follow-up 不应该进入当前 run 的 `prepareTurn`。
- waiting 状态不应自动 drain follow-up；必须先完成 pending approval / user input。
- error / aborted / interrupted 状态不应自动 drain follow-up；queue 保留但进入 paused 状态，等待用户显式继续、清空或丢弃。
- 用户在 error 后发送新的 `prompt` 不会自动解冻旧 follow-up queue，避免旧队列在新话题后突然恢复消费。

### Abort

现状：

- `abortInvocation()` 不进入 `invokeAgent()`；它直接改 active status、触发 AbortController、可清空 steer/followUp queue、publish `invocation_aborted` 和 snapshot。
- provider/tool 通过 AbortSignal 尽量停止。
- run catch/finalize 会写 lifecycle `aborted` 或 `error` 并 cleanup。

新架构落位：

- abort request 由 Invocation Coordinator 处理。
- AbortSignal 作为 RunFrame 的 runtime resource 传给 `executeTurn`。
- `cleanup` 统一释放 active invocation、queue、abort controller、variable patch 等运行态。

关键约束：

- abort 是外部控制面，不是 profile hook。
- hook 可以看到 `abortSignal.aborted` 的结果，但不负责发起 abort。

### Report Result Reminder

现状：

- 如果 profile 允许 `report_result` 但 run 没有拿到 `reportResult`，Run Kernel 会在 `shouldStop -> prepareNextTurn` 位置写一条 harness reminder user message，然后在同一个 `RunFrame` 内继续下一轮 turn。
- summarizer 迁移后，这条 reminder 不能落进 summarizer session 历史。

新架构落位：

- `shouldStop` 的 Report Result Hook 判断是否缺少必需的 `report_result`。
- 如果必须 retry，`shouldStop` 返回 `continue`，`prepareNextTurn` 注入一条 reminder message。
- reminder retry 表现为同一个 run 内的下一次 Turn Transaction，而不是递归调用一套旧 `runLoop()`，也不是 `settleRun` 里的补救逻辑。
- reminder 是否持久化由 `ingestTurn` 决定：普通 profile 可持久化，summarizer runtime-only。

关键约束：

- reminder retry 仍然要遵守同一个 Turn Transaction：`prepareTurn -> executeTurn -> ingestTurn -> savePoint`。
- `settleRun` 只看最终结果，不负责重新开启模型请求。

### Session Commands / Tree Control

现状：

- `runCommand()` 支持 `new`、`fork`、`retry`、`tree`、`plan`、`model`、`thinking`、`summarize`、`archive`、`compact`。
- 除 `compact` 外，大多数命令要求 session idle。
- `moveTree()` 支持切换 active leaf 到 `empty` / `at` / `before`，并可在树移动后立即发起 `next.invoke`。
- `compact` 以单独 active invocation 运行，但不是普通 ReAct run。
- 旧后端 `session/slash-commands.ts` 已删除；slash command 只在前端识别，然后调用正式 HTTP command/tree 入口。

新架构落位：

- 这些属于 **Session Control Plane**，不属于 Run Kernel hook。
- `new` / `fork` / `archive` / `model` / `thinking` / `plan` / tree move 通过 `SessionWriteExecutor` 写 session entry 并发布 snapshot。
- `retry` 是 tree leaf move，不启动模型。
- `moveTree(... next.invoke)` 在 tree 写入完成后交给 Invocation Coordinator 启动一次正常 `prompt` / `continue` run。
- `compact` 可以作为 `operation="compact"` 的特殊 coordinator operation，复用 Compact Hook / compaction service，但不需要伪装成普通 ReAct turn。
- summarizer 后续由普通 profile runtime hooks 重新设计，不保留旧 `summarize` command 自动运行路径。

关键约束：

- command 不应该被塞进 `prepareRun`；否则每个 command 都会污染模型 invocation 的生命周期。
- tree move 后的 `next.invoke` 目前不是原子事务；新架构第一阶段可以保持现状，后续若要修复，应在 Session Control Plane 做 tree + run admission 的 transaction，不需要新增 Run Kernel stage。

### Session Snapshot / Projection / Event Recovery

现状：

- `getSessionSnapshot()` 是前端恢复真相，包含 summary、messages、tree、entries、linked agents、pending approval、queues、active invocation、model/thinking、plan mode、summarizer 状态和 `lastSeq`。
- `AgentSessionEventHub` 提供 bounded replay；replay 不足时发送 `snapshot_required`。
- `publishSessionEntry()` 和 `publishSessionState()` 分散在 harness 多处。
- projection entry 用于 session title/summary 等展示状态，不应该移动 active leaf，也不应该污染 tree。
- path-scoped projection 需要绑定 source active leaf；reduce 时只应用与当前 active path 匹配的 projection，保证 title/summary 这类 active-path-specific 元数据能随 rollback/tree 切换一起变化。

新架构落位：

- snapshot / event recovery 仍属于 SessionLog + EventHub，不进入 Run Kernel stage。
- `SessionWriteExecutor` 是唯一发布入口：写入 entry 后统一决定 publish `session_entry`、`session_state_changed.state` 或静默。
- projection write 是 `SessionWritePlan.ops[]` 里的 `op.kind = "append" + projection: true`，由 executor 保证不进入 tree，不移动 active leaf。
- follow-up queue 状态写入 `agent.followUpQueue` projection custom state；snapshot 会优先读内存 queue，内存没有时从 projection 恢复，保证刷新页面或重建 harness 后仍能看到 paused queue。第一版不在重启后自动 drain ready queue。
- Run Kernel 只通过 write plan 间接影响 snapshot；hook 不直接 publish event。

关键约束：

- event 是增量优化，snapshot 是恢复真相。
- 新架构要把“写 repo + publish entry + publish state”的重复代码集中到 executor，否则 hook 化后会更难排查前端恢复问题。

### Linked Agents / Sub-Agent Tools

现状：

- `create_agent` tool 调 `harness.createAgent()` 创建 child session，并在 owner session 写 `agent.link.${sessionId}` custom entry。
- `invoke_agent` tool 调 `harness.invokeAgent()`，目标 session 运行一条独立 invocation；tool result 只保存目标 agent 的摘要结果，不保存完整 events。
- `get_agent` / `get_session` 读取 session summary、summary、recent messages、linked agents。
- `detach_agent` 写 `agent.detach.${sessionId}` custom entry，不删除 child session。
- summarizer system session 不走 linked-agent 路径。

新架构落位：

- child session 创建、link/detach、查询属于 Session Control Plane / SessionLog。
- `invoke_agent` 在 `executeTurn` 的 tool execution 中调用 Invocation Coordinator；目标 session 进入自己的 Run Kernel，和当前 parent run 是两个独立 run。
- parent run 等待 `invoke_agent` tool result；目标 run 的 session 写入和 event 发布走目标 session 自己的 executor/event hub。
- summarizer 继续作为 hidden system session，由 Summarizer Coordinator 创建，不写 `agent.link.*`。

关键约束：

- `invoke_agent` 不能调用当前 session 自己，避免自递归 lock。
- 目标 session 如果正在 active，应由 Invocation Coordinator 统一决定 queued / rejected / started，而不是 tool 自己绕过 active lock。
- 跨 session 依赖仍先通过 profile input / ctx 表达，不引入 `RuntimeBinding`。

### Profile Prepare / DSL / Variables

现状：

- profile `prepare()` / TSX DSL 生成 `ProfileTurnPlan`。
- `HistorySet` 只在空 active path 首次写入。
- `AppendingSet` / `modelContextAppendingMessages` / `stateWrites` 在 ReAct 前写入 session。
- `ModelContext` 的普通 message 只进本轮 provider context，不写 session。
- `ctx.vars` 可读写变量；`client.*` patch 会请求前端 ack，并在 ack 后写 `client_variable_patch_ack` entry。
- invocation 结束时会清理 `invocationClientStates`、`invocationVariableStates` 和未完成 client patch。

新架构落位：

- profile prepare 属于 `prepareRun`。
- `ProfileTurnPlan` 只编译成 write plan 和 frame 上的 model-only context，不直接写 repo。
- prompt 模式下的 pending user message 仍在 `profile.prepare()` 后写入，这保留当前“profile appending 先展示，真实用户消息随后展示”的 UI 顺序。
- variable accessor 挂在 `RunFrame` / ToolExecutionContext 上；它产生的 session writes 必须进入 executor。
- client variable patch request 是 EventHub 控制事件；ack 写入由 Session Control Plane 或 Tool Session Write Sink 统一落盘。

关键约束：

- `prepareRun` 的内部顺序不能被 hook reducer 打乱。
- `stateWrites` 仍只允许写 `profileState.${profileKey}`，否则 profile prepare 会变成任意 session mutation 入口。
- `dryRun` prepare 用于 preview / snapshot system prompt，不应创建 write plan。

### Tool Execution / Tool-Side Session Writes

现状：

- `executeTool()` 给工具传 `ToolExecutionContext`，包含 harness、sessionId、workspaceRoot、workspaceKey、projectPath、invocationId、vars。
- `task_tools`、plot tools、变量工具等会在工具执行期间写 session custom state 或变量 entry。
- file/bash/sql 等工具有外部副作用或长输出；tool execution events 会实时广播。
- `commitTurn()` 只负责 assistant/toolResult transcript，不知道工具执行期间已经写过的 custom state。

新架构落位：

- provider call 和 tool batch 仍在 `executeTurn`。
- 工具参数校验、approval barrier、report_result 捕获都在 `executeTurn` 的内部规则。
- 工具侧 session 写入不直接调用 repo；通过 `ToolSessionWriteSink` 或 `SessionFacade` 生成 `SessionWritePlan`，再交给 `SessionWriteExecutor`。
- tool-side writes 必须显式声明 durability：
  - `immediate`：progress/task/client ack 等实时状态，可在工具执行期间立即 flush，可接受服务崩溃后没有对应 assistant/toolResult transcript。
  - `savePoint`：必须和本轮 assistant/toolResult transcript 一起提交的写入，只能进入 `RunFrame.pendingWrites`，在 save point flush。
- 第一阶段只允许工具默认写 `immediate`；需要强一致性的工具必须显式选择 `savePoint`。
- `ingestTurn` 只处理本轮 transcript 如何吸收；不负责重放或改写工具已经产生的 side writes。

关键约束：

- transcript 写入仍在 `ingestTurn` / save point，避免普通 assistant/toolResult 半提交。
- tool-side custom state 是独立 session fact，可以在 tool 执行中间出现；这类 entry 不应插入 assistant/toolResult batch 内部。
- abort/cleanup 必须 reject 未完成的 client patch ack，避免悬挂 Promise。
- executor 必须在事件里保留 `cause.invocationId` / `cause.toolCallId`，让前端和诊断工具能把 side write 关联回对应工具。

### Parallel Tool Batch

目标：允许同一个 assistant turn 中的多个工具并行执行，尤其是多个 `invoke_agent` 可以同时启动不同目标 session，而不是父 agent 串行等待每个子 agent 完成。

PI 的做法可以直接作为第一版心智模型：agent core 默认并行执行工具；单个工具可以声明 `executionMode: "sequential"`；如果同一个非 barrier segment 里出现任何 sequential tool，该 segment 回退串行。PI core 不做通用资源锁调度；文件这类危险副作用由具体工具内部 queue 保护，例如 coding-agent 的 `withFileMutationQueue(filePath, fn)` 会串行化同文件 mutation，但不同文件仍可并行。

不要把这个实现成裸 `Promise.all(toolCalls.map(executeTool))`。工具调用并行有三个必须保持稳定的外部合同：

- provider 下一轮看到的 `toolResult` 顺序必须仍然等于 assistant message 里的 tool call 顺序。
- approval / user input 仍然是 batch barrier；barrier 后面的 tool call 不能偷偷并行执行。
- 工具执行期间产生的 session writes、文件写入、变量 patch、SQLite mutation 等副作用必须按资源互斥，不能只靠 JS promise 调度碰运气。

#### Recommended Shape

采用 PI 风格的粗粒度执行模式，而不是第一版就做通用资源锁系统：

```ts
type ToolExecutionMode = "sequential" | "parallel";

type NeuroAgentTool = AgentTool<any, any> & {
    key: string;
    approvalRequired?: boolean;
    executionMode?: ToolExecutionMode;
    executeWithContext?: (...args: never[]) => Promise<AgentToolResult<unknown>>;
};
```

默认策略与 PI 对齐：未声明 `executionMode` 的工具按全局默认 `parallel` 处理。Neuro Book 可以在 harness 级别保留 `toolExecution: "parallel" | "sequential"` 配置；测试和调试时可强制全串行。

批次规则：

- 如果全局 `toolExecution === "sequential"`，整批串行。
- 如果本段里任意工具 `executionMode === "sequential"`，整段串行。第一版不再把 segment 继续拆成 `parallel -> sequential -> parallel` 的子段；这样牺牲一点并行度，换取更简单的事件、错误和写入归并语义。
- 否则本段并行。
- approval tools 不靠 `executionMode` 表达，仍然是 harness 内置 barrier。
- `report_result` 是 terminal barrier，也不靠 `executionMode` 表达。

`runToolBatch()` 变成一个小调度器：

1. 先按 assistant tool call 原始顺序扫描。
2. 遇到 approval tool，执行 barrier 规则：approval 之前已经完成或可完成的结果保留；approval 自己进入 waiting；approval 后面的 tool call 生成 skipped tool result，不执行。
3. 遇到 `report_result`，先执行它之前的 segment，再执行 `report_result`，然后让后续 tool call skipped 或至少不执行 mutation。
4. 非 barrier 段交给 `executeToolSegment()`。
5. segment 内顺序执行 prepare / 参数校验 / permission check / `beforeToolCall`，失败会生成对应 index 的 immediate error tool result。
6. 如果 segment 需要串行，逐个执行、finalize、发 `tool_execution_end`，并立刻记录该 index 的 finalized result。
7. 如果 segment 可并行，把 allowed prepared calls 并发执行；每个工具完成后立刻执行 `afterToolCall` 并按真实完成时间发 `tool_execution_end`。
8. segment 全部结束后，按原始 tool call index 发 toolResult message，并组装 `toolResults`。
9. `terminate` 和 `shouldContinue` 的归并按原始 tool call 顺序计算。

这和 PI 的重要语义一致：`tool_execution_end` 可以按完成顺序出现；tool-result message artifact 必须按 assistant source order 出现。

#### SavePoint Write Ordering

并行后，`RunFrame.pendingWritePlans.push(plan)` 不能再依赖完成顺序。

需要把 savePoint write 从裸数组改成带 source index 的结构：

```ts
type PendingToolWritePlan = {
    toolCallIndex: number;
    toolCallId: string;
    plan: SessionWritePlan;
};
```

`ToolSessionWriteSink.savePoint*()` enqueue 时必须带当前 tool call index。`ingestTurn` flush 时按：

```text
assistant/toolResult transcript
toolCallIndex asc
within same tool call enqueue order asc
```

这样多个并行工具即使完成顺序不同，session log 仍然稳定、可测试、可回放。

`immediate` writes 可以按真实执行时间发布，因为它们本来就是实时 side writes；但事件必须包含 `cause.invocationId` 和 `cause.toolCallId`，后续如需要更强诊断再补 `toolCallIndex`。

#### Tool Classification

第一版推荐分组如下。

**Parallel by default**

- `invoke_agent`：允许并行；不能 self-invoke。同 target session 不在 tool scheduler 里特判，继续复用目标 session 的 Invocation Coordinator admission：`prompt + message` 遇到 active invocation 会进入 follow-up queue；`continue` 遇到 active invocation 会按现有规则返回 `active_invocation_exists` 等错误；不同 target session 可以真并行。
- `read`：可并行。
- `web_search` / `web_fetch`：external read；可并行，但后续可加 provider-level max concurrency / rate limit。
- `get_agent` / `get_session` / `get_agent_profile`：轻量查询，可并行。
- `variable_schema` / `variable_read`：可并行。`variable_read` 记录 read fingerprint 时要确认和 `variable_patch` 的同路径 queue 不冲突。

**Sequential or tool-internal queued**

- `create_agent`：会分配 session id、创建 session、写 parent link。第一版建议声明 `executionMode: "sequential"`；等 repo create/link 并发测试补齐后再放开。
- `detach_agent`：写 parent link state，第一版声明 sequential。
- `variable_patch`：同 `namespace.path` 必须排队；`client.*` 还要等待 frontend ack。同一路径并发 patch 必须拒绝或用 `withVariablePatchQueue()` 排队。
- `task_create` / `task_set_status`：都写同一个 `agent.tasks` custom state；用 `withSessionStateQueue(sessionId, AGENT_TASKS_STATE_KEY)`，或第一版声明 sequential。
- plot selection tools：即使是 `get_story_thread` / `get_story_scene_context`，当前也会写 `plot.selection`，所以不能当纯读；用 session state queue，或第一版声明 sequential。
- plot mutation tools：用 `withProjectDbMutationQueue(projectPath)`，并保护 `plot.selection` 写入；第一版可声明 sequential。
- `execute_sql`：速度通常不构成瓶颈，且 `SELECT/WITH` 与 `INSERT/UPDATE/DELETE` 的并发语义不值得第一版拆分；第一版把整个工具声明 sequential。
- `write` / `edit` / `apply_patch`：参考 PI coding-agent，用 `withFileMutationQueue(filePath, fn)` 保护同文件 mutation；不同文件仍可并行。`apply_patch` 涉及多文件时需要按稳定路径排序拿多个 queue，避免死锁；第一版也可以先声明 sequential。
- `bash`：默认声明 sequential。除非未来新增只读声明，否则无法可靠知道它会不会写文件、跑测试、启动服务或改数据库。

**Barrier**

- `request_user_input`、`enter_plan_mode`、`exit_plan_mode`：approval barrier。
- `report_result`：建议作为 terminal barrier。它可以不触发 waiting，但不要和 mutation tools 并行；否则可能出现“最终结果已经报告，但同一 turn 的写文件/变量修改还没完成”。第一版可以规定：`report_result` 之后的 tool call 生成 skipped result，或者至少让 `report_result` 所在段等待前面的所有 tool 完成后再执行。

#### Better Alternatives Considered

1. 全量 `Promise.all`
   - 优点：实现最少。
   - 问题：toolResult 顺序、savePoint write 顺序、approval barrier、文件写冲突全部不稳定。
   - 结论：不采用。

2. 只给 `invoke_agent` 特判并行，其他工具继续串行
   - 优点：最快解决当前痛点。
   - 问题：会在 `runToolBatch()` 里引入第二套 tool execution path，后续 web/read 并行还要再重做 scheduler。
   - 结论：可以作为临时 spike，但不建议作为正式架构。

3. 全局工具队列 / worker pool
   - 优点：可以统一限流和观察。
   - 问题：把 turn 内顺序、approval barrier、session savePoint 顺序都推到外部队列，心智更重。
   - 结论：后续如果 web/provider rate limit 明显，再在 scheduler 下方加 provider-level limiter；不要第一版就做全局 worker pool。

4. 通用资源锁调度器
   - 优点：保留 `executeTurn` 内部规则，能表达并行、barrier、文件/变量/DB 互斥，也能逐步放开工具。
   - 问题：第一版需要每个工具声明 lock provider，profile/tool 作者心智负担更高，也容易和工具内部真实副作用漂移。
   - 结论：暂不采用。先采用 PI 风格 `parallel/sequential`，危险资源由工具内部 queue 保护；等出现跨工具资源冲突再升级。

5. PI 风格并行 + 工具内部 queue
   - 优点：core 心智最小，和 PI 语义一致；工具知道自己的真实副作用，适合在工具内部做 file/session/variable/db queue。
   - 问题：需要逐个工具补 queue，不能靠中心调度器自动发现冲突。
   - 结论：推荐方案。

#### Required Tests

- 两个 `invoke_agent` 指向不同 child session 时并行启动；总耗时接近较慢者，而不是两者相加。
- 两个 `invoke_agent` 指向同一 session 时不并行；第二个要么排队等待，要么由 Coordinator 返回 active lock 语义，不能绕过 active invocation。
- approval tool 前面的普通工具可以完成；approval 后面的工具 skipped；approval 后不会启动并行任务。
- `toolResults` 永远按 assistant tool call 顺序写入，即使实际完成顺序相反。
- 并行工具的 savePoint writes 按 tool call index flush，不按完成时间 flush。
- `report_result` 不会早于同 turn 里的 mutation tool 完成并结束 run。
- 同一路径 `write/edit/apply_patch` 串行或冲突拒绝。
- 同一 `variable_patch` path 串行；并发 patch 不破坏 read-before-patch fingerprint。
- `bash` 与文件写工具默认不并行。
- abort 时取消所有仍在运行的并行工具；已完成工具结果保留，未完成工具生成 interrupted/error result 或让 failure path 统一处理，不能留下永远 pending 的 tool call。
- 如果本段包含任意 `executionMode: "sequential"` 工具，整段串行执行。

### Model / Thinking / Provider Config

现状：

- session 可通过 `model_change` 覆盖模型，通过 `thinking_level_change` 覆盖 reasoning。
- 运行时从 effective config、session context、profile 默认值一起解析 model / apiKey / provider options / thinking。
- `TurnSnapshot` 已显式存在，当前由 `createTurnSnapshot()` 在每轮 provider request 前冻结这些值。

新架构落位：

- `prepareTurn` 创建 `TurnSnapshot` 时冻结 model、apiKey、requestOptions、thinkingLevel 和 tools。
- `model` / `thinking` command 是 Session Control Plane 写入，不影响已经开始的 provider request，只影响下一次 `prepareTurn`。
- 如果 run 中途外部改变 session model/thinking，当前 turn 不变；下一 turn 是否刷新由 `prepareNextTurn` 决定。

关键约束：

- provider streaming 开始后不能读 mutable session config。
- snapshot 展示的 effective thinking 应复用同一套解析规则，避免 UI 和真实 run 不一致。

### Plan Mode

现状：

- `enter_plan_mode` / `exit_plan_mode` 是 approval tools。
- approval resolution 时 `appendPlanModeResolution()` 写 `ui.planMode.active` 和 `AGENT_PLAN_MODE_STATE_KEY`。
- UI 也可以通过 `plan` command 直接切换 plan mode state。
- `exit_plan_mode` 可以携带 `planFilePath`，pending approval DTO 会读取文件内容给前端预览。

新架构落位：

- tool 触发的 plan mode suspend 走 Approval Hook：`executeTurn` barrier，`ingestTurn` 允许 pending approval，`settleRun` 返回 waiting。
- resolution restore 在 `prepareRun` 最早执行，先写 toolResult，再写 plan mode custom state，再进入 profile prepare。
- UI `plan` command 留在 Session Control Plane。
- pending approval DTO 仍由 snapshot projection 从 active path 推导。

关键约束：

- plan mode resolution 的 state write 必须与 approval toolResult 邻近发生，不能被 `AppendingSet` 插到中间。
- waiting run 不触发 summarizer 或 follow-up drain。

### Manual Compaction

现状：

- 自动 compaction 已迁到普通 turn save point 后、下一轮 `prepareNextTurn` 前运行。
- `/compact` command 单独启动 active invocation，读取当前 profile compaction 配置后写 compaction entry。
- compact run 只写 lifecycle，不跑普通 assistant/toolResult turn。

新架构落位：

- 自动 compaction 是 Compact Hook，第一版直接在 save point / `prepareNextTurn` 生效。
- 手动 compact 是 Session Control Plane 启动的 `operation="compact"`，复用 compaction service 和 `SessionWriteExecutor`。
- 手动 compact 不需要进入 `runTurns`，也不需要创建 `RuntimeTurn`。

关键约束：

- compact entry 是 SessionLog 事实，后续 Runtime Context Hook 从 reduce 后的 context 重建 provider messages。
- summarizer 不 compact 自己，只读取 source session 已 compact 后的 Agent Dialogue Content。

## Agent System Capability Inventory

当前项目 Agent 系统需要覆盖的能力可以分成四层。

**Session Control Plane**

- 创建普通 session、创建 hidden system session、列 session、读 snapshot。
- session command：new、fork、retry、tree、plan、model、thinking、summarize、archive、compact。
- tree / branch active leaf 切换，以及 tree move 后的 next invoke。
- linked agent link/detach/query，system session 默认隐藏。
- snapshot projection、event replay、snapshot_required 恢复。

**Invocation Coordinator**

- active invocation lock。
- prompt / continue / internal / compact operation 的 admission。
- running 时接收 steer / follow-up queue。
- inactive 时拒绝 steer / follow-up。
- abort controller、active invocation state、queue cleanup。
- run completed 后按规则 drain follow-up；run error/aborted/interrupted 后 pause follow-up queue。
- terminal error/aborted/interrupted 后清理或标记 failed pending steer queue。
- background summarizer latest-only/coalesced 调度；所有声明了 `summarizer` 的 profile 都可启用，不限定特定 source profile。
- summarizer ModelContext 每次由 summarizer system prompt 和 source Agent Dialogue Content 重建；AppendingSet 为空，summarizer 自身 assistant/toolResult transcript 不落盘也不进入下一轮上下文。

**Run Kernel / Turn Transaction**

- lifecycle start/end/error/aborted。
- approval resolution restore。
- profile prepare、pre-turn writes、pending prompt write。
- model/tool/thinking/provider option snapshot。
- runtime context build、compaction、steer drain。
- provider streaming、tool batch、approval barrier、report_result 捕获。
- turn-level ingest、save point、prepare next turn、should stop。
- report_result reminder retry、summarizer settle。

**Tool / Variable Runtime**

- tool 参数校验和 per-profile allowed tool 集合。
- tool context 里的 workspaceRoot / projectPath / sessionId / invocationId。
- tool-side session custom state writes。
- variable read/patch/read-before-patch fingerprints。
- client.* variable patch request / ack / timeout cleanup。
- external side effects：文件、bash、SQL、workspace 数据修改。

## Capability Fit Matrix

| 能力 | 新架构归属 | Stage / Hook | 好实现吗 | 备注 |
| --- | --- | --- | --- | --- |
| prompt / continue invocation | Invocation Coordinator + Run Kernel | coordinator -> `enterRun` -> `prepareRun` | 是 | `enterRun` 只处理已 accepted run。 |
| running prompt/follow-up 入队 | Invocation Coordinator | coordinator queue | 是 | 不进入 Run Kernel。 |
| steer | Coordinator + Queue Hook | enqueue；`prepareTurn` drain | 是 | 建议每轮只在 `prepareTurn` drain，turn 末只检查是否需要下一轮。 |
| follow-up | Invocation Coordinator | cleanup 后按 terminal result drain/pause | 是 | 新 invocation，不是当前 turn context；只有 completed 后自动 drain。 |
| abort | Invocation Coordinator + cleanup | abort signal；`cleanup` | 是 | 外部控制面，不是 profile hook。 |
| approval / request-user-input waiting | Approval Hook | `executeTurn` barrier；`ingestTurn`；`settleRun`；`prepareRun` restore | 是 | 要保护 resolution toolResult 先于 appending writes。 |
| report_result schema | Report Result Hook | `prepareTurn` tool snapshot | 是 | 由 profile OutputSchema 动态派生。 |
| report_result reminder | Report Result Hook | `shouldStop` -> `prepareNextTurn` | 中 | 缺 report_result 时同一 run 内追加 turn，`settleRun` 不重开模型请求。 |
| 普通 assistant/toolResult 持久化 | Turn Ingest Hook | `ingestTurn` + save point | 是 | 当前 `commitTurn()` 迁移为默认 ingest。 |
| summarizer runtime-only transcript | Profile Runtime Hooks | `prepareTurn` / `ingestTurn` / `settleRun` | 是 | summarizer 是 hook 组合的第一目标，不是 kernel 特例。 |
| profile.prepare / DSL writes | Default Persistence Hook | `prepareRun` | 是 | 转 write plan，不直接 append。 |
| automatic compaction | Profile `compaction` policy | save point；`prepareNextTurn` | 中 | 由 profile 显式声明启用；没有 `compaction` 时不走默认压缩。 |
| manual compact command | Session Control Plane | `operation="compact"` + compaction service | 是 | 不需要普通 ReAct turn。 |
| tree / branch / retry / fork | Session Control Plane | session write executor | 是 | `next.invoke` 交 coordinator；原子性后续补。 |
| model / thinking command | Session Control Plane + TurnSnapshot | command writes；下一次 `prepareTurn` 生效 | 是 | 当前 provider request 不受影响。 |
| plan mode UI command | Session Control Plane | command writes | 是 | 与 tool approval plan mode 共享 state key。 |
| linked agent create/detach | Session Control Plane | link/detach custom entries | 是 | summarizer 不走 linked agent。 |
| invoke_agent tool | Tool execution + Coordinator | `executeTurn` calls coordinator | 中 | 需要避免 self-invoke 和目标 active lock 绕过。 |
| get_agent / get_session tool | Session facade | tool read facade | 是 | 只读，不进 pipeline。 |
| tool-side custom state writes | Tool Session Write Sink | inside `executeTurn` via executor | 中 | 需要保留实时 UI，同时避免绕过统一写入。 |
| variable read/patch | Tool/runtime variable accessor | `prepareRun` / `executeTurn` | 中 | invocation-scoped state 放 RunFrame，cleanup 必须清理。 |
| client variable patch ack | Session Control Plane + Tool runtime | event request；ack write | 中 | 不是 ReAct stage，但必须关联 invocation/toolCall。 |
| SSE replay / snapshot recovery | EventHub + SessionLog | executor publish | 是 | 不进 hook；snapshot 是真相。 |
| session title/summary summarizer | Summarizer Coordinator + internal Run Kernel | source invocation completed 后 trigger | 是 | 所有 profile 可启用；失败隔离，不影响 source result。 |

## Pipeline Stage Review

这次审查后，当前新架构不需要推翻。更准确的分层应该是：

```text
Session Control Plane
  - create/list/snapshot/commands/tree/link/detach/ack
  - all writes go through SessionWriteExecutor

Invocation Coordinator
  - admit/enqueue/reject/abort
  - owns active invocation and queues
  - starts Run Kernel only for accepted runs

Run Kernel
  - enterRun
  - prepareRun
  - runTurns
  - settleRun
  - cleanup

Turn Transaction
  - prepareTurn
  - executeTurn
  - ingestTurn
  - savePoint
  - prepareNextTurn / shouldStop
```

不建议新增一堆 pipeline stage。需要补的是两个“非 stage”服务：

- `SessionWriteExecutor`：统一 session writes、projection writes、lifecycle writes、publish entry/state。
- `ToolSessionWriteSink`：工具执行期间的 session writes 入口，内部仍使用 `SessionWriteExecutor`。

为什么不新增 stage：

- command/tree/list/snapshot/link 不是模型运行，不应进入 Run Kernel。
- follow-up admission 可能根本不开始 run，不应进入 `enterRun`。
- tool-side writes 是工具副作用的一部分，不是 assistant/toolResult transcript ingest。
- snapshot recovery 是事件/投影层能力，不是 run lifecycle。

未来可能拆出的子 hook：

- `beforeModelCall` / `afterModelCall`：当需要 provider payload inspection、cache hint、request mutation 时再拆。
- `beforeToolCall` / `afterToolCall`：当需要 tool gate、tool arg patch、tool result patch 时再拆。
- `transformModelContext`：当 runtime hooks 需要多个 context transform 组合时再拆。

第一阶段保持少量 stage 更稳：先把写入统一、RunFrame/TurnSnapshot 明确、turn-level ingest 跑通，再扩展细粒度 hook。

## Stage Fit Decision

审查现有能力后，当前设计不需要推翻，但需要三个边界收紧。

### 1. Coordinator Is Outside Kernel

`activeInvocations`、`steerQueues`、`followUpQueues`、`abortControllers` 这些状态属于 invocation admission / scheduling，不属于 ReAct runtime。

因此：

- 不新增 `admitRun` 作为 Run Kernel stage。
- 增加外侧 Invocation Coordinator 概念。
- `enterRun` 只服务已经 accepted 的 run。

### 2. `prepareRun` Has A Strict Internal Order

`prepareRun` 不是一个无序的大 prepare。它内部必须固定顺序：

```text
hydrate session
  -> if continue resolution: append resolution toolResult
  -> refresh session snapshot
  -> profile.prepare()
  -> compile pre-turn write plans
  -> flush pre-turn writes
  -> refresh projection for first turn
```

这个顺序主要保护 approval resume 的 tool call / tool result 邻接性。

### 3. Turn Queue Belongs To `prepareTurn`

`steer` 是当前 run 的中途引导，所以在 turn 边界消费。

`followup` 是下一次 invocation，所以不进入 turn pipeline。

这条分界能避免 Queue Hook 同时处理两种完全不同的语义。

## Runtime Objects

### SessionLog

`SessionLog` 是持久事实层，当前对应 `JsonlSessionRepository`。

职责：

- 保存 append-only entries。
- 保存 active leaf。
- reduce active path + projection entries 成 session projection。
- 提供 snapshot/list/tree 视图。

非职责：

- 不决定 provider context。
- 不决定 turn 是否落盘。
- 不知道某个 write plan 来自 compact、summarizer、ingest 还是 profile hook。

目标约束：

- 所有写入经过 `SessionWriteExecutor`。
- projection entry 只参与 projection/reduce，不污染 tree 展示和 active branch。
- 业务层不再散落调用 `appendEntry()` / `appendProjectionEntry()`。

### Session Storage Layout

第一版重构同时收紧 session 文件布局。

当前实现按 project/workspace 目录存储：

```text
.nbook/agent/session-seq.json
.nbook/agent/sessions/<workspace-key>/<session-id>.jsonl
```

新架构不再按 workspace/project 分目录。`sessionId` 是当前 `.nbook/agent` session store 内的主键，session repo 通过 `sessionId` 直接定位文件。

目标形态：

```text
.nbook/agent/session-seq.json
.nbook/agent/sessions/<session-id>.jsonl
```

约束：

- `SessionWritePlan.target` 只包含 `sessionId`，不暴露 `workspaceKey`。
- workspace/project 信息如果仍需要展示或工具运行，应作为 session metadata / project context 读取，不参与 write target。
- executor 必须在当前 session store 中拒绝无法解析的 `sessionId`，而不是要求 hook/profile 作者传 workspace 维度。
- 迁移时可以硬切旧布局；当前是开发版，不需要 legacy 兼容层。

### RunFrame

`RunFrame` 表示一次 invocation 的运行态。它只描述“这次运行是谁、用哪个 profile、当前有哪些运行材料”，不把 summarizer 这类业务关系硬编码成顶层字段。

```ts
type RunFrame = {
    invocationId: string;
    sessionId: number;
    mode: "prompt" | "continue" | "internal" | "compact";
    operation?: string;
    snapshot: SessionSnapshot;
    projection: NeuroSessionContext;
    profile: AgentProfile;
    profileInput: JsonValue;
    prepared?: ProfileTurnPlan;
    runtimeMessages: AgentMessage[];
    pendingWrites: SessionWritePlan[];
    runtimeState: Record<string, JsonObject>;
    turnIndex: number;
};
```

核心意义：

- session history 是输入，不等于当前 loop 内存。
- assistant/toolResult 可以只进入 `runtimeMessages`，不进入 session。
- profile 可以通过 hook 组合选择 runtime-only transcript 行为：它有自己的 session 和初始化历史，但不把运行中的 assistant/toolResult transcript 写进 session history。
- summarizer 依赖哪个 source session 由 `defineAgentProfile.summarizer` 初始化 input 表达，harness 注入 `sourceSessionId`，summarizer profile 再通过 ctx/input 读取源 session。kernel 不需要额外的 `RuntimeBinding` 抽象。
- `internalQueued` 这类 bypass boolean 不进入新架构。internal run、summarizer run、tree next invoke、manual compact 都由 Invocation Coordinator 以明确 mode/operation 创建 RunFrame。
- queue、transcript persistence、compact、report_result required 这类行为不再作为 RunFrame boolean flags；它们由 runtime hook bundle 决定。

### TurnSnapshot

`TurnSnapshot` 是一次 provider request 的冻结快照。

```ts
type TurnSnapshot = {
    index: number;
    systemPrompt: string;
    modelMessages: AgentMessage[];
    providerMessages: Message[];
    model: Model<any>;
    apiKey?: string;
    thinkingLevel: ThinkingLevel;
    tools: ReturnType<AgentToolRegistry["allowed"]>;
    requestOptions?: Record<string, JsonValue>;
};
```

约束：

- provider streaming 开始后，当前 `TurnSnapshot` 不再被修改。
- 运行中 config/profile/session/resource 的变化只能通过下一次 `createTurnSnapshot` 生效。
- `buildModelContext` / `transformModelContext` 在 provider request 前完成。

### RuntimeTurn

`RuntimeTurn` 是一次成功或等待中的 ReAct turn 结果对象。

```ts
type RuntimeTurn = {
    index: number;
    snapshot: TurnSnapshot;
    assistant?: AssistantMessage;
    toolCalls: AgentToolCall[];
    toolResults: ToolResultMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    waiting?: {
        toolCallId: string;
        toolName: string;
    };
};
```

`RuntimeTurn` 只描述 provider/tool 已经形成合法 turn shape 的情况。Provider stream 中途失败、tool fatal、approval setup failure 这类错误不能强行伪装成 `RuntimeTurn`。

### TurnOutcome

`executeTurn` 的输出是 `TurnOutcome`。它是 `ingestTurn`、`savePoint` 和 Kernel failure path 的主要输入。

`shouldStop` / `prepareNextTurn` 只接收 `SuccessfulTurnOutcome`，类型上禁止 failed outcome 继续进入正常 turn continuation 判断。

```ts
type SuccessfulTurnOutcome =
    | {
        kind: "completed";
        turn: RuntimeTurn;
    }
    | {
        kind: "waiting";
        turn: RuntimeTurn;
        pending: PendingUserResolution;
    }
;

type FailedTurnOutcome = {
    kind: "failed";
    phase: "provider" | "tool" | "approval" | "unknown";
    partialAssistant?: AssistantMessage;
    errorInfo: InvocationErrorInfo;
};

type TurnOutcome = SuccessfulTurnOutcome | FailedTurnOutcome;
```

约束：

- `partialAssistant` 必须已经 sanitized：只保留已收到的 text/content，剥离未闭合或完整性无法确认的 tool calls，并标记 partial/interrupted/error。
- `completed` 和 `waiting` 分支可以进入普通 transcript ingest。
- `failed` 分支只能进入 error-aware ingest 和 Kernel failure path；类型上不能继续 `shouldStop` / `prepareNextTurn` 的正常完成判断。
- lifecycle `error` 由 Kernel failure path 统一写，不由 profile hook 自行写。

### SessionWritePlan

`SessionWritePlan` 是唯一的持久化申请单。

它的职责只保留三件事：

- 写到哪个 session。
- 为什么写。
- 按什么顺序写哪些 session op。

不要把 `SessionWritePlan` 设计成 `{messages, entries, projectionEntries, lifecycle, publish, atomicity}` 这种多字段大袋子。那种形态虽然能表达需求，但会让同一个 plan 内部的写入顺序、publish 语义和 batch 语义变隐式。

```ts
type SessionWritePlan = {
    target: SessionWriteTarget;
    /** 第一批实现先用 string cause；后续如诊断需要再升级为结构化 cause。 */
    cause: string;
    durability?: "immediate" | "savePoint";
    ops: SessionWriteOp[];
};

type SessionWriteTarget = {
    sessionId: number;
};

type SessionWriteOp =
    | {
        kind: "append";
        entry: SessionEntryDraft;
        /** projection append 不进入 tree、不移动 active leaf。 */
        projection?: boolean;
    }
    | {
        kind: "appendMany";
        /** batch 写入，repo 只在最后移动 leaf。 */
        entries: AppendManySessionEntryDraft[];
    }
    | {
        kind: "moveLeaf";
        /** 移动 active leaf；null 表示清空当前 active path。 */
        leafId: SessionEntryId | null;
    };

type AppendManySessionEntryDraft = Exclude<SessionEntryDraft, {type: "leaf"}>;
```

硬性约束：

- `target.sessionId` 必填。write plan 不默认写当前 session；summarizer 写 source session、child agent 写 parent link、tool 写当前 session 都必须显式 target。
- `target` 不包含 `workspaceKey`。session repo 通过当前 session store 内的 `sessionId` 定位文件。
- `cause` 必填。第一批实现用短字符串，如 `prompt`、`turn.ingest`、`lifecycle.start`、`command.plan`；如果后续诊断需要，再升级为结构化对象。
- `ops` 是有序列表；executor 必须按 `ops[]` 顺序写入。
- public plan 不暴露 `atomicity`。第一版没有 batch commit marker，不承诺进程崩溃级别的半批恢复；executor 只承诺先整批校验、按顺序 append、统一 publish。
- public plan 不暴露 `publish`。publish 由 executor 根据 op kind 自动决定，避免 hook/profile 作者承担事件发布细节。
- projection writes 第一批通过 `op.kind = "append" + projection: true` 表达；它会走 `appendProjectionEntry()`，不进入 tree、不移动 active leaf。后续 active-path-specific source leaf 绑定由 17 summarizer 重做时补充。
- active leaf 移动通过 `op.kind = "moveLeaf"` 表达；retry/tree/empty 这类控制面操作也必须走 executor 发布 entry/state。
- lifecycle status 硬切为 `start -> waiting/resumed* -> end/error/aborted/interrupted`。waiting 是持久状态，不再用重复 `start` 表示。
- waiting / resume 使用同一个 logical `invocationId`；如需区分实际执行片段，用可选 `attemptId`，不要创建用户可见的新 invocation。
- partial assistant 必须通过 message state 持久表达，不靠 lifecycle error 反推上一条 assistant。session entry schema 需要支持 message-level partial/interrupted/error metadata。
- 普通 turn messages 能表达。
- projection writes 能表达。
- lifecycle writes 能表达。
- turn ingest/session_update 能表达。

示例：

```ts
const startRunPlan: SessionWritePlan = {
    target: {sessionId},
    cause: "lifecycle.start",
    ops: [
        {
            kind: "append",
            entry: {type: "invocation_lifecycle", invocationId, status: "start"},
        },
    ],
};

const promptPlan: SessionWritePlan = {
    target: {sessionId},
    cause: "prompt",
    ops: [
        {
            kind: "append",
            entry: {type: "message", origin: "prompt", message: userMessage},
        },
    ],
};

const turnCommitPlan: SessionWritePlan = {
    target: {sessionId},
    cause: "turn.ingest",
    durability: "savePoint",
    ops: [
        {
            kind: "appendMany",
            entries: [
                {type: "message", origin: "harness", message: assistantMessage},
                {type: "message", origin: "harness", message: toolResultMessage},
            ],
        },
    ],
};

const summaryProjectionPlan: SessionWritePlan = {
    target: {sessionId: sourceSessionId},
    cause: "summarizer.projection",
    ops: [
        {
            kind: "append",
            projection: true,
            entry: titleSummaryEntry,
        },
    ],
};

const treeMovePlan: SessionWritePlan = {
    target: {sessionId},
    cause: "tree.before",
    ops: [
        {kind: "moveLeaf", leafId: targetParentId},
    ],
};
```

这版暂不提供 `ctx.session.writeXxx()` plan builder，避免 API 过早膨胀。自定义 hook 可以直接返回 `SessionWritePlan`，executor 会做完整校验。内置 harness/tool 代码如需更顺手的写入 API，使用 `ToolSessionWriteSink`。

## Hook Runtime

### Hook Object

首发 hook object 是带 `stage` / `name` / `run` 的插件对象。stage 只围绕 run 和 turn 的事务边界，不把 provider/tool 内部每个动作都提升成一等 pipeline stage：

```ts
type AgentRuntimeHook<TInput, TOutput> =
    | {stage: "prepareRun"; name: string; run(ctx: PrepareRunContext<TInput, TOutput>): MaybePromise<PrepareRunResult>}
    | {stage: "prepareTurn"; name: string; run(ctx: PrepareTurnContext<TInput, TOutput>): MaybePromise<PrepareTurnResult>}
    | {stage: "ingestTurn"; name: string; run(ctx: IngestTurnContext<TInput, TOutput>): MaybePromise<IngestTurnResult>}
    | {stage: "prepareNextTurn"; name: string; run(ctx: PrepareNextTurnContext<TInput, TOutput>): MaybePromise<PrepareNextTurnResult>}
    | {stage: "settleRun"; name: string; run(ctx: SettleRunContext<TInput, TOutput>): MaybePromise<SettleRunResult>};
```

第一阶段真正需要先落地的是：

- `prepareRun`
- `prepareTurn`
- `ingestTurn`
- `prepareNextTurn`
- `settleRun`

`shouldStop` 第一版是 Run Kernel 内置 reducer 点，不作为 profile hook 暴露。Report Result Hook 可以参与这个 reducer，但 profile 作者不直接实现 `shouldStop`。

后续再按真实需求拆出子 hook：

- `transformModelContext`
- `beforeModelCall`
- `afterModelCall`
- `beforeToolCall`
- `afterToolCall`

### Hook Result

Hook result 必须按 slot 定义窄类型，不使用一个可 patch 一切的通用结果。下面是概念形状：

```ts
type PrepareRunResult = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: Record<string, JsonObject>;
    writePlans?: SessionWritePlan[];
};

type PrepareTurnResult = {
    systemPrompt?: string;
    modelContext?: AgentMessage[];
    runtimeState?: Record<string, JsonObject>;
    turnSnapshotPatch?: Pick<Partial<TurnSnapshot>, "systemPrompt" | "modelMessages" | "tools" | "requestOptions">;
    writePlans?: SessionWritePlan[];
};

type IngestTurnResult = {
    transcript?: "persist" | "runtime_only" | "drop";
    partialAssistant?: {
        action: "persist" | "drop";
    };
    runtimeMessages?: AgentMessage[];
    runtimeState?: Record<string, JsonObject>;
    writePlans?: SessionWritePlan[];
};

type PrepareNextTurnResult = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: Record<string, JsonObject>;
    writePlans?: SessionWritePlan[];
};

type SettleRunResult = {
    runtimeState?: Record<string, JsonObject>;
    writePlans?: SessionWritePlan[];
};
```

Reducer 只能合并当前 slot 允许的字段。需要新能力时先扩展对应 slot result。

`turnSnapshotPatch` 第一版直接对 custom profile hook 开放，包括 `tools` / `requestOptions`。这些能力目前不常用，但先开放可以避免未来有真实需求时重做 runtime hook 合同。开放后的边界是：hook 仍只能返回 patch，最终 tool policy、report_result schema、approval barrier 和 provider request 规范化仍由 Run Kernel reducer 统一执行。

`runtimeState` 必须按 hook namespace 合并，不能让多个 hook 共享一个裸 `JsonObject`。推荐 reducer 使用 hook name 作为默认 namespace：

```ts
for (const [namespace, value] of Object.entries(normalizeRuntimeState(hook.name, result.runtimeState))) {
    runtimeState[namespace] = merge(runtimeState[namespace], value);
}
```

实现也可以提供 `ctx.runtimeState.get(namespace)` / `ctx.runtimeState.set(namespace, value)` facade，但底层状态必须保持命名空间隔离。

### Reducer Rules

- `prepareRun`：合并 profile prepare 输出、pending prompt、resolution restore、pre-turn writes。
- `prepareTurn`：顺序构建本轮 `TurnSnapshot`，包括 queue drain、model context、tools、model/thinking。
- `ingestTurn`：默认 plan 可被系统 hook 替换；决定本轮 assistant/toolResult 如何进入 runtime/session/projection；failed `TurnOutcome` 下决定 sanitized partial assistant 是否写入 session。
- `savePoint`：本轮 write plan 已落盘后的安全点，可刷新 snapshot/projection。
- `prepareNextTurn`：只为同一个 run 的下一轮准备材料，例如重建 context、更新 compact 后 projection、注入 report_result reminder；不启动 follow-up。
- `shouldStop`：Run Kernel 内置 reducer 根据 tool batch、waiting、report_result、steer queue 和 max loop 等信号判断当前 run 是否结束；缺必需 report_result 时返回 continue。
- `settleRun`：只处理正常 completed / waiting run 的最终 session update/projection/lifecycle plans；waiting run 不执行 summarizer trigger 或 follow-up drain。

Kernel failure path 不属于 profile hook。任何 stage 抛错或 `executeTurn` 返回 failed outcome 时，Kernel 负责规范化 `InvocationErrorInfo`、调用 error-aware `ingestTurn` 处理 partial assistant、尽力写 lifecycle `error`，然后进入 `cleanup`。这样可以避免 profile hook、`settleRun` 和 catch/finally 多处竞争写 terminal lifecycle。

### Hook Context

Hook context 提供 facade，不暴露 raw repo：

```ts
type RuntimeHookContext = {
    session: SessionFacade;
    profiles: ProfileFacade;
    tools: ToolFacade;
    config: ConfigFacade;
    events: EventFacade;
};
```

目标 `SessionFacade` 只允许：

- read persisted snapshot/projection。
- create `SessionWritePlan` draft。

它不提供：

- `appendEntry()` / `appendMessage()` / `appendProjectionEntry()`。
- `publish()`。
- `enqueueWritePlan()`。

Hook 只能返回 plan。只有 Run Kernel reducer 和 Session Control Plane 可以把 plan 交给 `SessionWriteExecutor`。

当前第一批实现已经落地最小只读 facade：

```ts
type RuntimeSessionFacade = NeuroSessionContext & {
    read(sessionId?: number): Promise<{
        snapshot: SessionSnapshot;
        context: NeuroSessionContext;
    }>;
    agentDialogueContent(input?: {
        sessionId?: number;
        snapshot?: SessionSnapshot;
        profileKey?: string;
        input?: JsonValue;
    }): Promise<AgentDialogueContent>;
};
```

这版暂不提供 `ctx.session.writeXxx()` plan builder，避免 API 过早膨胀。自定义 hook 直接返回显式 `SessionWritePlan`；等内置 hook bundle 成型后，再把常用 projection / lifecycle plan builder 做成小 helper。

## Built-in Hooks

### Default Persistence Hook

普通 profile 默认启用。

职责：

- `prepareRun` 时将 pending prompt 写入 session。
- `prepareRun` 时将 `HistorySet` 首轮消息、`AppendingSet`、stateWrites 编译成 pre-turn write plan。
- `ingestTurn` 时写 assistant/toolResult。
- 保持现有 `origin` 语义：`prompt` / `harness` / `ingest`。

### Runtime Context Hook

普通 profile 默认启用。

职责：

- `prepareTurn` 时从当前 session active path reduce 出 `context.messages`。
- 追加 `prepared.modelContextMessages`。
- 过滤 provider 可见 message。
- 校验未闭合 tool call。

### Profile Runtime Hooks

普通 profile 和用户自定义 profile 都可以通过 `runtime: { hooks }` 在固定事务边界改写 context / transcript / settle 行为。summarizer 是第一批使用者，但不是 Run Kernel 特例。

职责：

- `prepareRun`：允许 profile 把 HistorySet 初始化、AppendingSet、stateWrites 编译成 write plan，或选择不使用默认 prepare 行为。
- `prepareTurn`：允许 profile 读取 `ctx.session.read(sourceSessionId)`，并通过 helper 从 source session 当前 active path 重建 Agent Dialogue Content。
- `ingestTurn`：允许 profile 决定 assistant/toolResult 只进入 runtime，还是写入当前 profile session。
- `prepareNextTurn`：如果还需要继续，允许 profile 重新读取 source session 并重建 ModelContext。
- `settleRun`：允许 profile 把 `report_result.data` 转成写往目标 session 的 projection/session_update plan。
- queue / compact / approval 能力由是否组合对应 built-in hook 决定。

summarizer 用这个通用机制表达：

- 不组合默认 transcript persistence hook，改用 runtime-only ingest：HistorySet 初始化后，assistant/toolResult 不再 append。
- ModelContext 每次由 summarizer system prompt + source Agent Dialogue Content 重建，AppendingSet 为空。
- `ingestTurn` runtime-only，只闭合 runtime turn，不写 summarizer session transcript。
- `settleRun` 把 title/summary 写回 source session projection。

硬性约束：

- summarizer 的 write plan `target` 必须是 source session，不能默认写 summarizer 自己。
- summarizer session 只保存实例 metadata、HistorySet 初始化内容和必要 custom state，不保存运行中的 assistant/toolResult transcript。
- source session 发生 branch/tree 切换或新 message 写入后，旧 source leaf 的 summarizer 输出不能覆盖新 active path 的 title/summary。

### Compact Hook

第一版直接放在 save point / `prepareNextTurn`，不保留旧 pre-loop 语义：

- 估算下一轮 context token。
- 超阈值时写 compaction entry。
- 重新 reduce session。
- 创建下一轮 `TurnSnapshot`。

summarizer 不跑自身 compact；它读取 source session compact 后的 Agent Dialogue Content。

### Queue Hook

职责：

- 在 `prepareTurn` 的 turn-safe 点 drain `steer` queue。
- drain 出来的 user message 通过 write plan 持久化，或按 profile 策略只进入 runtime。

默认策略：

- 普通 profile 开启外部 queue。
- summarizer/internal profile 禁用外部 queue。
- `followup` 不由 Queue Hook 消费；它是下一次 invocation，由 Invocation Coordinator 在当前 run cleanup 后调度。

### Approval Hook

职责：

- 处理 pending approval resolution。
- 生成恢复用 toolResult write plan。
- 默认 summarizer runtime 不组合 approval hook，因此不进入 approval suspend。

落位：

- `prepareRun` 处理 resolution restore。
- `executeTurn` 处理 approval batch barrier。
- `ingestTurn` 按 waiting 语义允许唯一 pending approval tool call。
- `settleRun` 把 run 标成 waiting，并跳过 summarizer / follow-up drain。
- resume 时仍使用原 logical `invocationId`；如需技术追踪，可给恢复后的执行片段分配新的 `attemptId`。

### Report Result Hook

职责：

- `report_result` schema 根据 profile `OutputSchema` 动态生成。
- 缺少 report_result 时通过 `shouldStop -> prepareNextTurn` 插入 reminder。
- reminder 是否持久化由当前 runtime 的 `ingestTurn` 结果决定。

summarizer 下 reminder 必须是 runtime-only。

### Turn Ingest Hook

新的 ingest 语义是 **turn-level ingest**，不是旧 ReAct Loop 结束后的统一后处理。

职责：

- 每个 ReAct turn 结束后运行一次。
- 输入是本轮 `TurnOutcome`：
  - `completed` / `waiting` 分支包含合法 `RuntimeTurn`，包括 assistant、tool calls、toolResults、reportResult、waiting。
  - `failed` 分支包含 `errorInfo`，以及可能存在的 sanitized `partialAssistant`。
- 输出是：
  - 本轮哪些消息进入 runtime context。
  - 本轮哪些消息写入当前 profile session。
  - failed provider stream 下，partial assistant 是否写入 session。
  - 本轮哪些结果写入 projection 或其他绑定 session。
  - 下一轮是否需要重建 context。
- 普通 profile 默认 ingest hook 持久化 assistant/toolResult。
- 普通 profile 默认 error-aware ingest 会保存 sanitized partial assistant content，并剥离 tool calls；没有 content delta 时不写空 assistant。
- summarizer 的自定义 ingest hook 是 runtime-only transcript，只保留 runtime closure，不写自身 session。
- lifecycle `error` 不由 Turn Ingest Hook 写。Kernel failure path 在 ingest partial assistant 之后统一写 lifecycle `error`。

### Coordinator Follow-Up Hook

这不是 Run Kernel hook，而是 Coordinator 内置策略。

职责：

- running 时把新的 `prompt` / `followup` 放入 follow-up queue。
- 当前 run completed 后，取下一条 follow-up 启动新的 Run Kernel。
- waiting run 不自动消费 follow-up。
- error / aborted / interrupted run 不自动消费 follow-up；queue 保留但进入 paused 状态，等待用户显式继续、清空或丢弃。
- terminal error / aborted / interrupted 必须清空或标记 failed pending steer queue，因为 steer 只属于当前 active invocation。
- abort 时可按请求决定是否清空 follow-up queue；如果不清空，也必须处于 paused 状态。

### Legacy Ingest Removal

旧 `profile.ingest()` 不保留兼容层。新架构硬切后：

- profile 作者不再实现 invocation-level `ingest()`。
- 普通 transcript 持久化由默认 Turn Ingest Hook 完成。
- title/summary 由普通 summarizer profile 通过 runtime hooks 完成。
- 需要额外 session update 的系统能力必须做成内置 hook、tool-side write 或明确的 profile runtime hook。

## Summarizer Flow

```text
source invocation completed
  -> background trigger
  -> ensure hidden summarizer session
  -> create internal RunFrame for summarizer profile
  -> runtime hooks keep transcript runtime-only after HistorySet initialization
  -> sourceSessionId comes from summarizer profile input
  -> buildModelContext from source session Agent Dialogue Content
  -> AppendingSet is empty
  -> provider sees summarizer system prompt + source dialogue content
  -> assistant calls report_result
  -> toolResult closes call in runtime
  -> ingestTurn skips summarizer transcript persistence
  -> settleRun rechecks source active leaf
  -> if unchanged, writes title/summary projection to source session
  -> if changed, marks dirty and skips stale write
```

关键语义：

- source profile / source invocation 对 summarizer 透明、无感。
- summarizer 有 session 身份，也可以有 HistorySet 初始化历史，但运行中的 assistant/toolResult 不 append 到 session。
- summarizer session 的 leaf 只会因 HistorySet 初始化等少数初始化写入移动；摘要运行本身不通过 transcript append 推进 leaf，所以表现近似一条固定初始化线。
- summarizer ModelContext 只由自身 system prompt 和 source Agent Dialogue Content 组成。
- source title/summary 写回 source session。
- branch/tree 切换后每次按当前 active path 重新构建 Agent Dialogue Content。
- 如果 Agent Dialogue Content 超过 summarizer 上限，跳过本次摘要并记录状态，不自动 compact summarizer。

## Implementation Plan

### Phase 1: Write Plan Foundation

- 引入 ordered-op 形态的 `SessionWritePlan` / `SessionWriteExecutor`：`target + cause + durability + ops[]`。
- 删除 public `workspaceKey` target；`SessionWritePlan.target` 只接受当前 session store 内的 `sessionId`。
- 调整 session 文件布局，不再按 workspace/project 分目录：`.nbook/agent/sessions/<session-id>.jsonl`。
- public write plan 不暴露 `atomicity` / `publish`；executor 内部负责先整批校验、按 `ops[]` 顺序 append、统一 publish。
- 引入 `ToolSessionWriteSink`，让工具执行期间的 custom state / variable writes 也经过 executor。
- 硬删 legacy `profile.ingest()` 调用路径，直接切到新的 runtime hook / turn ingest 语义；当前是开发版，不保留中间兼容层。
- 迁移 `commitTurn()`、summary projection 写回和工具侧 session writes。
- 明确 projection entries 不进入 tree、不移动 active leaf。
- 扩展 session message entry metadata，支持 partial/interrupted/error message state。
- 扩展 lifecycle status，支持 `waiting` / `resumed` / `interrupted`。
- 扩展 snapshot DTO，`followUpQueue` 从裸数组升级为 `{status, pausedBy, items}`。
- 验证：
  - 普通 turn assistant/toolResult 顺序不变。
  - projection 不污染 tree。
  - 旧 `profile.ingest()` 不再被调用。
  - task/plot/variable 这类工具侧状态写入仍能实时刷新 UI。
  - write plan 必须显式 target/cause，缺失时 executor 拒绝执行。
  - write plan `ops[]` 顺序就是 append 顺序。
  - public write plan 不出现 `workspaceKey` / `atomicity` / `publish`。
  - session repo 能用当前 session store 内的 `sessionId` 定位 `.nbook/agent/sessions/<session-id>.jsonl`。
  - partial assistant metadata 能从 session snapshot 和 `session_entry` 增量稳定投影到前端。
  - paused follow-up queue 能通过 snapshot 恢复。

### Phase 2: RunFrame + TurnSnapshot

- 在 `invokeAgent()` 创建 `RunFrame`。
- 在每轮模型请求前创建 `TurnSnapshot`。
- `runLoop()` 改为操作 frame/turn outcome，而不是散落参数。
- 引入 `TurnOutcome`：`executeTurn` 必须返回 completed、waiting 或 failed partial output，不能把 provider/tool failure 伪装成成功 `RuntimeTurn`。
- 验证：
  - steer/followUp 不回归。
  - approval waiting 不回归。
  - report_result 不回归。
  - provider request error before stream 不写空 assistant。
  - provider stream partial failure 产出 sanitized partial assistant，并剥离 tool calls。

### Phase 3: Built-in Hook Runtime

- 实现最小 hook runner 和 reducer。
- 首发注册内置 hooks，并开放固定事务边界的 profile `runtime: { hooks }`。
- custom hook 第一版可以 patch `tools` / `requestOptions`，但仍不开放直接 provider/tool runtime 调用；所有 patch 由 Run Kernel reducer 统一规范化。
- 实现 Kernel 统一 failure path：stage error / failed `TurnOutcome` 统一规范化为 `InvocationErrorInfo`，先让 error-aware `ingestTurn` 处理 partial assistant，再写 lifecycle `error`，最后进入 cleanup。
- 默认普通 profile 使用：
  - default persistence hook。
  - runtime context hook。
  - compact hook。
  - queue hook。
  - report result hook。
  - turn ingest hook。
- report_result reminder 从 `settleRun` 迁到 `shouldStop -> prepareNextTurn`。
- `settleRun` 只处理 completed / waiting 的正常收尾；error terminal lifecycle 不由 `settleRun` 写。
- 验证普通 profile 行为与当前一致。
  - `ingestTurn` 能处理 failed `TurnOutcome`，保存 partial assistant 但不保存未闭合 tool calls。
  - terminal error/aborted/interrupted 后清理 steer queue，并暂停 follow-up queue。

### Phase 4: Summarizer Readiness

18 不直接落地 summarizer。用户已确认 `docs/tasks/17-session-title-summary-enhancement/README.md` 等 18 完整重构后重新计划；因此 18 的责任是提供足够表达 summarizer 的普通 profile runtime 能力，并删除旧 hard-coded summarizer 自动运行路径。

18 完成时应具备：

- custom profile 可以通过 `runtime: { hooks }` 注入 runtime-only source Agent Dialogue Content。
- custom profile 可以通过 `ingestTurn` 返回 `runtime_only`，让 assistant/toolResult 不写入自身 session history。
- custom profile 可以在 `settleRun` 读取 `reportResult`，并通过 `SessionWritePlan` 写 source session projection。
- hook context 暴露 `ctx.session.read()` 和 `ctx.session.agentDialogueContent()`，profile 作者不直接拼 active path。
- `RunFrame` 不出现 hard-coded source / binding 字段，summarizer 关系后续继续由 profile input 和 ctx 表达。
- 旧 hard-coded `session.summarizer` 自动运行路径已删除。

17 重新计划时再决定：

- 是否把 profile key 从 `session.summarizer` 改成 `summarizer`。
- summarizer session 的创建、trigger、coalescing、stale source leaf 校验。
- source title/summary 的 active-path-specific projection scope。
- summarizer prompt、InputSchema、OutputSchema 和 `report_result` 数据结构。

### Phase 5: Compact Save Point

- 把 `compactIfNeeded()` 从 pre-loop 硬编码迁入 compact hook，并直接在 save point / `prepareNextTurn` 生效。
- 验证：
  - compact 后 context 从 session truth 重建。
  - long session 仍能继续。
  - summarizer 不做自身 compact。

### Phase 6: Public Profile Runtime Hooks

第一版需要给 `defineAgentProfile` 暴露足够表达 summarizer 的 runtime hook 组合；后续再按真实需求增加更细 hook。

### Phase 7: SSE Epoch / Snapshot Recovery

目标：修复“前端 Agent 运行中后端 dev reload 后无法 continue”的系统性恢复问题。

实施切片：

- DTO：
  - `AgentSessionEventDto` 增加 `eventEpoch: string`。
  - `AgentSessionSnapshotDto` 增加 `eventEpoch: string`，继续保留 `lastSeq`。
  - `AgentSessionEventsQueryDtoSchema` 增加 `eventEpoch?: string`。
  - `connected` control event 明确作为 handshake，包含当前 `eventEpoch` 和 `latestSeq`。
- EventHub：
  - `AgentSessionEventHub` 构造时生成进程内 `eventEpoch`。
  - `publish()` 给所有事件加当前 epoch。
  - `subscribe()` 接收 `{eventEpoch?, after?}` cursor。
  - 同 epoch 才 replay。
  - `after < firstSeq - 1` 返回 `snapshot_required("event replay buffer expired")`。
  - `after > lastSeq` 返回 `snapshot_required("event cursor is ahead of server")`。
  - epoch mismatch 不 replay buffer，让 connected handshake 驱动前端 snapshot recovery。
- HTTP SSE route：
  - `/api/agent/sessions/:id/events` 不再自己伪造 `seq = query.after ?? 0` 的 connected。
  - connected handshake 由 EventHub 当前 cursor 生成。
  - query 透传 `eventEpoch` + `after`。
- Snapshot：
  - `getSessionSnapshot()` 返回当前 EventHub `eventEpoch` 和 `lastSeq`。
  - snapshot 是 cursor 真相；事件只是增量优化。
- Frontend session store：
  - `useAgentSession` 保存 `eventEpoch`。
  - `connected` 在普通 seq 过滤之前处理。
  - epoch mismatch 时标记 `needsSnapshot("event_epoch_changed")`。
  - `applySnapshot()` 在 epoch 不同时允许 `lastSeq` 回退到 snapshot `lastSeq`；同 epoch 时可以继续 `Math.max()`。
  - snapshot 成功后清空旧 live runtime 状态，以 snapshot 的 `activeInvocation` / `pendingApproval` 重建 UI。
- Frontend stream manager：
  - `subscribeSessionEvents()` 传 `eventEpoch` 和 `lastSeq`。
  - snapshot single-flight 继续保留。
  - reconnect 后如果服务端 epoch 已变，先 snapshot 再继续使用新 cursor。

验证：

- EventHub 单测：
  - publish event 带稳定 epoch。
  - same epoch + after replay 正常。
  - same epoch + after 太旧触发 snapshot_required。
  - same epoch + after 大于 lastSeq 触发 snapshot_required。
  - different epoch 不 replay 当前 buffer。
- Frontend store 单测：
  - 本地 `(epoch=A, lastSeq=426)` 收到 connected `(epoch=B, latestSeq=0)` 后请求 snapshot。
  - 应用 snapshot `(epoch=B, lastSeq=0)` 后 lastSeq 允许从 426 回退到 0。
  - 同 epoch snapshot 仍不让 lastSeq 被旧 snapshot 回退。
  - connected 不再只是更新 connectionStatus。
- Stream manager 单测：
  - reconnect 时传 cursor。
  - epoch mismatch 后只拉一次 snapshot。
  - snapshot 完成后下一次 subscribe 使用新 epoch / new lastSeq。

不做：

- 不恢复 reload 前正在进行的 provider stream / tool promise。
- 不把 EventHub replay 做成持久日志。
- 不支持跨进程实时 fan-out；多实例第一版仍靠 snapshot 恢复。

### Phase 8: Waiting Hydration / Resume After Reload

目标：后端 reload 后，session 已经停在 approval / user input waiting 时，前端能恢复 waiting UI，并且 `continue(resolution)` 能继续同一个 logical invocation。

实施切片：

- Session reducer / snapshot helper：
  - 从 active path messages 继续推导 `pendingApproval`。
  - 新增 helper 从 active path lifecycle entries 中找到 pending approval 对应的最近 waiting lifecycle。
  - `getSessionSnapshot()` 在 `activeInvocations` 内存 map 缺失时，用上述 helper hydrate `activeInvocation.status = "waiting"`。
- Invocation Coordinator admission：
  - `continue(resolution)` 不能只检查内存 `activeInvocations`。
  - 内存缺失但 session 可 hydrate waiting 时，接受为 resume。
  - resume 使用 hydrated `invocationId`，写 `resumed` lifecycle，不创建新用户可见 invocation。
- prepareRun：
  - resolution restore 仍然第一步写 resolution toolResult。
  - 写完 resolution 后重新 reduce session snapshot，再执行 profile prepare / hooks。
- abort：
  - reload 后 waiting abort 只能关闭 pending approval：写 harness error toolResult + `aborted` lifecycle。
  - 不假装能 abort 已丢失的 provider/tool 执行。
- Frontend：
  - snapshot 中只要有 hydrated waiting activeInvocation + pendingApproval，就进入 `waiting_user`。
  - 新请求 accepted 后旧 ErrorBubble / stale live state 由 snapshot projection 重新计算。

验证：

- Harness 单测：
  - 构造 waiting session，丢弃旧 harness，新建 harness 后 `getSessionSnapshot()` 仍返回 `pendingApproval` 和 waiting `activeInvocation`。
  - 新 harness 对同一 session 执行 `continue(resolution)`，写入同一 `invocationId` 的 `resumed` lifecycle。
  - resolution toolResult 仍先于 continue prepare appending messages。
  - 找不到 reliable invocationId 时，`continue(resolution)` 返回结构化 admission error。
- Frontend 单测：
  - snapshot hydrated waiting 后 composer 展示 approval / user input UI。
  - connected epoch mismatch + hydrated waiting snapshot 后，running 卡死状态被覆盖为 waiting_user。

不做：

- 不把普通 running invocation hydrate 成 running；reload 前正在 stream 的内容只能通过已 durable 写入的 partial assistant / lifecycle error 或用户手动继续处理。
- 不在 server restart 后自动 drain ready follow-up queue。
- 不恢复内存 steer queue，除非后续把它也设计成 durable projection。

### Phase 9: Parallel Tool Batch Scheduler

目标：让同一 turn 内安全的工具可以并行执行，先解决多个 `invoke_agent` 串行阻塞父 agent 的问题，同时保持 approval、toolResult 顺序、savePoint 写入顺序和副作用资源互斥。

实施切片：

- Tool type：
  - `NeuroAgentTool` 增加可选 `executionMode?: "sequential" | "parallel"`，与 PI `AgentTool.executionMode` 对齐。
  - harness 默认 `toolExecution = "parallel"`；调试或测试可强制 `"sequential"`。
  - 未声明 `executionMode` 的工具使用 harness 默认值。
- Scheduler：
  - 新增 `executeToolSegment()` helper，保持在 `executeTurn` 内部，不变成 public hook stage。
  - 输入是非 barrier 的连续 tool call segment。
  - 输出包含按原始 index 排序的 `toolResults`、`reportResult`、`shouldContinue` 和结构化 execution records。
  - segment 内先按原始顺序 prepare / validate / permission / beforeToolCall。
  - 如果 harness 全局 sequential，或 segment 内任意工具 `executionMode === "sequential"`，整段串行执行。
  - 否则 allowed prepared calls 并行执行。
  - scheduler 负责 `tool_execution_start/end` 事件；`tool_execution_end` 可按真实完成顺序发布；最终 `message_start/end` for toolResult 仍按原始 tool call 顺序发布，避免前端 transcript block 顺序抖动。
- Approval split：
  - `runToolBatch()` 先扫描 approval barrier。
  - approval 前 segment 交给 scheduler。
  - approval 自己进入 waiting。
  - approval 后 tool call 生成 skipped result，不执行。
- Report result terminal：
  - 第一版把 `report_result` 当 terminal barrier。
  - `report_result` 前面的 segment 先完成。
  - `report_result` 自己执行后，后续 tool call skipped，避免最终结果和后续 mutation 并发。
- SavePoint writes：
  - `RunFrame.pendingWritePlans` 从 `SessionWritePlan[]` 升级成带 `toolCallIndex` / `toolCallId` / enqueue order 的结构，或者新增单独 `pendingToolWritePlans`。
  - `ToolSessionWriteSink` 构造时接收当前 tool call index。
  - `ingestTurn` flush 前按 `toolCallIndex asc, enqueueOrder asc` 排序。
- Tool-internal queues：
  - 新增 `withFileMutationQueue(filePath, fn)`，参考 PI coding-agent，同文件 mutation 串行，不同文件可并行。
  - 新增 `withVariablePatchQueue(namespace, path, fn)`，保护同变量 path 的 read-before-patch / patch 顺序。
  - 新增 `withSessionStateQueue(sessionId, key, fn)`，保护 `agent.tasks`、`plot.selection` 这类 custom state read-modify-write。
  - 新增 `withProjectDbMutationQueue(projectPath, fn)`，保护 Project SQLite mutation。
  - 不为 `invoke_agent` 增加 `withTargetSessionInvocationQueue()`。同 target session 并发继续进入目标 session 的 Invocation Coordinator：`prompt + message` 会按现有规则排入 follow-up，`continue` 冲突会按现有规则报错。
- First enabled tools：
  - `invoke_agent`：默认 parallel，保留 self-invoke guard。
  - `read`：默认 parallel。
  - `web_search` / `web_fetch`：默认 parallel；后续可加 provider-level limiter。
  - `get_agent` / `get_session` / `get_agent_profile`：默认 parallel。
  - `write` / `edit` / `apply_patch`：如果补齐 file mutation queue，可保持 parallel；否则先声明 sequential。
  - `create_agent`、`detach_agent`、`variable_patch`、task、plot、SQL、bash：第一版声明 sequential，后续只有在对应内部 queue 补齐并有实际性能收益时再放开。

验证：

- 父 agent 同一 turn 调两个不同 child `invoke_agent` 时并行执行，父 session toolResult 顺序仍按 tool call 顺序。
- 同一 target session 的两个 `invoke_agent` 不会绕过目标 session admission；`prompt + message` 冲突按 follow-up queue 处理，`continue` 冲突按现有错误处理。
- approval barrier 后的工具不启动；skipped result 顺序稳定。
- `report_result` 后的工具不执行，或至少不和 mutation 并发。
- savePoint writes 在并行完成顺序反转时仍按 tool call index flush。
- immediate writes 可以按真实时间发布，但 snapshot 最终一致。
- file write 同路径互斥；bash 默认 workspace exclusive。
- variable_patch 同路径互斥，read-before-patch fingerprint 不被并发破坏。
- abort 并行工具批次时，没有 tool call 永久悬空。

不做：

- 不开放 profile/runtime hook 改写工具并发策略。
- 不做全局 durable worker pool。
- 不做通用 resource lock provider；第一版危险资源由具体工具内部 queue 保护。
- 不承诺跨进程工具并发锁；第一版 queue 只保护当前 Node 进程内的同一 server。
- 不自动推断 bash 或任意 shell command 的读写资源。

### `defineAgentProfile` Target API

现有 `context()` / `prepare()` 继续保留，用于普通 profile 的 system prompt、HistorySet、AppendingSet、ModelContext 和 stateWrites。新增单一 `runtime` 字段；hook 只出现在 `runtime: { hooks }` 内，不在 `defineAgentProfile` 顶层再放一份 `hooks`。

默认普通 profile 不写 `runtime` 时，等价于使用 `builtins.defaultSessionRuntime()`。自定义 profile 可以组合 built-in hooks 和自定义 hooks。`defineAgentProfile()` 会统一规范化 `runtime`；`defineAgentRuntime()` 只是给可复用 runtime hook bundle 使用的 helper，不是新的 agent，也不创建新的 session。

```ts
export default defineAgentProfile({
    manifest: {
        key: "summarizer",
        name: "Session Summarizer",
    },
    inputSchema: SessionSummarizerInputSchema,
    outputSchema: SessionSummarizerOutputSchema,
    allowedToolKeys: ["report_result"],

    context(ctx) {
        return (
            <ProfilePrompt>
                <System>...</System>
                <HistorySet>
                    <Message role="user">...</Message>
                </HistorySet>
            </ProfilePrompt>
        );
    },

    runtime: {
        hooks: [
            builtins.profilePrompt(),
            builtins.reportResult({required: true}),
            hooks.prepareTurn("source-dialogue-context", async (ctx) => {
                const source = await ctx.session.read(ctx.input.sourceSessionId);
                const dialogue = await ctx.session.agentDialogueContent({
                    snapshot: source.snapshot,
                    input: ctx.input,
                });

                if (dialogue.tokens > ctx.input.maxDialogueContentTokens) {
                    return {
                        writePlans: [{
                            target: {sessionId: ctx.input.sourceSessionId},
                            cause: "summarizer.tooLarge",
                            ops: [{
                                kind: "append",
                                projection: true,
                                entry: {
                                    type: "custom",
                                    key: "summarizer.state",
                                    value: {lastError: "source dialogue content exceeds limit"},
                                },
                            }],
                        }],
                    };
                }

                return {
                    runtimeMessages: [
                        createUserMessage({text: dialogue.text}),
                    ],
                    runtimeState: {
                        sourceLeafId: source.snapshot.leafId,
                        dialogueContentTokens: dialogue.tokens,
                        dialogueContentFingerprint: dialogue.fingerprint,
                    },
                };
            }),
            hooks.ingestTurn("runtime-only-transcript", () => ({
                transcript: "runtime_only",
            })),
            hooks.settleRun("write-source-summary", async (ctx) => {
                const report = ctx.reportResult?.data;
                if (!report) {
                    return {};
                }
                const source = await ctx.session.read(ctx.input.sourceSessionId);
                const sourceState = ctx.runtimeState;
                if (
                    typeof sourceState !== "object"
                    || !sourceState
                    || Array.isArray(sourceState)
                    || source.snapshot.leafId !== sourceState.sourceLeafId
                ) {
                    return {
                        writePlans: [{
                            target: {sessionId: ctx.input.sourceSessionId},
                            cause: "summarizer.staleSource",
                            ops: [{
                                kind: "append",
                                projection: true,
                                entry: {
                                    type: "custom",
                                    key: "summarizer.state",
                                    value: {dirty: true},
                                },
                            }],
                        }],
                    };
                }
                return {
                    writePlans: [{
                        target: {sessionId: ctx.input.sourceSessionId},
                        cause: "summarizer.result",
                        ops: [{
                            kind: "append",
                            projection: true,
                            entry: {
                                type: "session_update",
                                updates: {
                                    title: report.title,
                                    summary: report.summary,
                                },
                            },
                        },
                        {
                            kind: "append",
                            projection: true,
                            entry: {
                                type: "custom",
                                key: "summarizer.state",
                                value: {
                                    dirty: false,
                                    lastDialogueContentFingerprint: sourceState.dialogueContentFingerprint,
                                },
                            },
                        }],
                    }],
                };
            }),
        ],
    },
});
```

类型真相源只保留在上文 **Hook Runtime** / **Hook Result** 章节。这里不再复制一份 `AgentRuntimeHook` / `PrepareRunResult` / `IngestTurnResult`，避免示例附近的类型和 canonical hook contract 漂移。

约束：

- `defineAgentProfile` 顶层不提供 `hooks` 字段，避免和 runtime hooks 形成双控制面。
- `defineAgentRuntime()` 只负责规范化 hooks、校验 hook name/stage、展开 built-in hook bundle。
- 普通 profile 默认 runtime 是 `builtins.defaultSessionRuntime()`，包含 profile prompt、session context、transcript persistence、compact、queue、approval、report_result optional 等默认行为。
- 自定义 runtime 写了 hooks 后，不会自动注入默认 session context 或默认 transcript persistence；需要哪些行为就显式组合哪些 built-in hook。
- custom profile hook 第一批实现允许返回 `turnSnapshotPatch.toolKeys` / `turnSnapshotPatch.requestOptions`。Run Kernel reducer 仍负责最终工具策略、report_result schema、approval barrier 和 provider request 规范化，hook 不能直接调用 provider 或 tool runtime。
- summarizer 不暴露“history mode”或“context mode”这类 enum。它的“运行 transcript 不落盘”表现来自 hook 组合：不组合 session context，不组合 transcript persistence，`ingestTurn` 返回 runtime-only，`settleRun` 写 source projection。
- hook context 暴露 `ctx.session.read()` 和 `ctx.session.agentDialogueContent()` helper；profile 作者不直接拼 active path。
- hook 只能返回 slot result 和 `SessionWritePlan` draft，不能 append repo、publish event、启动 invocation。
- `context()` / `prepare()` 仍只负责 profile prompt DSL；不要把 hook 能力塞进 TSX 节点里。
- `builtins.reportResult({required: true})` 要求 profile `allowedToolKeys` 包含 `report_result`。
- hook 的 `runtimeState` 是 RunFrame scoped、profile 私有、按 hook namespace 隔离，只在一次 invocation 内传递给后续 hook，不写 session。

## Decisions

- 不直接采用 PI `AgentHarness`，继续维护 Neuro Book 自己的 harness。
- 借鉴 PI 的 turn snapshot、save point、pending writes、hook reducer 思路。
- 不把所有功能都做成 pipeline stage；pipeline 是 run/turn 事务边界，功能是内置 hook。
- hook 不直接做副作用，只返回 plan。
- `ingest` 的新语义是 turn-level ingest，能控制每一个 ReAct turn。
- 旧 `profile.ingest()` 硬删，不保留 after-run 兼容层。
- `summarizer` 是第一个强需求消费者，但不是唯一目标；18 先提供 runtime hook 能力，具体 summarizer 落地回到 17 重新计划。
- `RunFrame` 不设置 hard-coded `source` 或 `RuntimeBinding` 字段；跨 session 依赖先通过 profile input / ctx 表达，等出现第二类真实需求后再抽象。
- Run Kernel 固定为 `enterRun -> prepareRun -> runTurns -> settleRun -> cleanup` 五个事务边界。
- `SessionWriteExecutor` 是各安全点调用的服务，不作为独立 pipeline stage。
- `ToolSessionWriteSink` 是工具执行期间的写入入口，不作为独立 pipeline stage，内部仍调用 `SessionWriteExecutor`。
- 第一阶段开放足够表达 summarizer 的 profile `runtime: { hooks }`；summarizer 不能作为 Run Kernel 硬编码特例。
- `SessionWritePlan` 使用 ordered ops 形态：`target + cause + durability + ops[]`。
- `SessionWritePlan.target` / `cause` 必填，跨 session 写入是第一等能力；target 只包含当前 session store 内的 `sessionId`，不包含 `workspaceKey`。第一批实现的 `cause` 是短字符串，后续如诊断需要再升级为结构化 cause。
- session 文件布局硬切为 `.nbook/agent/sessions/<session-id>.jsonl`，不再按 workspace/project 分目录。
- public write plan 不暴露 `atomicity` / `publish`；executor 根据 `ops[]` 统一校验、按顺序 append、统一发布事件。
- report_result retry 属于 `shouldStop -> prepareNextTurn`，不是 `settleRun` 的职责。
- lifecycle waiting 是显式持久状态，不再用重复 `start` 表示。
- approval / user-input resume 复用同一个用户可见 logical `invocationId`；内部 trace 如需拆分执行片段，再加 `attemptId`。
- `executeTurn` 必须产出 `TurnOutcome`，覆盖 completed、waiting 和 failed partial output；provider stream 中途失败时，partial assistant 可以保存，但必须剥离未闭合 tool calls。
- `TurnOutcome` 拆成 `SuccessfulTurnOutcome | FailedTurnOutcome`；`shouldStop` / `prepareNextTurn` 只接收 `SuccessfulTurnOutcome`。
- partial assistant 通过 message entry metadata 持久表达，不靠 lifecycle error 反推。
- `ingestTurn` 必须 error-aware；它不只处理成功 transcript，也负责 partial assistant 持久化、runtime-only transcript、drop tool calls 等 turn output 策略。
- Run Kernel 需要统一 failure path：stage error / failed `TurnOutcome` 规范化为 `InvocationErrorInfo`，先通过 error-aware `ingestTurn` 处理 partial assistant，再尽力写 lifecycle `error`，最后进入 cleanup。
- `settleRun` 只负责 completed / waiting 的正常收尾；error terminal lifecycle 不由 `settleRun` 写。
- Coordinator 的 terminal queue policy 固定为：completed 后可自动 drain follow-up；waiting 不 drain；error/aborted/interrupted 清理 steer 并暂停 follow-up。
- follow-up queue 在公共 snapshot DTO 中使用对象形态 `{status, pausedBy, items}`，不是裸数组。
- hook `runtimeState` 必须按 hook namespace 隔离，不能共用裸 `JsonObject`。
- custom profile hook 第一版允许 patch `tools` / `requestOptions`；最终工具策略和 provider request 规范化仍由 Run Kernel reducer 执行。
- 第一版不做 deterministic entry id、durable pending queue、batch commit marker；同 session batch 只承诺先整批校验、顺序 append、统一 publish。
- 第一批实现里 projection op 暂用 `append + projection: true`，不是独立 `op.kind = "projection"`。如果 active-path-specific projection 需要强类型 scope，留到 17 summarizer 重做时一起升级。
- 工具并行不作为新的 public hook stage；它是 `executeTurn` 内部的 tool batch scheduler。并行能力通过 PI 风格 `executionMode?: "sequential" | "parallel"` 表达，默认 parallel；危险副作用由具体工具内部 queue 保护。
- 第一版工具并行只优先放开显著影响性能的慢工具和纯读工具：`invoke_agent`、`read`、`web_search`、`web_fetch`、`get_agent`、`get_session`、`get_agent_profile`。`sql`、mutation、task、plot、变量 patch、bash 等先 sequential。
- 同一非 barrier segment 内只要混入 sequential tool，整个 segment 串行；第一版不做更细的 segment 内二次切分。
- 同 target session 的并行 `invoke_agent` 不由 tool scheduler 特判，继续走目标 session admission：`prompt + message` 可入 follow-up queue，`continue` 冲突按现有错误返回。
- 并行工具的 `toolResults` 和 savePoint writes 必须按 assistant tool call 原始顺序归并；实时 `tool_execution_*` 事件可以按真实完成时间发布。

## Open Questions

- 暂无必须阻塞 18 第一版实现的架构 open question；后续 semi-durable recovery 另开任务设计。

## Walkthrough

- 2026-05-28：基于 summarizer 设计讨论，确认现有 `ingest()` 不足以表达每 turn 行为控制。
- 2026-05-28：创建新的 active task，用于沉淀 runtime pipeline / hooks 架构，不立即改代码。
- 2026-05-28：补充当前 `NeuroAgentHarness` 的完整 pipeline 分解。确认当前项目没有直接使用 PI `AgentHarness`，而是自研 harness 复用 PI message/event/tool/provider 类型。
- 2026-05-28：重新阅读 PI `AgentHarness` lifecycle、durable harness、hooks、low-level loop 源码，决定从“20 个 pipeline stage”收敛为 “Invocation Kernel + Built-in Hooks” 设计。
- 2026-05-28：进一步降低复杂度，把设计收敛为 run/turn 两级事务边界；确认新 ingest 语义应控制每一个 ReAct turn。
- 2026-05-28：用户确认删除 `RuntimeBinding`。summarizer 的 source session 关系继续由 `defineAgentProfile.summarizer` 初始化 input 和 summarizer profile 的 ctx/input 读取表达。
- 2026-05-28：用户确认当前 Run Kernel / Turn Transaction 取舍可接受。Run Kernel 保留五个 stage；`flushWrites` 不作为 stage，`SessionWriteExecutor` 作为服务在安全点调用。
- 2026-05-28：审查当前 `NeuroAgentHarness` 的现有能力，补充 Session Control Plane、Invocation Coordinator、Run Kernel、Tool / Variable Runtime 四层能力清单，并确认不需要推翻新架构；需要新增的是 `ToolSessionWriteSink` 这类服务边界，不是更多 pipeline stage。
- 2026-05-28：按开发版硬切原则收紧合同：硬删 legacy `profile.ingest()`，write plan 必须显式 target/cause，hook 只能返回 plan，report_result retry 移到 `shouldStop -> prepareNextTurn`，tool-side writes 区分 `immediate` / `savePoint` durability，summarizer 写回前校验 source active leaf。
- 2026-05-28：用户确认 summarizer ModelContext 由自身 system prompt 和 source Agent Dialogue Content 组成；AppendingSet 为空，工具和 ReAct 过程中生成的消息都不进入 summarizer 历史；source title/summary 绑定 source active leaf。
- 2026-05-28：同步 17 的最新决策：summarizer 不限定 leader，所有 profile 可启用；source 关系通过 profile input / ctx 表达，不引入 `RuntimeBinding`；waiting/resume 使用同一个用户可见 logical `invocationId`，内部追踪可另加 `attemptId`。
- 2026-05-28：用户确认删除 `AgentProfileRuntimePolicy` / `history: "persistent" | "history_frozen"` 这类双控制面。profile 只通过 `runtime: { hooks }` 组合 built-in hooks 和自定义 hooks；summarizer 的运行 transcript 不落盘由 hook 组合表达，不作为 public enum。
- 2026-05-28：用户确认第一版不做 batch commit marker。deterministic entry id、durable pending queue、commit marker 都推迟到后续 semi-durable recovery 任务；18 第一版只做先校验后顺序 append。
- 2026-05-28：用户提出用黑盒 + 状态机方法重新约束 Harness 设计。新增 Harness black-box contract：以 `prompt` / `continue` / `steer` / `followup` 为输入，按 `Idle` / `Running` / `WaitingUser` / `Aborting` 列出 session writes、SSE events、HTTP response 和 frontend state 结果，再反推内部 pipeline。
- 2026-05-29：根据黑盒操作矩阵和错误矩阵反推 pipeline，确认 18 架构不需要推翻；补充 Operation Matrix To Pipeline、Error Matrix To Pipeline、`TurnOutcome`、error-aware `ingestTurn`、统一 failure path 和 terminal queue policy。
- 2026-05-29：整体审查 README 后同步类型/API 草案：`RuntimeTurn` 只表示合法 turn shape，`executeTurn` 输出 `TurnOutcome`，`ingestTurn` 消费 `TurnOutcome`，`settleRun` 不负责 error lifecycle。
- 2026-05-29：用户确认工程设计决策：partial assistant 写 message metadata；hook runtimeState 命名空间隔离；custom hook 直接开放 toolKeys/requestOptions patch；follow-up queue DTO 对象化；`TurnOutcome` 类型拆分；删除重复 hook 类型块；Phase 1 直接硬删 legacy ingest。
- 2026-05-29：用户确认 `SessionWritePlan.target` 删除 `workspaceKey`；session 文件不再按 workspace/project 分目录；WritePlan 收敛为 ordered ops，public plan 不暴露 `atomicity` / `publish`。
- 2026-05-29：实现第一批垂直切片。新增 `SessionWritePlan` / `SessionWriteExecutor`，session 文件布局扁平化，follow-up queue DTO 对象化，waiting/resume lifecycle 和 partial assistant metadata 落地，删除 active `profile.ingest()` 合同，移除旧 hard-coded summarizer 自动运行路径。
- 2026-05-29：接入最小 `defineAgentRuntime({ hooks })` runner。当前执行 `prepareRun`、`prepareTurn`、`ingestTurn`，支持 hook 返回 `SessionWritePlan[]`、hook namespace runtimeState、以及 requestOptions/toolKeys patch。普通 profile 默认 runtime 仍为空 hook bundle，旧 loop 继续提供默认行为。
- 2026-05-29：把 resolution、steer drain、plan/model/thinking/archive command、report_result reminder、compact lifecycle 等明显写入迁移到 `SessionWriteExecutor`。仍保留部分 repo append 直连，等待后续 ToolSessionWriteSink / RunFrame 重构收敛。
- 2026-05-29：新增 `ToolSessionWriteSink` 第一版，并继续迁移 harness active 写入路径：parent agent link、tool custom state、profile prepare 的 custom message/stateWrites、variable patch audit、client variable ack、自动/手动 compaction entry 均通过 executor 发布 entry/state。变量 accessor 和 compaction 模块保留无 sink fallback 以支持底层单元测试和独立调用。
- 2026-05-29：落地 Phase 2 第一版。新增内部 `RunFrame`、`TurnSnapshot`、`RuntimeTurn`、`TurnOutcome` 类型；`runLoop()` 改为创建 frame，逐轮通过 `createTurnSnapshot()` 冻结 provider 请求材料，通过 `executeTurn()` 返回 completed/waiting/failed outcome，再交给 `ingestTurn()` 持久化。provider error/aborted 现在走 failed outcome 分支，partial assistant 仍按原规则 sanitized 后保存。
- 2026-05-29：迁移 report_result reminder retry。缺少必需 report_result 时不再由 `finalizeInvokeResult()` 递归调用 `runLoop()`；现在由 `resolveTurnContinuation()` / `prepareNextTurn()` 在同一个 `RunFrame` 内写入 reminder 并继续下一轮 turn。测试覆盖同一次 invocation 只有一个 `agent_start`、两个 `turn_start`。
- 2026-05-29：接入 `prepareNextTurn` runtime hook。`runLoop()` 在每轮 save point 后先归并 tool/steer/report_result 三类 continuation reason，再进入 `prepareNextTurn()`；custom hook 能在下一轮请求前读取 save point 后的 session context、写 `SessionWritePlan`、更新命名空间 runtimeState，并影响下一轮 `prepareTurn`。
- 2026-05-29：接入 `settleRun` runtime hook。正常 completed / waiting run 会在 terminal lifecycle 写入前执行 `settleRun`，hook 能读取 `runResult.status`、`finalAssistant`、`reportResult`、`waiting` 并返回 write plans；error / aborted 不进入该 stage，继续由 Kernel failure path 统一写 lifecycle。
- 2026-05-29：接入 `ingestTurn` 的 `transcript: "runtime_only"` slot result。默认 transcript persistence 可被 hook 跳过，assistant/toolResult 仍保留在 `RunFrame` 供同 run continuation、`report_result` 和 `settleRun` 使用；waiting turn 直接拒绝 runtime-only transcript，避免 resolution 找不到 pending tool call。
- 2026-05-29：让 `report_result` reminder 遵守 runtime-only ingest。上一轮 transcript 为 `runtime_only` 时，reminder 只 append 到 `RunFrame.messages` 供下一轮 provider 使用，不写入 session history；普通 profile 仍保持原有持久化 reminder 行为。
- 2026-05-29：接入 `runtimeMessages` hook result。`prepareRun` 返回的 runtime-only messages 会进入首轮 provider context，`prepareNextTurn` 返回的 runtime-only messages 会进入下一轮 provider context；二者都不写 session history。
- 2026-05-29：接入 tool-side savePoint pending writes。`ToolSessionWriteSink.savePointAppend()` / `savePointCustomState()` 会把 plan 放入当前 `RunFrame.pendingWritePlans`，`commitTurn()` 把 transcript plan 和 pending savePoint plans 交给 executor 连续合并；`SessionWriteExecutor` 会把同 session 连续 savePoint plans 写成同一个 JSONL batch。
- 2026-05-29：迁移自动 compaction 时机。`compactIfNeeded()` 不再在 invoke pre-loop 执行，而是在成功 turn save point 后、确认还要继续下一轮时执行；compact 成功后 `RunFrame.messages` 从最新 session context 重建，下一轮 provider context 会使用 compact 后历史。
- 2026-05-29：补齐 runtime hook context 的第一版只读 `SessionFacade`。hook 现在能通过 typed `ctx.input` 读取 profile input，通过 `ctx.session.read()` 读取当前或其他 session，并通过 `ctx.session.agentDialogueContent()` 从 source session active path 构造 Agent Dialogue Content；写入仍只能返回 `SessionWritePlan`，不暴露 repo append / publish API。
- 2026-05-29：确认 `runtime: { hooks }` 直接放在 `defineAgentProfile({ inputSchema, ... })` 内时，hook 的 `ctx.input` 能从外层 TypeBox schema 自动推导；单独调用 `defineAgentRuntime()` 定义 reusable runtime bundle 时需要显式泛型。`defineAgentProfile()` 现在会统一调用 `defineAgentRuntime()` 规范化 runtime。
- 2026-05-29：抽出第一版 Run Kernel 类型边界。新增 `server/agent/harness/run-kernel-types.ts`，集中声明 `RunFrame`、`TurnSnapshot`、`RuntimeTurn`、`TurnOutcome`、`TurnContinuationDecision`、hook execution input/result 和 `RunRuntimeState`；`NeuroAgentHarness` 暂时只改为引用这些类型，执行逻辑保持原样，为后续拆 reducer 做准备。
- 2026-05-29：抽出 turn continuation / shouldStop 第一层 reducer。新增 `server/agent/harness/turn-continuation.ts`，把 tool continuation、steer continuation、缺失 `report_result` reminder continuation 的纯判定从 `NeuroAgentHarness` 移出；harness 仍负责 drain steer queue、写 reminder message、compact 和执行 `prepareNextTurn` hook。
- 2026-05-29：抽出 failure path 的第一层纯 helper。新增 `server/agent/harness/turn-failure.ts`，集中处理 provider partial assistant sanitizer 和 runtime error assistant 构造；sanitizer 会剥离未闭合 tool calls，没有可展示文本时不写 partial assistant。
- 2026-05-29：抽出 RunFrame 状态写回 helper。新增 `server/agent/harness/run-frame-state.ts`，集中处理 successful turn / failed outcome 对 `finalAssistant`、`messages`、`reportResult`、`lastTurnIngest` 的内存写回；`NeuroAgentHarness.runLoop()` 保留事件、ingest、queue、next-turn 编排。
- 2026-05-29：抽出 prepare-next-turn reducer。新增 `server/agent/harness/prepare-next-turn.ts`，把 steered messages 和缺失 `report_result` reminder 对 `RunFrame` 的确定性写回从 `NeuroAgentHarness.prepareNextTurn()` 移出；普通 transcript 下返回 reminder `SessionWritePlan`，runtime-only transcript 下只写 RunFrame，不写 session history。
- 2026-05-29：继续收敛 failed turn 处理。`turn-failure.ts` 现在负责把 failed `TurnOutcome` 转成可选 partial assistant ingest 草案，并把 final assistant / ingest 状态归并为 RunFrame 可消费形状；`runLoop()` 不再直接拼 partial ingest 输入。
- 2026-05-29：修正 runtime hook state reducer。hook `runtimeState` 仍按 hook name namespace 隔离，同名 hook 跨 stage 返回对象时浅合并，非对象按后一次返回替换；新增覆盖 `prepareRun -> prepareNextTurn -> prepareTurn` 的测试。
- 2026-05-29：本轮 targeted 回归通过：`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-next-turn.test.ts --reporter=dot`，4 files / 74 tests passed。18 相关宽套件通过：15 files / 172 tests passed。
- 2026-05-29：贯穿 failed outcome 的结构化错误信息。`RunLoopResult` 现在是 `completed | waiting | failed` 判别联合，failed 分支携带 `InvocationErrorInfo`；provider request error 和 stream partial error 的 `errorInfo` 会进入 `InvokeAgentResult` 并用于 lifecycle `errorInfo` 写入，不再由 `finalAssistant.stopReason` 二次推断。
- 2026-05-29：本轮验证：`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/run-frame-state.test.ts --reporter=dot`，3 files / 70 tests passed；18 相关宽套件 `15 files / 172 tests passed`；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：继续收窄 failed run result 创建。`turn-failure.ts` 新增 `createFailedRunLoopResult()`，`runLoop()` 只保存 failed outcome 并在统一出口归并为 failed `RunLoopResult`；targeted 回归 `server/agent/harness/turn-failure.test.ts server/agent/harness/neuro-agent-harness.test.ts` 通过，2 files / 68 tests passed。
- 2026-05-29：新增 Run Kernel stage error phase 包装。`server/agent/harness/run-kernel-error.ts` 提供 `withRunKernelPhase()` / `toRunKernelErrorInfo()`，当前 `ingestTurn`、下一轮前 compaction、prepare-turn/prepare-next-turn hook 等 stage 抛错时会保留更准确的 `ingest` / `compaction` / `model` phase；runtime-only waiting 失败测试现在断言 `errorPhase: "ingest"`。targeted 回归 2 files / 65 tests passed，18 相关宽套件 16 files / 177 tests passed；`tsc --noEmit` 仍只剩既有 SillyTavern marker optional 错误。
- 2026-05-29：抽出 Turn Transaction outcome 应用。新增 `server/agent/harness/turn-transaction.ts`，把 successful / waiting / failed outcome 在 ingest 后如何写回 `RunFrame`、如何生成 waiting / failed run result 从 `NeuroAgentHarness.runLoop()` 移出；targeted 回归 2 files / 64 tests passed，18 相关宽套件 17 files / 180 tests passed；`tsc --noEmit` 仍只剩既有 SillyTavern marker optional 错误。
- 2026-05-29：落地内置 runtime bundle 的展开层。`defineAgentRuntime()` 现在接受 `AgentRuntimeBuiltin` 并展开为普通 hooks；`agentRuntimeBuiltins.defaultSessionRuntime()` 返回默认内置 hook 标记，`NeuroAgentHarness.runRuntimeHooks()` 先跳过这些标记 hook，保持现有默认行为不变。targeted 回归 `define-agent-runtime.test.ts` + harness 通过，18 相关宽套件 17 files / 181 tests passed；`tsc --noEmit` 仍只剩既有 SillyTavern marker optional 错误。
- 2026-05-29：迁入 `builtin.transcriptPersistence` 的第一段行为。该 built-in hook 现在会显式返回 `transcript: "persist"`，`runRuntimeHooks()` 会执行这个 built-in hook；runtime-only 自定义 hook 仍可覆盖默认 persist。targeted 回归 2 files / 65 tests passed，18 相关宽套件 17 files / 182 tests passed；`tsc --noEmit` 仍只剩既有 SillyTavern marker optional 错误。
- 2026-05-29：硬切 transcript persistence 的最后兜底。`commitTurn()` 不再在缺少 `ingestTurn` transcript result 时默认落盘；普通 profile 依赖默认 `builtin.transcriptPersistence` hook 显式持久化，自定义 runtime 如果不组合 `agentRuntimeBuiltins.sessionRuntime()` 或自定义 persist hook，则 assistant/toolResult 只保留在当前 `RunFrame`。本轮同步重编译 system/user `.compiled` profile artifact，避免覆盖 profile 继续加载旧 runtime helper。targeted 回归 `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，2 files / 66 tests passed。
- 2026-05-29：把 report_result reminder retry 挂到 `builtin.reportResult`。`RunFrame` 新增 `reportResultReminderEnabled`，由 profile runtime 是否组合 `builtin.reportResult` 决定；自定义 runtime 不组合默认 session runtime 时，不再因为 `allowedToolKeys` 包含 `report_result` 而自动追加 reminder。targeted 回归 `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，4 files / 75 tests passed；18 相关宽套件 17 files / 184 tests passed；`tsc --noEmit` 仍只剩既有 SillyTavern marker optional 错误。
- 2026-05-29：把 automatic compaction 挂到 `builtin.compact`。`RunFrame` 新增 `automaticCompactionEnabled`，由 profile runtime 是否组合 `builtin.compact` 决定；自定义 runtime 不组合默认 session runtime 时，不再因为 `prepare()` 返回 compaction plan 而自动压缩。targeted 回归 `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/compaction.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，7 files / 90 tests passed；18 相关宽套件 17 files / 185 tests passed；`tsc --noEmit` 仍只剩既有 SillyTavern marker optional 错误。
- 2026-05-29：把 profile system prompt 挂到 `builtin.profilePrompt`。该 built-in 在 `prepareRun` 显式返回 profile prompt 行为位；自定义 runtime 不组合默认 session runtime 时，`prepare()` 返回的 `systemPrompt` 不再进入 provider request，`getSessionSnapshot()` 也不展示未启用的 system prompt。同步修正 `runRuntimeHooks()` 没有 await `applyRuntimeHookResult()` 的顺序 bug，避免 hook write plans 变成失序后台副作用，并把 `builtinBehavior` 校验收紧为只能由 `hook.builtin === true` 的内置 hook 返回，不能靠 hook name 伪造。targeted 回归 `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts --reporter=dot`，6 files / 89 tests passed；18 相关宽套件 17 files / 189 tests passed；已重新执行 `bun scripts/profile.ts compile --all --system` 和 `bun scripts/profile.ts compile --all`；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：继续收紧 `builtin.sessionContext`。`prepare()` 现在接收 `sessionContextEnabled`，只有 profile runtime 组合 `builtin.sessionContext` 时才会把 `historyInitMessages`、`modelContextAppendingMessages`、`appendingMessages` 写入 session history；自定义 runtime 不组合该 built-in 时，这些 prepare context messages 不会再通过旧 prepare 路径隐式污染 session / provider context。`stateWrites` 仍保留为 profile 私有状态写入，不归入 session context 开关。targeted 回归 `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts --reporter=dot`，6 files / 90 tests passed；18 相关宽套件 17 files / 190 tests passed；已重新执行 `bun scripts/profile.ts compile --all --system` 和 `bun scripts/profile.ts compile --all`；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：继续削薄 `prepare()` 的职责边界。新增 `compilePrepareWritePlan()`，把 `ProfileTurnPlan` 中需要持久化的 `HistorySet` / `AppendingSet` / `stateWrites` 编译为 `SessionWritePlan`；`prepare()` 仍负责调用 profile 和执行 executor，但“产出 plan”和“执行写入”已经分开，后续 Default Persistence Hook 接管 `prepareRun` 写入会更直接。targeted 回归 6 files / 90 tests passed；18 相关宽套件 17 files / 190 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：把 `builtin.sessionContext` 从静态扫描推进为真正执行的 `prepareRun` built-in hook。该 hook 现在在 `prepareRun` 返回 `builtinBehavior.sessionContext`，`prepare()` 写入 gating 和 `modelContextMessages` 注入都读取 `prepareRunHooks.sessionContext`，不再靠 `hasBuiltinHook(profile, "builtin.sessionContext")` 静态扫描。targeted 回归 6 files / 91 tests passed；18 相关宽套件 17 files / 191 tests passed；已重新执行 `bun scripts/profile.ts compile --all --system` 和 `bun scripts/profile.ts compile --all`；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：把 automatic compaction 从 `RunFrame` 初始化时的静态 `hasBuiltinHook()` 扫描迁到 `prepareNextTurn` hook result。`builtin.compact` 现在作为可执行 `prepareNextTurn` built-in 返回 `builtinBehavior.automaticCompaction`；`prepareNextTurn()` 先运行 hook，读取 `nextTurnHooks.automaticCompaction` 后再执行 compact，并在 compact 后重建 `frame.messages`，最后追加 hook runtimeMessages。targeted 回归 7 files / 97 tests passed；18 相关宽套件 17 files / 192 tests passed；已重新执行 `bun scripts/profile.ts compile --all --system` 和 `bun scripts/profile.ts compile --all`；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：把 report_result reminder enablement 从 `RunFrame` 初始化时的静态 `hasBuiltinHook()` 扫描迁到 `prepareRun` hook result。`builtin.reportResult` 现在作为可执行 `prepareRun` built-in 返回 `builtinBehavior.reportResultReminder`；`invokeAgent()` 把 `prepareRunHooks.reportResultReminder` 传入 `RunFrame`，所以第一轮 turn 后的 continuation 判定已经由 hook result 决定，不再提前扫描 profile runtime。targeted 回归 `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，4 files / 84 tests passed。
- 2026-05-29：继续收紧 profile prepare 的持久化边界。`prepare()` 现在只返回 `{ plan, writePlan }`，不再自己执行 session 写入；`invokeAgent()` 在 `prepareRun` 阶段统一执行 `prepared.writePlan`。这保持现有 message 顺序不变，但把 profile prepare 计算和 Default Persistence 写入执行分开。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts --reporter=dot`，6 files / 93 tests passed。
- 2026-05-29：抽出 prepare-run reducer/helper。新增 `server/agent/harness/prepare-run.ts`，把 `compilePrepareRunWritePlan()` 和 profile state write 校验从 `NeuroAgentHarness` 移出；新增 `prepare-run.test.ts` 覆盖 sessionContext 开关、HistorySet/AppendingSet 编译、已有历史不重复初始化、非法 stateWrites 拒绝。targeted 回归 `bunx vitest run server/agent/harness/prepare-run.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，2 files / 72 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：把 `invokeAgent()` 内的 prepareRun 编排抽成私有 `prepareRun()` helper。该 helper 现在集中负责 resolution restore、prepareRun hooks、profile prepare、profile prepare write plan、pending prompt 写入、首轮模型上下文组装和首轮 RunFrame 输入返回；`invokeAgent()` 主流程进一步收敛为 Coordinator / prepareRun / runLoop / settleRun / cleanup。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/prepare-run.test.ts server/agent/profiles/define-agent-runtime.test.ts --reporter=dot`，3 files / 80 tests passed；18 相关宽套件 18 files / 197 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：把 accepted invocation 的 terminal 处理抽成 `completeInvocation()` / `failInvocation()`。正常 terminal 现在集中处理 `settleRun`、terminal lifecycle、follow-up pause/drain 和 active cleanup；异常 terminal 统一规范化 `InvocationErrorInfo`、写 `error/aborted` lifecycle、暂停 follow-up 并释放运行态。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/run-kernel-error.test.ts --reporter=dot`，3 files / 79 tests passed；18 相关宽套件 18 files / 197 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：把单轮 turn 的执行事务抽成 `runTurnTransaction()`。`runLoop()` 现在只负责 frame 初始化、循环终态和 `agent_start` / `agent_end`，每轮的 `turn_start`、pre-model steer drain、`TurnSnapshot` 创建、`executeTurn`、failed partial ingest、successful/waiting ingest、`turn_end`、continuation 和 `prepareNextTurn` 都收敛到一个内部事务 helper；`RunTurnTransactionResult` 类型进入 `run-kernel-types.ts`。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/run-frame-state.test.ts --reporter=dot`，4 files / 81 tests passed。
- 2026-05-29：把 active leaf 移动纳入 `SessionWritePlan`。新增 `SessionWriteOp.kind = "moveLeaf"`，retry/tree/empty 等用户可见控制面写入不再直连 `repo.moveLeaf()` 或手动 `publishSessionState()`，统一由 `SessionWriteExecutor` 写 leaf entry 并发布 `session_entry` / `session_state_changed`。targeted 回归 `bunx vitest run server/agent/session/write-plan.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，2 files / 73 tests passed。
- 2026-05-29：持久化 follow-up queue snapshot 状态。新增 `agent.followUpQueue` custom state key，enqueue/drain/pause 会通过 projection write 保存 `{status, pausedBy, items}`；`getSessionSnapshot()` 在内存 queue 不存在时可从 session projection 恢复 paused/ready queue。第一版只恢复 UI snapshot，不在 server restart 后自动 drain ready queue。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/session/write-plan.test.ts --reporter=dot`，2 files / 74 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：删除旧后端 slash command 模块。`server/agent/session/slash-commands.ts` 和 `server/agent/index.ts` 的对应导出已移除，避免保留一套绕过 `SessionWriteExecutor` 的 command/tree/retry 实现；正式 slash command 仍由前端识别后调用 HTTP command/tree 入口。
- 2026-05-29：硬切 compaction repo append fallback。`appendCompaction()` / `compactIfNeeded()` 现在必须接收 `writeCompactionEntry`，compaction 模块只负责生成 compaction entry，不再自行 `repo.appendEntry()`；active harness 继续通过 `ToolSessionWriteSink` 写入。targeted 回归 `bunx vitest run server/agent/harness/compaction.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，2 files / 75 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-29：标注 variable accessor 的 standalone fallback 边界。`variables/accessor.ts` 仍允许低层变量单元测试和独立调用在没有 harness writer 时直接 append audit entry，但注释明确 active harness 必须注入 `writeSessionEntry`，实际运行路径通过 `ToolSessionWriteSink` / `SessionWriteExecutor` 发布。
- 2026-05-29：固定 RunFrame 初始化合同。新增 `createRunFrame()`，把 `runLoop()` 中的初始运行态组装移入 `run-frame-state.ts` 并补测试，明确 messages 浅拷贝、events/pendingWritePlans 初始为空、turnIndex/reminder/compaction 默认值。targeted 回归 `bunx vitest run server/agent/harness/run-frame-state.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，2 files / 74 tests passed；18 宽套件 18 files / 201 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-06-01：细化并行工具批次设计。确认不采用全量 `Promise.all`，而是在 `executeTurn` 内新增 PI 风格 tool segment scheduler：默认 parallel，任意 `executionMode: "sequential"` 工具会让所在 segment 回退串行；approval / report_result 仍是 harness barrier；`tool_execution_*` 事件可按真实完成时间发布，但最终 `toolResults` 与 savePoint writes 必须按原始 tool call index 稳定归并。危险副作用不做中心 resource lock provider，先由工具内部 queue 保护，例如 file mutation queue、variable patch queue、session state queue、project DB mutation queue。
- 2026-06-03：按用户决策移除默认 `builtin.compact`。默认 session runtime 不再组合 compact built-in，`RunFrame` 删除 `automaticCompactionEnabled`，compaction 唯一启用入口改为 profile 顶层 `compaction` 配置；没有 `compaction` 的 profile 手动 `/compact` 会写 compaction phase lifecycle error，自动路径不会压缩，若 provider 前上下文超过模型窗口则返回明确错误。内置主路径 profile（leader / writer / researcher / retrieval / simulator.actor / rp.writer）已显式添加 `compaction`，后台 `summarizer` 保持无 compaction。自动 compact 成功后会重新注入一次 `HistorySet` 初始化消息。
- 2026-06-01：实现第一版并行工具批次。`NeuroAgentTool` 新增 `executionMode`，`runToolBatch()` 改为内部 segment scheduler：approval / `report_result` 为 barrier，非 barrier segment 默认并行，混入 sequential 工具时整段串行；`tool_execution_end` 可按真实完成顺序发，`toolResult` message 按原始 tool call 顺序落盘。`RunFrame.pendingWritePlans` 改为带 `toolCallIndex/toolCallId/enqueueOrder` 的 pending plan，savePoint writes 在 transcript 后按 source order flush。首批并行工具为 `invoke_agent`、`read`、`web_search`、`web_fetch`、`get_agent`、`get_session`、`get_agent_profile`、变量 schema/read；mutation、SQL、plot/task、bash 先 sequential。`HarnessOptions.toolExecution` 已可在测试/调试时强制全串行。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，1 file / 86 tests passed；`bunx vitest run server/agent/harness/neuro-agent-harness.black-box.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/turn-failure.test.ts --reporter=dot`，5 files / 34 tests passed；18 相关宽套件 18 files / 215 tests passed；`bunx tsc --noEmit --pretty false` 仍失败在既有 unrelated RP / SillyTavern 类型错误。
- 2026-06-01：修复 barrier skipped toolResult 的实时事件一致性。approval / `report_result` barrier 后生成的 skipped toolResult 现在会和普通 toolResult 一样发布 `message_start` / `message_end`，避免 session 已落盘但 SSE 实时 transcript 缺少 skipped message；`report_result` 校验失败仍只闭合后续 tool calls 并继续下一轮，让模型看到错误后修正。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`，1 file / 86 tests passed。
- 2026-05-29：修复 waiting/running abort terminal 语义。waiting 状态下 abort 会先写 harness error toolResult 闭合 pending approval tool call，再写 lifecycle `aborted` 并释放 active invocation；running 状态 provider 返回 aborted/interrupted failed outcome 时，RunLoop failed result 会携带 `terminalStatus`，terminal lifecycle 写 `aborted`，follow-up queue 以 `aborted` reason 暂停而不是误记为普通 error。targeted 回归 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-failure.test.ts --reporter=dot`，2 files / 78 tests passed；18 宽套件 18 files / 202 tests passed；`bunx tsc --noEmit --pretty false` 仍只剩既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误。
- 2026-05-31：针对“Agent 运行中后端 dev reload 后无法 continue”补充系统性恢复设计。新增 SSE `(eventEpoch, seq)` cursor / connected handshake / snapshot cursor reset 合同，明确 `after > lastSeq` 和 epoch mismatch 都触发 snapshot recovery；补充 waiting hydration 设计，要求 snapshot 可从 session active path 的 pending approval + waiting lifecycle 恢复 `activeInvocation.status = "waiting"`，`continue(resolution)` 在内存 active 丢失时仍复用原 logical `invocationId`。本次只更新设计和实现计划，代码实现待下一切片。
- 2026-06-30：修复 session 311 暴露的 Agent 基础工具协议问题。`request_user_input` 的模型可见结果改为格式化文本，Low-Code Form 提交会合并 `form.defaults` 和字段 `defaultValue`，内部 `details.answers` 继续保留结构化答案；`read` 新增 `lineNumbers`，在 offset/limit 或截断时自动显示 `123 | 内容` 行号并返回 `startLine/endLine/totalLines/nextOffset`；`edit` 保持 exact replacement，但批量编辑先完整预检，任一项失败时不写文件并返回匹配/失败/重复/重叠诊断；`task_create/task_set_status` 修复 savePoint batch leaf 计算，tool transcript 与 tool custom state 留在同一 active path，避免 task custom state 落成下一轮读不到的 sibling。
- 2026-06-30：本轮不改 `list/tree`，也不新增模糊 edit 或 line-based edit。宽跑聚焦套件中 `safe point drain 期间拒绝新的 steer` 曾出现一次并发/清理波动，单测独立复跑通过，未作为本轮工具协议阻塞项。
- 2026-06-30：补齐遗漏修复。`request_user_input` 已从 Low-Code Form 拆出，前端 snapshot/SSE 路径恢复为专用 questions UI；schema 只支持问题、单选 options 与开放 note，拒绝多选、默认选项和 option-level `defaultSelected`，历史气泡只展示单选、note-only 与 text-only 答案。后端等待态 custom state 不再为 `request_user_input` 持久化 `formSpec`，重载 snapshot 也按普通 pending question 恢复。`read.offset/limit` 收紧为正整数 schema；`edit` 新增重叠 edit 拒绝与失败不写文件覆盖；harness 队列测试补齐 active invocation 等待点，避免 steer/followup 入队测试依赖异步 race。
- 2026-06-30：修复当前工作区回写回归。再次移除 `request_user_input` 的 Low-Code Form 生成、`selectedOptionIndexes`、多选和默认值协议；snapshot/reload 即使遇到旧 waiting `formSpec` 也按普通 questions UI 恢复；Low-Code Form 仍只服务非 `request_user_input` 用户输入工具。本轮没有扩大 `read/edit/task` 功能面。

## Files Changed

- `server/agent/tools/control-tools.ts`
- `server/agent/tools/request-user-input-result.ts`
- `server/agent/tools/types.ts`
- `server/agent/tools/approval.ts`
- `server/agent/tools/control-tools.test.ts`
- `server/agent/tools/approval.test.ts`
- `server/agent/tools/file-tools.ts`
- `server/agent/tools/file-tools.test.ts`
- `server/agent/tools/task-tools.test.ts`
- `app/components/common/low-code-form/low-code-form-utils.ts`
- `app/components/novel-ide/agent/AgentUserInputPrompt.vue`
- `app/utils/low-code-form-utils.test.ts`
- `server/agent/session/tool-session-write-sink.ts`
- `server/agent/session/write-plan.ts`
- `server/agent/session/write-plan.test.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/session/session-repo.test.ts`
- `server/agent/session/types.ts`
- `server/agent/profiles/define-agent-runtime.ts`
- `server/agent/profiles/define-agent-runtime.test.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/profiles/types.ts`
- `server/agent/profiles/default-profile.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/harness/run-kernel-error.ts`
- `server/agent/harness/run-kernel-error.test.ts`
- `server/agent/harness/run-frame-state.ts`
- `server/agent/harness/run-frame-state.test.ts`
- `server/agent/harness/prepare-run.ts`
- `server/agent/harness/prepare-run.test.ts`
- `server/agent/harness/prepare-next-turn.ts`
- `server/agent/harness/prepare-next-turn.test.ts`
- `server/agent/harness/run-kernel-types.ts`
- `server/agent/harness/turn-continuation.ts`
- `server/agent/harness/turn-continuation.test.ts`
- `server/agent/harness/turn-failure.ts`
- `server/agent/harness/turn-failure.test.ts`
- `server/agent/harness/turn-transaction.ts`
- `server/agent/harness/turn-transaction.test.ts`
- `server/agent/harness/types.ts`
- `server/agent/harness/compaction.ts`
- `server/agent/variables/accessor.ts`
- `shared/dto/agent-session.dto.ts`
- `app/components/novel-ide/agent/agent-message.ts`
- `app/components/novel-ide/agent/agent-message-low-code-form.test.ts`
- `app/components/novel-ide/agent/useAgentSession.ts`
- `app/components/novel-ide/agent/useAgentSession.test.ts`
- `app/components/novel-ide/agent/useAgentSessionStream.test.ts`
- `app/components/novel-ide/agent/agent-message.test.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/utils/agent-message-projection.test.ts`
- `docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md`
- `docs/tasks/18-agent-runtime-pipeline-hooks/README.md`
- `PROJECT-STATUS.md`

## Verification

- `bunx vitest run app/utils/agent-message-projection.test.ts app/components/novel-ide/agent/agent-message-low-code-form.test.ts app/components/novel-ide/agent/useAgentSession.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**" --pool forks`
  - 3 files / 39 tests passed after repairing the `request_user_input` regression back to dedicated questions UI while keeping Low-Code Form for non-request tools.
- `bunx vitest run server/agent/tools/control-tools.test.ts server/agent/tools/approval.test.ts server/agent/tools/file-tools.test.ts server/agent/tools/task-tools.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**" --pool forks`
  - 4 files / 69 tests passed after request schema narrowing, `read` positive integer, and `edit` overlap coverage.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/harness/neuro-agent-harness.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**" --pool forks`
  - 3 files / 170 tests passed after removing `request_user_input` formSpec persistence and stabilizing queue admission tests around active invocation registration.
- `bunx tsc --noEmit --pretty false`
  - Passed.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/session/write-plan.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 3 files, 60 tests passed.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 1 file, 52 tests passed.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/neuro-agent-harness.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 9 files, 121 tests passed.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 11 files, 153 tests passed.
- `bunx vitest run server/agent/session/write-plan.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 62 tests passed.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 62 tests passed.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 66 tests passed after hard-cutting transcript persistence fallback and recompiling system/user profile artifacts.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 4 files, 75 tests passed after moving report_result reminder enablement behind `builtin.reportResult`.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/compaction.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 7 files, 90 tests passed after moving automatic compaction enablement behind `builtin.compact`.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 4 files, 84 tests passed after moving report_result reminder enablement to executable `prepareRun` hook result.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts --reporter=dot`
  - 6 files, 93 tests passed after separating profile prepare planning from prepareRun write execution.
- `bunx vitest run server/agent/harness/prepare-run.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 72 tests passed after extracting prepare-run write plan reducer.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/prepare-run.test.ts server/agent/profiles/define-agent-runtime.test.ts --reporter=dot`
  - 3 files, 80 tests passed after extracting invoke prepareRun orchestration helper.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/run-kernel-error.test.ts --reporter=dot`
  - 3 files, 79 tests passed after extracting invocation terminal cleanup helpers.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-run.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 18 files, 197 tests passed after the latest prepare-run extraction and built-in hook migrations.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 17 files, 185 tests passed after the compact built-in hook migration slice.
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 62 tests passed after extracting Run Kernel type boundaries.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 1 file, 60 tests passed after extracting Run Kernel type boundaries and fixing runtime input inference.
- `bunx vitest run server/agent/harness/turn-continuation.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 64 tests passed.
- `bunx vitest run server/agent/harness/turn-failure.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 63 tests passed.
- `bunx vitest run server/agent/harness/run-frame-state.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 63 tests passed.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 11 files, 154 tests passed.
- `bunx tsc --noEmit --pretty false`
  - 仍失败，但剩余错误是既有 unrelated `server/agent/skills/silly-tavern-card-cli.test.ts` 中 `inspection.markers.* is possibly undefined`；runtime hook / Run Kernel 类型迁移相关错误已清掉。
- `bunx vitest run server/agent/harness/run-frame-state.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - 2 files, 74 tests passed after extracting `createRunFrame()`.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-run.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 18 files, 201 tests passed after the latest RunFrame initialization helper slice.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/turn-failure.test.ts --reporter=dot`
  - 2 files, 78 tests passed after fixing waiting/running abort terminal semantics.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-run.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 18 files, 202 tests passed after fixing abort terminal semantics.
- `bunx vitest run server/agent/events/public-event-projection.test.ts server/agent/harness/types.test.ts server/agent/session/write-plan.test.ts app/components/novel-ide/agent/useAgentSession.test.ts --reporter=dot`
  - 4 files, 15 tests passed after public event projection hard cut.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-run.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/harness/types.test.ts server/agent/events/public-event-projection.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 20 files, 213 tests passed after public event projection hard cut.
- `bunx vitest run server/agent/harness/neuro-agent-harness.black-box.test.ts --reporter=dot`
  - 1 file, 16 tests passed after adding Harness black-box coverage for prompt/continue/steer/followup/waiting/error/SSE replay/slow tool observation/waiting abort/running abort.
- `bunx tsc --noEmit --pretty false`
  - 18 相关类型错误已清掉；仍失败于既有 unrelated SillyTavern 类型错误。
- `bunx vitest run server/agent/tools/control-tools.test.ts server/agent/tools/approval.test.ts app/utils/low-code-form-utils.test.ts server/agent/tools/file-tools.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**" --pool forks`
  - 4 files / 63 tests passed after `request_user_input` result formatting/default-option schema coverage, Low-Code Form default merge, `read` line number/image preservation, and `edit` preflight diagnostics coverage.
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t 'approval 工具调用会停在 assistant tool call|task_create 后同 run 继续输出时下一轮 task_set_status|safe point drain 期间拒绝新的 steer' --testTimeout 60000 --hookTimeout 60000 --exclude "product/**" --pool forks`
  - 1 file / 3 tests passed, 145 skipped. Covers approval waiting snapshot, task custom state active-path persistence, and the safe-point drain regression that previously showed one wider-suite fluctuation.
- `bunx vitest run server/agent/tools/task-tools.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**" --pool forks`
  - 1 file / 2 tests passed. Covers direct task custom state writes and the branch semantic where moving the active leaf back before the savePoint does not inherit the newer task list.
- 已核对 PI 文档与源码入口：
  - `.agent/workspace/pi/packages/agent/docs/agent-harness.md`
  - `.agent/workspace/pi/packages/agent/docs/durable-harness.md`
  - `.agent/workspace/pi/packages/agent/docs/hooks.md`
  - `.agent/workspace/pi/packages/agent/src/agent-loop.ts`
  - `.agent/workspace/pi/packages/agent/src/harness/agent-harness.ts`
- 已核对当前 Neuro Book harness 入口：
  - `NeuroAgentHarness.invokeAgent()`
  - `prepare()`
  - `runLoop()`
  - `streamAssistant()`
  - `runToolBatch()`
  - `commitTurn()`
  - `finalizeInvokeResult()`
  - 第一批实现后 active 代码中已无 `applyIngest()` 调用路径，也无旧 hard-coded `triggerSessionSummarizer()` 自动运行路径。

## TODO / Follow-ups

- 18 完整重构落地后，重新计划 `docs/tasks/17-session-title-summary-enhancement/README.md` 的 summarizer 实现细节。
- 将当前 `RunFrame`、`TurnSnapshot`、`TurnOutcome`、`RunLoopResult`、`TurnContinuationDecision` 的执行逻辑继续拆成更清晰的 Run Kernel 模块；类型边界已先移入 `run-kernel-types.ts`，turn continuation / shouldStop 纯判定已先移入 `turn-continuation.ts`，partial failure helper 与 failed ingest draft 已先移入 `turn-failure.ts`，Turn Transaction outcome 应用已先移入 `turn-transaction.ts`，RunFrame 状态写回已先移入 `run-frame-state.ts`，prepare-next-turn 的确定性 reducer 已先移入 `prepare-next-turn.ts`，stage error phase 包装已先移入 `run-kernel-error.ts`。下一步是继续把完整 failure path 从 `NeuroAgentHarness` 里分离。
- 继续实现内置 hook bundle 的行为迁移。当前 `defineAgentRuntime()` 已能展开 built-in bundle，默认 session runtime 也已有内置 hook；`builtin.profilePrompt` 已显式启用 profile prepare system prompt；`builtin.sessionContext` 已作为可执行 `prepareRun` hook 控制 `prepare().modelContextMessages` 注入 provider context，也控制 `HistorySet` / `AppendingSet` / `ModelContext` appending 写入 session history；`builtin.transcriptPersistence` 已显式返回 `transcript: "persist"`，且无 transcript hook 时不再隐式落盘；`builtin.reportResult` 已作为可执行 `prepareRun` hook 显式启用缺失 report_result 的 reminder retry；`builtin.compact` 已删除，compaction 统一由 profile 顶层 `compaction` 配置显式启用；profile prepare 现在只产出 plan/writePlan，prepare persistence 编译已抽到 `prepare-run.ts`。下一步继续把完整 `prepareRun` 编排从 `invokeAgent()` 主流程拆成更小的 Run Kernel helper。
- `ToolSessionWriteSink` 已覆盖 active harness 路径的 variable accessor、client variable ack、tool custom state、profile prepare writes、compaction append 和控制面 active leaf 移动；`compaction.ts` 已硬切为调用方必须注入 compaction entry writer，不再 fallback 直连 repo append。
- 剩余 repo append fallback 已明确为 standalone/test-only：`variables/accessor.ts` 在没有注入 `writeSessionEntry` 时仍可独立工作，但 active harness 必须注入 writer，让 audit entry 走 `SessionWriteExecutor`。
- 如需服务重启后自动继续 ready follow-up queue，另开 coordinator recovery 任务；18 第一版只保证 snapshot 能恢复 queue 状态，不自动消费。
- 17 summarizer 重做时清理旧 `session.summarizer` profile key / DTO / custom state 命名，改成普通 profile runtime hooks 表达，并补 active-path-specific projection source leaf 校验。
- 后续实现前先补最小 targeted tests：
  - projection 不污染 tree。
  - source session `AgentDialogueContent` helper 继续覆盖 compaction / toolResult omitted / branch active path。
  - ingestTurn 能替换默认 turn persistence。
  - write executor 保持 assistant/toolResult 顺序。
  - write executor 拒绝缺少 target/cause 的 plan。
  - waiting lifecycle 写入显式 `waiting`，resolution 后写入 `resumed`。
  - `moveTree(... next.invoke)` 仍能先切 active leaf 再由 coordinator 启动 run。
  - `invoke_agent` tool 遵守目标 session active lock，且拒绝 self-invoke。
  - summarizer stale source leaf 不覆盖 source title/summary，只标 dirty 重跑。
  - provider request error before stream 不写空 assistant，只写 lifecycle error。
  - provider stream partial failure 保存 partial assistant content，并剥离 tool calls。
  - terminal error/aborted/interrupted 后清理 steer queue，并暂停 follow-up queue。
  - accepted retry/new prompt start 后，前端不再投影旧 ErrorBubble。
  - message entry partial/interrupted/error metadata reducer 和前端投影。
  - follow-up queue `{status, pausedBy, items}` snapshot/SSE/frontend store 迁移。（snapshot projection 恢复已覆盖；后续只剩 server restart 后是否自动 drain 的产品决策。）
  - hook runtimeState namespace merge 不互相覆盖。（已覆盖同名 hook 对象浅合并；后续如支持多 namespace patch 再扩展测试。）
  - custom hook patch `tools` / `requestOptions` 后仍保留 report_result schema、approval barrier 和 provider request 规范化。
