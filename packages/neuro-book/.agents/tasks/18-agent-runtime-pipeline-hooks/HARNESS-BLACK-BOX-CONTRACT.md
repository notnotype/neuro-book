# Harness 黑盒合同

## 目的

本文在讨论 `NeuroAgentHarness` 的内部 pipeline 之前，先定义它的外部行为合同。

方法是：

1. 把 Harness 当成黑盒。
2. 列出用户可见的 invocation 输入。
3. 列出粗粒度、可观察的运行状态。
4. 定义预期输出：
   - session writes
   - SSE events
   - HTTP invocation response
   - frontend state changes
5. 从这个外部合同反推内部状态机和 pipeline。

这个合同刻意从用户操作出发。Run Kernel、Turn Transaction、hook、ingest、save point 这些内部名字，必须由外部可观察行为来证明它们存在的必要性，而不是反过来用内部名字定义外部行为。

## 系统边界

Agent 系统目前有四个主要部分：

- **Harness**：invocation admission、运行态、steer/follow-up 队列、工具执行、approval waiting/resume、编排。
- **SSE events**：实时投递通道，用来发送 stream events、session entries、lifecycle changes、queue updates、snapshot invalidation。
- **Session**：持久化的 append-only 真相，目前由 JSONL entries、active path reducer 和 projection reducer 支撑。
- **Frontend state**：由 invocation response、SSE events 和 session snapshot 推导出来的 UI 状态。

本文只关注 Harness 作为黑盒时的行为。

```text
Harness(input, runtimeState, sessionState)
  -> session writes
  -> SSE events
  -> HTTP invocation response
  -> next runtimeState
```

## Invocation 与 Session Abort 输入

第一版覆盖 `AgentInvokeRequestDtoSchema` 的四种 invocation mode：

```ts
type AgentInvokeMode =
    | "prompt"
    | "continue"
    | "steer"
    | "followup";
```

本合同同时覆盖 Session abort 操作：

```ts
type AgentAbortRequestDto = {
    reason?: string;
    clearQueue?: boolean;
};
```

HTTP 入口为 `POST /api/agent/sessions/:sessionId/abort`。`sessionId` 必须是安全正整数；body 只接受上述字段，`clearQueue` 缺失时按 `true` 处理。非法 body/path 返回 400；主 Session 缺失返回 404 `SESSION_NOT_FOUND`。Abort admission 固定分三支：① `context.archived` 或 `summary.status === "archived"` 时，无论是否有 active invocation，直接返回 409 `session_abort_not_allowed`；② 非归档且没有匹配 active invocation（包括 Idle、Profile `missing`/`unloadable` 的 Session）时返回 200 `idle`，不写 lifecycle、resolution、queue 或 abort 事件；③ 有匹配 active invocation 时才检查 `interaction.canAbort`，允许则进入 Waiting/Running/Aborting 的 abort flow，拒绝则返回 409 `session_abort_not_allowed`。forced lifecycle 无法同步占据 SessionWriteExecutor queue 返回 503 `session_abort_durability_unavailable`、`retryable: true`。

本轮黑盒合同暂不覆盖：

- variables / client state
- slash commands
- tree/fork/retry commands
- manual compact
- model/thinking/plan commands
- linked-agent management

这些操作后续也应该用同样的黑盒方法单独定义。

Abort 成功响应为 `{status: "idle" | "aborted", sessionId}`：仅非归档 Session 在没有匹配 active invocation（包括重复取消已收口 invocation）时返回 `idle` 且没有副作用；Waiting User 的合作取消和 Running 的 accepted/forced abort 返回 `aborted`。Running 的 200 只表示唯一 forced plan 已被同一 per-session write queue 接受，不表示 HTTP 返回前物理 append 已完成。

同步 enqueue 失败时保持 `Aborting` ownership，不发布 `agent_end`、不 resolve 原 invocation gate，不写替代 lifecycle；调用方可以重试同一个 abort。enqueue 后 physical append/live-state/after-write 失败由同一 write queue 的 pending recovery 幂等重放，恢复失败阻止后续 `start` 越过旧 terminal，不直接 repository 写或重复追加 aborted lifecycle。

Abort 不改变普通 invocation 输入的其它排除范围。

## 粗粒度运行状态

第一版黑盒状态模型保持粗粒度：

