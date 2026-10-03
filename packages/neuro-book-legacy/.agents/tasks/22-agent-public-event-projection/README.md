# Agent Public Event Projection

> 当前状态：实现中 / Integrated locally。中央projector已完成有界投影，本轮继续收口公共tool-call身份的所有入口。

## 2026-07-19：Tool-call identity fail-closed

- `PublicToolCallId`与其Zod Schema移动到shared公共Module，DTO、HTTP、Harness、Stored Codec与live/durable projector不再各写一套长度规则。
- assistant toolCall、toolResult、tool execution、streaming、pending recovery、resolution和client patch ack均保持原ID或明确拒绝；禁止截断稳定身份。
- 新增durable assistant/tool result非法ID、UTF-8边界与HTTP输入回归。本地投影组合测试通过；公开Product证据仍待Task 104–109统一门禁。

## User Request

- 用户提供了一份 Agent SSE 文本，指出 event 接口太大，尤其是 `session_state_changed`。
- 经过统计，`session_state_changed` 反复携带完整 `snapshot`，成为 SSE 流体积的绝对大头。
- 用户进一步要求系统性考虑修复方案，并把 `agent_end` 这类 runtime event 也纳入同一套方案。
- 本 task 先记录修复计划，随后按该计划完成 harness / DTO / frontend reducer 的系统性修改。

## Goal

建立一层稳定的 **Public Event Projection**，把内部运行事件、完整 session snapshot、公开 SSE/API 事件彻底分开。

完成后应满足：

- 正常 SSE 流只承载增量 UI 信号，不重复发送完整 session history、active path、tree、system prompt 或 provider context。
- `session_state_changed` 不再携带完整 `AgentSessionSnapshotDto`，而是携带轻量 live state。
- `agent_end` 不再携带完整 `frame.messages`。
- `turn_end` 等仅用于 UI phase 的事件不携带完整 assistant/toolResult payload。
- 完整 snapshot 仍然存在，但只通过 `GET /api/agent/sessions/:sessionId` 在 initial load、manual refresh、seq gap、`snapshot_required` 等恢复场景按需拉取。
- `AgentSessionEventHub` replay buffer 只保存 public event，避免 replay 里长期持有大对象。
- `InvokeAgentResult.events` 删除；HTTP invocation response 只返回终态、usage、report_result、error 等摘要字段，live 事件只走 SSE / `onEvent`。

## Current State

### Captured SSE Size

对用户提供的 SSE 文本进行字段级统计：

- 文件总大小约 `45.79 MB`。
- 事件总数 `69`。
- `session_state_changed`：
  - `14` 条。
  - 总计约 `42.74 MB`。
  - 平均每条约 `3.05 MB`。
  - 最大单条约 `3.06 MB`。
- `agent_end`：
  - `2` 条。
  - 总计约 `3.00 MB`。

`session_state_changed.snapshot` 内部最大字段：

- `entries`：约 `21.05 MB`。
- `messages`：约 `20.89 MB`。
- `systemPrompt`：约 `0.42 MB`。
- `tree`：约 `0.36 MB`。

结论：SSE 体积膨胀的根因不是普通增量事件，而是把完整 snapshot / runtime context 当成 public event payload 反复推送。

### Code Shape

当前相关路径：

- `server/agent/session/write-plan.ts`
  - `SessionWriteExecutor` 在写入后发布 `session_entry`，然后发布 `session_state_changed`。
  - 当前 `session_state_changed` 通过 `snapshotProvider` 携带完整 snapshot。
- `server/agent/harness/neuro-agent-harness.ts`
  - `SessionWriteExecutor` 的 `snapshotProvider` 指向 `getSessionSnapshot(sessionId)`。
  - harness 自身的 `publishSessionState()` 也发送完整 snapshot。
  - `runLoop()` 在结束时调用 `emitFrameEvent(frame, {type: "agent_end", messages: frame.messages})`。
  - `emitFrameEvent()` 当前把内部 `AgentEvent` 原样写入 `frame.events`、`onEvent` 和 SSE。
- `shared/dto/agent-session.dto.ts`
  - `AgentSessionEventDto.kind === "pi"` 当前直接暴露 Pi `AgentEvent`。
  - `AgentSessionControlEvent.session_state_changed` 当前允许携带完整 `AgentSessionSnapshotDto`。
- `app/components/novel-ide/agent/useAgentSession.ts`
  - 前端收到 `session_state_changed.snapshot` 时直接 `applySnapshot()`。
  - 前端已经能用 `session_entry` 增量投影消息，说明正常 SSE 不需要重复发送 `messages` / `entries`。

### Relationship To Existing Tasks

- [14-agent-sse-front-end-contract](../14-agent-sse-front-end-contract/README.md)
  - 已经提出正常 SSE 增量不应触发 snapshot 拉取。
  - 但当时仍把 `session_state_changed` 描述为可更新 snapshot shell，没有严格禁止完整 snapshot 进入 SSE。
- [18-agent-runtime-pipeline-hooks](../18-agent-runtime-pipeline-hooks/README.md)
  - 已经把 `SessionWriteExecutor` 定为统一写入和 publish 入口。
  - 已经明确 hook/profile/tool 不直接 publish event。
  - 本 task 不新增 Run Kernel pipeline stage，而是在 executor / event hub / runtime event emitter 之间补一个 public projection 服务边界。

## Design Decision

### Three Event/Data Shapes

必须硬切为三种数据形态：

1. **Internal Runtime Event**
   - harness / RunFrame 内部使用。
   - 可以保留完整 Pi `AgentEvent`、`frame.messages`、tool result 等。
   - 不直接进入 SSE、EventHub replay 或 HTTP DTO。

2. **Session Snapshot**
   - HTTP 恢复真相接口使用。
   - 可以包含 `messages`、`entries`、`tree`、`systemPrompt`。
   - 只在 initial load、manual refresh、seq gap、`snapshot_required` 等场景按需读取。

