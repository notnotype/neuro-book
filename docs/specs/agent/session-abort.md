---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.session-abort
owners:
  - agent-runtime
  - session-persistence
---

# Agent Session Abort

本文是 Agent Session 取消当前 invocation 的唯一公开行为合同。它定义 HTTP abort、运行态、持久化 lifecycle、SSE 事件、队列副作用、取消失败和恢复边界；方案 B 的锁与执行器取舍见 [ADR 0019](../../../packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md)。

## 目标与非目标

目标：

- 让用户或上层调用方能够取消当前 Session invocation，并区分无 active invocation、合作取消和 forced-abort。
- 在 provider、tool 或 settleRun 不合作时保持有界调用方响应，同时不让迟到结果污染已取消 invocation 或后续 invocation。
- 让唯一 `aborted` lifecycle、`activeInvocation`、SSE 事件和 steer/follow-up 队列对调用方保持一致。
- 为同步 admission 失败和异步 durable write 失败提供可重试、fail-closed 的行为。

非目标：

- 不改变 compaction、Provider 协议、普通 invocation 输入或 Task 147 的上下文压缩合同。
- 不提供第二套 Session mutation lock、直接 repository 写入、tombstone 旁路或静默兼容 fallback。
- 不把 HTTP 200 解释为物理 JSONL append 已经完成；200 只表示取消终态已被接受并占据 Session write queue。
- 不定义真实 Provider、浏览器人工验收或远端部署行为。

## 术语与参与者

- **Session**：由 `sessionId` 定位、具有 JSONL durable history 和 live projection 的 Agent 对话。
- **invocation**：一次拥有 Session running 状态、唯一 `invocationId` 的 Agent 执行段。
- **cooperative abort**：AbortSignal 被 Provider/tool/settleRun 观察并在宽限期内自行收口。
- **forced-abort**：宽限期后仍由当前 invocation 拥有运行态时，取消控制面同步接管 ownership，并把唯一 `aborted` lifecycle 送入 Session write queue。
- **admission**：在 Session mutation 边界内读取最新状态、校验 `canAbort` 并 claim 当前 invocation 的阶段。
- **pending recovery**：forced lifecycle 物理写或写后状态发布失败后，由同一个 SessionWriteExecutor 保存并重放的精确 Session/invocation plan。

## 输入与前置条件

HTTP 入口：

```text
POST /api/agent/sessions/:sessionId/abort
```

路径参数：

- `sessionId` 必须是安全正整数；非法值返回 HTTP 400。
- 主 Session 缺失返回 HTTP 404，错误码为 `SESSION_NOT_FOUND`。

请求体允许的字段只有：

```typescript
type AgentAbortRequestDto = {
    reason?: string;
    clearQueue?: boolean;
};
```

- `reason` 可选。只有调用方显式提供时，才进入 lifecycle 或公开控制事件；取消不得把 Provider 的英文 abort 错误正文作为默认用户错误。
- `clearQueue` 可选，缺失时按 `true` 处理。`true` 清空 steer/follow-up admission；`false` 不清空 follow-up，而把它们保留为 `paused`。
- 非法字段、非法类型或不符合 schema 的 body 返回 HTTP 400，不能部分执行取消。

- 取消 admission 必须先解析当前 Session runtime projection；若 `context.archived` 或 `summary.status === "archived"`，无论是否存在 active invocation 都立即返回稳定 HTTP 409 `session_abort_not_allowed`。
- 对非归档 Session，再读取/claim active invocation；没有 active invocation，或与 `expectedInvocationId` 不匹配时，保持 HTTP 200 幂等 no-op。Idle 的 `interaction.canAbort === false` 不参与此分支判断。
- 只有存在匹配 active invocation 的 Running、Waiting User 或 Aborting 才校验 interaction policy；policy 明确拒绝停止运行时返回稳定 HTTP 409。当前策略允许 active Running/Waiting 在 Profile 不可用时 abort。Profile 不可运行本身不改变非归档 Idle no-op，也不改变策略允许的 active abort。
## 输出与可观察行为

成功响应均为 HTTP 200：

```typescript
type AgentAbortResult = {
    status: "idle" | "aborted";
    sessionId: number;
};
```

- 没有 active invocation、重复取消已完成的 invocation 或 invocation 已在其它 terminal 路径收口时返回 `{status: "idle", sessionId}`，不新增 lifecycle、resolution、queue item 或终态事件。
- Waiting User 的合作收口返回 `{status: "aborted", sessionId}`，并在返回前完成唯一 durable `aborted` lifecycle 和必要 resolution。
- Running invocation 的 abort admission 成功，或 forced-abort 已同步占据 Session write queue 后，返回 `{status: "aborted", sessionId}`。该响应表示取消已被接受，不表示物理 append、live-state publish 或 after-write observer 已完成。

稳定错误响应：