- `Idle`：当前 session 没有 active invocation。
- `Running`：正在 provider call、tool batch、turn boundary 或 run settlement 中。
- `WaitingUser`：invocation 因 approval、`request_user_input` 或其他用户 resolution 暂停。
- `Aborting`：已经请求 abort，active run 正在被打断或清理。

这些是 UI 可观察状态，不是最终内部状态机。

## 输出通道

### Session Writes

Session writes 是持久事实，包括：

- 模型真实消费过的 user message
- 在 turn boundary 提交的 assistant message
- 在 turn boundary 提交的 tool result
- invocation lifecycle entry
- approval / user-input resolution tool result
- projection entry，例如 active-path-specific title/summary

重要规则：

- queued `steer` / `followup` message 在被 drain 并成为模型可见输入之前，不是 session history。

### SSE Events

SSE events 是实时 UI 信号。有些对应持久 session 事实，有些只对应运行态。

例子：

- invocation lifecycle events
- provider stream events
- tool call/tool result stream events
- `session_entry`
- `session_state_changed`
- `steer_queued`
- `follow_up_queued`
- rejection/error events，如果该请求已有订阅方或需要广播

重要规则：

- SSE 可以立即暴露 runtime queue，即使此时还没有任何 durable session entry 被写入。

### HTTP Invocation Response

Invocation response 是本次 HTTP 请求的直接结果。

它可能表示：

- accepted and completed
- accepted and entered waiting state
- accepted and queued
- rejected because the mode is invalid for the current state
- failed with an error

具体 response DTO 可以后续细化。黑盒合同关心的是语义。

### Frontend State

Frontend state 不是事实源。它由这些东西推导：

- HTTP invocation responses
- SSE events
- snapshot reloads
- session entries/projections
- snapshot/SSE 暴露出来的 runtime queue state

前端不应该从 queued item 推断持久事实。Queued item 在被消费之前只是 runtime state。

## 操作矩阵

下面的事件名是语义名。实现时可以映射到现有 SSE envelope。

### Abort 状态、事件与持久化顺序

| Runtime state | Abort operation | Harness result | Session writes | SSE result | Frontend state |
| --- | --- | --- | --- | --- | --- |
| `Idle`（非归档、无 active invocation；包括 Profile unavailable） | `POST /abort` | 返回 `idle`。 | 不写 lifecycle、resolution 或 queue。 | 不新增 abort 终态事件。 | 保持 idle。 |
| `Archived`（无论是否有 active invocation） | `POST /abort` | 返回 409 `session_abort_not_allowed`。 | 不写 abort lifecycle 或 resolution。 | 不新增 abort 事件。 | 保持 archived，只能恢复。 |
| 匹配 active 且 `interaction.canAbort === false` | `POST /abort` | 返回 409 `session_abort_not_allowed`。 | 不写 abort lifecycle 或 resolution。 | 只依赖 HTTP response。 | 保持现有 runtime state。 |
| `WaitingUser`（匹配 active 且 `canAbort === true`） | `POST /abort` | 返回 `aborted`，释放 waiting invocation。 | 写一次取消 resolution 和 `aborted` lifecycle。 | `invocation_aborted`，随后 `session_entry`/`session_state_changed` 与 `agent_end(aborted)`。 | 关闭 waiting UI，`activeInvocation=null`。 |
| `Running`（匹配 active 且 `canAbort === true`） | `POST /abort` 且合作收口 | 返回 `aborted`。 | 只允许一个匹配 invocation 的 `aborted` lifecycle；按 `clearQueue` 清理或暂停队列。 | 先 `invocation_aborted`，再 state/terminal event。 | 进入 aborting，最终回到 idle。 |
| `Running`（匹配 active 且 `canAbort === true`） | `POST /abort` 且 forced | 在 300ms 上界内返回 `aborted`；200 表示 forced plan 已入 queue。 | forced plan 只经 SessionWriteExecutor；后续 `start` 排在旧 aborted append 后。 | 迟到 provider/tool/settleRun 事件被 ownership fence 丢弃；终态发布 `agent_end(aborted)`。 | 最终 snapshot/state 的 `activeInvocation=null`。 |
| `Aborting`（匹配 active 且 `canAbort === true`） | 重复 `POST /abort` | 返回 idle 或同一 accepted 结果，不重复叠加 timer/terminal。 | 不追加第二个 aborted lifecycle。 | 不重复发送终态事件。 | 保持现有 aborting/cleanup 过渡。 |