3. **Public Stream Event**
   - SSE 和 harness `onEvent` 使用。
   - 必须是轻量、稳定、可 replay 的 DTO。
   - 不允许携带完整 session history、完整 active path、完整 tree、完整 system prompt、完整 provider context。

### Public Session State

新增轻量状态 DTO，概念形态：

```ts
type AgentSessionLiveStateDto = {
    summary: AgentSessionSummaryDto;
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    pendingApproval: AgentPendingApprovalDto | null;
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    thinkingLevel: ThinkingLevel | null;
    effectiveThinkingLevel: ThinkingLevel;
    planModeActive: boolean;
    usage?: Usage;
};
```

`session_state_changed` 改为：

```ts
{
    type: "session_state_changed";
    state: AgentSessionLiveStateDto;
}
```

明确禁止 `session_state_changed` 携带：

- `messages`
- `entries`
- `tree`
- `systemPrompt`

### Public Runtime Events

当前 `kind: "pi"` 直接暴露 `AgentEvent`，这是 `agent_end` 膨胀的直接原因。需要新增 public runtime event DTO。

概念形态：

```ts
type AgentRuntimeStreamEventDto =
    | {type: "agent_start"}
    | {type: "agent_end"; status?: "completed" | "waiting" | "failed" | "aborted" | "interrupted"; usage?: Usage}
    | {type: "turn_start"; turnIndex?: number}
    | {type: "turn_end"; turnIndex?: number}
    | PublicMessageStreamEvent
    | PublicToolExecutionEvent;
```

第一版重点：

- `agent_end` 不带 `messages`。
- `turn_end` 不带完整 assistant/toolResults，只保留 UI phase 所需的轻量字段。
- `message_start` / `message_update` / `message_end` 可以继续携带当前 message 投影，因为前端需要 live assistant patch；后续如发现大 payload，再做 preview/ref 分层。
- `tool_execution_end` 当前可继续携带工具结果，因为前端工具卡需要 live result；如果工具结果也进入 MB 级，再追加 result preview / session entry ref 策略。

### Snapshot Required

`snapshot_required` 继续作为恢复真相信号。

触发场景：

- EventHub replay buffer 不足。
- 前端检测到 seq gap。
- 某些结构性操作无法用 lightweight state + `session_entry` 准确恢复，例如需要刷新完整 tree / entries 视图。

原则：

- `snapshot_required` 是例外路径，不是每次 state changed 后的常规补偿。
- 不允许把 `session_state_changed` 改成空事件后让前端每次都 `getSession()`，那只是把 SSE 体积转移到 HTTP snapshot 流量。

## Implementation Plan

### Phase 1: Define Public DTOs

- 在 `shared/dto/agent-session.dto.ts` 中新增：
  - `AgentSessionLiveStateDto`
  - `AgentRuntimeStreamEventDto`
  - 更新 `AgentSessionEventDto`，让 public event 不再直接暴露 raw Pi `AgentEvent`。
- 决定是否把 `kind: "pi"` 硬切为 `kind: "runtime"`。
  - 推荐硬切为 `runtime`，因为 public event 已经不是 Pi 原始事件。
  - 如果短期为了少改前端，也可以保留 `kind: "pi"` 名字，但类型必须变成 projected event；这种命名会误导后续维护者。

### Phase 2: Add Event Projectors

新增投影层：

- `projectSessionLiveState(sessionId)`：
  - 读取 session reduce 结果。
  - 只构造轻量 `AgentSessionLiveStateDto`。
  - 不调用 `getSessionSnapshot()`。
- `projectRuntimeEventForPublicStream(event, frame)`：
  - 输入内部 runtime event。
  - 输出 public runtime event。
  - 对 `agent_end`、`turn_end` 等事件删掉大字段。

推荐文件位置：

- `server/agent/events/public-event-projection.ts`

### Phase 3: Wire SessionWriteExecutor

- `SessionWriteExecutor` 不再接收 `snapshotProvider`。
- 改为接收 `liveStateProvider`。
- 写入完成后发布：
  - 每条 entry 对应 `session_entry`。
  - 每个 touched session 对应一次 `session_state_changed.state`。
- executor 仍然不让 hook/profile/tool 直接控制 publish。

### Phase 4: Wire Run Kernel Event Emission

- 修改 `emitFrameEvent()`：
  - raw Pi runtime event 只在投影函数输入侧短暂停留，不进入 `RunFrame` 历史、SSE replay 或 HTTP response。
  - 对外 `onEvent`、`publishRuntimeEvent()` 只使用 projected public event。
- `runLoop()` 结束时不再构造 `{type: "agent_end", messages: frame.messages}` 作为 public event。
- `InvokeAgentResult.events` 从 HTTP response 中删除。

### Phase 5: Update Frontend Reducers

- `useAgentSession.applyEvent()`：
  - `session_state_changed.state` 调用 `applyLiveState()`。
  - `applyLiveState()` 只更新 snapshot shell / runtime shell，不重建历史消息。
  - 如果本地没有 snapshot，标记 `needsSnapshot`，而不是凭空构造完整聊天状态。
- `useAgentSessionStream()`：
  - `applySnapshotSideEffects` 只在完整 snapshot 到达时运行。
  - live state 到达时如需同步 model/title 等 UI shell，提供轻量 side effect 或由 store 派生。
- `agent-message.ts`：
  - 输入 event 类型从 raw `AgentEvent` 改为 public runtime event。
  - `agent_end` / `turn_end` 不再假设有 messages。

### Phase 6: Regression Tests And Size Budget

新增或更新测试：

- `session_state_changed` 不包含 `snapshot`。
- `session_state_changed.state` 不包含 `messages` / `entries` / `tree` / `systemPrompt`。
- 大 session 下多次 write 只产生小体积 state event。
- `agent_end` 不包含 `messages`。
- `turn_end` 不包含完整 assistant/toolResults。
- 前端收到 `session_entry + session_state_changed.state` 后能维持消息、running、waiting、queue、summarizer 状态。
- seq gap / `snapshot_required` 仍能通过完整 snapshot 恢复。

