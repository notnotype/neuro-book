# Agent SSE Front-End Contract

## User Request

- 复查当前 Agent 聊天界面 SSE 接收和气泡展示问题，尤其是：
  - 看不到思维链。
  - `/api/agent/sessions/:sessionId` 被频繁重复调用。
  - 所有工具看起来已完成，但发送按钮仍是停止按钮，用户不知道系统是否正常。
- 结合已有 task 文档确认：当前 Agent 主路径已经从 LangChain 切到 Pi-based `server/agent`，SSE 事件应基于 Pi event 扩展。
- 新建任务文档，规范 SSE 事件和前端展示合同，避免后续靠零散 hack 适配。

## Goal

- 前端只在加载、重连恢复、`snapshot_required`、本地发现 seq gap 或显式用户操作需要强一致 snapshot 时拉取一次历史；正常运行期间只通过 SSE 增量追加和更新 live UI。
- 前端支持自动重连：dev server reload、网络波动或 SSE 断开时，用户能看到连接状态，前端能用 `lastSeq` 自动续订；无法安全 replay 时只拉取一次 snapshot 恢复。
- 前端明确展示 run 阶段：模型思考/生成、工具调用参数流式生成、工具执行、工具输出流式更新、等待用户确认、已完成、已中断。
- 明确工具流式能力：模型生成 tool call arguments 的流式展示、工具执行过程中的 partial output 展示、通用工具气泡和专用工具气泡的职责边界。
- 评估并收敛当前前端接口结构，避免 `NovelAgentDrawer.vue`、`useAgentSession.ts`、`agent-message.ts` 之间继续增长隐式状态和补丁逻辑。

## Initial Diagnosis

- 后端主路径已经是 Pi-based `server/agent`。旧 v2 只作为迁移参考，不进入 active runtime。
- 正式 HTTP 入口是 `/api/agent/sessions/**`：
  - `GET /api/agent/sessions/:sessionId` 返回 session snapshot。
  - `GET /api/agent/sessions/:sessionId/events?after=<seq>` 返回 SSE。
  - `POST /api/agent/sessions/:sessionId/invocations` 是阻塞式 invoke，SSE 同步 live event。
- SSE envelope 已固定为：

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

- 服务端 SSE route 使用 `payload.event.type` 作为 SSE event name，但前端 `readSseStream()` 当前只解析 `data:` JSON，不依赖 SSE event name。
- 当前 `.agent/workspace/sse_response` 抽样结果：
  - 122 个 frame，`seq=34..155`，无 seq gap。
  - 包含 `message_start/update/end`、`tool_execution_start/end`、`session_entry`、`session_state_changed`、`turn_start/end`。
  - 不包含 `agent_start` / `agent_end`，也不包含 `snapshot_required`。
  - `session_state_changed` 抽样里均为 `summary.status = "running"` 且 `activeInvocation` 非空。
  - assistant content block 只见到 `text` 与 `toolCall`，没有 `thinking` block。
- 初始前端状态：
  - `useAgentSession.ts` 只在 `agent_start` / `agent_end` 和 snapshot `activeInvocation` 上维护 `running`，对 `turn_start` / `turn_end` 没有 UI phase 语义。
  - `NovelAgentDrawer.vue` 在每条 SSE event 后检查 `session.needsSnapshot`，若为 true 立即 `GET /api/agent/sessions/:sessionId`；缺少 snapshot request single-flight、触发原因记录和重连状态。
  - `agent-message.ts` 能从 Pi `message_*` 和 `tool_execution_*` 投影聊天消息和工具卡，但 message/run/session 连接状态混在一起。
  - `AgentTextBubble.vue` 只有 `message.thinking` 非空时展示思维链；若后端不产出 `thinking` block，前端不会显示。
  - `AgentWriteFileBubble.vue` 已能从 streaming args 文本中提取 `path` / `content`，所以 write 工具参数实时预览方向是存在的。
  - 通用 `AgentToolNode.vue` 已能显示 args/result/error；`tool_execution_update` 会更新 `result/rawResult`，但当前 harness 普通工具执行只 emit start/end，尚未把工具内部 partial output 发出来。

## Current Implementation