可观察顺序固定为：`start -> waiting/aborting -> invocation_aborted -> session_state_changed/agent_end(aborted)`。运行结果先于 abort 收口时，首个 durable terminal 事实优先；运行结果迟到时不得写入、发布或改变新 invocation。`clearQueue=true` 清空 steer/follow-up；`false` 保留 follow-up 并以 `pausedBy.reason="aborted"` 呈现。

## 错误矩阵
| Runtime state | User operation | Harness result | Session writes | SSE result | Frontend state |
| --- | --- | --- | --- | --- | --- |
| `Idle` | `prompt(message)` | 接受并启动新的 invocation。 | 写 user message；写 lifecycle `start`；后续写 assistant/toolResult turns；最后写 `end`、`error` 或 `waiting`。 | `invocation_started`；user message 的 `session_entry`；provider stream/tool events；committed turns 的 `session_entry`；最终 lifecycle/state event。 | 进入 running；展示 user message、streaming assistant、tool cards；最后回到 idle 或 waiting；如果失败，runtime 回到 idle，同时投影 `ErrorBubble`。 |
| `Idle` | `continue` | 如果当前 session tail 可继续，则接受。 | 不写新的 user message；写 lifecycle `start`；后续写 assistant/toolResult turns 和最终 lifecycle。 | `invocation_started`；stream/tool events；committed `session_entry`；最终 lifecycle/state event。 | 进入 running，并从现有 session state 继续。 |
| `Idle` | `steer(message)` | 拒绝。没有 active invocation 可以引导。 | 不写。 | 可选 `invoke_rejected`，或只返回 HTTP error response。 | 展示拒绝/通知；保持 idle。 |
| `Idle` | `followup(message)` | 拒绝。没有 active invocation 可以排队到后面。 | 不写。 | 可选 `invoke_rejected`，或只返回 HTTP error response。 | 展示拒绝/通知；保持 idle。 |
| `Running` | `prompt(message)` | 兼容选项：当成 follow-up。新合同应优先要求前端显式发送 `followup`。 | 入队时不写；只有 follow-up 被 drain 时才写 user message。 | `follow_up_queued` 加 `session_state_changed`；后续消费时发 `session_entry`。 | 在 follow-up queue 中展示消息；当前 run 继续。 |
| `Running` | `continue` | 拒绝。不能和 active invocation 并发运行第二个 continue。 | 不写。 | 可选 `invoke_rejected` / busy event，或只返回 HTTP error response。 | 保持 running。 |
| `Running` | `steer(message)` | 接受进入 steer queue。 | 入队时不写；drain 时写一条模型会看到的 harness-origin user message。 | `steer_queued` 加 `session_state_changed`；后续消费时发 `session_entry`。 | 展示 steer queue item；被消费后离开队列并进入历史。 |
| `Running` | `followup(message)` | 接受进入 follow-up queue。 | 入队时不写；消费时写 user message，作为下一轮 user turn。 | `follow_up_queued` 加 `session_state_changed`；后续消费时发 `session_entry` 和 run events。 | 展示 follow-up queue item；当前 run 继续；只有当前 run completed 后才自动运行 queued item。 |
| `WaitingUser` | `continue(resolution)` | 接受，并恢复同一个 logical invocation。 | 写 resolution toolResult；写 lifecycle `resumed`；后续写 assistant/toolResult turns 和最终 lifecycle。 | `invocation_resumed`；resolution 的 `session_entry`；stream/tool events；最终 lifecycle/state event。 | 关闭 waiting UI，回到 running，之后进入 idle 或 waiting；如果失败，runtime 回到 idle，同时投影 `ErrorBubble`。 |
| `WaitingUser` | `prompt(message)` | 当成 follow-up queue；不能回答或绕过 pending resolution。 | 入队时不写；只有当前 waiting invocation 被 resolution 恢复并结束后，才写 user message。 | `follow_up_queued` 加 `session_state_changed`。 | Waiting UI 保持；follow-up queue 展示 item。 |
| `WaitingUser` | `steer(message)` | 接受进入 steer queue；resolution 后在下一个模型可见 turn boundary 生效。 | 入队时不写；drain 时写 harness-origin user message。 | `steer_queued` 加 `session_state_changed`；后续消费时发 `session_entry`。 | Waiting UI 保持；steer queue 展示 item。 |
| `WaitingUser` | `followup(message)` | 接受进入 follow-up queue。 | 入队时不写；当前 invocation 结束后消费时写 user message。 | `follow_up_queued` 加 `session_state_changed`。 | Waiting UI 保持；follow-up queue 展示 item。 |
| `Aborting` | any invocation mode | 拒绝或返回 busy，直到 cleanup 完成。 | 通常本请求不写新内容；abort 自身可能写 lifecycle `aborted` 或 `interrupted`。 | abort cleanup 发 `invocation_aborted` / `session_state_changed`；本请求可选 busy rejection。 | 保持 aborting 直到 cleanup；不创建新的 run 或 queue item。 |