建议加入事件体积预算测试：

```text
给定一个包含大 tool result 的 session：
  session_state_changed serialized size < 50 KB
  agent_end serialized size < 5 KB
```

具体阈值可以后续按 UI 字段实际大小调整，但测试必须防止再次把完整 snapshot 或 frame.messages 塞回 public event。

## Resolved Decisions

- `AgentSessionEventDto.kind === "pi"` 已硬切为 `runtime`。
- `InvokeAgentResult.events` 已删除，避免阻塞 HTTP response 继续聚合 live event。
- `tool_execution_end.result` 是否也需要 preview/ref。
  - 第一版只修 `session_state_changed` 和 `agent_end`；后续实测大工具结果会放大 live/replay，已由 [Task 107](../107-agent-event-memory-boundaries/README.md) 建立中央 public tool projector。
  - 当前 result content/details 分别共享 16 KiB 文本预算，图片只公开 metadata，单 public event 受 128 KiB hard limit；不再保留“原样结果后续再看”的未决状态。
- tree / linked agents 这类结构性变化，是放进 live state 还是触发 `snapshot_required`。
  - 第一版保持 live state 小而稳定；复杂结构变化触发 `snapshot_required` 或让前端主动刷新完整 snapshot。

## Implementation Result

- `shared/dto/agent-session.dto.ts`
  - 新增 `AgentSessionLiveStateDto` 和 `AgentRuntimeStreamEventDto`。
  - `session_state_changed` 从 `snapshot?: AgentSessionSnapshotDto` 硬切为 `state: AgentSessionLiveStateDto`。
  - runtime event `kind` 从 `pi` 硬切为 `runtime`。
- `server/agent/events/public-event-projection.ts`
  - 新增 runtime public projector。
  - `agent_start` / `agent_end` / `turn_start` / `turn_end` 不从 raw Pi event 透出，由 Run Kernel 直接生成轻量公开事件。
- `server/agent/session/write-plan.ts`
  - `snapshotProvider` 改为 `liveStateProvider`。
  - 写入后发布 `session_entry` + `session_state_changed.state`。
- `server/agent/harness/neuro-agent-harness.ts`
  - 新增 `getSessionLiveState()`，只投影 summary、summarizer、activeLeafId、approval、queue、activeInvocation、model/thinking、plan mode、usage。
  - 删除 `RunFrame.events` / `InvokeAgentResult.events` 聚合路径。
  - `agent_end` 只发送 `{status, usage?}`；`turn_end` 只发送 `{turnIndex, status}`。
- 前端 `useAgentSession` / `agent-message` reducer
  - 只消费 `runtime` public event。
  - `session_state_changed.state` 只更新 live shell，不重建消息历史。
  - 没有本地 snapshot 时标记 `missing_snapshot`，仍通过完整 snapshot 恢复真相。

## Files Changed

- `shared/dto/agent-session.dto.ts`
- `server/agent/events/public-event-projection.ts`
- `server/agent/events/public-event-projection.test.ts`
- `server/agent/session/write-plan.ts`
- `server/agent/session/write-plan.test.ts`
- `server/agent/harness/types.ts`
- `server/agent/harness/types.test.ts`
- `server/agent/harness/run-kernel-types.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/harness/run-frame-state.ts`
- `server/agent/harness/run-frame-state.test.ts`
- `server/agent/harness/turn-transaction.ts`
- `server/agent/harness/turn-transaction.test.ts`
- `server/agent/harness/turn-failure.ts`
- `server/agent/harness/turn-failure.test.ts`
- `server/agent/harness/prepare-next-turn.test.ts`
- `server/agent/http.test.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/tools/builtin-tools.ts`
- `app/components/novel-ide/agent/agent-message.ts`
- `app/components/novel-ide/agent/agent-message.test.ts`
- `app/components/novel-ide/agent/useAgentSession.ts`
- `app/components/novel-ide/agent/useAgentSession.test.ts`
- `app/components/novel-ide/agent/useAgentSessionStream.ts`
- `app/utils/agent-message-projection.test.ts`
- `docs/tasks/18-agent-runtime-pipeline-hooks/README.md`
- `docs/tasks/22-agent-public-event-projection/README.md`

## Verification

- `bunx vitest run server/agent/events/public-event-projection.test.ts server/agent/harness/types.test.ts server/agent/session/write-plan.test.ts app/components/novel-ide/agent/useAgentSession.test.ts --reporter=dot`
  - 4 files, 15 tests passed.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-run.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/harness/types.test.ts server/agent/events/public-event-projection.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 20 files, 213 tests passed.
- `bunx tsc --noEmit --pretty false`
  - 本次相关类型错误已清掉；仍失败于既有 unrelated SillyTavern 类型错误：
    - `assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts` 的 `inspection` 字段类型不匹配。
    - `server/agent/skills/silly-tavern-card-cli.test.ts` 的 optional marker/string undefined 错误。

## TODO / Follow-ups

Task 22 的基础 hard cut 已完成；后续 transport / history 边界分别由 Task 107 / Task 106 持有，不在本任务复制第二套 projector 或预算常量。

## 2026-07-18 Follow-up Audit

本轮按当前源码重新审计最初目标，并补齐原 walkthrough 没有直接证明的尺寸门禁：

- `session_state_changed` 继续只携带 `AgentSessionLiveStateDto`；测试改为按 UTF-8 bytes 断言 `< 50 KiB`，不再用 JavaScript 字符数近似网络体积。
- Run Kernel 生成的 `agent_end` SSE frame 明确断言 `< 5 KiB` 且没有 `messages`。
- 10 MiB tool result synthetic fixture 只公开有界 preview、`textBytes` 和 `textOmitted`，单事件 `< 50 KiB`；完整结果不进入 public event。
- EventHub 仍以 immutable `PublishedAgentSessionEvent` 一次序列化并记录 exact bytes；任何超过 128 KiB 的候选事件会改投 `snapshot_required`，不会先进入 replay。
- Task 14 已明确当前协议是 projected `kind: "runtime"`，完整 snapshot 只走 recovery；Task 107 继续拥有 replay/subscriber/Node writer 的内存与背压边界。

