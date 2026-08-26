# Agent SSE Session Contract

## Status

本文档是当前 `/api/agent/sessions/**` 的稳定 SSE 与前端同步规范。旧 thread stream 事件名，例如 `assistant_delta`、`tool_started`、`history_sync`，不再作为当前 Agent 主路径合同。

## Core Model

Agent 聊天同步由三层组成：

- Session snapshot：恢复真相。前端首次加载、重连无法安全 replay、`snapshot_required`、seq gap、手动刷新时读取。
- SSE event stream：实时增量。正常运行期间前端只通过 SSE 追加和更新 live UI。
- Front-end reducer：投影层。前端把 snapshot、session control event、Pi event 合成聊天气泡、工具卡、连接状态和 run phase。

普通 live 更新不得通过频繁 `GET /api/agent/sessions/:sessionId` 修正。snapshot 不是轮询接口。

## HTTP Entry Points

- `GET /api/agent/sessions/:sessionId`：返回有界 recovery shell 与最新 history 尾页。
- `GET /api/agent/sessions/:sessionId/events?eventEpoch=<epoch>&after=<seq>`：建立 SSE，按 cursor replay 之后的事件。
- `POST /api/agent/sessions/:sessionId/invocations`：发起 blocking invocation；运行过程仍通过 SSE 实时同步。
- `POST /api/agent/sessions/:sessionId/abort`：中止当前 active invocation。
- `POST /api/agent/sessions/:sessionId/commands`：执行 session command，例如 model、mode、compact。轻控制命令返回 `kind:"live_state"`，前端只应用 live state，不额外补拉 snapshot；`retry/tree` 返回 `kind:"snapshot"`，`new/fork` 返回 `kind:"created_session"`。
- `POST /api/agent/sessions/:sessionId/tree`：移动 session tree leaf，必要时继续 invoke。

## Event Envelope

SSE `data:` payload 使用统一 envelope：

```ts
type AgentSessionEventDto =
    | {
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "runtime";
        event: AgentRuntimeStreamEventDto;
    }
    | {
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "session";
        event: AgentSessionControlEvent;
    };
```

`kind` 不推荐合并成单一 Pi custom event。

- `kind: "runtime"` 表示 Agent loop 内的公开 runtime event，前端按模型输出、工具调用和 turn lifecycle 处理。
- `kind: "session"` 表示 Neuro Book 产品层事件，前端按恢复、状态、队列、UI patch 和 session entry 处理。
- `connected`、`snapshot_required`、`session_entry`、`session_state_changed` 不是模型 loop 事件，不应伪装成 Pi custom。
- 如果未来 Pi runtime 本身需要 custom event，应投影到 `kind: "runtime"` 的 `event` 内；session 恢复和产品状态仍保持 `kind: "session"`。

保持两类 `kind` 的目的，是让事件来源、replay 语义和前端 reducer 边界清楚。把所有事件包成 Pi custom 会污染 Pi lifecycle，也会让 `snapshot_required`、`connected` 这类 transport 事件被误解为 Agent run 事件。

## Transport Rules

- `seq` 是 session event stream 的递增序号，用于去重、gap detection 和 replay。
- `snapshot.eventCursor` 是应用 snapshot 后的恢复点。首次打开、刷新和 snapshot recovery 后使用 `events?eventEpoch=<eventCursor.eventEpoch>&after=<eventCursor.after>`。
- `lastSeq` 是前端已经实际应用到的 event seq。普通 SSE 断线重连时使用 `events?eventEpoch=<currentEpoch>&after=<lastSeq>`。
- `snapshot.latestSeq` 和 `connected.latestSeq` 只表示服务端当前事件流尾部，不能作为前端恢复点。
- `connected` 只表示 SSE HTTP 连接已建立，不是 durable session event，不推进 `lastSeq`，不改变消息和 running 状态。
- 前端收到 `payload.seq <= lastSeq` 的 durable event 必须丢弃。
- 前端收到 `payload.seq > lastSeq + 1` 必须进入 recovering，单飞拉取一次 snapshot。
- `snapshot_required` 表示服务端无法安全 replay，处理方式与 seq gap 相同。
- SSE 断开不是 run error。前端应显示连接状态并自动重连，不应直接把 run 置为 idle。
- `session_state_changed` 只携带 live state；active path 等恢复条件变化时进入统一 recovery，不能把该事件当成 recovery response。

### Reconnect Backoff