### 错误矩阵

错误也必须按黑盒合同定义。先区分两类：

- **Admission error**：请求没有被 Harness 接受，没有创建 invocation，也不进入 Run Kernel。
- **Runtime error**：请求已经被接受，invocation 已经开始，但运行过程中失败。

一旦 invocation 被接受，运行失败就必须写成可恢复的 terminal lifecycle，而不能只靠 HTTP 500 表达。

| Error point | Example | Harness result | Session writes | SSE result | HTTP response | Frontend state |
| --- | --- | --- | --- | --- | --- | --- |
| Admission validation | DTO 不合法；`prompt` 缺 message；`continue` 带非法 message。 | 拒绝请求，不创建 invocation。 | 不写。 | 通常不广播 session event；如果前端已有订阅，可选 `invoke_rejected`。 | 4xx validation error。 | 保持原状态，显示表单/请求错误。 |
| State admission | `Idle` 下 `steer` / `followup`；`Running` 下非法 `continue`；`Aborting` 下任何 invocation。 | 拒绝请求，不创建新 invocation，不入队。 | 不写。 | 只依赖 HTTP response。 | 409/400 类结构化错误。 | 保持原 runtime state，显示无法执行。 |
| Queue admission | `steer` / `followup` 入队时队列已满、session 不再 steerable、run 已越过最后可引导点。 | 拒绝入队。 | 不写 queued message。 | 可选 `invoke_rejected` / `queue_rejected`；不发 `steer_queued` / `follow_up_queued`。 | 409/400 类结构化错误。 | 队列不新增 item，输入内容可保留。 |
| `prepareRun` runtime error | profile `prepare()` 抛错；profile input 无法解析；恢复 resolution 无法匹配 pending tool call。 | 已接受的 invocation 失败。 | 如果 prompt 的 user message 已经 durable 写入 session，则失败时必须保留该 user message，并追加 lifecycle error。如果失败发生在 user message durable 写入之前，则不要补写聊天历史；可以只写 lifecycle error，用来记录这次已接受 invocation 的失败。 | `invocation_error` 加 `session_state_changed`；如果 user message 已写，已有对应 `session_entry`。 | `status: "error"` 的结构化 invocation response。 | runtime 回到 idle；可从 snapshot 看到失败记录，并由前端投影 `ErrorBubble`。 |
| Provider request error before stream | provider API 报错、鉴权失败、模型不存在、限流、网络错误，且没有 assistant content delta。 | 当前 invocation 失败。 | 保留已写 user message；写 lifecycle `error`，`errorInfo.kind = "provider_error"`；不写 assistant message。 | `provider_error` / `invocation_error`；`session_state_changed`。 | `status: "error"`，带 provider error info。 | 停止 streaming；显示 provider 错误；历史里没有空 assistant。 |
| Provider stream error after partial content | provider streaming 中途断开，已经收到部分 assistant text。 | 当前 invocation 失败，但保留用户已经看到的半截 assistant content。 | 写一条 partial assistant message，只保留已收到的 text/content；去掉未闭合或不完整的 tool calls；写 lifecycle `error`，标记该 assistant 为 interrupted/partial。 | 已发出的 stream delta 保留为 live UI；随后发 partial assistant 的 `session_entry`、`provider_error` / `invocation_error`、`session_state_changed`。 | `status: "error"`，带 provider error info 和 partial message id（如果 DTO 支持）。 | 流式卡片转为失败的已保存 assistant；提示回答中断，可继续/重试。 |
| Provider stream error after complete tool call JSON but before tool execution | provider 已产生 tool call，但 turn 未完成或 tool call 是否完整无法可靠确认。 | 当前 invocation 失败。 | 默认不保存 tool calls；如已有 partial text，按 partial assistant 保存 text；写 lifecycle `error`。 | `provider_error` / `invocation_error`；如保存 partial assistant，发对应 `session_entry`。 | `status: "error"`。 | UI 不展示可恢复的 pending tool call，避免出现无法闭合的 tool 卡。 |
| Tool execution error recoverable | tool 返回结构化失败结果，模型可以继续处理。 | 这不是 invocation error，而是正常 toolResult。 | 写 assistant/toolCall 和 toolResult，toolResult 表达失败；run 可继续下一轮。 | tool error event；committed `session_entry`；后续 stream events。 | 最终取决于 run 是否完成。 | 工具卡显示失败结果，agent 可继续解释或修正。 |
| Tool execution fatal error | tool runner 崩溃、工具协议错误、无法生成合法 toolResult。 | 当前 invocation 失败。 | 已完整提交的前序 turns 保留；本轮如果 assistant tool call 已经进入 durable commit，则必须写一个 harness error toolResult 闭合；如果尚未 commit，则可不写本轮 tool call；写 lifecycle `error`。 | `tool_error` / `invocation_error`；必要时发 error toolResult 的 `session_entry`；`session_state_changed`。 | `status: "error"`。 | 工具卡显示 fatal；run 结束为 error。 |
| Approval / waiting setup error | 工具请求 approval/user input 时无法创建 pending waiting state。 | 当前 invocation 失败，不进入 waiting。 | 如果本轮无法合法闭合 tool call，则不提交该 pending tool call；写 lifecycle `error`。 | `invocation_error` 加 `session_state_changed`。 | `status: "error"`。 | 不显示 waiting UI，显示失败。 |
| Session write error before response | JSONL append、projection write、lifecycle write 失败。 | 当前 invocation 失败；如果无法写 lifecycle error，则返回 unrecoverable error。 | 尽力写 lifecycle `error`；如果 repo 完全不可写，则没有可靠 session 写入。 | 如果 event channel 可用，发 `session_write_error` / `snapshot_required`；否则只靠 HTTP。 | 如果能结构化返回则 `status: "error"`；repo 不可写可返回 500。 | 触发 snapshot reload；若 snapshot 也失败，显示持久化错误。 |
| SSE publish error | session 写入成功，但某个 SSE subscriber 发送失败。 | 不影响 invocation 成功或失败判定。 | 已写内容保持。 | 对失败连接断开；其他连接继续；不回滚。 | 当前 invocation response 不应因单个 subscriber 失败而失败。 | 失败连接重连后通过 snapshot 恢复。 |
| `settleRun` error | report_result 处理、projection 写回、summarizer trigger、final lifecycle 期间失败。 | 主 invocation 的模型结果可能已完成，但 settlement 失败必须显式记录。 | 已提交 turns 保留；尽力写 lifecycle `error` 或 settlement error projection；不能把未完成 settlement 标成成功。 | `invocation_error` / `session_state_changed` / `snapshot_required`。 | `status: "error"`，并设置 `errorInfo.phase = "settleRun"`。 | 显示回答已生成但收尾失败；snapshot 是最终真相。 |
| Background summarizer error | source invocation 已完成，后台 title/summary 生成失败。 | 不改变 source invocation result。 | 不写错误 assistant 到 source；可写 summarizer state/projection dirty/error。 | `summarizer_error` / `session_state_changed`，可选静默。 | 原用户 invocation response 不受影响。 | title/summary 保持旧值或显示待更新状态。 |