原始用户 SSE 为 `45.79 MB / 69 events`，其中 14 条 `session_state_changed` 占约 `42.74 MB`、2 条 `agent_end` 占约 `3.00 MB`。当前没有保留同一份原始文本用于逐字重放，因此本轮没有伪造“同输入 after 总量”；改用更强的结构与 hard-budget 证明：状态/终态分别受 50/5 KiB 门禁，所有公开 event 还有 128 KiB 运行时硬上限。

验证：

- `bunx vitest run server/agent/events/public-event-projection.test.ts server/agent/events/session-event-hub.test.ts server/agent/session/write-plan.test.ts --reporter=dot`
  - 3 files / 38 tests passed。
- 未执行浏览器验证；本轮只调整公开事件回归和文档，不改变前端视觉行为。

## 2026-07-19 Session Shell Boundary Audit

本轮继续从 `session_state_changed.state` 的真实组合字段反向审计 50 KiB 目标，补齐了单项预算存在但聚合后仍可能超限的边界：

- public model 与 JSONL durable model 已硬切为 `{providerConfigId, modelId}`；完整 Pi `Model` 只在 invocation 前从当前配置解析并冻结于 runtime RunFrame，不再向持久化 session、live state 或 recovery 暴露 `baseUrl`、`headers.Authorization`、`compat`、价格和 provider metadata。
- 同一 live state 的全部 `pendingUserInputs[].args` 共享 24 KiB 文本预算，不再让每个 pending item 各自获得 24 KiB。
- Low-Code Form 不做字段级截断：完整 `formSpec` 只进入当次 `tool.user-input-required` runtime event 与 recovery；live state 保留全部 `toolCallId/toolName`，并用 `detailsOmitted: true` 明确要求复用 runtime 详情或拉 recovery。
- 前端将 runtime user-input 详情写入 recovery shell；后续 identity-only live state 不会覆盖更完整的 args/form。若客户端确实缺失详情，会请求 `pending_input_details_missing` recovery，也不会错误降级成普通工具审批。
- 新增统一 public session projector：title 2 KiB、summary 8 KiB、profile issue 2 KiB、summarizer error 2 KiB。JSONL `session_update` 和 summarizer custom state 继续保留完整真相；session list、relations、recovery 与 live state 共用有界展示投影。

计划与实际的差异：

- 初始聚合测试尝试让正常 run 同轮产生多个 `request_user_input`，实际 tool barrier 只保留首个 pending call，后续调用会被显式跳过。因此最终使用 durable waiting session 构造协议允许的多 pending recovery 场景，验证重启/历史数据路径仍能保留所有 resolution 身份并满足尺寸预算；没有为了测试修改当前 barrier 语义。
- 原计划只考虑 pending args/form；审计继续发现 runtime 详情会被更瘦 live preview 覆盖，以及 session title/summary/profile/summarizer 字符串无预算，两者均在本轮系统性收口。

验证：

- Task 22 + Task 107 去重组合回归：13 files / 265 tests passed，覆盖完整 Harness、public projection、EventHub、SSE writer、write plan、model ref 与前端 reducer/stream/message。
- `bun run typecheck` passed。
- 未执行浏览器验证；本轮修改公开事件与恢复状态合同，不涉及视觉样式。

## 2026-07-19 Runtime And Control Event Audit

继续审计 `kind: "runtime"` 与 session control events 后，确认仅靠 EventHub 的通用 oversized fallback 不足以保护所有语义。公开事件分为两类：

1. 可通过 recovery 恢复的展示/状态事件，极端超限时可以降级为 `snapshot_required`。
2. 必须原样送达并触发一次性动作的控制请求，不能截断，也不能丢失为 `snapshot_required`。

本轮实现：

- `client_variable_patch_requested` 属于第二类。请求携带精确 JSON Patch，前端必须应用并回传 ack；超过 64 KiB 时 Harness 在创建 pending request 和发布 SSE 之前返回 `client_variable_patch_too_large`，工具立即获得错误结果，模型仍可继续运行。不会再出现 EventHub 已降级、Harness 却继续等待 10 秒 ack 的状态分裂。
- `invocation_aborted.reason` 属于第一类中的提示文本。abort 操作本身继续成功，公开 reason 只保留 2 KiB UTF-8 预览；内部 lifecycle/tool result 仍可保留原始原因。超大原因不再把整条 abort 信号替换成 `snapshot_required`。
- Sidecar 生命周期退出公开 SSE：删除 `sidecar_start/complete/error/merge`、从未有生产者的点号版 `sidecar.*`，以及从未赋值的 `sidecarContext`。Sidecar 内部执行、side-branch JSONL transcript、merge 和错误日志保持不变；公开 Chat Flow 只呈现主 invocation 可消费的事件。
- `public-control-event-projection.ts` 统一承载“精确控制请求前置拒绝”与“控制提示文本预览”两类策略，避免在 Harness 调用点散落尺寸判断。

反向 RED 证明：

- 移除 client patch 前置门禁后，90 KiB 请求会真实发布 `client_variable_patch_requested`，违反测试要求。
- 移除 abort reason projector 后，超大原因会被 EventHub 替换成 `snapshot_required: public event exceeded maximum frame size`。
- 保留 Sidecar publish 时，成功链会额外公开 `sidecar_start`、`sidecar_complete`、`sidecar_merge`。

验证：

- Task 22/107 runtime、control、projection、HTTP、Harness、variables 与前端去重组合回归：17 files / 319 tests passed。

## 2026-07-19 Blocking Invocation Result Error Audit

本轮继续审计阻塞式 `InvokeAgentResult`，重点是确认 HTTP 返回不会因为终态错误文本重新绕过 Public Event Projection 的边界：