- 前端已新增 `useAgentSessionStream()`，负责 SSE connect/reconnect/backoff、`lastSeq` 续订、`snapshot_required` / seq gap 恢复和 snapshot single-flight。
- `useAgentSession()` 已增加 connection state、live run status、run phase 和 snapshot reasons；`connected` 不推进 durable `lastSeq`，`session_state_changed.snapshot` 直接 apply。
- `NovelAgentDrawer.vue` 不再直接管理 SSE `AbortController` / ready promise；发送前通过 stream manager ensure，command/tree response 自带 snapshot 时直接 apply，并校验 sessionId。
- `AgentComposer.vue` 已显示连接状态和 run phase；事件连接多次失败时提供“重连”和“刷新历史”入口。
- `agent-message.ts` 已支持 `assistantMessageEvent` 按 `contentIndex` 合并 text / thinking / toolCall block，并保留 `assistantContent` 避免从扁平 UI 字段反推顺序。
- `readSseStream()` 已等待 async `onEvent`，避免异步 client patch / reducer 处理期间后续 frame 抢先 apply。
- 工具参数流式已在前端 reducer 和工具气泡层保留能力；工具执行输出流式合同保留，但本轮未接后端 tool `onUpdate`。
- `agent-message.ts` 已为 `tool_execution_start/update/end` 增加 live fallback：当工具执行事件先于可见 assistant toolCall 到达时，先创建 `tool-execution:<toolCallId>` 临时工具气泡；后续真实 assistant toolCall 到达时按 `toolCallId` 合并运行状态并移除临时气泡。
- 运行中刷新恢复已补 `snapshot.eventCursor`：snapshot 返回稳定历史和真正恢复 cursor，`latestSeq` 只表示 EventHub 尾部；如果当前 turn 有已发 SSE 但尚未落盘的 transcript，前端会从 `eventCursor.after` replay 这些 runtime event。

## Event Contract

### Transport Rules

- `seq` 是 session event stream 的单调递增序号，前端必须用它做去重和 gap detection。
- `snapshot.eventCursor` 是应用 snapshot 后的恢复点；`lastSeq` 是前端已经实际应用到的 event seq，普通断线重连时使用 `events?eventEpoch=<currentEpoch>&after=<lastSeq>`。
- 前端收到 `payload.seq <= lastSeq` 必须丢弃。
- 前端收到 `payload.seq > lastSeq + 1` 必须进入 `needsSnapshot`，暂停继续猜测 live state，拉取一次 snapshot 后再继续。
- 正常 SSE 增量不应触发 snapshot 拉取。
- `snapshot_required` 是服务端明确告诉客户端 replay 不安全；处理方式和 seq gap 一致。
- `connected` 只表示 SSE HTTP 连接已建立，不代表 session 已恢复，不改变消息或 running 状态。
- SSE 断开不是 run error。前端应显示连接状态，并自动重连；只有后端 session lifecycle error 才投影为 Run Error 卡。

### Pi Events

| Event | Source | Front-End Rendering Rule |
| --- | --- | --- |
| `agent_start` | Pi Agent run 开始 | 设置 run 为 active；如果 snapshot 已有 `activeInvocation`，保持一致。不要拉 snapshot。 |
| `turn_start` | 新一轮 ReAct turn 开始 | 设置 live phase 为 `model_pending` 或 `thinking`；如果上一轮工具都已结束但 run 继续，必须显示“正在继续生成/思考”，避免用户误以为卡死。 |
| `message_start` | user / assistant / toolResult message 开始 | user 通常来自 session entry 或 optimistic message；assistant 创建/更新 live assistant bubble；toolResult 用于补工具结果。空 assistant start 也应显示轻量生成状态。 |
| `message_update` | assistant partial message | 根据 `event.message.content` 和 `assistantMessageEvent` 更新同一条 live assistant bubble。必须支持 text/thinking/toolCall 多 block 交错。不要依赖事件连续性。 |
| `message_end` | message 完成 | assistant bubble 标记为本轮 message 完成；如果 assistant 只有 toolCall 且随后进入工具执行，文本气泡可收窄但不能丢失 thinking。toolResult end 更新对应工具结果。 |
| `tool_execution_start` | 工具开始执行 | 对应 tool call 状态从 `streaming` 变为 `running`，展示工具名、参数、执行中状态。如果没有已有 assistant toolCall，必须创建 live fallback 工具气泡，避免长耗时/阻塞工具看起来像卡住。 |
| `tool_execution_update` | 工具执行过程 partial output | 更新工具卡 result/progress/rawResult。若对应工具气泡尚不存在，也必须创建 live fallback 并保持 `running`。通用工具气泡应可显示 streaming result；专用气泡可按工具 schema 渲染结构化进度。 |
| `tool_execution_end` | 工具执行完成 | 工具状态变为 `success` / `error`，写入最终 result/error/rawResult。若此前没有 start 或 assistant toolCall，仍创建完成态 live fallback，直到 snapshot/session entry 给出稳定历史。 |
| `turn_end` | 一轮 LLM call + tool execution 结束 | 当前 turn 完成，但不一定代表 run 结束。若后续还有 `turn_start`，UI 应显示继续运行。可用作清理 turn-local pending 状态。 |
| `agent_end` | run 最终结束 | 设置 run 为 idle；清理 live phase；保留最终消息和工具状态。若缺失该事件，最终状态必须能由 `session_state_changed.snapshot.activeInvocation = null` 恢复。 |

### Assistant Message Sub-Events

`message_update.assistantMessageEvent` 来自 Pi AI streaming event。前端不应只看最终 `event.message.content`，需要使用 sub-event 做更稳定的 live patch。