## 错误恢复和 UI 投影

错误恢复要区分 durable truth 和 frontend projection。

Session 负责保存事实：

- 哪条 user message 已经被模型消费。
- 哪些 assistant/toolResult 已经 durable commit。
- 哪个 invocation 进入了 `error` terminal lifecycle。
- `errorInfo` 的 kind、message、provider、statusCode、retryable 等结构化信息。

前端负责把这些事实投影成用户可理解的 UI，例如 `ErrorBubble`、partial assistant error badge、retry action。

### ErrorBubble 不是 Session Message

`ErrorBubble` 不是 durable session message。

Provider API 错误后，session 应保存 invocation lifecycle `error` 和必要的 partial assistant content；前端根据 snapshot / SSE 投影出错误气泡。

因此，隐藏 `ErrorBubble` 不需要删除 session entry。它只是 UI projection 变化。

### ErrorBubble 展示规则

- Admission error 不显示聊天流里的 `ErrorBubble`。这类错误用 toast、form error 或 inline request error 展示。
- Provider request error before stream 应显示独立 `ErrorBubble`，挂在最后一个已消费 user message 后。
- Provider stream error after partial content 优先把错误状态挂到 partial assistant bubble 上，而不是再插入独立错误消息。
- Tool recoverable error 不显示 run-level `ErrorBubble`，它是普通 toolResult，由工具卡展示。
- Tool fatal、provider fatal、prepare fatal、settle fatal 可以显示 run-level `ErrorBubble`。

