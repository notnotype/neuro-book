# Agent Runtime Event OOM 与 SSE 内存边界

> 当前状态：实现中 / Integrated locally。公开事件预算主链已完成；Public Tool Identity全入口与Product证据仍按本轮集成状态跟踪。

## 2026-07-19：Public Tool Identity统一入口

- Public DTO的wire type保持普通`string`；branded identity只存在于服务端`assertPublicToolCallId()`验证后的内部投影。
- `client_variable_patch_requested`在注册pending Map和EventHub publish前验证tool-call ID；空白、超过512 UTF-8 bytes及多字节超限全部fail closed，不产生pending或replay。

- 新增共享`Public Tool Identity` Module，非空且UTF-8不超过512 bytes；live projector、durable Chat、Stored Codec、pending recovery、HTTP resolution与client patch ack统一消费。
- 非法tool ID不再被`return null`静默丢弃，也不会先序列化后截断；Provider终态、durable replay/history和用户resolution均fail closed。
- 公共DTO覆盖512/513 ASCII、多字节边界与空白ID；事件、HTTP、Harness和durable聚焦回归通过。浏览器/SSE真实连接验收未执行。

## Relative documents refs

- [Agent SSE Front-End Contract](../14-agent-sse-front-end-contract/README.md)
- [Agent Public Event Projection](../22-agent-public-event-projection/README.md)
- [Agent SSE Reload Recovery](../24-agent-sse-reload-recovery/README.md)
- [Harness Contract / SSE Recovery](../62-harness-contract-sse-recovery-fixes/README.md)
- [Agent Chat Flow Snapshot 分页与有界投影](../106-agent-chat-flow-pagination/README.md)
- [Agent SSE 稳定合同](../../../reference/agent/sse.md)

## User Request / Topic

- 主 Agent 通过 `invoke_agent` 调 writer 写作时，writer 的 `write` 工具耗时较长，服务进程内存曾增长到约 5 GB 后被 OOM kill。
- 已确认这不是典型的永久 Map 泄漏；主要放大链位于 provider 工具参数流、公开 runtime event、EventHub replay pin、SSE 慢连接与 Node HTTP 响应缓冲。
- 本任务独立治理 Agent 运行期间的公开事件和 transport 内存边界；Task 106 继续负责 durable recovery snapshot、历史分页和 Chat Flow 首屏响应。
- 两个任务共享同一个逐 entry `AgentChatEntryDto` 与 public tool projection，但不得各自建立不兼容的 entry/message DTO。

## Goal

让任意单次 Agent invocation 的 live runtime event、replay 和 SSE 写出具有可验证的内存上界，即使模型生成超长 `write.content`、大 patch、图片 tool result，或客户端长期不读取 SSE，也不能让服务进程内存随事件数量或响应积压无限增长：

- 公开 runtime event 不携带完整写作正文、完整 patch、大 diff、图片 base64 或其他无界工具参数/结果。
- `message_update` 使用不可变、delta-first 的公开 DTO，不再重复携带累计完整 `message + assistantMessageEvent.partial`。
- durable `session_entry` 不再原样公开服务端 `SessionEntry`；它与 Task 106 的 recovery/history 响应复用同一个逐 entry 的 `AgentChatEntryDto` 投影。分页显示组只属于 Task 106，不进入 live protocol。
- replay 同时受事件数和 UTF-8 字节数限制；transcript pin 不能绕过限制。
- 慢订阅者在 EventHub 队列和 Node HTTP 响应写出层都受背压与硬上限约束。
- 连接无法继续安全交付时，关闭该 SSE 连接并让前端按既有 replay/snapshot recovery 合同恢复；不得把恢复事件继续排在已阻塞的大缓冲之后。
- 前端工具卡继续展示路径、短预览、原始字节数、内容省略状态和成功/失败状态。
- 以真实慢 socket 集成测试、EventHub 压力测试、公开事件体积测试和 harness 回归证明修复，而不是只依赖单元对象数量断言。

依赖调研已确认当前稳定 H3/Nitro transport 不等待 Node `drain`，而带修复的 H3 2 仍为 RC 且不在当前 Nuxt/Nitro 依赖线上；本任务采用 Agent SSE 专用最小 Node writer。禁止通过定时 GC、提高 Node heap、缩短 writer 输出或静默禁用 SSE 等方式掩盖问题。

## Diagnosis / Evidence

### 运行链路

```text
Provider stream
    -> Pi message_update / toolcall_delta
        -> projectRuntimeEvent()
            -> AgentSessionEventHub.publish()
                -> replay buffer / transcript replay pin
                -> SessionEventSubscription queue
                    -> H3 EventStream
                        -> Node ServerResponse
                            -> browser EventSource

Turn commit
    -> SessionWriteExecutor
        -> append-only SessionEntry
        -> session_entry public event
        -> front-end stable Chat Flow projection
```

`invoke_agent` 会让父 Agent 在等待 writer 时继续持有父 RunFrame；writer 同时持有子 RunFrame、工具参数、history before/after 和 live event。它会延长对象重叠生存期，但不是首要永久泄漏源。

### 已复现的放大结果（2026-07-13）

#### 1. 工具参数仍原样公开

- 2 MiB `write.content` 投影后的 `tool_execution_start` 仍约 2 MiB。
- 当前 `projectRuntimeEvent()` 原样公开：
  - `message_update.message`
  - `message_update.assistantMessageEvent`
  - `tool_execution_start.args`
  - `tool_execution_update.args/partialResult`
  - `tool_execution_end.result`

#### 2. 累计 `message_update` 产生二次方级序列化量

构造 1 MiB `write.content`、250 个 `toolcall_delta`：

- replay 中保留 250 个 `message_update`。
- 流结束后，单条事件序列化约 4.1 MiB。
- 重新序列化整段 replay 的潜在总量约 1.03 GB。

原因是每条事件同时携带完整 `message` 和 `assistantMessageEvent.partial`；两侧又各自包含累计 `toolCall.arguments.content + partialJson`。

