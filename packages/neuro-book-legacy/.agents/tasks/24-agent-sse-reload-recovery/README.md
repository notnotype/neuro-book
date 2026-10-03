# Agent SSE Reload Recovery

## User Request

- 前端 Agent 正在运行时，后端 dev 服务重载后，聊天 UI 会停在旧的 running / waiting / tool running 状态。
- 现象表现为：历史消息还在，但前端无法正常 continue，或者继续请求与真实后端运行态脱节。
- 用户要求不要只做局部 hack，需要仔细调研相关 task、文档和代码后，新建 task 并记录系统性修复计划。

## Goal

修复 Agent session 在后端 dev reload / EventHub 重建后的恢复协议，让前端不再相信旧的内存运行态，而是以 session snapshot 作为恢复真相。

成功标准：

- SSE 增量 cursor 从单独 `seq` 升级为 `(eventEpoch, seq)`。
- `connected` 成为 event stream handshake，明确告诉前端当前事件流身份和最新序号。
- snapshot 成为跨 reload、断线、replay buffer 丢失后的恢复真相。
- 后端 reload 后：
  - 普通 running 不恢复半截 provider/tool run，而是通过 snapshot 清掉前端 running，并投影为 interrupted。
  - durable waiting 可以从 session active path hydrate，继续展示 pending approval / user input。
  - `continue(resolution)` 可以复用原 waiting `invocationId` 写入 `resumed`。
  - hydrated waiting 支持 abort。

非目标：

- 第一版不恢复重载前正在执行的 provider request / tool batch / abort controller。
- 第一版不自动 retry 被 reload 打断的普通 run。
- 第一版不处理多后端实例的 event stream 一致性。
- 第一版不自动 drain 重载前的 ready follow-up queue。

## Implemented State

- 已按 18 的恢复合同落地：event 是增量优化，snapshot 是恢复真相。
- `AgentSessionEventHub` 现在创建进程内 `eventEpoch`，所有公开 SSE envelope 都携带 `eventEpoch + seq`。
- `connected` 已从 route 伪造事件改为 EventHub handshake，携带当前 `eventEpoch/latestSeq`。
- 前端 stream cursor 已改为 `{eventEpoch, after}`，并在 epoch mismatch / cursor ahead / replay buffer expired 时拉 snapshot。
- `applySnapshot()` 在 epoch 改变时允许 `lastSeq` 回退，不再被旧 epoch 的高 seq 压住。
- `getSessionSnapshot()` 返回当前 `eventEpoch`，并可从 session active path hydrate durable waiting active invocation。
- 后端 reload 后：
  - 普通 running 不恢复半截 provider/tool runtime，snapshot 会清掉前端 live running。
  - 有可靠 pending approval + waiting lifecycle 时，snapshot 恢复 waiting UI。
  - `continue(resolution)` 可在新 harness 上复用原 waiting `invocationId`。
  - hydrated waiting 可走 abort 分支。
- 落后订阅者收到的 `snapshot_required` 是 per-subscriber recovery control event，不推进 session seq，避免给其他正常订阅者制造人工 seq gap。
- 2026-05-31 继续补齐系统边界：
  - `seq` 已从全局递增改为 per-session stream cursor，其他 session / linked agent / summarizer 的事件不会让当前 session 误判 `seq_gap`。
  - `getSessionSnapshot().latestSeq` 返回目标 session 的 EventHub 尾部；`eventCursor.after` 才是前端应用 snapshot 后继续订阅的恢复点，`lastSeq` 作为兼容别名等于 `eventCursor.after`。
  - `snapshot_required` control event 会在前端 stale seq 过滤之前处理，避免 recovery event 因 seq 等于 latestSeq 被丢弃。
  - `invokeAgent()` 入口新增 session admission queue，`continue(resolution)` 的 hydrate waiting / claim active / queue admission 作为同 session 短事务串行执行。
  - `continue(resolution)` 只有 active 或 hydrated 状态为 `waiting` 才能恢复；active 已是 `running` / `aborting` 时拒绝，不会创建 unrelated invocation。
  - `abortInvocation()` 的 waiting hydrate/claim 也走同一个 admission queue。
  - `SessionWriteExecutor` 内部新增 per-session write queue，同一个 session 的 repo append 与对应 `session_entry` / `session_state_changed` publish 串行执行；跨 session 写入仍可并行。