| Assistant Sub-Event | Rendering Rule |
| --- | --- |
| `start` | 初始化 assistant live message。 |
| `text_start` | 在 `contentIndex` 创建 text block。 |
| `text_delta` | 将 delta 追加到指定 text block。 |
| `text_end` | 用完整 content 覆盖指定 text block，标记该 block 完成。 |
| `thinking_start` | 在 `contentIndex` 创建 thinking block，并展示可折叠思维链区域。 |
| `thinking_delta` | 追加 thinking delta。即使正文还没出现，也要显示“思考中”。 |
| `thinking_end` | 用完整 thinking 覆盖指定 block，标记思维链完成。 |
| `toolcall_start` | 在 `contentIndex` 创建 tool call，工具卡状态为 `streaming`，展示正在生成参数。 |
| `toolcall_delta` | 按 `contentIndex` 更新 partial args。write/edit/apply_patch 等专用气泡应实时预览参数内容。 |
| `toolcall_end` | 用完整 tool call 覆盖 partial args，状态仍为 `streaming`，等待 `tool_execution_start`。 |
| `done` | provider stream 完成；最终消息以 outer `message_end` 为准。 |
| `error` | provider stream error/abort；最终 error message 以 outer `message_end` 或 invocation lifecycle 为准。 |

Pi 明确允许 text、thinking、toolcall block 交错到达；前端 reducer 必须以 `contentIndex` 合并，不能假设 `*_start -> *_delta -> *_end` 是连续片段。

### Session Control Events

| Event | Front-End Rendering Rule |
| --- | --- |
| `connected` | 标记 SSE connected；不改消息，不改 run。 |
| `snapshot_required` | 设置连接状态为 recovering；单飞拉取一次 snapshot；成功后用 snapshot 恢复并清空 live patch。 |
| `session_entry` | 将 append-only session entry 投影到消息列表。用于 prompt user message、profile reminder、toolResult、invocation lifecycle error 等稳定历史追加。 |
| `session_state_changed` | 更新 snapshot shell、summary、activeInvocation、pendingApproval、linkedAgents、usage、model、planMode 等 session 状态。不得无条件触发额外 snapshot。 |
| `follow_up_queued` | 更新 follow-up queue UI；不作为普通 user message 展示，直到后端 drain 并写入 session entry。 |
| `invocation_aborted` | 进入 aborting / stopped 状态；等待后续 `session_state_changed` 或 snapshot 确认。 |
| `client_variable_patch_requested` | 前端执行 client state patch 并 ack；不展示为聊天消息。失败 ack 应进入后端变量管线，不要写入普通 UI error state。 |

## Front-End State Model

推荐把前端状态拆成四层，避免 `NovelAgentDrawer.vue` 同时承担 API、连接、消息 reducer 和 UI 派生。

1. Transport state
   - `connectionStatus: "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected"`
   - `lastSeq`
   - `reconnectAttempt`
   - `lastDisconnectReason`
   - `snapshotRequestInFlight`

2. Session snapshot state
   - `summary`
   - `activeInvocation`
   - `pendingApproval`
   - `linkedAgents`
   - `usage`
   - `model`
   - `planModeActive`

3. Live invocation state
   - `invocationId`
   - `runStatus: "idle" | "running" | "waiting" | "aborting"`
   - `phase: "idle" | "model_pending" | "thinking" | "assistant_streaming" | "tool_args_streaming" | "tool_running" | "tool_streaming" | "waiting_user" | "finishing"`
   - `currentTurnIndex`
   - `activeToolCallIds`

4. Chat projection state
   - Stable messages derived from snapshot/session entries.
   - Live assistant/tool patches derived from Pi events.
   - Optimistic user message kept separate until matching session entry arrives.

`running` should become a derived value:

```ts
running = Boolean(snapshot.activeInvocation)
    || live.runStatus === "running"
    || live.runStatus === "aborting";
```

Button shape should use `running` only for whether click means stop. User-facing status text should use `connectionStatus + live.phase`，例如“工具已完成，正在继续生成下一步回复”。

## Snapshot Fetch Rules

- Initial load:
  - `GET /api/agent/sessions/:sessionId` once.
  - Apply snapshot.
  - Subscribe SSE with `eventEpoch = snapshot.eventCursor.eventEpoch` and `after = snapshot.eventCursor.after`.

- Normal SSE:
  - Do not fetch snapshot.
  - Apply event reducer only.

- Reconnect:
  - Keep current messages visible.
  - Show reconnecting banner/status.
  - Reconnect with `after = lastSeq`.
  - If replay succeeds, continue.
  - If `snapshot_required` or seq gap occurs, fetch one snapshot.

- User operations that return snapshot:
  - `tree`、`command`、`model` 等如果 HTTP response 已含 snapshot，直接 apply，不再额外 `getSession`。

- Error result fallback:
  - Blocking invocation 返回 error 时可以拉一次 snapshot，用于补 Run Error 卡。
  - 如果 snapshot 中已经有同 invocation 的 visible error，不再重复 notification。

- Single-flight:
  - 任意时刻同一个 session 最多一个 snapshot fetch。
  - 多个触发原因合并到同一次 fetch 的 `reasons[]` 里记录，用于调试。

## Reconnect Contract