Jobs、Agent Session 和 Project Presence 共用 `SseReconnectBackoff` 的失败序列，延迟固定为 `300/800/1500/3000/5000ms`，随后保持 5 秒。该 Module 只负责退避和连接稳定性，不接管 cursor、snapshot recovery、Session ready 或 Project open。

- `opened()` 只记录打开时间，不清零失败次数；HTTP 200 后立即 EOF 仍继续下一档退避。
- 连接连续存活至少 5 秒后，本次断线标记为 stable，并从 300ms 开始新的失败序列。
- 正常 EOF 与异常 rejection 都是断线；主动 abort、代次替换和销毁不重连。
- 手动恢复、成功 snapshot recovery、新目标和显式 stop 调用 `reset()`。
- Agent Session 的 ready 与 `connected` 状态仍在有效 SSE open 时立即完成；这与内部失败序列是否清零是两个独立合同。
- Project Presence 每次重连必须先执行幂等 Project open，再订阅 presence；不能由 timer 绕过 reopen 直接重订阅。

## Event Types

### Pi Events

| Event | Front-End Rule |
| --- | --- |
| `agent_start` | 设置 live run active；若 snapshot 已有 `activeInvocation`，保持一致。 |
| `turn_start` | 进入新一轮 ReAct turn，phase 设为 `model_pending` 或 `thinking`。 |
| `message_start` | 创建或更新 live assistant bubble；空 assistant start 也应显示生成状态。 |
| `message_update` | 更新 assistant text、thinking、toolCall block；优先使用 `assistantMessageEvent`。 |
| `message_end` | 标记当前 assistant message 完成，但不代表 run 结束。 |
| `tool_execution_start` | 工具从参数生成态进入执行态，工具卡显示 running。 |
| `tool_execution_update` | 工具执行输出流式更新。能力保留，当前可以暂不实现具体工具输出。 |
| `tool_execution_end` | 工具完成，工具卡显示 success 或 error。 |
| `turn_end` | 当前 turn 完成；普通 assistant/toolResult 在此边界成组持久化。 |
| `agent_end` | 当前 invocation 最终结束；清理 live phase。若缺失，以 snapshot `activeInvocation` 纠偏。 |

### Session Control Events

| Event | Front-End Rule |
| --- | --- |
| `connected` | 标记 SSE connected；不推进 `lastSeq`，不改消息，不改 run。 |
| `snapshot_required` | 进入 recovering，单飞拉取一次 snapshot。 |
| `session_entry` | 将 append-only entry 投影到稳定消息或系统卡。 |
| `session_state_changed` | 更新 summary、activeInvocation、pendingApproval、linkedAgents、usage、model、agentMode 等。 |
| `follow_up_queued` | 更新 follow-up queue；不直接显示为普通 user message。 |
| `invocation_aborted` | 进入 aborting/stopped 过渡态，等待后续 state changed 或 snapshot 确认。 |
| `client_variable_patch_requested` | 前端执行 client state patch 并 ack；不展示为聊天消息。 |

## Assistant Streaming

`message_update.assistantMessageEvent` 是 live reducer 的主数据源，`event.message.content` 是完整 block 兜底校准。

前端必须支持 text、thinking、toolCall block 交错到达，并按 `contentIndex` 合并。不得假设 `*_start -> *_delta -> *_end` 连续出现。

基本规则：

- `text_delta` 追加到对应 text block。
- `thinking_delta` 追加到对应 thinking block；即使正文还未出现，也应显示思考状态。
- `toolcall_delta` 更新工具 partial args；工具卡处于 `streaming`，表示模型正在生成参数。
- `toolcall_end` 用完整 tool call 覆盖 partial args，但工具仍需等待 `tool_execution_start` 才算真正执行。

如果 SSE payload 中没有 thinking block 或 thinking sub-event，前端不能凭空展示思维链。排查顺序应是 provider、Pi model adapter、harness、前端 reducer。

## Tool Streaming

工具流式分两类：

- Tool arguments streaming：来自模型 assistant message 的 `toolcall_delta`。用于实时展示 write/edit/apply_patch 等工具参数。
- Tool result streaming：来自工具 runtime 的 `tool_execution_update`。用于展示 bash stdout、progress、file preview 等执行输出。

当前稳定合同要求保留 `tool_execution_update` 能力，但具体工具执行输出流式可以暂不实现。第一版实现重点是保证工具参数流式可见、工具 start/end 状态准确、最终结果可靠。

未来启用工具执行输出流式时，`partialResult` 应使用小型 discriminated union，例如：