#### 3. 公开事件对象可在 publish 后继续膨胀

- 某条事件 publish 时约 21 KB。
- provider 继续修改共享 partial 后，同一旧事件 replay 时约 4.2 MB。
- 膨胀约 197 倍。

结论：如果 replay byte accounting 只在 publish 时对 mutable event 计一次大小，预算会失真。公开事件必须先变成不再共享 provider 可变对象的 immutable DTO。

#### 4. EventHub 队列上限不能单独解决慢 SSE

真实本地 H3 慢 socket 复现：客户端建立 SSE 后停止读取，服务端发布 150 条工具参数流事件，最终正文约 300 KiB。

- EventHub subscriber queue：0 条。
- Node `ServerResponse.writableLength`：约 183.5 MB。
- `writableNeedDrain=true`。
- 进程 RSS：约 306.9 MB。

当前 H3 `sendStream()` 的 Web Stream writer 调用 `res.write(chunk)` 后没有等待 `drain`。因此 EventHub 队列已被快速抽空，数据转移到 Node response buffer 继续增长；只增加 subscriber queue limit 无法覆盖这条链路。

#### 5. replay pin 当前绕过默认数量裁剪

- `turn_start` 创建 transcript replay anchor。
- 普通 assistant/tool turn 在持久化前保持 pin。
- 慢 `write` 会延长 pin 生命周期。
- 当前 pin 分支直接按 pin 起点保留事件，不执行默认 `replayLimit` 裁剪，也没有 replay byte limit。

#### 6. `nb-history` 是次要峰值，不是本轮主根因

- 单次大文件登记会同时构造 before/after 字节并产生 SQLite/native RSS 峰值。
- 真实 1 MiB 版本链连续登记 30 版时，RSS 上升后趋于平台，没有复现与事件数量相同的无限增长。
- 本任务只保留 history 的独立内存基线；`recordAgentWorkspaceWrite` / nb-history 大文件快照优化另列后续，不与 transport 修复混写。

#### 7. 当前稳定 H3 没有可直接升级的 backpressure 修复

- 项目声明 `h3@^1.15.5`，实际安装 `h3@1.15.11`；它也是当前最新稳定 1.x。
- `h3@1.15.11 sendStream()` 的 Web Stream bridge 只调用 `event.node.res.write(chunk)`，忽略返回的 `false`，不会等待 `drain`。
- `h3@2.0.1-rc.25` 把 Node bridge 下沉到 `srvx@0.11.22`；`srvx` 在 `res.write(false)` 后确实等待 `drain`，并在 response close/error 时取消 Web Stream reader。
- 但当前 `nuxt@4.3.1` 仍依赖 `h3@^1.15.5`，`nitropack@2.13.4` 仍依赖 `h3@^1.15.11`。为本问题直接迁移 H3 2 RC 会把 Nuxt/Nitro adapter、HTTP handler 与全站 SSE 都带入升级范围。

结论：本任务不把 H3 2 RC 升级作为实现分支。采用 Agent SSE 路由自有的最小 Node writer，直接等待 `drain`；未来框架稳定迁移后可删除该 adapter，但不保留运行时双轨或版本探测。

#### 8. raw `session_entry` 还承担了隐式控制事件

- `SessionWriteExecutor` 对 `appendMany` 仍逐条发布 `session_entry`；前端也是逐 entry 合并 assistant/tool result。
- 前端当前只对 raw custom entry 的 `agent.link.*` / `agent.detach.*` 做额外处理：收到后触发 `linked_agent_changed` snapshot。
- 其他非 UI 账本 entry 大多被 Chat Flow 忽略，状态由 `session_state_changed`、variable patch 等专用事件消费。

结论：不能简单过滤所有非 UI entry 后保持现状。link/detach 必须改成显式、带类型的 projection invalidation control event；不能继续依赖前端解析 custom key。

## Relationship With Task 106

### 共享边界

- JSONL / `SessionEntry` 是 durable 真相源。
- Task 106 的 recovery snapshot/history page 需要有界的逐 entry `AgentChatEntryDto`。
- 本任务的 `session_entry` live event 也必须发送同一种 `AgentChatEntryDto`。
- 同一条 assistant/tool result 在 initial load、snapshot recovery 和 live append 时必须得到一致的截断/省略语义。

### 任务所有权

- **Task 107 负责**：runtime event DTO、`session_entry` live projection、EventHub replay/pin/subscriber、SSE transport backpressure、工具卡 live preview。
- **Task 106 负责**：recovery snapshot/history page、active path cursor/revision、双预算分页、向上滚动加载、command/tree 的有界 recovery 行为。
- **共享 DTO 只定义一次**：Task 107 Phase 1 先落 `AgentChatEntryDto` / public tool projection；Task 106 直接复用。assistant + tool results 的显示组只用于 Task 106 分页边界。

### 实施顺序

1. Task 107 先修会杀死进程的 live OOM 路径。
2. Task 106 紧接复用公开投影治理 snapshot/recovery；两任务不应长期分离发布。
3. Task 106 的 System Prompt 冷成本和向上滚动分页不阻塞 Task 107。

## System Design

### 1. 明确六层数据与内存所有权

~~~text
Pi/provider mutable event
    -> Run-scoped public projection state
        -> immutable public runtime DTO
            -> PublishedEvent（一次序列化 + exact bytes）
                -> EventHub replay / subscriber queue（只保存 PublishedEvent 引用）
                    -> Agent SSE Node writer（同一时刻最多等待一个 bounded frame）

append-only SessionEntry
    -> AgentChatEntryDto
        -> session_entry / Task 106 recovery-history page
~~~

- provider event 和完整 tool arguments 只属于 Run Kernel/tool execution 内部；公开层不得持有其引用。
- Run-scoped projection state 只保存公开 preview、UTF-8 累计 bytes、omitted 和必要的小型结构字段，不复制完整正文。
- `PublishedEvent {event, frame, frameBytes}` 在 publish 时完成一次 JSON + SSE frame 序列化并记录精确 UTF-8 bytes；replay、subscriber 和 writer 不得反复 stringify/format 同一事件。
- replay/subscriber queue 保存同一个 immutable published item 的引用，但各自按逻辑待交付 bytes 计预算。
- durable `SessionEntry` 与 public `AgentChatEntryDto` 是两种类型；前端不再 import 服务端账本联合。