- assistant 最终正文继续由 `projectPublicFinalMessage()` 投影为 64 KiB UTF-8 预览；JSONL transcript 保留完整正文，并通过 `finalMessageBytes/finalMessageOmitted` 明确是否省略。
- Provider 错误在进入 lifecycle 前已经经过 `providerErrorText()`；回归测试确认 lifecycle 与 `InvokeAgentResult` 使用同一份脱敏、有界文本，不重复实现 error projector。
- admission 阶段的 `AgentInvocationPayloadError` 原先直接把 `error.message` 放进 HTTP 结果；现在统一通过 Harness 的 `toInvocationErrorInfo()`，保留 `invalid_payload` 与 retryable 元数据，同时限制错误正文。
- `report_result` 连续校验失败的最后一条工具错误原先直接拼入 terminal `errorInfo`；现在在 Run Kernel 收口处复用 `providerErrorText()`，避免超长 schema path 撑大 HTTP response。超大字段 fixture 已覆盖该链路。

本轮已完成 `reportResult.data` 的结果 Seam 拆分。证据表明它是结构化业务结果而非 UI 摘要：NeuroBook 的协作工具、memory curator、session summarizer、settle hook 都需要完整数据；llmlint 也把完整 optimize body/edits 与 analysis output 作为正式结果。因此：

- server-only `AgentInvocationResult` 保留完整 `reportResult.data`，内部 Harness、Run Kernel、runtime hook 和协作工具继续使用它。
- shared `InvokeAgentResult` 硬切为 HTTP DTO，只返回有界 `reportResult.result`、`resultBytes`、`resultOmitted`，以及表示内部存在结构化结果的 `dataOmitted`；不再声明或传输 `data`。
- `server/agent/http.ts` 的普通 invoke 和 tree+invoke 两个 Adapter 都经过 `projectPublicInvocationResult()`；类型系统拒绝把内部 invocation 直接作为 HTTP 结果返回。
- `report_result.result` 与 `finalMessage` 共享 64 KiB JSON-string budget；重复的 `error/errorInfo.message` 也按实际序列化次数扣除同一预算。公开错误、结构化摘要和 partial assistant 组合仍低于 96 KiB。
- 完整结构化结果仍可由内部调用者和 durable session 使用；本轮没有新增仅为 HTTP 取回 output 的 endpoint，因为当前 NeuroBook 前端没有该需求。
- Recovery tree 反向审计确认 `session_update` projection entry 会被 `JsonlSessionRepository.tree()` 排除；可达 message/compaction/branch preview 已有有界投影，没有再引入伪造仓储状态的测试。
- Provider tool-call ID 在 streaming 尚未进入执行前就经过同一 512-byte identity policy；非法或空 ID 的 `toolcall_*`、tool execution 和 user-input-required public event 全部 fail closed，不截断或伪造稳定身份。

验证：

- Harness 结果边界回归：3 tests passed（大 Provider error、大 invocation payload、大 `report_result` 校验错误）。
- Provider sanitizer 与 Run Kernel error 回归：2 files / 7 tests passed。
- HTTP result Seam 回归：`server/agent/http.test.ts` 与 Harness public type contract 通过，覆盖普通 invoke、tree+invoke、结构化 data omission、partial+重复 error 组合。
- 此前聚焦门禁拆分运行：Harness 主文件 179 tests；black-box/payload/type/HTTP 43 tests；public projector/EventHub/frontend 81 tests；合计 15 files / 303 tests passed。
- tool-call identity 回归与 turn failure 回归：2 files / 14 tests passed。
- `bun run typecheck` passed。

计划偏差：第一次 15 文件并行执行有两条既有 5 秒复杂 Harness 用例因调度争用超时；两条均隔离重跑通过，最终门禁按 Harness / public transport 两组顺序执行，没有提高既有行为测试的默认 timeout。原先把 `InvokeAgentResult` 当作内部与 HTTP 共用类型；本轮已改为明确的内部结果/HTTP DTO Seam，而不是在 Core 截断结构化 output。
- `bun run typecheck` passed。
- 未执行浏览器验证；删除的 Sidecar public events 没有前端消费者。

## 2026-07-19 Final Tool-call Identity Gate

补齐 streaming tool-call ID 旁路后，重新执行最终窄门禁：

- `bun run typecheck`：通过。
- `bun run test server/agent/events/public-event-projection.test.ts server/agent/harness/turn-failure.test.ts`：2 files / 14 tests passed。
- 公开投影、EventHub、SSE writer 与前端 reducer：11 files / 97 tests passed。
- Harness、black-box、payload、public type contract 与 HTTP 结果 Seam：5 files / 222 tests passed。

代码审计确认 provider 的 tool-call ID 在 `toolcall_start`、`toolcall_delta`、`toolcall_end`、`tool_execution_*` 和 `tool_user_input_required` 所有公开入口都经过统一的非空且不超过 512 UTF-8 bytes 校验；非法或超长 ID fail closed，不截断、不伪造稳定 ID。普通 invoke 与 tree+invoke HTTP 入口都经过 `projectPublicInvocationResult()`，shared `InvokeAgentResult` 不包含 `reportResult.data`。

本轮未执行浏览器验证；前端行为只通过 reducer、stream、message 和公开事件单测覆盖。

## 2026-07-19 Final Lifecycle And Aggregate Audit

本轮从公开传输的完整生命周期继续反向审计，补齐以下边界：