- `readSseStream()` 结束或抛非 AbortError 时，不应直接把 run 设置为 idle。
- 前端应：
  1. 标记 `connectionStatus = "reconnecting"`。
  2. 展示非阻塞提示：“Agent 事件连接断开，正在重连...”
  3. 按指数退避重连，例如 300ms、800ms、1500ms、3000ms，上限 5s。
  4. 使用 `lastSeq` 续订。
  5. 重连成功后提示恢复，清空错误状态。
  6. 连续失败时保持可点击“重新连接”和“刷新历史”。
- dev server reload 场景：
  - 内存 event hub 会丢 replay buffer。
  - 服务恢复后订阅可能收到 `snapshot_required`，或因为 seq 从新进程开始导致 gap。
  - 前端只拉一次 snapshot 恢复，不反复轮询历史。

## Tool Streaming

### Tool Arguments Streaming

- 已具备基础能力。
- Pi `toolcall_delta` 会把 partial args 放进 assistant partial message。
- `agent-message.ts` 当前已从 `event.message.content` 派生 tool call args。
- `AgentWriteFileBubble.vue` 已通过 `extractStreamingStringField()` 在 JSON 尚未完整时提取 `path` / `content`，可以实时预览 write 参数。
- 后续应把这个能力规范化：
  - 通用工具气泡展示 partial args。
  - 专用工具气泡可按字段实时预览。
  - args JSON 未完整时不要显示 parse error，只显示“参数生成中”。

### Tool Result Streaming

- 前端已有入口，但后端还没有完整使用。
- `agent-message.ts` 已处理 `tool_execution_update`，会把 `partialResult` 写入 tool call 的 `result/rawResult` 并保持 `running`。
- `AgentToolNode.vue` 通用工具气泡能展示 result 文本或 JSON。
- 当前 harness `runToolBatch()` 只 emit `tool_execution_start` 和 `tool_execution_end`；普通工具没有把内部 progress 传给 `tool_execution_update`。
- `NeuroAgentTool.executeWithContext()` 和 `AgentTool.execute` 的签名已经预留 `onUpdate` 参数，但 harness 需要把它接到 `emit({ type: "tool_execution_update", partialResult })`。
- 因此：
  - write 工具“参数实时预览”可以通过 toolcall args streaming 达成。
  - bash/read/write/edit/apply_patch 的“执行输出实时流式展示”需要补 harness/tool 层 onUpdate 转发。
  - 通用工具气泡可以适配流式工具输出，但需要规范 partial result 形状，例如 `{ kind: "stdout_delta", text }`、`{ kind: "progress", message }`、`{ kind: "file_preview", path, contentDelta }`。

## Code Interface Assessment

初始诊断时，当前接口不是不可维护，但已经开始混乱，主要问题是状态边界不清：

- `NovelAgentDrawer.vue` 同时做 session 加载、SSE lifecycle、snapshot recovery、用户操作、notification、model state 同步和 UI glue。
- `useAgentSession.ts` 名义上是 session store，但里面同时处理 snapshot、Pi event、session control event、running、pending user input 和 gap detection。
- `agent-message.ts` 既做稳定 snapshot 投影，也做 live Pi event reducer，还包含工具状态合并、旧坏历史防御和 pending approval 投影。
- `running` 来源混合了 `agent_start/agent_end`、snapshot `activeInvocation`、abort 事件和 stream catch fallback；这导致“工具都完成但按钮仍是停止”时缺少解释性 phase。
- snapshot 拉取策略在 Drawer 层，难以保证 single-flight、防抖和触发原因可观测。

推荐重构方向：

- 保留现有组件视觉结构，先提纯状态层，不大改 UI。已按此方向落地第一版。
- 新增或重组一个 `useAgentSessionStream()`：已完成。
  - 负责 SSE connect/reconnect/backoff。
  - 负责 `lastSeq`、gap detection、`snapshot_required`、single-flight snapshot recovery。
  - 输出 connection state 和 reconnect actions。
- 将 `useAgentSession()` 收窄为纯 reducer：已部分完成，HTTP 和 stream lifecycle 已外移；消息投影仍在 `agent-message.ts`。
  - `applySnapshot(snapshot)`
  - `applyEvent(event)`
  - `applyConnectionState(state)`
  - 不直接发 HTTP。
- 将 `agent-message.ts` 拆分为：尚未执行，后续如继续增长再拆。
  - snapshot projection。
  - live Pi event projection。
  - tool call merge/status helpers。
  - pending approval projection。
- 明确 `AgentRunPhase` 类型，避免 UI 从工具状态和 running boolean 反推用户文案。已完成第一版。

## Optimization Recommendations

后续实现优先按下面顺序推进，避免先改视觉气泡却没有解决事件消费模型。

1. Snapshot recovery 收口
   - snapshot 是恢复真相，不是日常同步手段。
   - 正常 SSE 事件只走 reducer，不触发 `GET /api/agent/sessions/:sessionId`。
   - 所有 snapshot fetch 必须 single-flight，并记录 reason：`initial_load`、`seq_gap`、`snapshot_required`、`manual_refresh`、`invoke_error_fallback` 等。