修复后的公开 transport 内存应能用下式近似约束：

~~~text
public transport RSS
  <= active runs × public preview budget
   + replay sessions × replay byte limit
   + subscribers × (live queue byte limit + replay cursor refs + Node highWaterMark + max event frame)
~~~

subscription 的 replay cursor 只保存对 immutable `PublishedEvent` 的引用，不复制 serialized payload；逻辑可交付 bytes 仍受 replay limit 约束。该公式不包含模型上下文、工具执行所需完整 args 和 nb-history snapshot；这些是独立所有者，不能通过把正文复制到公开事件中重复放大。

第一轮实现使用集中常量的保守候选基线，不作为外部 API 参数：

| Boundary | Count | Bytes | 说明 |
| --- | ---: | ---: | --- |
| 单条 public event | — | 128 KiB | 可容纳 durable entry preview 与 envelope；任何 projector 都不能突破 |
| 单 tool live preview | — | 16 KiB | 生成期可读预览 |
| 单 invocation public preview state | — | 64 KiB | 防止大量 tool call 累积 preview |
| 单 session replay | 500 | 4 MiB | count/bytes 任一达到即 trim |
| 单 subscriber queue | 128 | 1 MiB | 比 replay 更早断开真正慢客户端 |

这些值必须在 synthetic 10 MiB 正文、真实中文章节和专用工具卡 fixture 上记录结果。若需要调整，统一修改 policy/constants 并报告内存与 UX 权衡，禁止在各 projector 内散落例外。

### 2. Public Event 必须 immutable 且一次序列化

- `projectRuntimeEvent()` 输出不得引用 `event.message.content`、`assistantMessageEvent.partial`、tool args/result 或其他可继续变化的 provider 对象。
- 投影完成后继续修改原始 event，不得改变已发布事件的 JSON、serialized bytes 或 replay accounting。
- 不能用 shallow copy 通过测试；嵌套 content/tool call/result 必须重新投影为公开 DTO。
- EventHub 以已序列化 published item 为存储单位，replay/queue bytes 使用 `Buffer.byteLength(frame, "utf8")` 或等价结果。
- 顶层 event hard budget 在进入 EventHub 前执行；超过预算时必须转成 typed omitted fallback，不能先把无界事件塞进 replay 再裁剪。

### 3. Runtime message 使用 delta-first public protocol

`message_start` 只建立 live message shell，至少携带稳定 `messageId`、role、timestamp 和 invocation/turn 身份。公开 ID 由 Run Kernel 分配，不能继续依赖前端用 `role:timestamp` 猜测。

`message_update` 的 payload 改为小型判别联合：

- text/thinking：`messageId + contentIndex + delta`。
- tool call start：`messageId + contentIndex + toolCallId + toolName`。
- tool args projection update：`toolCallId + contentIndex + PublicToolArgsDto`。
- tool call end：同一个 ID 和有界终态 projection，不带完整 arguments/partialJson。

`message_end` 只携带 completion metadata 和必要校准字段，不重新发送完整 assistant message。若 provider 事件顺序存在缺口，应补稳定 ID/metadata；禁止恢复完整 partial 作为兜底。

### 4. Live tool call 需要 run-scoped preview accumulator

仅把累计 partial 改成 delta 仍不够：如果完整转发 `write.content` 的每个 delta，浏览器最终仍会收到完整正文。

每个 RunFrame 持有 public tool stream state，以 `toolCallId + contentIndex` 为 key：

- 记录 toolName、已识别 path/touchedFiles 等小字段。
- 对正文类字段只累计固定 UTF-8 preview 和 `totalBytes`。
- args stream 与 execution partial result 分别维护 bounded preview；`tool_execution_update.partialResult` 即使是累计对象，也只在公开 projection 变化时发送 preview delta/bytes/status。
- preview 达限后停止发送正文 delta；后续只在累计 bytes 跨过固定里程碑或结构化字段变化时发布进度，避免为每个 token 生成无意义事件。
- 同一 invocation 还要有 aggregate public preview budget；工具数过多时，后续工具保留 metadata/bytes/omitted，不继续占用 preview 内存。
- tool call 完成时用内部完整 args 生成一次有界终态 projection，不能把 accumulator 当作工具真实参数。
- `message_end`、`turn_end`、abort、error 和 RunFrame release 都要清理 state；嵌套 `invoke_agent` 的父子 frame 分别拥有自己的 state。

预算常量集中定义，至少满足：

~~~text
LIVE_TOOL_PREVIEW_BYTES
  < PUBLIC_EVENT_MAX_BYTES

CHAT_ENTRY_PREVIEW_BYTES + envelope margin
  <= PUBLIC_EVENT_MAX_BYTES
~~~

初始候选采用 16 KiB live preview、64 KiB durable history preview，并用真实中文正文、patch 和 tool result fixture 校准；若校准结果要求明显改变展示量或内存预算，再把权衡交给用户决定。

### 5. Tool projection 是中央安全边界

建立单一 `public-tool-projection` 模块；runtime event、durable entry 和 Task 106 snapshot 都调用它。不要把是否截断交给各工具自行决定，否则未来新工具容易绕过边界。

专用 projection 至少覆盖：

- `write.content`：path、preview、contentBytes、contentOmitted。
- `edit.edits[].oldText/newText`：每项 preview/bytes/omitted，并限制 edits 数量。
- `apply_patch.patch`：patchPreview、patchBytes、touchedFiles、patchOmitted。
- `edit/apply_patch` result diff：diffPreview、diffBytes、diffOmitted。
- `read` image block：MIME、原始 bytes、尺寸（可得时）、dataOmitted；绝不公开 base64。
- `bash.command` 和 stdout/stderr：preview、bytes、omitted。
- 当前专用 UI 所需的小型强类型 details：`request_user_input`、`switch_mode`、`task_create`、`task_set_status`。
- agent 工具结果中 UI 需要的 `sessionId/profileKey/status` 等链接字段。