### ErrorBubble 隐藏规则

同一个 active path 上，只要出现新的 accepted invocation start，旧 `ErrorBubble` 应立即隐藏。

这里的关键是 accepted，而不是 completed：

- 用户点击 retry，只要新 invocation 被接受，旧 `ErrorBubble` 隐藏。
- 用户发送新 prompt，只要新 invocation 被接受，旧 `ErrorBubble` 隐藏。
- 如果新请求被 admission 拒绝，旧 `ErrorBubble` 保持显示。

Snapshot 恢复时按同一规则重建：

```text
如果 active path 最新 terminal invocation 是 error，
并且之后没有新的 accepted invocation start：
  显示 ErrorBubble

否则：
  不显示旧 ErrorBubble
```

### Retry 语义

Retry 不是 waiting/resume。

已经 terminal `error` 的 invocation 不复活。Retry 应创建新的 invocationId。

只有 approval / user-input resolution 才复用同一个 logical invocationId：

```text
start -> waiting -> resumed -> end/error/aborted/interrupted
```

Provider error 的 retry 是新的 invocation：

```text
old invocation: start -> error
new retry invocation: start -> end/error/waiting
```

### Retry: Provider Error Before Assistant Content

如果 provider 在产生任何 assistant content 前失败：

```text
user message
invocation lifecycle error
```

Retry 可以从同一个 dialogue tail 发起 `continue`，不新增 user message。

这是“重新尝试回答最后一个已消费 user message”。

这里的 dialogue tail 不是 JSONL 文件里字面最后一条 entry。Lifecycle、projection、queue state、error metadata 这类 control/projection entry 不参与模型对话 tail 判断。

定义：

```text
dialogue tail = active path 中最后一个 model-visible dialogue item
```

因此，provider error before assistant content 后，虽然最后可能存在 lifecycle `error` entry，但 dialogue tail 仍然是最后一条已消费 user message。

### Retry: Partial Assistant 已保存

如果 provider streaming 中途失败，并已经保存 partial assistant：

```text
user message
partial assistant
invocation lifecycle error
```

普通 `continue` 的语义不是 retry。它会从 partial assistant 之后继续，模型会看到这条半截 assistant。

真正的 retry 应使用 tree/retry 语义：从 partial assistant 之前的 parent leaf 重新开分支，再发起新的 invocation。

这避免把“重试上一轮回答”和“沿着半截回答继续对话”混在一起。

### New Prompt After Error

用户也可以不 retry，直接发送新 `prompt`。

此时：

- 新 user message 正常写入 session。
- 新 invocation start。
- 旧 `ErrorBubble` 立即隐藏。
- 旧 lifecycle error 仍保留在 session durable truth 中。

如果前面有 partial assistant，新 prompt 默认沿着当前 active path 继续，也就是模型会看到 partial assistant。用户可以自然地说“继续刚才中断的内容”。

Partial assistant 的 `partial/interrupted/error` 标记是 session/UI metadata；其 text/content 默认仍然是 model-visible dialogue content。用户如果想让模型不看到这条 partial assistant，应通过 tree/retry 回到 partial assistant 之前的 leaf。

### Follow-Up Queue After Error

当前 run 以 `error`、`aborted` 或 `interrupted` 结束时，不自动消费 follow-up queue。

Follow-up 自动消费只允许在当前 run 正常 `completed` 后发生。