2. Stream manager 抽离
   - 从 `NovelAgentDrawer.vue` 抽出 `useAgentSessionStream()` 或等价模块。
   - 该模块只负责 connect/reconnect/backoff、`lastSeq`、去重、gap detection、`snapshot_required`、snapshot single-flight 和 connection state。
   - Drawer 只消费 stream state、session state 和用户操作回调。

3. Connection state 与 run phase 显式化
   - 连接状态使用 `connecting` / `connected` / `reconnecting` / `recovering` / `disconnected`。
   - run phase 使用 `model_pending` / `thinking` / `assistant_streaming` / `tool_args_streaming` / `tool_running` / `tool_streaming` / `finishing` / `waiting_user`。
   - 发送按钮是否是停止按钮只由 active invocation 决定；用户可见文案由 connection state + run phase 决定。

4. Live reducer 正规化
   - live assistant/tool 更新以 `message_update.assistantMessageEvent` 为主。
   - `event.message.content` 只做完整 block 兜底校准。
   - reducer 必须按 `contentIndex` 合并 text、thinking、toolCall block，不能假设事件连续到达。

5. 工具流式拆成两条链
   - tool arguments streaming 来自 `toolcall_delta`，用于实时展示 write/edit/apply_patch 等工具参数。
   - tool result streaming 来自 `tool_execution_update`，用于展示 bash stdout、progress、file preview 等执行输出。
   - `tool_execution_update.partialResult` 第一版使用小型 discriminated union，不直接传任意字符串。

6. SSE dev observability
   - 增加 dev-only 调试信息：`lastSeq`、connection state、reconnect count、最近 event type、最近 snapshot reason、active invocation id、run phase。
   - 这类信息可以先放在隐藏调试面板或 console debug，不进入普通用户主流程。

7. Event hub 长期边界
   - 当前单进程 memory replay 可以继续作为第一版。
   - dev reload、多 worker、多实例部署都必须通过 snapshot 恢复兜底。
   - 如果未来要支持多实例实时 fan-out，再考虑 Redis pub/sub、数据库通知或持久 event stream，不让前端假设所有事件永远可 replay。

## Proposed Implementation Plan

1. 文档和事件合同
   - 本文档先固定 SSE event 与前端渲染规则。
   - 同步 `docs/modules/agent/harness.md` 中 SSE 段落，避免迁移文档和稳定模块文档漂移。

2. 前端重连与 snapshot single-flight
   - 增加 connection state。
   - `subscribeSessionEvents()` 断线后自动 reconnect。
   - `syncActiveSessionSnapshot()` 改为 single-flight，记录 reasons。
   - 去掉“每个 event 后只要 needsSnapshot 就立即可能重复拉”的路径。

3. Live phase reducer
   - 支持 `turn_start` / `turn_end`。
   - 支持 `message_update.assistantMessageEvent` 的 text/thinking/toolcall block reducer。
   - UI 展示“正在思考/正在生成工具参数/执行工具/继续生成/重连中”。

4. Tool streaming
   - harness 在执行工具时把 `onUpdate` 转成 `tool_execution_update`。
   - 先让 bash 或一个可控测试工具输出 partial result，验证通用工具气泡。
   - write 工具参数预览继续基于 `toolcall_delta`，不和执行输出混在一起。

5. Tests and verification
   - reducer unit tests：seq duplicate、seq gap、snapshot_required、turn_start after all tools done、thinking_delta、toolcall_delta、tool_execution_update。
   - stream/reconnect unit or harness tests：断线重连后 replay、replay 过期后 snapshot_required。
   - 前端手动验收：dev server reload、网络断开/恢复、多窗口同 session、长 tool args streaming、tool output streaming。

## Decisions

- 不恢复旧 LangChain `assistant_delta` / `thinking_delta` / `tool_started` 那套前端事件名。新合同以 Pi `AgentEvent` 为主，Neuro Book 只在 `kind: "session"` 下补 session control event。
- 不把 `kind: "runtime" | "session"` 合并成单一 runtime custom event。runtime event 表达 Agent loop，session control event 表达产品层恢复、状态和 UI patch；两者保持 envelope 层区分。
- `turn_end` 不等于 run end。发送按钮是否为停止取决于 active invocation；用户文案取决于 live phase。
- 工具参数流式和工具执行输出流式是两件事：
  - 参数流式来自 model assistant message 的 `toolcall_delta`。
  - 输出流式来自 tool runtime 的 `tool_execution_update`；当前保留能力和事件合同，但具体工具执行输出流式可以后置实现。
- snapshot 是恢复真相，不是普通 live update 手段。正常流式 UI 不应靠频繁拉历史修正。

## Grill Review

本节记录对当前合同的追问和默认推荐答案。后续实现若需要改变这些答案，应先更新本文档。

### 1. 中途订阅是否必须 replay `agent_start` / `agent_end`

推荐答案：不强制。

