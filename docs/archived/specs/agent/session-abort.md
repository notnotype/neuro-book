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

本文是 Agent Session 取消当前 invocation 的已实现行为合同。它定义 HTTP abort、运行态、持久化 lifecycle、SSE 事件、队列副作用、取消失败和恢复边界；方案 B 的架构取舍见 [ADR 0019](../../../packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md)。

## 目标与非目标

目标：

- 允许用户或上层调用方取消当前 Session invocation，并区分无 active invocation、合作取消和 forced-abort。
- 在 Provider、tool 或 settlement 不合作时保持有界调用方响应，同时阻止迟到结果污染已取消 invocation 或后续 invocation。
- 让唯一 `aborted` lifecycle、`activeInvocation`、SSE 事件和 steer/follow-up 队列保持一致。
- 为同步准入失败和异步持久化失败提供可重试、fail-closed 的行为。

非目标：

- 不改变 compaction、Provider 协议、普通 invocation 输入或上下文压缩合同。
- 不提供第二套 Session mutation lock、直接 repository 写入、tombstone 旁路或静默兼容 fallback。
- 不把 HTTP 200 解释为物理 JSONL append 已经完成。
- 不定义真实 Provider、浏览器人工验收或远端部署行为。

## 术语与参与者

- **Session**：由 `sessionId` 定位、具有 JSONL durable history 和 live projection 的 Agent 对话。
- **invocation**：一次拥有 Session running 状态、唯一 `invocationId` 的 Agent 执行段。
- **cooperative abort**：AbortSignal 被 Provider、tool 或 settlement 观察并在宽限期内自行收口。
- **forced-abort**：宽限期后仍由当前 invocation 拥有运行态时，取消控制面接管 ownership，并把唯一 `aborted` lifecycle 送入 Session write queue。
- **admission**：在 Session mutation 边界内读取最新状态、校验交互策略并 claim 当前 invocation 的阶段。
- **pending recovery**：持久化或写后状态发布失败后，按同一 Session 写入顺序重试原取消终态的恢复阶段。

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

- `reason` 可选。只有调用方显式提供时，才进入 lifecycle 或公开控制事件；取消不得把 Provider 的 abort 错误正文作为默认用户错误。
- `clearQueue` 缺失时按 `true` 处理。`true` 清空 steer/follow-up admission；`false` 保留 follow-up 并标记为 paused。
- 非法字段、非法类型或不符合 schema 的 body 返回 HTTP 400，不能部分执行取消。

取消必须读取当前 Session 交互状态：

- Idle 没有 active invocation 时，取消是幂等 no-op。
- Running、Waiting User 或 Aborting 时，只有 interaction policy 允许停止运行才接受 admission。
- Archived、Profile 不可运行或其它不允许停止的状态返回 HTTP 409 `session_abort_not_allowed`。

## 输出与可观察行为

成功响应均为 HTTP 200：

```typescript
type AgentAbortResult = {
    status: "idle" | "aborted";
    sessionId: number;
};
```

- 没有 active invocation、重复取消已完成 invocation 或 invocation 已在其它 terminal 路径收口且没有 pending recovery 时返回 `{status: "idle", sessionId}`，不新增 lifecycle、resolution、queue item 或终态事件。
- Waiting User 的合作收口返回 `{status: "aborted", sessionId}`，并完成唯一 durable `aborted` lifecycle 和必要 resolution。若 lifecycle 已 durable 但 auto leaf 尚未完成，内存保持 `aborting` recovery ownership；此时 continue/resolution admission 不得追加任何 entry，显式 abort retry 只补同一 terminal。
- Running invocation 的 abort admission 被接受后返回 `{status: "aborted", sessionId}`；该响应只表示取消已接受，不表示所有物理写入或状态事件已经完成。queue projection 持久化不得阻塞进入 Aborting、触发 AbortSignal 或启动有界 grace。

稳定错误响应：

| 条件 | HTTP | `data.code` | 可重试 |
| --- | ---: | --- | --- |
| 非法路径或 body | 400 | 现有 Agent validation code | 否 |
| 主 Session 不存在 | 404 | `SESSION_NOT_FOUND` | 否 |
| Session 当前不允许 abort | 409 | `session_abort_not_allowed` | 否 |
| forced lifecycle 无法同步入队 | 503 | `session_abort_durability_unavailable` | 是 |

SSE 与 live state：