| 条件 | HTTP | `data.code` | 可重试 |
| --- | ---: | --- | --- |
| 非法路径或 body | 400 | 现有 Agent validation code | 否 |
| 主 Session 不存在 | 404 | `SESSION_NOT_FOUND` | 否 |
| Session 当前不允许 abort | 409 | `session_abort_not_allowed` | 否 |
| forced lifecycle 无法同步入队 | 503 | `session_abort_durability_unavailable` | 是 |

SSE 与 live state：

- 接受 Running abort 后发送 `invocation_aborted`，前端进入 aborting/stopped 过渡态。
- Waiting User durable writes 先抑制 executor 自动公开事件；释放 ownership 后按 `invocation_aborted -> session_entry（仅本次新写入） -> session_state_changed -> agent_end` 发布，避免 resolution/lifecycle 事件先于 abort 通知。
- 终态 state 或 snapshot 最终必须显示 `activeInvocation: null`。
- 终态事件使用 `agent_end {status: "aborted"}`；abort 不是 Run Error，不应默认显示错误卡。
- 迟到 Provider/tool/settleRun 结果、`message_update`、`agent_end` 或其它 invocation 事件不能在 ownership 释放后污染当前 Session 或下一 invocation。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察结果 |
| --- | --- | --- | --- |
| Idle | abort | Idle | HTTP 200 idle；无 durable lifecycle、resolution、queue 或终态事件副作用。 |
| Waiting User | 合作 abort | Idle | 写一次 aborted resolution 与 aborted lifecycle；发布 abort/state/终态事件；按 `clearQueue` 处理队列。 |
| Running | abort admission | Aborting | 在 mutation 边界内 claim invocation、进入 aborting、触发 AbortSignal；运行锁外等待最多 `150ms` grace。 |
| Aborting | 合作 terminal | Idle | 合作路径只能提交该 invocation 的唯一 aborted terminal；释放 ownership，后续 start 排在 durable terminal 后。 |
| Aborting | grace 到期且仍拥有 invocation | Idle | forced lifecycle 已入 write queue 后释放 ownership、补发终态事件；迟到运行结果被 fence 丢弃。 |
| Aborting | forced enqueue 同步失败 | Aborting | 不释放 ownership、不发 `agent_end`、不 resolve 原 invocation gate；HTTP 503，重复 abort 可重试。 |
| 任意已完成状态 | 重复 abort | Idle | 幂等返回，不重复写 lifecycle 或事件。 |

并发语义：

- 同一 invocation 的合作 terminal 与 forced terminal 只有第一个 durable terminal 事实生效；后到路径必须无副作用地退出。
- 后续 invocation 的 `start` 不得早于旧 invocation 唯一 `aborted` lifecycle 的 durable append。
- 同一 Session 的多个 abort 请求不能叠加 grace timer、tombstone、resolution 或 `aborted` lifecycle。

## 副作用与数据

- Invocation lifecycle 在历史中最多追加一个匹配 `invocationId` 的 `status: "aborted"` entry。没有显式 `reason` 时不写默认英文错误正文。
- Waiting abort 必要时追加一个标记取消的 tool/user resolution；Running forced-abort 不生成 Provider 错误消息或伪造模型结果。
- `clearQueue: true` 清空 steer 与 follow-up；`false` 保留 follow-up 并以 `pausedBy.reason: "aborted"` 标记，后续由既有 resume/queue owner 处理。
- 唯一 forced lifecycle 以及 waiting partial lifecycle 的 `ensureAutoLeaf` 修复必须经同一个 SessionWriteExecutor 的 per-session write queue；不能直接调用 repository、建立第二把锁或写 projection 旁路。
- `ensureAutoLeaf` 是幂等修复：目标已是 active leaf 时不追加 entry 或公开事件；目标缺少 active leaf 时只追加唯一 auto leaf。
- forced plan 只能包含单 Session、固定 cause `lifecycle.aborted.force`、单个非 projection `invocation_lifecycle(status: "aborted")`，且 entry invocationId 必须匹配授权 invocation。

## 失败与恢复

同步 forced enqueue 失败时：

1. 终态没有占据 write queue，不能返回 200 aborted。
2. 当前 invocation 保持 `aborting` ownership，禁止迟到运行路径写入新 terminal。
3. 不发布 `agent_end`，不 resolve 原 invocation abort gate，不伪造 durable lifecycle。
4. HTTP 返回 503 `session_abort_durability_unavailable`、`retryable: true`；调用方重复同一 abort 请求即可重试。
5. 若底层在重试前合作收口，普通 aborting terminal seam 负责唯一 aborted lifecycle；否则下一次 abort admission 再次尝试 forced plan。

forced 已入队但 physical append、live-state publish 或 after-write 阶段失败时：