SSE replay 是 bounded memory buffer，不能保证客户端中途订阅时一定看到本次 invocation 的 `agent_start`。前端 run truth 必须由 snapshot `activeInvocation` 和 live Pi event 共同决定：

- 初始加载通过 snapshot 判断当前是否正在运行。
- 正常 live 期间收到 `agent_start` / `agent_end` 可以即时更新。
- 重连 replay 期间如果缺少 run boundary event，以 snapshot 或 `session_state_changed.snapshot.activeInvocation` 纠偏。

这解释了 `.agent/workspace/sse_response` 中没有 `agent_start` / `agent_end` 但 session 仍为 running 的情况。它不一定是后端 bug，但前端不能再依赖这两个事件作为唯一 running 来源。

### 2. `connected.seq` 是否参与 `lastSeq`

推荐答案：`connected` 不应推进 durable `lastSeq`。

当前 route 把 `connected.seq` 设置为 query `after` 或 `0`，它只是连接确认，不是 hub 发布事件。前端应该把它视为 transport 状态，不参与 gap detection、去重和 replay 恢复点推进。若继续复用 `AgentSessionEventDto` envelope，也要在 reducer 中对 `connected` 特判为“不更新 lastSeq”。

### 3. `session_state_changed.snapshot` 是否可以直接 apply snapshot

推荐答案：可以 apply，但不能触发额外 `GET /sessions/:id`。

`session_state_changed.snapshot` 已经携带完整 snapshot，应视作本次事件自带的恢复真相。前端可以直接 `applySnapshot(payload.event.snapshot)`，同步 model/profile/usage 等 UI shell；但不应因为它再设置 `needsSnapshot`。这也是去掉频繁拉历史的关键。

### 4. 工具都完成但按钮仍是停止，UI 应该显示什么

推荐答案：按钮仍可保持停止，但必须显示 phase。

只要 `activeInvocation` 仍非空，发送按钮保持停止是正确的，因为 Agent 可能正在进入下一轮模型生成、等待 provider 首 token、运行 ingest，或准备最终 commit。问题不是按钮形态本身，而是缺少 `phase` 文案。前端应在 `tool_execution_end` 后、下一次 `turn_start/message_start/agent_end` 前显示类似“工具已完成，正在继续生成下一步”的状态。

### 5. 思维链不可见时应先查前端还是后端

推荐答案：先查事件 payload。

前端只有在 message content 或 `assistantMessageEvent` 里出现 thinking block / thinking sub-event 时才能展示思维链。当前截取的 SSE 没有 thinking block，因此这不是单纯的气泡渲染问题。排查顺序应是：

1. provider 是否返回 reasoning/thinking。
2. Pi model adapter 是否保留 thinking。
3. harness 是否把 thinking 写入 `message_update.assistantMessageEvent` 或 `event.message.content`。
4. 前端 reducer 是否按 `contentIndex` 合并并渲染。

当前规范把 thinking 强度放在 Agent Profile 和当前 session 覆盖上，而不是放在模型配置页。模型配置页的 `reasoning` 只表示模型能力；Profile `reasoningEffort` 是默认强度；session snapshot 的 `thinkingLevel` 为 `null` 时跟随 Profile，为 `"off"` 时显式关闭，为 `"minimal" | "low" | "medium" | "high" | "xhigh"` 时显式覆盖。

### 6. `assistantMessageEvent` 与 `event.message.content` 谁是主数据源

推荐答案：live reducer 以 `assistantMessageEvent` 为主，`event.message.content` 为兜底校准。

`assistantMessageEvent` 更适合增量 patch，尤其是 `thinking_delta`、`toolcall_delta` 和 block 交错。`event.message.content` 适合作为完整快照兜底：事件乱序、delta 丢失、或收到 `*_end` 时，用完整 block 覆盖 partial block。

### 7. `tool_execution_update.partialResult` 的最小规范

推荐答案：先规范为小型 discriminated union，不直接传任意字符串。

建议第一版只支持这些通用形状：

```ts
type ToolPartialResult =
    | {kind: "stdout_delta"; text: string}
    | {kind: "stderr_delta"; text: string}
    | {kind: "progress"; message: string}
    | {kind: "file_preview"; path: string; contentDelta?: string; content?: string};
```

通用工具气泡按 `kind` 做基础展示；专用工具气泡只负责更好的字段布局，不改变事件语义。

### 8. 重连提示放在哪里

推荐答案：composer 附近常驻轻量状态 + notification 只用于长时间失败。

SSE 断线不是 run error，不应投影为聊天错误卡。短暂断线在 composer/status strip 上显示“正在重连”；连续失败或需要用户操作时再弹 notification，并提供“重新连接 / 刷新历史”操作。

### 9. 是否把 `kind: "runtime" | "session"` 合并成单一 custom event

推荐答案：不合并。

`kind: "runtime"` 与 `kind: "session"` 的边界不是编码风格问题，而是语义边界：

- Pi event 是 Agent loop 内事件，描述模型输出、工具调用和 turn lifecycle。
- session event 是 Neuro Book 产品层事件，描述恢复真相、session entry、follow-up queue、client variable patch、snapshot recovery。
- `connected` 和 `snapshot_required` 更接近 transport/recovery 事件，不应该伪装成 Agent loop custom event。