规则：

```text
completed -> 可以自动消费下一条 follow-up
waiting -> 不消费
error / aborted / interrupted -> 不消费，保留 queue，等待用户选择
```

Error 后保留的 follow-up queue 必须进入 paused 状态。

用户之后发送新的 `prompt` 不会自动解冻旧 follow-up queue。旧 queue 只有在用户显式选择继续执行队列、丢弃队列或清空队列时才改变状态。

原因：

- follow-up 通常假设前一轮成功完成。
- error 后自动消费 follow-up 会让 UI 看起来吞掉了错误。
- 用户发送新 prompt 可能已经切换话题，旧 follow-up 不应在新 prompt 结束后突然恢复消费。
- 用户应该明确选择 retry、发送新 prompt、清空 queue，或手动继续 queued follow-up。

### Steer Queue After Terminal Error

`steer` 是当前 active invocation 的中途引导。

如果当前 run 以 `error`、`aborted` 或 `interrupted` 结束，pending steer queue 没有可继续引导的目标，必须清空或标记 failed，并通过 `session_state_changed` 让前端移除这些 queue items。

规则：

```text
completed -> pending steer 正常应已 drain；若仍存在，清空
waiting -> 保留 pending steer，等待 resolution 后在下一次模型请求前 drain
error / aborted / interrupted -> 清空或标记 failed，不跨 invocation 存活
```

## 硬规则

### Queued Message 首先是 Runtime State

`steer` 和 `followup` 被接受入队时，不写 durable session history。

只有 Harness drain 它们、并让它们成为模型可见输入时，它们才变成 session message。

这样可以避免 session history 记录“用户说了 X”，但模型其实还没看到 X。

### `steer` 是当前 Run 的引导

`steer` 面向 active invocation。

它不能打断：

- 当前 assistant stream
- 当前 tool batch
- approval/user-input waiting

它应该在下一次 model request 前的 turn-safe point 被 drain。

### `followup` 是下一轮用户输入

`followup` 不是 mid-turn correction。

它等待当前 invocation 本来要结束时再运行。它应该在这些条件满足后运行：

- 没有 pending tool call
- 没有 pending steer 需要 drain
- invocation 没有在等待用户 resolution

第一版应一次只消费一个 follow-up。

### `continue(resolution)` 恢复同一个 Logical Invocation

Approval 或 user-input resolution 不应该创建用户可见的新 invocation。

同一个 logical `invocationId` 贯穿：

```text
start -> waiting -> resumed -> end/error/aborted/interrupted
```

如果实现需要在 trace 层区分不同执行片段，可以增加内部 `attemptId`。

### SSE 可以早于 Durable Session Writes

Streaming assistant text 和 tool progress 可以先出现在 UI 中，再提交最终 session entries。

但 durable session history 只能在 commit/save-point boundary 更新。

前端应把 streaming events 当作 live state，把 committed `session_entry` 当作 durable truth。

### Partial Assistant Content 可以持久化

如果 provider streaming 中途失败，但已经收到 assistant text/content，Harness 应保存用户已经看到的半截 assistant content。

保存规则：

- 只保存已经确认收到的 text/content。
- 去掉 tool calls，除非它们已经被完整提交并且能够被合法 toolResult 闭合。
- 标记该 assistant message 为 partial/interrupted/error，避免前端把它当成完整回答。
- 随后写 invocation lifecycle `error`。

这条规则只适用于 provider stream 已经产生可展示 assistant content 的情况。没有 content delta 的 provider error 不应写空 assistant。

### 不保存未闭合 Tool Call

Session history 中不能出现无法闭合的 assistant tool call。

如果 tool call 已经 durable commit，则后续必须写入合法 toolResult 闭合它；如果工具执行本身发生 fatal error，也要写 harness 生成的 error toolResult。

如果 provider stream 在 tool call 完整性无法确认前失败，则不保存该 tool call。此时可以保存 assistant text/content，但要剥离 tool calls。

这条规则优先级高于“保存 partial assistant content”：可以保存半截文本，但不能为了保存半截响应而污染 session 的 tool-call/result 配对结构。

### Snapshot 是恢复真相

如果前端漏事件或重连，应重新拉 snapshot。

Snapshot 必须同时包含 durable session projection 和 UI 恢复所需的 runtime state：