```ts
type ToolPartialResult =
    | {kind: "stdout_delta"; text: string}
    | {kind: "stderr_delta"; text: string}
    | {kind: "progress"; message: string}
    | {kind: "file_preview"; path: string; contentDelta?: string; content?: string};
```

通用工具气泡按 `kind` 做基础展示；专用工具气泡只做更高质量布局，不改变事件语义。

## Front-End State

前端状态至少拆成四层：

- Transport state：`connectionStatus`、`lastSeq`、`reconnectAttempt`、`lastDisconnectReason`、`snapshotRequestInFlight`。
- Session snapshot state：`summary`、`activeInvocation`、`pendingApproval`、`linkedAgents`、`usage`、`model`、`agentMode`。
- Live invocation state：`invocationId`、`runStatus`、`phase`、`currentTurnIndex`、`activeToolCallIds`。
- Chat projection state：snapshot 派生的稳定消息、SSE 派生的 live patch、尚未对齐的 optimistic user message。

`running` 是派生值：

```ts
running = Boolean(snapshot.activeInvocation)
    || live.runStatus === "running"
    || live.runStatus === "aborting";
```

发送按钮是否为停止按钮由 `running` 决定。用户可见文案由 connection state + run phase 决定，例如“工具已完成，正在继续生成下一步回复”。

## Flow Scenarios

### 1. Open Session

1. 前端 `GET /api/agent/sessions/:sessionId`。
2. 应用 snapshot，生成稳定历史和 shell 状态。
3. 使用 `snapshot.eventCursor` 订阅 `events?eventEpoch=<eventCursor.eventEpoch>&after=<eventCursor.after>`。
4. 收到 `connected`，只更新连接状态。
5. 后续正常运行只应用 SSE event reducer。

### 2. Prompt Without Tools

1. 前端追加 optimistic user message。
2. 前端确保 SSE 已连接，调用 `POST /invocations`。
3. 后端写 invocation start、profile appending messages 和真实用户消息。
4. 前端通过 `session_entry` 对齐真实历史。
5. 后端进入 ReAct loop，发送 `agent_start`、`turn_start`、`message_start`。
6. `message_update` 持续更新 assistant 文本。
7. `message_end` 表示 assistant live message 完成。
8. `turn_end` 持久化 assistant message。
9. `agent_end` 和后续 `session_state_changed` 让前端恢复 idle。

### 3. Prompt With Tool Call

1. assistant 通过 `message_update` 产生 toolCall block。
2. `toolcall_delta` 更新 partial args，工具卡显示 `streaming`。
3. `message_end` 后工具参数完整。
4. `tool_execution_start` 表示工具真正开始执行，工具卡显示 `running`。
5. `tool_execution_update` 可选更新执行输出；当前能力保留但可暂不支持。
6. `tool_execution_end` 写入最终 result/error。
7. `turn_end` 把 assistant toolCall 和 toolResult 成组持久化。
8. 如果还需继续，后端进入下一次 `turn_start`；工具完成不等于 run 完成。

### 4. Multi-Turn ReAct

一次 invocation 可包含多轮：

```text
turn_start -> assistant toolCall -> tool execution -> turn_end
turn_start -> assistant toolCall -> tool execution -> turn_end
turn_start -> assistant final text -> turn_end -> agent_end
```

前端不得把 `turn_end` 当作 run end。只要 `activeInvocation` 仍存在，发送按钮仍是停止按钮；phase 必须告诉用户当前正在继续生成、等待模型或整理结果。

### 5. Thinking Visibility

thinking 展示链路是：

```text
provider reasoning/thinking
-> Pi model adapter preserves thinking
-> harness emits thinking block/sub-event
-> front-end reducer merges by contentIndex
-> bubble renders thinking
```

如果 SSE payload 没有 thinking，前端不展示思维链是正确行为。

运行时 thinking 开关不属于模型配置页的强度参数。模型配置只描述模型是否支持 reasoning/thinking；Agent Profile 的 `reasoningEffort` 提供默认强度，session command `{ command: "thinking", thinkingLevel }` 提供当前 session 覆盖。snapshot 中 `thinkingLevel: null` 表示跟随 Profile，`"off"` 表示显式关闭，其他可选值为 `"minimal" | "low" | "medium" | "high" | "xhigh"`。

### 6. Reconnect With Replay