- 2026-06-14 补齐运行中前端刷新恢复：
  - Harness 会在公开 `turn_start` 后记录当前 turn 的 transcript replay anchor，并 pin 住 EventHub replay buffer。
  - 当前 turn transcript `persist` 落盘后清理该 turn anchor；`runtime_only` 保留到 invocation terminal。
  - snapshot 返回 `eventCursor` 与 `latestSeq`：前端刷新使用 `eventCursor` replay 未落盘 runtime events，`latestSeq` 仅作事件流尾部观测。

## Walkthrough

期望恢复链路：

1. 前端持有旧 cursor，例如 `(epoch=A, seq=426)`。
2. 后端 dev reload，新的 EventHub 创建 `(epoch=B, seq=0)`。
3. 前端 SSE 重连时把旧 cursor 发给后端。
4. 后端返回 `connected(epoch=B, latestSeq=0)`。
5. 前端发现 epoch 不同，停止相信旧 live projection，并请求 snapshot。
6. snapshot 返回当前 session 真相：
   - 如果没有可恢复 waiting，则 UI 回到 idle / interrupted。
   - 如果 active path 上有可靠 pending approval，则 UI 恢复 waiting。
7. 前端把 cursor 重置为 snapshot 的 `eventCursor`，后续同 epoch event 才继续增量 apply。

## Decisions

- `eventEpoch` 第一版使用进程内随机 UUID。
  - 不持久化。
  - 不跨多实例同步。
- `seq` 只在同一个 `eventEpoch` 内有意义。
- `seq` 是 session stream cursor，不是全局 stream cursor；前端的 gap 判断只对当前 session 有意义。
- `connected` 是 handshake，不是普通业务增量事件。
- snapshot apply 必须使用 `snapshot.eventCursor` 作为恢复 cursor；这个 cursor 允许回退到未落盘 transcript 的 replay anchor，不能继续把 EventHub 尾部当成已覆盖事件点。
- 普通 running 在后端 reload 后不恢复半截执行，第一版投影为 interrupted。
- durable waiting 可以恢复，因为 pending approval / user input 是可从 session active path 证明的 suspend point。
- 如果 active path 上有 pending approval，但找不到可靠 waiting lifecycle，`continue(resolution)` 必须拒绝，不能偷偷创建 unrelated invocation。
- 从 session hydrate 出来的 waiting 也支持 abort，用户恢复后既可以回答，也可以取消。
- invocation admission 和 session writes 都是短事务边界：
  - admission queue 只保护入口 claim，不包 provider streaming / tool execution。
  - write queue 只保护同 session 写入和 publish 顺序，不改变 `SessionWritePlan` public 形状。

## Implementation Plan

### 1. DTO and EventHub

- 在 `AgentSessionEventDto` 上增加 `eventEpoch: string`。
- 在 `AgentSessionSnapshotDto` 上增加 `eventEpoch: string`。
- 在 `AgentSessionEventsQueryDtoSchema` 增加 `eventEpoch?: string`。
- 把 `connected` control event 扩展为：

```ts
{
    type: "connected";
    eventEpoch: string;
    latestSeq: number;
}
```

- `AgentSessionEventHub` 初始化时生成 `eventEpoch`。
- `publish()` 自动补上 `eventEpoch` 和目标 session 内递增 `seq`。
- 增加 handshake helper，用于 SSE route 发送当前 `eventEpoch/latestSeq`。
- `subscribe()` 改为接收 cursor：

```ts
{
    eventEpoch?: string;
    after?: number;
}
```

- replay 规则：
  - cursor epoch 缺失或不一致：不 replay 旧 buffer，等待前端根据 connected 拉 snapshot。
  - 同 epoch 且 `after < firstReplaySeq - 1`：推送 `snapshot_required`。
  - 同 epoch 且 `after > sessionLastSeq`：推送 `snapshot_required`。
  - 同 epoch 且 after 正常：replay `after` 之后的事件。

### 1.5. EventHub Session Cursor Hardening