前端 `AgentToolCall.rawResult?: unknown` 应迁移为强类型 `resultDetails?: PublicToolResultDetailsDto`。通用 ToolNode 只消费有界 generic preview，不再尝试展示任意原始 JSON。

未知工具输入允许在 projector 边界为 `unknown`，但输出必须是有最大深度、最大字段数、最大数组项数和字符串字节数的 `PublicValuePreviewDto`。bounded walker 在遍历时执行预算，禁止先对未知大对象完整 `JSON.stringify()` 再判断是否超限。

### 6. Durable `AgentChatEntryDto` 保持逐 entry

- `SessionWriteExecutor` 仍按 append-only entry 顺序逐条 publish，不引入 grouped live protocol。
- 公开 union 只包含 Chat Flow 可见 entry：user/assistant message、tool result、custom message、compaction、branch summary、invocation error。
- assistant entry 直接带 public `invocationId`；live publish 可使用 write executor 已知 invocationId，Task 106 snapshot projector 则在遍历 active path 时从 lifecycle 账本推导。
- tool result 通过 `toolCallId` 关联 owner assistant。Task 106 可以据此把 assistant + 连续 tool results 作为不可切分页组，但组不是 transport DTO。
- `parentId`、重复 timestamp、provider-only metadata、图片 base64 和任意 raw details 不进入公开 entry。
- `session_entry` 和 Task 106 recovery/history 必须使用同一 projector 与 durable policy，保证刷新前后字段、preview 和 omitted 语义一致。

非 UI 账本 entry 不作为 Chat Flow entry 广播：

- model/thinking/profile/archive 等状态由 `session_state_changed` 或对应 shell 表达。
- variable/client patch 继续使用专用事件。
- `agent.link.*` / `agent.detach.*` 改成 sequenced `session_projection_invalidated {reason: "linked_agent_changed"}` control event，对 owner/target session 都显式发布；前端不再解析 custom key。

### 7. Replay、pin 与 snapshot cursor 必须共同设计

- replay 同时受 per-session event count 和 serialized byte limit 约束；pin 不绕过任一限制。
- replay 保持连续 seq window，并暴露 `replayFloorSeq` 或 `canReplayFrom(sessionId, after)`。
- transcript anchor 仍优先让刷新后的 snapshot 从 turn start 前 replay 未持久化 preview。
- 如果 byte/count trim 已裁掉 anchor 后的任何事件，anchor 立即视为 unavailable；`snapshotEventCursor()` 必须改用当前安全 cursor，不能继续返回失效 anchor。
- 使用安全 cursor 时允许丢失 transient live preview；turn commit 后由 projected `session_entry` 恢复 stable history。
- 否则会形成 `snapshot -> stale anchor -> snapshot_required -> snapshot` 的无限恢复循环，必须有专门回归测试。
- turn persist、waiting persist、failure ingest、abort、exception 和 harness cleanup 都必须解除 anchor/pin。
- session 无 subscriber 且无 active pin 时可清空该 session 的 replay payload，保留 seq 即可；下次连接走 snapshot recovery，避免 inactive session replay Map 长期累计大对象。

### 8. Slow subscriber 溢出必须立即中止连接

- `SessionEventSubscription` 同时维护 queue count 与 queue serialized bytes。
- subscribe 时不能把全部 replay 同步 enqueue 到 live queue，否则 replay limit 大于 queue limit 时会误杀正常客户端。
- subscription 分成 replay cursor 与 live queue：先原子捕获 cursor 后的 bounded replay 引用并注册 live subscriber；iterator 懒惰 yield replay，期间新事件只进入单独的 bounded live queue，随后再切换到 live queue。
- replay item 被 yield 或 subscription close 后立即释放对应引用；同一 serialized payload 不为每个 subscriber 复制。
- writer 等待 `drain` 时不再 pull，背压自然回到 subscription queue。
- queue 溢出时清空积压、从 subscriber set 移除，并触发 subscription abort signal；不能把 `snapshot_required` 排在阻塞连接后面。
- SSE writer 的 `waitDrain` 必须 race subscription/socket abort，收到 overflow 后立即 destroy 当前 response，丢弃 Node buffer。
- EventSource 重连后使用原 cursor：replay 仍完整则继续；cursor 落后则由新 subscription 首帧返回一次 `snapshot_required`。
- close、return、socket close/error、route exception 和 overflow 共用幂等 cleanup，不能留下 resolver、queued published item 或 subscriber set 空壳。

### 9. Agent SSE 使用最小 Node writer

调研结论已经确定，不再保留升级分支：

- 保持当前 Nuxt/Nitro/H3 稳定依赖。
- 只替换 Agent session events route 的 H3 EventStream bridge。
- adapter 负责设置与现有合同一致的 SSE headers、格式化 `event/data` frame、写 connected/replay/live event、等待 `drain` 和处理 close/abort。
- `res.write(frame) === false` 后不得读取下一条 subscription item。
- 正常完成使用 `end()`；subscriber overflow、socket error 或 abort 使用立即断连，确保积压 buffer 被释放。
- 不 monkeypatch H3、不复制整个 H3 EventStream、不影响 workspace/presence 等其他 SSE 路由。

不再增加第二套“connection pending bytes”计数：writer 同时只持有一个 bounded frame，Node highWaterMark 提供 socket buffer 边界，subscription queue count/bytes 提供上游积压边界。再加一套异步 pending 预算会产生重复所有权和难以验证的竞态。

### 10. Front-End recovery 与工具卡