1. 前端记录当前 `lastSeq`。
2. SSE 断开，connectionStatus 设为 `reconnecting`。
3. 前端用 `events?eventEpoch=<currentEpoch>&after=<lastSeq>` 重连。
4. 如果 replay 成功，继续应用后续 event。
5. 重连过程不把 run 设为 idle，不显示 Run Error。

### 7. Reconnect Requires Snapshot

1. 前端重连时 replay buffer 不足，或 dev server reload 后内存 hub 丢失。
2. 服务端发送 `snapshot_required`，或前端发现 seq gap。
3. 前端进入 `recovering`。
4. 同一 session 只发起一个 snapshot fetch。
5. 应用 snapshot，清理 live patch，继续订阅 SSE。

### 8. Abort

1. 用户点击停止，前端调用 `POST /api/agent/sessions/:sessionId/abort`，body 可为 `{reason?: string, clearQueue?: boolean}`，`clearQueue` 默认 `true`。
2. 后端在 Session mutation 边界内完成 abort admission；Running invocation 的 AbortSignal 在锁外传播，合作路径最多等待 `INVOCATION_ABORT_GRACE_MS = 150`。
3. 前端可能收到 `invocation_aborted`，进入 aborting/stopped 过渡态。
4. forced-abort 只在同一个 `SessionWriteExecutor` per-session queue 中接受唯一 `aborted` lifecycle 后释放 ownership；后续 `session_state_changed` 或 snapshot 确认 `activeInvocation = null`，后续 invocation `start` 不早于旧 terminal append。
5. Abort admission 固定分三支：`context.archived` 或 `summary.status === "archived"` 时无论是否有 active invocation 都返回 HTTP 409 `session_abort_not_allowed`；非归档且没有匹配 active invocation 时（包括 Idle、Profile `missing`/`unloadable`）返回 HTTP 200 `idle` 且无新 lifecycle、resolution、queue 或 abort 事件；有匹配 active invocation 时才检查 `interaction.canAbort`，`true` 进入 abort flow，`false` 返回 HTTP 409 `session_abort_not_allowed`。forced plan 无法同步入队返回 503 `session_abort_durability_unavailable`、`retryable: true`，调用方可重试。HTTP 200 `aborted` 只表示 write queue admission，不表示响应返回前 physical append 已完成。
6. abort 不是 Run Error，不应默认显示错误卡；没有显式 reason 时不显示 Provider 英文 abort 文本。

### 9. Run Error

1. 后端写入 `invocation_lifecycle` error entry。
2. 前端通过 `session_entry` 或 snapshot 投影 Run Error system bubble。
3. Run Error bubble 只是 UI 投影，不进入模型上下文。
4. 如果 blocking invocation 返回 error 但 SSE 未补到错误卡，前端可拉一次 snapshot 兜底。

### 10. Approval Or User Input

approval / request-user-input 是合法 suspend point：

1. assistant 生成 pending toolCall。
2. harness 持久化该 assistant toolCall，session 进入 waiting。
3. 前端显示 pending approval/user input。
4. 用户提交答案。
5. 后端先写对应 toolResult，再继续下一轮 prepare 和 ReAct loop。

普通 read/write/edit/bash/apply_patch 等工具不得留下未闭合 toolCall；普通 turn 的持久化边界是 `turn_end`。

### 11. Tree/Edit/Retry

session 是 append-only tree。编辑、retry、rollback、fallback 不应原地覆盖旧历史，而是移动 active leaf 后追加新分支。

如果存在 active invocation，tree 移动类操作应禁用或返回 active invocation exists，避免后续 live event 写入错误分支。

## Snapshot Fetch Rules

- Initial load：拉一次 snapshot。
- Normal SSE：不拉 snapshot。
- `session_state_changed`：应用 live state；只有 reducer 标记需要 recovery 时才进入统一 single-flight。
- Reconnect replay success：不拉 snapshot。
- `snapshot_required` 或 seq gap：单飞拉一次 snapshot。
- Manual refresh：用户显式触发时拉一次 snapshot。
- Invocation error fallback：仅当 SSE/snapshot 未呈现同 invocation 的错误卡时兜底。

每次 snapshot fetch 应记录 reason，便于排查重复请求。

## Debug Observability

开发环境建议暴露以下调试信息：

- `lastSeq`
- connection state
- reconnect count
- 最近 event type
- 最近 snapshot reason
- active invocation id
- run phase

这些信息用于排查 SSE 重连、重复 snapshot、工具卡状态和思维链缺失问题，不要求进入普通用户主界面。