如果全部塞进 Pi custom，前端 reducer 会重新开始猜“这个 custom 到底是模型事件还是产品事件”，长期会让恢复和重连逻辑变浑。当前稳定 reference 继续保留 envelope 层 `kind` 区分。

## Files Changed

- Spec / docs:
  - `docs/tasks/14-agent-sse-front-end-contract/README.md`
  - `docs/modules/agent/harness.md`
  - `reference/agent/sse.md`
  - `reference/README.md`
  - `PROJECT-STATUS.md`
- Front-end runtime:
  - `app/components/novel-ide/NovelAgentDrawer.vue`
  - `app/components/novel-ide/agent/AgentComposer.vue`
  - `app/components/novel-ide/agent/useAgentSession.ts`
  - `app/components/novel-ide/agent/useAgentSessionStream.ts`
  - `app/components/novel-ide/agent/agent-message.ts`
  - `app/composables/useAgentSessionApi.ts`
  - `app/utils/http/read-sse.ts`
- Tests:
  - `app/components/novel-ide/agent/useAgentSession.test.ts`
  - `app/components/novel-ide/agent/useAgentSessionStream.test.ts`
  - `app/components/novel-ide/agent/agent-message.test.ts`
  - `app/utils/http/read-sse.test.ts`

## Initial Documentation Verification

- 初始阶段只新增规划/合同文档，尚未改运行代码。
- 已读取并对齐：
  - `docs/tasks/02-pi-agent-harness-migration/README.md`
  - `docs/tasks/07-agent-turn-commit-boundary/README.md`
  - `docs/modules/agent/harness.md`
  - `server/agent/harness/neuro-agent-harness.ts`
  - `shared/dto/agent-session.dto.ts`
  - `app/components/novel-ide/agent/useAgentSession.ts`
  - `app/components/novel-ide/agent/agent-message.ts`
  - `app/components/novel-ide/NovelAgentDrawer.vue`
  - `.agent/workspace/sse_response`

## Implementation Result

- 已新增 `useAgentSessionStream()`，把 SSE connect/reconnect/backoff、`lastSeq` 续订、`snapshot_required` / seq gap 恢复和 snapshot single-flight 从 `NovelAgentDrawer.vue` 中抽出。
- `useAgentSession()` 已补 connection state、live run status、run phase 和 snapshot reasons；`connected` 不再推进 durable `lastSeq`，`session_state_changed.snapshot` 直接 apply。
- `NovelAgentDrawer.vue` 不再直接持有 SSE `AbortController` / ready promise，发送前只调用 stream manager ensure。
- `AgentComposer.vue` 增加连接状态和 run phase 胶囊，工具完成后 active invocation 仍在时会显示“工具已完成，正在继续生成”一类状态，而不是只有“运行中”。
- `AgentComposer.vue` 在事件连接连续失败后提供“重连”和“刷新历史”入口；重连只重建 SSE，刷新历史走 snapshot single-flight。
- `agent-message.ts` 已把 `assistantMessageEvent` 收敛为按 `contentIndex` 合并 text / thinking / toolCall block；`event.message.content` / `partial.content` 作为完整 block 兜底校准，避免 toolCall block 前面有 thinking/text 时更新错工具。
- `agent-message.ts` 已修复 `invoke_agent` 阻塞期间不显示工具气泡的问题：后端 `runToolBatch()` 会在 `await executeTool()` 前发出 `tool_execution_start`，但前端之前只更新已存在的 tool call；当 assistant toolCall 没有先投影出来时，`tool_execution_start` 会被无声丢弃。现在 `tool_execution_start/update/end` 都会按 `toolCallId` upsert live fallback 工具气泡，`invoke_agent` 会立即显示执行中状态和 `sessionId` 参数。
- fallback 工具气泡是 live UI 临时层，不改变 append-only 历史语义。真实 assistant toolCall 后到时，前端会把 fallback 上的 `running/success/error/result/linkedSessionId` 合并回真实消息，并移除 `tool-execution:<toolCallId>` 临时节点；snapshot 仍是恢复真相。
- 工具执行输出流式仍保留 `tool_execution_update` 前端能力，但本轮未接后端 tool `onUpdate`，符合当前“保留能力、暂不支持具体工具输出流式”的决策。

## Initial Implementation Verification

- `bunx vitest run app/components/novel-ide/agent/useAgentSessionStream.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts`
  - 结果：通过，3 个测试文件，15 个测试。
- `bunx tsc --noEmit --pretty false --skipLibCheck`
  - 结果：通过。

## Review Fix Result