- 接受 Running abort 后发送 `invocation_aborted`，前端进入 aborting/stopped 过渡态。
- Waiting User 的 durable writes 不得先于 `invocation_aborted` 自动公开；释放 ownership 后按 `invocation_aborted -> session_entry -> session_state_changed -> agent_end` 发布，其中 `session_entry` 只对应本次新增或补发的 durable entry。
- 终态 state 或 snapshot 最终必须显示 `activeInvocation: null`。
- 终态事件使用 `agent_end {status: "aborted"}`；abort 不是 Run Error。
- 迟到 Provider、tool、settlement、`message_update` 或 `agent_end` 不能在 ownership 释放后污染当前 Session 或下一 invocation。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察结果 |
| --- | --- | --- | --- |
| Idle | abort | Idle | HTTP 200 idle；无 durable lifecycle、resolution、queue 或终态事件副作用。 |
| Waiting User | 合作 abort | Idle | 写一次 aborted resolution 与 lifecycle；按 `clearQueue` 处理队列并发布终态事件。 |
| Running | abort admission | Aborting | 在 mutation 边界内 claim invocation、进入 aborting、触发 AbortSignal；运行锁外等待有界 grace。 |
| Aborting | 合作 terminal | Idle | 仅该 invocation 的唯一 aborted terminal 生效；释放 ownership。 |
| Aborting | grace 到期且仍拥有 invocation | Idle | forced lifecycle 被接受进入 Session write queue；迟到运行结果被 fence。 |
| Aborting | forced enqueue 同步失败 | Aborting | 保留 ownership，不发 `agent_end` 或伪造 durable lifecycle；HTTP 503 可重试，重试直接进入原 forced plan，不重复 grace。 |
| 已释放 ownership但有 pending recovery | 重复 abort | Idle | 先排空同一 Session recovery；成功返回 aborted，失败保持 retryable barrier，不宣称 idle。 |

并发语义：

- 同一 invocation 的合作 terminal 与 forced terminal 只有第一个 durable terminal 事实生效。
- 后续 invocation 的 `start`、continue resolution 或普通 write 不得早于旧 invocation 唯一 `aborted` lifecycle 及其必要 active-leaf repair。
- 同一 Session 的多个 abort 请求不能叠加 grace timer、resolution 或 `aborted` lifecycle；forced retry 跳过第二次 grace，已释放 ownership的重复 abort 先排空 pending recovery。

## 副作用与数据

- Invocation lifecycle 历史中最多有一个匹配 `invocationId` 的 `status: "aborted"` entry。
- Waiting abort 必要时追加一个标记取消的 tool/user resolution；Running forced-abort 不生成 Provider 错误消息或伪造模型结果。
- `clearQueue: true` 清空 steer 与 follow-up；`false` 保留 follow-up 并以 `pausedBy.reason: "aborted"` 标记。
- 所有普通 Session mutation 与取消 admission 使用既有线性化边界；forced lifecycle 和 partial lifecycle 的 active-leaf repair 使用同一个 per-session Session write queue。
- active-leaf repair 是幂等的：目标已是 active leaf 时不追加 entry，缺失时只追加一个 auto leaf。
- 事件通道只传输有界公开投影，不暴露 Provider 原文、内部路径或锁细节。

## 失败与恢复

同步 forced enqueue 失败时：

1. 不返回表示已接受终态的成功响应。
2. 当前 invocation 保持 `aborting` ownership，禁止迟到运行路径写入新 terminal。
3. 不发布 `agent_end`，不 resolve 原 invocation abort gate，不伪造 durable lifecycle。
4. 返回 HTTP 503 `session_abort_durability_unavailable`、`retryable: true`；调用方可重试同一 abort。

forced lifecycle 已入队但 physical append、after-write 或 live-state 阶段失败时：

- 保留精确 Session/invocation 取消意图，按同一 per-session write queue 进行 pending recovery。
- Recovery 先读取 Session；若已有匹配 aborted lifecycle，则幂等完成并修复缺失的 active leaf，不重复追加 lifecycle。
- Recovery 失败时保留 retryable 状态，并阻止后续普通 write、新 invocation start 或 waiting resolution 越过旧终态；waiting partial terminal 在内存中保持 `aborting` 而非恢复 `waiting`。
- 下一次 abort 必须先 drain 同一 Session 的 pending forced recovery；成功时返回 aborted，不能因 active ownership 已释放而返回 idle。
- 任何失败都不能通过直接 repository 写、第二套锁、tombstone 旁路或静默放宽 timeout 掩盖。
- 进程重启不能从缺失 entry 猜测 aborted；只能按既有规则投影 interrupted。

## 边界与兼容

- HTTP route 只负责路径/body 校验、授权、调用领域入口和响应投影；Session 状态转移由 Agent runtime owner 负责，持久化由统一 Session write owner 负责。
- 普通 abort admission 继续遵守 Session mutation 线性化；forced 到期控制面是只为满足取消上界的窄化例外，不改变普通 admission 合同。
- 成功 DTO 保持 `{status, sessionId}`；新增错误只使用稳定 code，不暴露内部文件路径、Provider 原文或锁实现细节。
- `150ms` cooperative grace、`300ms` forced-abort 上界、`1_000ms` external-signal 上界和 `30_000ms` 外层测试预算保持不变。

## 验收与 Smoke