- 工具名称统一经过 512 UTF-8 bytes 投影，覆盖 runtime tool execution、streaming tool call、durable Chat Flow、waiting/recovery 与 Session Tree；工具结果图片 MIME 限制为 256 bytes。
- Session Tree 的 title、label、message、compaction、branch summary、custom、invocation preview 与 tool name 均有单字段预算；节点身份字段保持原值，不截断。完整 lightweight tree 的节点数量与总 bytes 仍按 Task 106 的既定决定保留，不在本轮暗中分页。
- `NeuroAgentHarness.dispose()` 先关闭 EventHub，使旧 subscription 收到 `hub_closed`、iterator 结束且旧 Hub 禁止继续发布，避免 HMR/实例替换后遗留 writer 持有已关闭 response。
- 浏览器 `readSseStream()` 在解析、回调或网络失败时统一 cancel reader 并 release lock，底层 stream 不再泄漏。
- streaming tool call 同一 assistant message 最多保留 32 个 accumulator，并共享 64 KiB preview budget；前四个工具最多各获得 16 KiB，后续工具保留 omitted/bytes 形态。重复 `toolcall_start` 对同一 content index 幂等，不会再次扣减 aggregate budget。
- 带正数 `after` 的 cursor 必须同时携带 epoch；缺少 epoch 时返回 `snapshot_required`。`after=0` 仍作为首次连接允许无 epoch。
- Harness 中仍期待 durable 完整 Pi Model 的旧测试已修正为稳定身份契约；metadata 改变但 selection key 不变时不会追加 `model_change`，也不会把 base URL、headers 或凭据写入 JSONL。
- runtime projector 输出交给宿主 `onEvent` 时使用独立 structured clone；继续保持“observer 先于 EventHub publish、observer 失败则不发布”的既有时序，但宿主即使修改嵌套 DTO，也不能再污染随后进入 SSE/replay 的事件。EventHub 仍负责最终 JSON detach、deep freeze 和单次 frame 序列化。

验证结果：

- 公开传输分组：12 files / 105 tests passed；`public-event-projection.test.ts` 为 15 tests passed。
- Harness 主文件顺序门禁：181 / 181 tests passed；新增宿主修改 event 不污染 EventHub 的回归，附件恢复与 `tree empty` 隔离回归均通过。
- Harness 五文件并行组合：223 tests 中 221 passed，2 个后台 summarizer 用例在固定约 3 秒轮询窗口内仍处于 `running`；相同 Harness 主文件顺序运行全绿，属于并行资源争用下的时间门禁，不通过放宽 timeout 掩盖。
- `bun run typecheck` 的旧 `session-model-redaction.ts` 阻断已不存在；当前最新门禁失败于并行任务中的两项无关改动：`useModelDiscoverySession.test.ts` fixture 缺少新增 `credentialSource`，以及 `session-attachment.test.ts` 仍传入已不属于关闭原因 union 的 `"test"`。本轮不越界修改其他任务测试。
- 未执行浏览器验证，遵循项目约束。

计划与实际差异：原计划仅复核公开文本与生命周期；审计中额外发现重复 tool-call start 会重复消耗 aggregate preview budget、部分模型测试仍验证旧的完整 Model 持久化合同，以及宿主 observer 可在 EventHub detach 前修改同一 event 对象。三项均在现有 projector/session identity/observer seam 内收口，没有新增兼容层或第二套状态模型。

## 2026-07-19 Recovery Cursor Handoff And Identity Audit

本轮继续审计完整 recovery → SSE replay 交接，而不只检查单个 event 大小。

服务端既有取样顺序是正确的：先捕获 `eventCursor`，再读取 JSONL 和构建 recovery，允许 cursor 之后的 durable entry 同时出现在 snapshot 与 replay 中，以重复换取不遗漏；`session-query.test.ts` 已用读取期间 append/publish 的并发注入证明该合同。active invocation 则可能返回更早的 transcript replay anchor，以恢复尚未 durable 的 thinking/tool stream。

前端原实现只把 recovery cursor 写入 store，却继续沿用旧 SSE connection。这在 active invocation 或读取期间事件推进时不成立：旧连接的真实读取位置与被重置的 `lastSeq` 分离，下一帧会制造 seq gap；recovery 清理 live overlay 后也没有真正从 transcript anchor replay。

当前已硬切为 recovery barrier：

- 成功应用 recovery 后，如果当前 session 存在活动 SSE，立即 abort 旧连接并从 recovery `eventCursor` 重订阅。
- recovery 请求失败时保留旧连接和当前 UI，不制造额外中断。
- HTTP 取样期间旧流仍可继续消费；切换后这些事件最多从 cursor 重复 replay，由现有 entry ID、queue ID 和 seq reducer 幂等收敛，不会遗漏。
- 旧 subscription 只有在仍持有当前 controller 时才能安排 reconnect、报告连接错误或处理 `onOpen`；被 replacement/session switch 淘汰的异步回调不能污染新连接状态。

同时完成 public tool-call identity 的端到端类型约束：

- `PublicToolCallId` 不再只存在于 invoke Zod schema；runtime event、pending input、durable assistant tool call 与 tool result DTO 均保留 branded identity。
- projector/codec 的运行时验证证明沿 DTO → pending view-model → Vue emits → invoke request 保持，不在前端降级回普通 string。
- 删除 user-input 提交处的两个 `as any`；缺少 provider tool-call ID 时拒绝提交，不再用纯 UI `toolNodeId` 猜测身份。
- client variable patch ack 在浏览器 HTTP 边界验证事件中的可选 tool-call ID。
- 测试 fixture 通过 `assertPublicToolCallId()` 构造已验证 identity，不使用类型断言伪造品牌。

验证：

- recovery/EventHub/reducer 聚焦组合：5 files / 41 tests passed。
- branded identity 与用户输入链：6 files / 61 tests passed。
- 最终公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 127 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证；需要用户授权后手动覆盖运行中 refresh、snapshot recovery 与网络重连视觉状态。

计划与实际差异：最初只准备确认 cursor 取样是否有服务端竞态；证据表明服务端已正确，缺口实际位于客户端没有把 recovery cursor 用作新 subscription 起点。进一步 typecheck 又暴露 branded identity 只约束请求、不约束公开响应的半截合同，本轮一并完成端到端硬切，而不是用组件断言掩盖。

## 2026-07-19 Per-Connection Ready Lifecycle Audit