- HTTP 可能已经返回 200，因为 admission 已被 write queue 接受；该响应不声称 durable append 已完成。
- SessionWriteExecutor 必须保留精确 Session/invocation plan 和 forced authorization 作为 pending recovery，并在同一 per-session write queue 中恢复。
- Recovery 先读取 Session；如果精确 invocation 已有 `aborted` lifecycle，则幂等视为成功，禁止重复追加；否则重放同一个 forced plan。
- 后续任何普通 write 或新 invocation start 必须先 drain recovery。Recovery 失败时该次新写入以 retryable error 失败，旧 recovery 保留，不能让新 start 越过旧终态。
- 物理写失败不得通过直接 repository 写、第二套锁、tombstone 旁路或静默放宽 timeout 来掩盖。
- 进程重启后不能根据缺失的 aborted entry 猜测取消成功；只有既有 session recovery 规则可以把未闭合 start 投影为 `interrupted`，而不是 `aborted`。

授权缺失、Session/invocation 不匹配、projection plan、多个 op、projection append 或非 aborted entry 一律 fail closed，且不产生 durable 写入或替代错误事件。

## 边界与兼容

- HTTP route 只负责路径/body 校验、调用统一 Agent HTTP helper 和错误投影；Session 状态转移由 Harness 负责，durable 写入由 SessionWriteExecutor 负责。
- 普通 abort admission 继续遵守现有 Session mutation 线性化；forced 到期控制面是窄化例外，只为维持取消预算，不改变普通 admission 合同。
- 公开输入继续使用现有 `AgentAbortRequestDtoSchema`；成功 DTO 保持 `{status, sessionId}`，新增错误只使用稳定 code，不暴露内部文件路径、Provider 原文或 lock 实现细节。
- `150ms` grace、`300ms` forced-abort 上界、`1_000ms` external-signal 上界和 `30_000ms` 外层测试预算保持不变。

## 验收与 Smoke

1. Given non-archived Idle Session with loaded or unavailable Profile, When POST abort, Then HTTP 200 idle，历史、队列和事件没有新增取消副作用。
2. Given Waiting User invocation，When POST abort with reason，Then HTTP 200 aborted，只有一个 aborted lifecycle/resolution，activeInvocation 为 null，`agent_end` 不被当作 Run Error。
3. Given Running cooperative invocation，When POST abort，Then 150ms 内合作收口，只有一个 aborted terminal，队列按 clearQueue 分支呈现。
4. Given provider/tool/settleRun 忽略 signal，When POST abort，Then 300ms 内 HTTP 和原 invocation 有界返回，activeInvocation 为 null，迟到结果不可见，后续 start 排在旧 aborted append 后。
5. Given forced enqueue 同步失败，When POST abort，Then HTTP 503 retryable，active ownership 与 aborting 状态保留，没有 agent_end、abort gate 或 durable aborted 伪造；重试可继续收口。
6. Given forced lifecycle 物理写失败，When recovery 或下一次 Session write 运行，Then 同一个 write queue 幂等重放，已有 aborted entry 不重复追加，恢复失败阻止后续 start。
7. Given duplicate/concurrent abort，When repeated POST arrives，Then only one terminal lifecycle、resolution、invocation_aborted 和终态事件生效，其余返回 idle 或同一 accepted result。
8. Given archived Session，When POST abort with or without active invocation，Then HTTP 409 `session_abort_not_allowed`，不写 lifecycle。

聚焦验证入口：

- `bun run --cwd packages/neuro-book test -- server/api/agent/sessions/[sessionId]/abort.post.test.ts server/agent/http.test.ts server/agent/harness/neuro-agent-harness.black-box.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/session/write-plan.test.ts`
- `bun run --cwd packages/neuro-book typecheck`
- `bun run docs:check` 与 `bun run governance:check`

## 实现合同
已实现。当前实现由 `NeuroAgentHarness.abortInvocationMatching()` 负责 mutation admission、waiting 合作收口和 running/forced ownership fence；`SessionWriteExecutor` 负责唯一 forced lifecycle 与 waiting partial `ensureAutoLeaf` repair 的 per-session write queue、严格 plan/authorization 校验、窄化事件抑制与 pending recovery；HTTP route/helper 负责 400/404/409/503 稳定边界。测试覆盖 waiting resolution/lifecycle/leaf 故障重试、forced enqueue/physical/after-write/live-state 故障、重复/迟到结果、队列语义、SSE 顺序与后续 start ordering。

- [Task 00159：Agent abort mutation contract](../../../.agents/tasks/00159-agent-abort-mutation-contract/README.md)
- [Task 18 Harness 黑盒合同](../../../packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)
- [ADR 0019：Agent abort mutation boundary](../../../packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md)

## 证据

- [Task 00159：Agent abort mutation contract](../../../.agents/tasks/00159-agent-abort-mutation-contract/README.md)
- [Task 18 Harness 黑盒合同](../../../packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)
- [ADR 0019：Agent abort mutation boundary](../../../packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md)