- SSE 断开不是 run error，继续使用 Task 14/62 的 reconnect/snapshot single-flight。
- overflow 断连不需要服务端在旧连接发送特殊业务事件。
- reducer 使用 server-provided live message ID 和 delta update，不再依赖完整 partial 兜底。
- write/edit/apply_patch/task/request-user-input/switch-mode 等专用气泡消费 typed projection。
- 通用 ToolNode 展示 args/result preview、bytes 和 omitted；复制操作只能复制当前公开 preview，并明确提示不是全文。
- 重连 replay 不足时，通过 Task 106 的有界 recovery snapshot 恢复 durable history；未持久化 preview 可以丢失，已提交结果不能丢失。

## Confirmed Product Semantics

- 用户目标已经明确要求 live runtime event 不携带完整写作正文、patch 或大 diff，因此无需再次等待产品决策。
- write/edit/apply_patch/bash/read 在生成和执行期间只显示路径、短预览、累计 bytes、omitted 与成功/失败；完整内容通过最终文件或 durable 真相查看。
- 16 KiB live preview、64 KiB durable history preview 只是初始候选。若真实中文正文、patch 或专用工具卡验收证明体验不足，需要报告 payload/内存/可读性权衡后由用户决定调整值，不能私自放宽到无界。

## Scope

### In scope

- immutable public runtime DTO、run-scoped tool preview accumulator 与一次序列化 published item。
- public durable `AgentChatEntryDto` projection、`session_entry` 与 link/detach typed invalidation event。
- EventHub replay、pin、replay floor、snapshot cursor、subscriber queue 的 count/byte bounds。
- Agent session SSE route 的 backpressure-aware Node writer 与 overflow abort 协作。
- useAgentSession/agent-message reducer 对 delta-only event 和 projected `AgentChatEntryDto` 的消费。
- write/edit/apply_patch/read/bash 等工具卡的 preview/bytes/omitted 展示。
- 与 Task 106 的共享 DTO 和交叉文档。
- 聚焦单元、harness、真实慢 socket 集成测试与 typecheck。

### Out of scope

- Task 106 的 snapshot/history pagination、顶部滚动加载和 System Prompt 策略。
- 全站升级 H3 2 RC 或重写其他 SSE route。
- 修改 JSONL、模型上下文或 compaction 的完整数据语义。
- 为图片/工具结果建设附件存储、对象存储或全文下载系统。
- `recordAgentWorkspaceWrite` / nb-history 大文件 snapshot 性能优化。
- 为规避 OOM 限制 writer 可写文件大小或模型输出 token。
- Markdown 编辑器、Workspace 下载、安装、发布和 Config API。
- 自动浏览器验证；用户明确授权后再执行。

## Verification / Test

### Public projection

- [x] 1–10 MiB `write.content` 的任意单条公开事件保持在 hard budget 内。
- [x] `edit/apply_patch` 的正文和 diff 只公开预览、bytes、omitted/touchedFiles。
- [x] 图片 tool result 不公开 base64 data。
- [x] 未知工具的深层对象、超长数组和字符串由 bounded walker 投影，不能突破 event hard budget，也不能先完整 stringify。
- [x] 投影后修改原始 provider event，不改变已发布 DTO、serialized data 或已记录 byte size。
- [x] 1 MiB / 250 delta 的 `message_update` 总序列化量随真实 delta/preview 线性增长，不再接近二次方。
- [x] preview 达限后不再发送正文 delta，只在 bytes milestone 或公开结构变化时发送 bounded update。
- [x] runtime transient policy 与 durable `AgentChatEntryDto` policy 的字段语义一致，预算常量关系通过测试约束。
- [x] `request_user_input`、`switch_mode`、task 和 agent linked-session details 通过强类型判别 projection 渲染。

### EventHub

- [x] 未 pin replay 同时遵守 count/byte limit。
- [x] pin 期间仍遵守 count/byte limit。
- [x] replay trim 后 `replayFloorSeq/canReplayFrom` 与真实连续 window 一致。
- [x] transcript anchor 仍可 replay 时 snapshot cursor 使用 anchor。
- [x] anchor 已被 byte/count trim 裁掉时 snapshot cursor 使用安全 cursor，不产生 snapshot recovery loop。
- [x] cursor 落后于 replay floor 时新连接只收到一次 `snapshot_required`。
- [x] replay bytes 大于 subscriber queue limit 时，快速客户端通过 lazy replay 完整读取，不被误判 overflow。
- [x] replay 交付期间并发 publish 的事件进入 live queue，切换阶段无遗漏、无重复。
- [x] replay item 已交付或 subscription 关闭后释放 cursor 引用。
- [x] 慢 subscriber 的 queue count/bytes 溢出后立即 abort subscription，并通知 writer 断连。
- [x] session 无 subscriber 且无 pin 时释放 replay payload。
- [x] subscription close/return/overflow 后不再保留 subscriber、resolver 和 queued published item。

### SSE transport

- [x] 使用真实 Node `ServerResponse` 和 Agent SSE writer；客户端停止读取后，`writableLength` 不再增长到百 MB。
- [x] `res.write(false)` 后 writer 不 pull 下一条 subscription item，直到 `drain` 或 abort。
- [x] queue overflow 会中止 `waitDrain` 并 destroy response，不等待阻塞 socket 自行恢复。
- [x] 客户端恢复读取时可继续传输；被 overflow 断开时按 EventSource/recovery 合同恢复。
- [x] socket close/error、AbortSignal 和 normal end 不留下 pending writer Promise 或 listener。
- [x] SSE frame 格式、event name、headers 与现有前端 parser 合同一致。

### Harness / Front-end

- [x] 慢 writer 工具执行期间 transcript replay 不突破预算。
- [x] live assistant text/thinking/toolCall 依赖 server messageId/contentIndex 正确合并，不使用完整 partial 兜底。
- [x] write/edit/apply_patch 工具卡显示路径、短预览、bytes、omitted 和终态。
- [x] request-user-input、switch-mode、task、invoke/create agent 卡片保留必要结构化结果。
- [x] projected `session_entry` 与 Task 107 runtime projector 使用同一公开 policy；Task 106 recovery 接入留在其实现阶段。
- [x] link/detach 不再依赖 raw custom key，owner/target 都收到 typed invalidation 并触发一次 snapshot。
- [x] stable `session_entry` 到达后能替换/合并 transient live preview。
- [x] seq gap、event epoch、snapshot_required single-flight 和 reconnect 回归通过。