- `AgentSessionEventHub` 维护 `seqBySession`，而不是单个全局 `seq`。
- `connectedEvent(sessionId)` 的 `latestSeq` 是该 session latestSeq。
- `snapshotRequiredEvent(sessionId)` 不推进 session seq。
- `getSessionSnapshot(sessionId).latestSeq` 读取 `eventHub.lastSeq(sessionId)`，只表示 EventHub 尾部。
- `getSessionSnapshot(sessionId).eventCursor.after` 才是应用 snapshot 后继续订阅的恢复点；`lastSeq` 只作为兼容别名，值等于 `eventCursor.after`。
- 目标效果：
  - session A 收到 seq 1。
  - session B 产生多条事件。
  - session A 下一条仍是 seq 2。
  - 前端不会因为其他 session 的事件误判当前 session 缺 event。

### 2. HTTP and Frontend Cursor

- SSE route 不再自己伪造 `connected` event。
- route 从 harness/EventHub 获取真实 connected handshake。
- `subscribeAgentSessionEvents()` 和前端 `subscribeSessionEvents()` 都改为传 cursor 对象。
- 前端请求 query 包含：

```text
?eventEpoch=<currentEpoch>&after=<lastSeq>
```

- `useAgentSessionStream()` 从 session store 读取 `eventEpoch` 和 `lastSeq` 组成 cursor。
- 首次加载、前端刷新和 snapshot recovery 后，store 内 cursor 来自 `snapshot.eventCursor`；普通 SSE 断线重连仍使用本地最后实际应用的 `lastSeq`。

### 3. Frontend Recovery Semantics

- `useAgentSession()` 增加 `eventEpoch` ref，并在 reset 时清空。
- `applyEvent()` 先处理 `connected`，不能让它被旧 `lastSeq` 过滤。
- connected 处理规则：
  - 本地没有 epoch：记录新 epoch，连接状态改为 connected。
  - 本地 epoch 与 connected epoch 一致：连接状态改为 connected。
  - 本地 epoch 与 connected epoch 不一致：请求 snapshot，reason 为 `event_epoch_changed`。
  - connected 的 `latestSeq < lastSeq` 时，即使 epoch 异常相同，也请求 snapshot，作为 runtime 重建兜底。
- 普通 event 处理规则：
  - event epoch 与本地 epoch 不一致：请求 snapshot。
  - 同 epoch 下才做 stale / seq gap 判断。
- `applySnapshot()`：
  - 优先读取 `snapshot.eventCursor`，兼容旧数据时才 fallback 到 `{ eventEpoch: snapshot.eventEpoch, after: snapshot.lastSeq }`。
  - 直接设置 `eventEpoch = eventCursor.eventEpoch`，`lastSeq = eventCursor.after`，并以 snapshot 清理 live patch。
  - 不使用 `snapshot.latestSeq` 作为恢复点；它只用于调试和对照服务端事件流尾部。
- `useAgentSessionStream()` 处理 snapshot reason 时优先级：
  - `event_epoch_changed`
  - `snapshot_required`
  - `seq_gap`

### 4. Harness Snapshot and Waiting Hydration

- `getSessionSnapshot()` 返回 `eventEpoch`。
- `getSessionLiveState()` 继续保持轻量；event stream identity 放在 SSE envelope / snapshot cursor，不塞进每个 live state。
- 增加内部 helper，从 session active path hydrate waiting active invocation：
  - 先按现有逻辑查 pending approval / user input。
  - 如果内存 active invocation 存在，优先使用内存。
  - 如果内存缺失但存在 pending approval，则查找最近可靠的 `invocation_lifecycle` waiting entry。
  - 该 invocationId 后面不能已经有 `resumed`、`end`、`error`、`aborted` 或 `interrupted`。
  - 找到后返回：

```ts
{
    invocationId,
    sessionId,
    status: "waiting",
    mode: "continue",
    startedAt: waitingEntry.timestamp,
}
```

- `resolveSessionStatus()` 使用同一个 active/hydrated waiting projection。
- 没有内存 active，也没有 hydrated waiting 时，尊重 repo summary 的 terminal / interrupted 状态，不把它强行覆盖成 running 或 waiting。

### 5. Continue and Abort Recovery

- `invokeAgent()` 在处理 `continue(resolution)` 时：
  - 先进入 per-session admission queue。
  - 在短事务内读取内存 active invocation。
  - 如果没有内存 active，则尝试 hydrate waiting invocation。
  - hydrate 成功后，立即 claim active invocation，后续 run loop 在 queue 外执行。
  - 只有 `waiting` 能恢复；active 已经是 `running` / `aborting` 时拒绝。
  - hydrate 失败但存在 pending approval 时，拒绝请求，返回结构化错误。