- active invocation
- waiting state
- steer queue
- follow-up queue
- pending approval/user input
- latest projection/title/summary

### SSE Epoch 是事件流身份

SSE 的增量 cursor 不能只靠 `seq` 表达。`seq` 只在当前后端进程里的 `AgentSessionEventHub` 有意义；dev reload、进程重启或未来多实例切换后，新的 EventHub 可能从更小的 `seq` 重新开始。

因此，事件恢复合同必须使用：

```text
event cursor = (eventEpoch, seq)
```

规则：

- `eventEpoch` 是当前 EventHub 实例的事件流身份。第一版可以是进程内随机 UUID。
- 每个 SSE envelope 都带 `eventEpoch` 和 `seq`。
- session snapshot 带 `eventEpoch` 和 `lastSeq`。
- `connected` 是 stream handshake，不是普通 session 增量事件。它必须告诉前端当前 `eventEpoch` 和 `latestSeq`。
- 前端如果发现 `eventEpoch` 不同，必须丢弃旧 event cursor、拉 snapshot，并允许 `lastSeq` 回退到 snapshot 的 `lastSeq`。
- 同 epoch 下，如果 `seq` 连续，前端应用增量事件。
- 同 epoch 下，如果 `seq` gap，前端请求 snapshot。
- 同 epoch 下，如果 `after > latestSeq`，说明客户端 cursor 来自服务端当前无法证明的“未来”。这等同于需要 snapshot recovery，不能继续等待更大的 seq。

这样，后端 dev reload 后的恢复链路是确定的：

```text
old frontend cursor: (epoch=A, seq=426)
backend reload -> new EventHub: (epoch=B, seq=0)
frontend reconnect with old cursor
server connected handshake: (epoch=B, latestSeq=0)
frontend detects epoch mismatch
frontend fetches snapshot
frontend applies snapshot as new truth: cursor=(B, snapshot.lastSeq)
```

没有 epoch 时，前端会把新进程的 `seq=1`、`seq=2` 当成旧 cursor `426` 之前的过期事件丢掉，UI 就会卡在旧的 running / waiting 状态。

### Snapshot 可以重建 Waiting UI

后端进程重启后，内存里的 `activeInvocations`、AbortController、EventHub replay、steer queue 运行态都会消失。Snapshot 仍然必须能从 session active path 重建用户可见的 waiting UI。

waiting hydrate 规则：

- `pendingApproval` / pending user input 继续从 session active path 的未闭合 approval tool call 推导。
- 如果存在 pending approval，但内存 `activeInvocation` 丢失，snapshot 应从最近的 lifecycle `waiting` entry hydrate 一个 `activeInvocation.status = "waiting"`。
- hydrate 出来的 `activeInvocation.invocationId` 必须优先使用同一 pending tool call 关联的 waiting lifecycle `invocationId`。
- 如果找不到可靠 lifecycle，snapshot 仍可展示 pending approval，但 `continue(resolution)` 必须在 admission 阶段给出结构化错误，不能悄悄创建新的 unrelated invocation。
- 第一版只要求恢复 waiting UI 和允许 resolution resume；不要求重启后自动恢复 running provider call、tool batch、abort controller 或 ready follow-up 自动 drain。

用户提交 resolution 后：

```text
snapshot hydrated waiting activeInvocation
continue(resolution)
  -> Coordinator 接受为 waiting resume
  -> prepareRun 写 resolution toolResult
  -> prepareRun 写 lifecycle resumed，复用原 invocationId
  -> Run Kernel 继续执行
```

## 对内部设计的推论

这个黑盒合同会推出一些内部架构要求，但它本身不定义内部架构：

- 需要 Coordinator，因为很多被接受的请求只是入队 runtime state，并不会启动 run。
- 需要 Run Kernel，因为真正被接受的 invocation 应该有统一 lifecycle 和 cleanup path。
- 需要 Turn Transaction，因为 steer drain 和 transcript commit 必须发生在 turn-safe boundary。
- 需要 SessionWriteExecutor，因为所有 durable writes 都必须有顺序、归因，并统一发布。
- 需要 turn-level ingest，因为不同 profile 可能用不同方式处理 assistant/toolResult transcript。

内部 pipeline 设计在新增 stage 或 hook 前，必须先对照这个合同检查。