Recovery barrier 落地后继续检查 `start/stop/reconnect`，发现 `readyPromise/resolveReady/rejectReady` 原先是跨连接共享状态，并且只会在 `onOpen` 或异常路径结算：

- HTTP open 前调用 `stop()` 或 replacement abort 时，订阅可以结束，但原 `start()` 永久 pending。
- Adapter 在 `onOpen` 前正常返回时，同样没有 resolve/reject；后台虽然可能安排重连，直接调用者仍永久等待。
- 共享 resolver 还要求每个旧连接回调都手工检查身份，否则可能结算新连接的 ready promise。

当前 ready deferred 与单个 `AbortController` 一一绑定：

- controller abort 无条件以标准 `AbortError` reject 自己的 ready；已 open 的 promise 重复 reject 自动忽略。
- `onOpen`、subscribe error 和正常关闭只操作当前连接的本地 deferred，不共享 resolver。
- subscribe 在 open 前正常关闭会以明确 `event stream closed before open` 错误结算，并继续既有 reconnect policy。
- replacement/stop 会清理当前引用，但旧 `start()` 调用者仍获得确定性结果，不再泄漏 pending promise。

RED→GREEN：

- 修复前“open 前 stop”与“open 前正常关闭”均真实跑到 Vitest 5 秒超时。
- 修复后 `useAgentSessionStream.test.ts` 11 / 11 passed。
- 最终公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 129 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证。

计划与实际差异：原计划只准备验证 replacement 回调隔离；最小复现证明问题不是状态文案，而是公开 `start()` Promise 本身无法结算，因此改为 per-connection deferred，而不是继续堆叠 controller identity 条件。

## 2026-07-19 Browser SSE Frame Boundary Audit

服务端 EventHub 已有 128 KiB 单 event hard limit，但浏览器 `readSseStream()` 原先没有对称门禁：

- 已闭合 frame 可在 JSON.parse 前无限大。
- 缺少空行终止符的响应会持续累积 `buffer`，直到连接关闭或浏览器内存耗尽。
- parser 只识别 LF `\n\n`，不识别标准 SSE 允许的 CRLF `\r\n\r\n`。

当前新增 shared 唯一常量 `shared/agent/public-event-limits.ts`，服务端 public policy 与浏览器 parser 共用 `PUBLIC_EVENT_MAX_BYTES = 128 KiB`：

- 每个完整 frame 在 JSON.parse 前按 UTF-8 bytes 检查，超限抛 `SseFrameTooLargeError`。
- 未闭合 buffer 按收到的原始 chunk bytes 累计；消费完整 frame 后只重算剩余 buffer，避免逐 chunk 对整个前缀反复编码造成 O(n²)。
- streaming `TextDecoder` 可能暂存的最多 3 个 UTF-8 尾字节保守计入剩余预算，hard limit 不留尾部漏口。
- 超限仍经过既有 `finally`，cancel reader 并 release lock；上层 stream state machine 按连接错误执行重连。
- frame 与 data line 同时支持 LF/CRLF，不改变 JSON event 语义。

RED→GREEN：

- 修复前 140 KiB 完整 frame 被正常解析并交给 handler，反向测试明确得到 “promise resolved instead of rejecting”。
- 新增超大完整 frame、超大未闭合 buffer cancel、CRLF 三项回归。
- parser/EventHub/SSE writer 聚焦：3 files / 28 tests passed。
- 最终公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 132 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证。

计划与实际差异：原计划只检查未闭合 buffer；审计确认完整 frame 同样会在 JSON.parse 时制造大对象，并发现 CRLF 协议缺口，因此用同一个 transport seam 一次收口，没有在业务 reducer 追加重复尺寸判断。

## 2026-07-19 Exact Wire Frame Byte Audit

对 shared 128 KiB 常量做边界值复核后，发现两端 `frameBytes` 定义仍差一个 delimiter：

- EventHub 计算完整 `event: ...\ndata: ...\n\n` Buffer，包含末尾空行。
- 浏览器先用空行 split，再对被移除 delimiter 的 frame 正文计数，LF 少 2 bytes、CRLF 少 4 bytes。

当前 `readSseStream()` 使用保留 delimiter 的 frame extractor：

- 每个切片记录 `{frame, wireBytes}`，`wireBytes = UTF-8(frame) + 实际 delimiter bytes`。
- JSON parser 接收已计算的 wire bytes，不重复编码完整 frame。
- LF、CRLF 和混合换行使用实际匹配到的 delimiter 长度；剩余未闭合 buffer 继续走累计预算。
- 恰好 128 KiB + 1 的 wire frame 即使正文低于 128 KiB，也会在 JSON.parse 前拒绝。

RED→GREEN：

- 构造总 wire bytes 为 `PUBLIC_EVENT_MAX_BYTES + 1`、但去掉 `\n\n` 后仍低于上限的合法 JSON frame；修复前 promise 正常 resolve，证明 delimiter 未计入。
- parser/EventHub/SSE writer：3 files / 29 tests passed。
- 最终公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 133 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证。

计划与实际差异：原先的“shared 常量”只统一了数值，没有统一测量对象；本轮把合同收紧为完整 wire frame，而不是放任两端各自解释 128 KiB。

## 2026-07-19 SSE HTTP Media Type Audit

`readSseStream()` 原先只检查 HTTP status 与 body；任何 `200` 响应都会先触发 `onOpen`。代理登录页、HTML 错误页或普通文本因此可能被误报为已连接，小响应还会静默结束，只在上层表现为无解释的反复重连。

服务端 `writeAgentSessionEventStream()` 已固定发送 `content-type: text/event-stream; charset=utf-8`，客户端现在对称验证：

- HTTP 非 2xx 继续抛 `SseHttpError`。
- body 存在后，media type 主值必须大小写无关地等于 `text/event-stream`；charset 等参数允许存在。
- 缺失 Content-Type 或其它 media type 抛 `SseContentTypeError`，错误中保留实际 header 便于诊断。
- `onOpen` 只在 status/body/media type 全部通过后执行；协议错误不会把 UI 短暂标记为 connected。
- 验证发生在取得 reader 前，无需为未开始读取的错误响应制造 cancel 生命周期。