- 修复 `readSseStream()` 未等待 async `onEvent` 的问题，避免 `client_variable_patch_requested` 等异步事件处理期间后续 seq 抢先 apply，造成假 seq gap 或漏进 reconnect catch。
- 修复 seq gap reducer：发现 `payload.seq > lastSeq + 1` 后只标记 `seq_gap` 和 snapshot recovery，不再推进 `lastSeq`，也不继续应用缺口后的 live event。
- `agent-message.ts` 为 live assistant message 保留 `assistantContent` 原始 block 列表，后续 `assistantMessageEvent` 继续按 Pi `contentIndex` 合并，避免从扁平 `content/thinking/toolCalls` 反推 block 顺序时更新错工具参数。
- `NovelAgentDrawer.vue` 新增 `applySnapshotOrSync()`，对 command/tree HTTP response 中已返回的 snapshot 直接 apply；只有没有 snapshot 时才兜底拉取一次历史。
- 修复 snapshot single-flight 的 session 隔离：in-flight snapshot 只允许回写发起时的 session，切换 session 后旧请求完成会被丢弃。
- 修复 stream stop 后同 session in-flight snapshot 仍可能回写的问题；snapshot recovery 增加 generation guard，`stop()` 后旧请求完成会被丢弃。
- 修复首帧 `message_update` 缺少 previous live message 时丢 delta 的问题；即使 replay 中没有 `message_start`，也会从当前 update 建立 baseline 并应用 `assistantMessageEvent`。
- 修复 command/tree HTTP response snapshot 的会话隔离：`applySnapshotOrSync()` 只应用当前 active session 的 snapshot，避免旧请求返回覆盖当前 UI。
- 修复 manual refresh / invoke error fallback 把 transport 状态伪造成 `connected` 的问题；普通 snapshot fetch 不再改变 SSE 连接状态。
- 修复 tool call placeholder 残留问题：`toolcall_end` 带真实 id 到达后，会按同 content index 替换 `content-*` 占位工具，避免 ghost tool call 长期停留在 streaming。
- 修复旧 snapshot 请求的 `finally` 清掉新 single-flight 的竞态；snapshot promise 现在按请求对象精确清理。

## Current Verification

- `bunx vitest run app/utils/http/read-sse.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts`
  - 结果：通过，4 个测试文件，28 个测试。
- `bunx tsc --noEmit --pretty false --skipLibCheck`
  - 结果：通过。

## TODO / Follow-ups

- 真实浏览器验收前端 SSE 重连、手动重连、snapshot single-flight、dev reload 恢复、多窗口、长工具参数流式和工具执行输出流式。当前未做自动浏览器验证。
- 保留 tool execution streaming 合同；具体工具输出流式可以后置实现，优先保证工具参数流式、start/end 和最终结果可靠。
- 后续如启用工具执行输出流式，将通用工具气泡的 streaming result 体验做成默认能力，专用工具气泡只做更高质量展示。

## Task 106 后续合同演进（2026-07-15）

本任务前文保留的是当时实现记录；当前恢复合同已由 Task 106 演进：

- `GET /api/agent/sessions/:id` 默认返回有界 recovery shell 与最新 history 尾页；更早历史通过同一 GET 的 `view=history&cursor=...` 查询。
- command/tree active-path mutation 返回 `AgentSessionLiveStateDto`，不再内嵌完整 snapshot。若 revision 变化，前端进入与 SSE 共用的 recovery single-flight。
- `session_state_changed` 只携带 live state，不再携带完整 snapshot；它可以更新 shell 并触发统一 recovery，但不能直接替代 recovery response。
- `snapshot_required`、seq gap、event epoch 变化、active path 变化和 invalid history cursor 都复用同一 recovery 调度，不建立平行请求状态。
- Task 107 已将 runtime event 改为有界公开投影；Task 106 的 durable history 使用同一个 `AgentChatEntryDto` projector。
- EventHub 只保存一次序列化的 immutable public frame，并按 UTF-8 bytes 管理 event/replay/subscriber 预算；公开 route 不再重新 stringify raw Pi event。
- Task 22 原始预算现有直接回归：`session_state_changed < 50 KiB`、`agent_end < 5 KiB`；10 MiB tool result 只进入有界 preview。更通用的单事件 hard limit 仍为 128 KiB。

因此前文关于 `session_state_changed.snapshot`、command/tree response snapshot 和 `applySnapshotOrSync()` 的描述仅是历史实现记录，不是当前接口契约。

## Task 111 重连治理加固（2026-07-27）

- Agent Session 改用共享 `SseReconnectBackoff`：`onOpen` 立即完成 ready 并显示 connected，但不清零内部失败序列。
- 连接连续存活至少 5 秒后，下一次断线才从 300ms 重新开始；正常 EOF 与 rejection 都计入 `300/800/1500/3000/5000ms` 序列。
- recovery 成功、手动重连、新 session target 和 stop 显式 reset；主动 abort 与旧代次不安排重连。
- 该 Module 只共享退避，不改变 Session cursor、recovery single-flight 或 reducer 合同。
- 短连接回归继续纳入 Task 111 三路 SSE 聚焦组合。2026-07-27 审查补漏后，17 文件组合实际为 129 项通过；旧 16 文件 / 111 项记录没有覆盖本轮 Project 通知周期与 dispose 场景，不再作为当前验证结论。