### Baseline targets

- [x] 重跑同等规模 paused socket repro：不得再次出现百 MB response buffer。
- [x] 重跑累计 delta replay repro：序列化量不再接近 1 GB。
- [x] 增加 10 MiB write、10 MiB unknown tool object、PNG base64 tool result synthetic fixture。
- [x] 记录修复后 RSS smoke、public preview state、replay bytes、subscriber bytes、response writableLength 与断连行为。
- [x] RSS 只作为整链 smoke；确定性 pass/fail 以 event/replay/queue/writableLength 边界为主，避免平台 GC 造成 flaky test。
- [x] typecheck 通过。

## Implementation Plan

### Phase 0 — 契约与依赖调研

- live 工具只显示有界预览的产品语义已由用户目标确认。
- H3/Nitro 调研已完成：冻结“当前稳定依赖 + Agent SSE 专用 Node writer”结论。
- 与 Task 106 冻结逐 entry `AgentChatEntryDto`、public tool schema 和 durable preview policy。
- 把现有 throwaway probe 收敛为不读取真实用户正文的确定性测试 fixture。
- 固化 public event/replay/subscriber 预算常量与派生关系；记录选择依据，不散落 magic number。

### Phase 1 — Public projection 与 DTO 红灯测试

- 先写大 write、patch/diff、image、unknown tool、mutable partial 和专用 UI details 红灯测试。
- 定义 delta-first runtime DTO、`AgentChatEntryDto`、`PublicToolArgsDto`、`PublicToolResultDetailsDto` 和 typed generic preview。
- 建立中央 public tool projector、bounded walker 和顶层 event hard-budget fallback。
- 删除前端 `rawResult?: unknown` 公共边界，迁移专用工具卡 schema。

### Phase 2 — Run-scoped accumulator 与 durable entry

- RunFrame 增加有总预算的 public tool preview state 和稳定 live message ID。
- runtime projector 只发 bounded delta/projection milestone；所有终止路径清理 state。
- `SessionWriteExecutor` 发布 projected `AgentChatEntryDto`。
- 用 typed projection invalidation 替代 link/detach raw custom key 控制逻辑。

### Phase 3 — PublishedEvent、replay 与 recovery cursor

- publish 时一次序列化并缓存 exact bytes；replay/subscriber 共享 immutable item。
- 增加 replay count/bytes、replay floor、lazy replay cursor、subscriber live queue count/bytes 与 inactive replay cleanup。
- pin 始终执行硬裁剪；`snapshotEventCursor()` 在 anchor 不可 replay 时使用安全 cursor。
- subscription overflow 暴露 abort signal，并完成所有 close/return cleanup 测试。

### Phase 4 — Backpressure-aware Agent SSE

- 实现 Agent SSE 专用 Node writer，保持现有 frame/header/envelope 合同。
- `write(false)` 后等待 `drain`；等待同时受 socket/subscription abort 控制。
- overflow 立即关闭 response，让重连在新连接上决定 replay 或 snapshot。
- 把真实 paused socket repro 变成集成回归测试。

### Phase 5 — Front-End reducer 与工具卡

- reducer 改为消费 server messageId + delta-only update。
- stable Chat Flow 增量改为消费 `AgentChatEntryDto`，不再 import `SessionEntry`。
- 更新专用卡与通用 ToolNode 的 preview/bytes/omitted/typed details。
- 保持 SSE reconnect/snapshot recovery single-flight，不把 overflow 伪装成 run error。

### Phase 6 — Regression And Review

- 运行 projection/EventHub/SSE/harness/front-end 聚焦测试和 typecheck。
- 重跑累计 delta、paused socket、PNG base64 和 unknown tool 四组内存基线。
- 审查 Task 106 共享 DTO，确认 snapshot 与 session_entry 没有分叉。
- 更新本 walkthrough、Task 106 与 PROJECT-STATUS 的实际变更和计划偏差。
- 等待用户决定是否进行浏览器验证、Git 提交和 PR。

## Architecture Guardrails

- provider event、run projection state、public runtime DTO、published event、durable SessionEntry、public `AgentChatEntryDto` 必须是明确数据形态。
- 公开边界不得直接 import/暴露服务端 SessionEntry 或原始 Pi mutable event。
- 不用 shallow copy 假装事件已不可变。
- 不把完整工具正文拆成很多小 delta 后宣称已经有界。
- 不用事件数量上限代替字节上限。
- 不用 EventHub queue limit 代替 Node response backpressure。
- 不把 `snapshot_required` 排在已阻塞的大响应缓冲之后当作恢复方案。
- 不让失效 transcript anchor 反复触发 snapshot recovery。
- 不增加与 subscription queue/Node highWaterMark 重复的 connection pending budget。
- 不在前端保留 full/preview 两套隐式兼容逻辑；直接迁移到明确字段。
- 不用 `any` / `unknown` 绕过公共 DTO 类型；未知工具只允许在 projector 输入边界，输出必须是 typed bounded preview。
- 不把 projector hook 分散到各工具定义；中央安全边界必须对未来工具默认生效。
- 不为本问题升级 H3 2 RC、monkeypatch H3 或重写全站 SSE。
- 不通过加大 `--max-old-space-size`、主动 GC、限制 writer 正文或减少模型能力解决架构性放大。

## Research Refinement Result

本轮只读调研对初版 Task 107 做了以下实质修正：