1. Given Idle Session，When POST abort，Then HTTP 200 idle，历史、队列和事件没有新增取消副作用。
2. Given Waiting User invocation，When POST abort with reason，Then HTTP 200 aborted，只有一个 aborted lifecycle/resolution，activeInvocation 为 null，`agent_end` 不被当作 Run Error。
3. Given Running cooperative invocation，When POST abort，Then 在 grace 内合作收口，只有一个 aborted terminal，队列按 clearQueue 分支呈现。
4. Given Provider/tool/settlement 忽略 signal，When POST abort，Then 调用方在 300ms 上界内得到响应，activeInvocation 为 null，迟到结果不可见，后续 start 排在旧 aborted append 后。
5. Given forced enqueue 同步失败，When POST abort，Then HTTP 503 retryable，active ownership 与 aborting 状态保留，没有 `agent_end` 或 durable aborted 伪造；重试可继续收口。
6. Given forced lifecycle 物理写失败，When recovery 或下一次 Session write 运行，Then 同一 write queue 幂等重放，已有 aborted entry 不重复追加，恢复失败阻止后续 start。
7. Given duplicate/concurrent abort，When repeated POST arrives，Then 只有一个 terminal lifecycle、resolution、`invocation_aborted` 和 aborted `agent_end` 生效。
8. Given missing/forbidden Session，When POST abort，Then 分别返回 404 `SESSION_NOT_FOUND` 或 409 `session_abort_not_allowed`，不写 lifecycle。

聚焦验证入口：

- `bun run --cwd packages/neuro-book test -- server/api/agent/sessions/[sessionId]/abort.post.test.ts server/agent/http.test.ts server/agent/harness/neuro-agent-harness.black-box.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/session/write-plan.test.ts`
- `bun run --cwd packages/neuro-book typecheck`
- `bun run docs:check` 与 `bun run governance:check`

## 实现合同

- Agent runtime 是 abort admission、active invocation ownership、`150ms` cooperative grace、forced authorization、迟到结果 fence 和队列状态的 owner；HTTP route 只负责路径/body 校验和稳定错误投影。
- `SessionWriteExecutor` 是 lifecycle 与 active-leaf repair 的唯一写 owner。普通写、forced lifecycle、pending recovery 和下一 invocation start 共用同一 per-session queue；forced plan 必须通过 `enqueueForcedAbort()` 进入，不能通过普通 `execute()` 绕过授权。
- Forced lifecycle 入队时快照 plan；物理 append、active-leaf repair、after-write observer 或 live-state 失败时，以 `(sessionId, invocationId)` 保存内存 recovery。下一次 abort、普通 write 或 invocation start 先 drain；若 durable aborted 已存在，只补缺失 leaf 和发布步骤，不重复 lifecycle。
- `AgentAbortNotAllowedError` 固定映射为 HTTP 409、`session_abort_not_allowed`、`retryable: false`；`AgentAbortDurabilityError` 固定映射为 HTTP 503、`session_abort_durability_unavailable`、`retryable: true`，底层 `cause` 不进入 HTTP body。
- 进程重启不恢复内存 forced authorization 或 pending recovery。仓库没有 durable aborted 时不猜测成功；未闭合 invocation 继续按现有 recovery 规则投影 interrupted。

实现入口：

- `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts`
- `packages/neuro-book/server/agent/session/write-plan.ts`
- `packages/neuro-book/server/agent/session/session-repo.ts`
- `packages/neuro-book/server/agent/http.ts`
- `packages/neuro-book/server/api/agent/sessions/[sessionId]/abort.post.ts`

合同测试：

- `packages/neuro-book/server/api/agent/sessions/[sessionId]/abort.post.test.ts`
- `packages/neuro-book/server/agent/http.test.ts`
- `packages/neuro-book/server/agent/session/write-plan.test.ts`
- `packages/neuro-book/server/agent/harness/neuro-agent-harness.test.ts`
- `packages/neuro-book/server/agent/harness/neuro-agent-harness.black-box.test.ts`
- `packages/neuro-book/shared/dto/agent-session.dto.test.ts`

实际 smoke/验证命令：

- `bun x vitest run server/api/agent/sessions/[sessionId]/abort.post.test.ts server/agent/http.test.ts shared/dto/agent-session.dto.test.ts server/agent/session/write-plan.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/neuro-agent-harness.black-box.test.ts`（cwd `packages/neuro-book`）
- `bun run test:agent`（cwd `packages/neuro-book`）
- `bun run typecheck`（cwd `packages/neuro-book`）

## 证据

- 实现入口：[`neuro-agent-harness.ts`](../../../packages/neuro-book/server/agent/harness/neuro-agent-harness.ts)、[`write-plan.ts`](../../../packages/neuro-book/server/agent/session/write-plan.ts)
- 合同测试：[`abort.post.test.ts`](../../../packages/neuro-book/server/api/agent/sessions/[sessionId]/abort.post.test.ts)、[`write-plan.test.ts`](../../../packages/neuro-book/server/agent/session/write-plan.test.ts)
- Smoke：不适用——abort 端到端需要真实 Provider 会话；`scripts/smoke/agent.ts` 只等待 `aborted` 状态，不覆盖 abort 请求路径。
- [ADR 0019：Agent abort mutation boundary](../../../packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md)
- [Current Task：Agent abort mutation 合同闭合](../../../.agents/works/w00004-agent-abort-mutation-contract/tasks/t01-agent-abort-mutation-contract/README.md)