RED→GREEN：

- 修复前 `200 text/html` promise 正常 resolve，并会调用 `onOpen`。
- 新增 `200 text/html` 与缺失 Content-Type 两项 fail-fast 回归；所有正常 fixture 改为真实 SSE Content-Type，不为测试放宽生产合同。
- parser + stream state machine：2 files / 19 tests passed。
- 最终公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 135 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证。

计划与实际差异：原计划只检查非 SSE media type；审计确认缺失 header 同样不能证明协议成立，因此两者都 fail closed。

## 2026-07-19 Pre-reader Response Body Cleanup Audit

Content-Type fail-fast 最初发生在 `getReader()` 前，但直接 throw 不会保证持续输出的 response body 被取消。代理返回 streaming HTML、网关错误流或非 2xx 长响应时，UI 虽然得到正确错误，底层 HTTP 连接仍可能保持打开。

当前所有 pre-reader 拒绝路径显式释放 body：

- 非 2xx：先 `response.body.cancel()`，再抛原始 `SseHttpError`。
- body 存在但 media type 非 SSE/缺失：先 cancel，再抛原始 `SseContentTypeError`。
- cancel 自身失败被安全吸收，不能覆盖 status 或 Content-Type 诊断。
- 已取得 reader 后的解析/handler/网络失败继续由原 `finally` 执行 reader cancel + release lock；两类生命周期不混用。

RED→GREEN：

- 两个不会主动 close 的 ReadableStream 分别模拟 `200 text/html` 与 `502`；修复前错误能够抛出，但 `cancelCalls` 均为 0。
- 修复后两条路径均精确 cancel 一次。
- parser + stream state machine：2 files / 20 tests passed。
- 最终公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 136 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证。

计划与实际差异：原计划聚焦非 SSE Content-Type；复核发现非 2xx 在同一个 pre-reader seam 有完全相同的资源泄漏，因此共用单一 cleanup，而不是只修一个分支。

## 2026-07-19 Requirement Completion Audit

本轮停止继续堆叠边界功能，回到 Task 22 原始 Goal、六个 Phase 与验收条目逐项核对：

| 原始要求 | 当前权威证据 | 结论 |
| --- | --- | --- |
| Public Runtime / Snapshot / Public Stream 三形态硬切 | shared DTO 不包含 raw Pi event 或 snapshot event；Harness raw `AgentEvent` 只进入 projector | 已证明 |
| `session_state_changed` 只携带 lightweight state | `AgentSessionControlEvent` 类型、SessionWriteExecutor 与 UTF-8 `< 50 KiB` 回归 | 已证明 |
| `agent_end` / `turn_end` 不携带 messages/tool payload | runtime DTO、projector 丢弃 raw 终态、`agent_end < 5 KiB` 回归 | 已证明 |
| snapshot 只走 recovery GET | strict recovery/history/systemPrompt query union；seq gap/snapshot_required 统一 recovery | 已证明 |
| EventHub replay 只持有 immutable public event | JSON detach + deep freeze + 单次 Buffer frame；replay/subscriber bytes hard limit | 已证明 |
| `InvokeAgentResult.events` 删除 | public type contract `not.toHaveProperty("events")`，HTTP Adapter 只返回终态投影 | 已证明 |
| 前端 live reducer 不重建完整 history | durable entry + live overlay 分层；active path 变化进入 recovery barrier | 已证明 |
| replay/epoch/seq gap/snapshot recovery | EventHub、session query、stream store 与 recovery reconnect 回归 | 已证明 |
| transport 与大 payload 有界 | server/browser shared 128 KiB wire frame、tool/queue/text budgets、reader/body cleanup | 已证明 |

最终自动化证据：

- 公开传输、recovery、Chat Flow、HTTP 去重门禁：15 files / 136 tests passed。
- Harness 主文件：181 / 181 tests passed。
- `bun run typecheck` passed。
- `bun run nuxt:build` exit code 0：client、SSR、Nitro server、runtime dependency closure、Product profile import context 均完成。仅有既有 sourcemap 与 chunk-size warning。

自动化范围内没有剩余 Task 22 实现缺口。Task 106/107 继续拥有 history pagination 与 transport retention 的后续演进，本任务不复制第二套设计。

## 2026-07-19 Product 浏览器验收

用户明确授权后，在本地 Product build `http://127.0.0.1:3000/` 使用真实 Agent Session `#536` 完成最小端到端验收：

- 创建真实 Session，使用已配置模型发送“只回复：浏览器验收通过”。
- 消息进入运行态后立即刷新页面；Project Workspace 与 Session hydration 完成后，恢复到同一 Session，并收到终态回复“浏览器验收通过”。
- 终态再次刷新，用户消息与助手消息均恰好各一条，Session 标题、摘要、idle 状态和 token/cost 投影均恢复，没有重复或丢失。
- 浏览器控制台日志为空；没有发现 SSE reader、recovery replacement 或 closed stream 异常。

验收边界：本轮用“运行中刷新”覆盖活动连接 replacement、snapshot recovery 和终态重连；没有停止本地服务制造破坏性断网，也没有构造超限恶意 SSE frame。超限、非法 Content-Type、seq gap、epoch mismatch 与 reader cleanup 已由前述自动化门禁覆盖。当前测试 Session 规模较小，因此只证明 durable continuity 与去重，不替代 Task 106 的长历史分页/内存专项证据。

计划与实际差异：原计划把断网重连、错误提示和长 session 也列为浏览器门禁。实际验收选择不修改真实网络和配置，活动连接 replacement 与终态重连通过两次刷新完成；协议错误、超限与长历史继续由各自自动化门禁和 Task 106/107 持有，避免为 Task 22 造第二套破坏性测试设施。Task 22 的实现、自动化和 Product 主链证据现已完成。