- **Transport 方案收敛**：初版把“升级 H3 或自有 writer”留作待决策分支；实际确认 H3 1.15.11 仍忽略 `drain`，H3 2 RC 的 srvx 已修但不在当前 Nuxt/Nitro 稳定依赖线上，因此直接收敛为 Agent SSE 专用 writer。
- **共享 DTO 降低耦合**：初版倾向共享 grouped Chat Flow item；实际写入和前端增量都是逐 entry，现改为共享 `AgentChatEntryDto`，显示组只属于 Task 106 分页算法。
- **补齐 preview state 所有权**：初版只写 delta-first，仍可能把完整正文拆成小 delta 传完；现增加 RunFrame-owned accumulator、preview/aggregate budget、milestone update 和完整清理生命周期。
- **补齐 recovery 正确性**：初版只写 replay trim；现明确 replay floor、anchor availability 和 safe snapshot cursor，防止 stale anchor 造成无限 snapshot loop。
- **补齐 overflow 协作**：初版只写 queue overflow；现明确 subscription abort 必须中止正在等待 `drain` 的 writer，否则 socket 仍可能长期持有 buffer。
- **移除重复预算**：初版计划增加 connection pending byte limit；现确认 bounded frame + Node highWaterMark + subscriber queue 已有单一所有权，删除重复计数。
- **替换隐式 custom 控制**：识别前端依赖 `agent.link.*` / `agent.detach.*` raw key 触发 snapshot，现要求 typed projection invalidation。

## Implementation Result

本轮已按“投影 → replay → transport → consumer”顺序完成实现，未升级依赖、未修改 JSONL 真相或模型上下文：

- 新增共享 `AgentChatEntryDto`、public tool/result projection 和 bounded unknown walker；`write`、`edit`、`apply_patch`、图片、read、bash、diff 都只公开预览、原始字节数和 omitted 状态。图片 base64 不再进入公开事件。
- runtime event 已改为 immutable、delta-first DTO；`message_update` 不再携带累计 `message` / `partial`。RunFrame 只保留固定大小的 write preview accumulator，预览达限后按 16 KiB milestone 发布。
- `session_entry` 改为逐 entry `AgentChatEntryDto`；非 Chat Flow 账本 entry 不广播。link/detach 改为 `session_projection_invalidated` typed control event。
- EventHub 以一次序列化的 `PublishedAgentSessionEvent` 为存储单位：replay 500 条/4 MiB，subscriber live queue 128 条/1 MiB；pin 不绕过硬裁剪，无 subscriber/retention 的 inactive replay 立即释放；`iterator.return()`、overflow、abort 都会注销订阅并清空引用。
- transcript anchor 在 `turn_start` publish 前建立；anchor 被裁剪后 `snapshotEventCursor()` 自动退回安全 latest cursor，避免 snapshot loop。
- Agent SSE 路由改用专用 Node writer；`res.write(false)` 等待 `drain`，socket close/error 或 subscription overflow 会打断等待并销毁响应。稳定 H3/Nitro 依赖未升级。
- 前端 reducer、live tool state 和 write/edit/apply_patch/request/switch/task 卡已迁移到有界字段；不再保存 `rawResult` 或 `linkedSessionId` 假消费者，工具卡明确提示“仅显示预览”。
- 审查收口后，前端消息状态显式区分 `live` / `durable` 投影来源；durable assistant 依次按 entry ID、live toolCall ID、同 invocation 最后一条无工具 live turn 接管，不再用 invocationId 覆盖第一条历史 assistant。
- 工具结果 content 与 details 分别共享 16 KiB 文本预算；`request_user_input` 的所有 answer text/note 共用 details 预算并公开 omitted 状态，正常 projector frame 不依赖 EventHub 超限降级。
- write/edit/apply_patch 的累计 args 在预览达限后使用指数增长投影水位，终态再精确投影；避免固定 16 KiB 周期反复扫描累计大参数。
- `seqBySession` 明确保留到 EventHub 生命周期结束以维持同 epoch seq 单调性；`close()` 会连同 replay、订阅和 seq metadata 一并释放。
- 最终边界审查将预算所有权从单字段提升为单条 entry/event：正常 projector 目标为 96 KiB、SSE hard limit 仍为 128 KiB。assistant 的 error/content/thinking 共用 64 KiB，最多公开 32 个 toolCall，全部 tool args 共用 24 KiB，并通过 `omittedToolCalls` 显式报告省略。
- `apply_patch` 的 patch preview 与 touched files 分别受 16/8 KiB 预算约束；路径数量、单路径截断或共享路径预算耗尽都会设置 `touchedFilesOmitted`。
- Agent waiting 新增轻量 `AgentUserInputFormDto`：最多 32 fields/options、256 nodes、2 KiB 单字符串和 32 KiB 总量，不允许配置界面的 `resource-preset`。Harness 在 waiting/persist/event 前验证，非法表单转为 tool error；runtime projector 另保留防御性 omission。
- `tool_execution_update` 删除无消费者的 args，避免慢工具进度重复扫描完整 write/edit/patch 参数；前端 live overlay 现在只持有 live turn，不再复制 durable history。
- EventHub `close()` 现在是幂等 terminal 操作；关闭后 publish/subscribe/connected/pin/unpin 统一拒绝，避免同 epoch seq 重启。

### Verification Result

- public projection / EventHub / SSE / write-plan / frontend 聚焦回归：`19 files / 148 tests passed`。
- Harness 与 black-box 回归：`2 files / 186 tests passed`。
- TypeScript：`bun run typecheck` passed。
- 10 MiB 累计 write fixture：公开累计事件序列化结果小于 5 MiB，单帧仍受 128 KiB 上限；旧的累计 partial 二次方序列化路径不再存在。
- 真实 paused `node:http` socket：writer 在 `write(false)` 后不再拉取下一事件；队列溢出会关闭连接，测试断言 response buffer 小于 256 KiB。
- 独立 Bun RSS smoke（10 MiB source write、256 个 delta）：`beforeRss=54.9 MiB`、`afterRss=185.8 MiB`、`rssDelta=130.9 MiB`；公开 projector 产出 256 个 bounded update、约 4.08 MiB 序列化量，EventHub replay 最终 248 条/约 3.99 MiB。RSS 包含 provider source partial 与 Bun runtime，仅作 smoke；硬边界仍由上述 bytes/queue 测试负责。
- 审查收口聚焦与 SSE/reducer 回归：`9 files / 107 tests passed`；`bun run typecheck` passed。
- Harness black-box 曾在本轮修改后首次独立回归通过 `17/17`，随后两次重跑均在既有 `terminal error 后清理 steer` 时序场景失败：steer 早于 active invocation 建立并伴随临时 session 清理竞态。失败栈不经过本轮 projection/EventHub 变更，本任务未越界修改 Harness admission 流程。
- 10 MiB 累计 apply_patch/edit fixture 使用真实累计参数；预览达限后的公开更新少于 40 次，toolcall_end 仍返回精确最终 bytes。
- 最终收口新增验证：64 个长 patch 路径仍低于 96 KiB；大 content/thinking/error + 40 toolCall assistant entry 低于 96 KiB并报告 8 个 omitted tool calls；10 MiB resource-preset form 在公开前被拒绝；300 条 durable history 运行时 live overlay 仅保留当前 live turn。
- 最终组合回归 `13 files / 108 tests passed`，Harness black-box `17/17 passed`，TypeScript typecheck passed。