- `abortInvocation()` 在没有内存 active 时：
  - 进入同一个 per-session admission queue 尝试 hydrate waiting invocation。
  - hydrate 成功后 claim waiting active，并走 waiting abort 分支。
  - 写 abort resolution、lifecycle `aborted`、`invocation_aborted` 和 session state update。
  - 不尝试 abort 普通 running，因为 provider/tool runtime 已经不存在。

### 6. Session Write Queue

- `SessionWriteExecutor.execute()` 仍接收 `SessionWritePlan[]`，public shape 不变。
- executor 内部按 `target.sessionId` 排序并串行进入 per-session write queue。
- 同一个 session 的 `read current leaf -> append -> publish entry/state` 不会与另一组同 session 写入交错。
- 多 session plan 以固定 sessionId 顺序加锁，避免交叉写入死锁。

## Files Changed

- 已修改：
  - `shared/dto/agent-session.dto.ts`
  - `server/agent/events/session-event-hub.ts`
  - `server/api/agent/sessions/[sessionId]/events.get.ts`
  - `server/agent/http.ts`
  - `server/agent/harness/neuro-agent-harness.ts`
  - `server/agent/session/write-plan.ts`
  - `app/composables/useAgentSessionApi.ts`
  - `app/components/novel-ide/agent/useAgentSession.ts`
  - `app/components/novel-ide/agent/useAgentSessionStream.ts`
- 已补测试：
  - `server/agent/events/session-event-hub.test.ts`
  - `server/agent/http.test.ts`
  - `server/agent/harness/neuro-agent-harness.test.ts`
  - `server/agent/session/write-plan.test.ts`
  - `app/components/novel-ide/agent/useAgentSession.test.ts`
  - `app/components/novel-ide/agent/useAgentSessionStream.test.ts`
  - `app/components/novel-ide/agent/agent-message.test.ts`
  - `app/utils/agent-message-projection.test.ts`

## Verification

已运行：

```powershell
bunx vitest run server/agent/events/session-event-hub.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/http.test.ts app/utils/agent-message-projection.test.ts app/components/novel-ide/agent/agent-message.test.ts shared/dto/agent-session.dto.test.ts --reporter=dot
```

结果：

- 8 个测试文件通过。
- 146 个测试用例通过。

覆盖场景：

- EventHub publish/replay 都带稳定 `eventEpoch`。
- 同 epoch replay 正常。
- 同 epoch `after > lastSeq` 触发 `snapshot_required`。
- epoch mismatch 不 replay 旧 buffer。
- 前端收到新 epoch connected 后触发 snapshot。
- 新 epoch snapshot 允许 `lastSeq` 回退。
- 后端 reload 后，前端旧 running 被 snapshot 清掉。
- 后端 reload 后，waiting session 能恢复 pending approval UI。
- 新 harness 上 `continue(resolution)` 复用原 waiting `invocationId`。
- hydrate waiting 后可以 abort。
- lifecycle 不可靠时拒绝 resolution，不创建新 invocation。

追加运行：

```powershell
bunx vitest run server/agent/events/session-event-hub.test.ts server/agent/session/write-plan.test.ts app/components/novel-ide/agent/useAgentSession.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot
```

结果：

- 4 个测试文件通过。
- 106 个测试用例通过。

追加覆盖场景：

- 不同 session 使用独立 seq；其他 session 事件不会制造当前 session 的 seq gap。
- 同 session 并发 `SessionWriteExecutor.execute()` 串行进入 repo append。
- 后端 reload 后两个并发 `continue(resolution)` 只有一个成功。
- 并发 resolution 后 session 中只有一个 resolution toolResult 和一个 `resumed` lifecycle。

## TODO / Follow-ups

- 如未来需要恢复后端重启前的 ready follow-up queue 自动 drain，应另开 coordinator recovery 任务。
- 如未来支持多后端实例，`eventEpoch` 需要升级为实例/stream identity 更明确的协议；第一版不处理。
- 尚未做真实浏览器/dev-server 热重载手工验收。