### 计划偏差与边界

- Task 106 的 snapshot/history 分页仍未在本任务实现；它直接复用本任务的逐 entry projector。当前 snapshot 的 raw `SessionEntry[]` 仍由 Session Tree 使用，不能在本任务强行替换。
- `recordAgentWorkspaceWrite` / `nb-history` 大文件 before/after 快照仍是独立后续优化，不与 live transport 修复混写。
- 初版审查收口计划拟按固定 16 KiB milestone 重投影 edit/apply_patch；实现复核发现这仍会随累计正文形成二次方扫描，实际改为指数水位。UI 超限后的 bytes 进度更新频率更低，但终态保持精确，且没有引入增量 JSON/patch parser。
- Low-Code Form 原先直接复用设置系统的完整 DTO；实际 Agent runtime 只有 switch_mode 和只读写审批的小表单，因此最终拆成轻量 Agent 子集，没有为尚不存在的 Agent 资源编辑需求引入资源引用 API。
- Harness black-box 的 steer/admission 用例原先依赖调用启动后的时间窗口；测试现等待真实 active invocation 信号后再入队，不修改生产 admission 语义。
- 未执行浏览器验证、Git 提交或 PR 操作；这些需要用户另行授权。

## TODO / Follow-ups

### Session shell / queue boundary closure (2026-07-15)

本轮继续收口所有尚未经过 public projector 的控制数据：

- pending approval 的 `args` 统一使用 `PublicToolArgsDto`；live state 只返回有界计划路径，recovery 才返回用户明确要求保留的完整 `planContent` 与 `planContentBytes`。计划正文不进入 SSE、replay 或 subscriber queue；waiting 首次进入时发布 typed invalidation，避免每次状态刷新重复触发恢复。
- steer/followup 内部保留完整 `AgentQueuedInvocationTruth`（包括图片和原始 payload），公开 recovery 最早 64 项/64 KiB，live state 仅返回 count/status，delta 使用单项 bounded projection。图片只公开 MIME/bytes/omitted，不反向恢复模型输入。
- stable toolCall ID 不再文本截断；执行前验证非空且 UTF-8 不超过 512 bytes，非法 provider ID 明确拒绝。
- 表单 projector 对非法 formSpec fail closed，不静默降级为普通 approval。

相关 Harness、black-box、queue projector、stable ID、plan recovery 和前端状态测试已按新 DTO 契约迁移。最终组合回归 `15 files / 297 tests passed`，`bun run typecheck` passed；未执行浏览器验证。

### Control event semantic boundary closure (2026-07-19)

- 必须精确送达并获得 ack 的 `client_variable_patch_requested` 不再依赖 EventHub oversized fallback；请求超过 64 KiB 时在注册 pending 和发布 SSE 前明确失败。
- `invocation_aborted.reason` 只公开 2 KiB 预览，避免 abort 信号因大原因退化为 `snapshot_required`。
- 无前端消费者且从未完成 `sidecarContext` 透传的 Sidecar lifecycle events 已退出公开 DTO；内部 Sidecar 执行、side branch 与日志不变。
- Task 22/107/HTTP/Harness/variables/frontend 最终去重组合回归 `17 files / 319 tests passed`，`bun run typecheck` passed。

- [x] 复现累计 `message_update` 的序列化放大。
- [x] 复现 replay pin 绕过数量裁剪。
- [x] 复现 subscriber queue 无硬上限。
- [x] 用真实 H3 慢 socket 确认 EventHub queue=0 时 Node response buffer 仍增长。
- [x] 确认 `nb-history` 是次要峰值，不是本轮首要根因。
- [x] 确认 H3 1.15.11 无 drain backpressure、H3 2 RC/srvx 已修但不兼容当前稳定栈。
- [x] 确认采用 Agent SSE 专用 Node writer，不升级 H3 2 RC。
- [x] 确认 `session_entry` 应保持逐 entry，并识别 link/detach 隐式控制依赖。
- [x] 识别 replay trim 后 transcript anchor 可导致 snapshot 恢复循环。
- [x] 用户目标确认 live 工具正文改为有界预览。
- [x] 固化 shared `AgentChatEntryDto` 与 public tool projection。
- [x] 编写并通过 public projection 红灯测试。
- [x] 实现 immutable delta-first runtime events 与 run-scoped preview accumulator。
- [x] 实现 projected `session_entry` 与 typed projection invalidation。
- [x] 实现 replay/pin/replay floor/safe cursor/subscriber count+byte bounds。
- [x] 实现并验证真实 SSE backpressure。
- [x] 更新前端 reducer 与工具卡。
- [x] 完成聚焦回归、内存基线和代码审查收口。
- [x] 修复同 invocation 多 assistant turn 的 durable/live 错误合并。
- [x] 让 tool result content/details 使用共享预算并覆盖 request answer 极限 fixture。
- [x] 用指数投影水位收口 10 MiB edit/apply_patch 累计参数扫描。
- [x] EventHub close 释放 seq metadata。
- [ ] 用户决定是否执行浏览器验证。
