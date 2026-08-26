# ADR 0019：Agent abort mutation boundary

- 状态：Accepted
- 日期：2026-08-25
- 关联任务：[Task 00159：Agent abort mutation 合同闭合](../../../../.agents/tasks/00159-agent-abort-mutation-contract/README.md)
- 关联规范：[Agent Session Abort](../../../../docs/specs/agent/session-abort.md)

## 背景

Agent Session 的普通 abort admission 必须读取最新 interaction projection、确认当前 invocation 仍由本 Session 拥有，并按 `clearQueue` 处理 steer/follow-up。Provider、tool 和 settleRun 可能不响应 AbortSignal；如果宽限期到点的 forced-abort 重新等待同一个 Session mutation queue，就会被合作路径的长写入挡住，突破既有 `INVOCATION_ABORT_GRACE_MS = 150` 与 forced-abort `300ms` 上界。

Task 147 已经引入 `SessionWriteExecutor.enqueueForcedAbort()`，但 Reference 与实现没有说明为什么 forced control-plane 不重新取得 mutation lock，也没有定义 enqueue/physical write failure 时的 ownership、HTTP 结果和恢复责任。

## 决策

1. **普通 admission 仍走 Session mutation。** `abortInvocationMatching()` 在 `withSessionMutation(sessionId)` 内读取最新 projection、校验 `canAbort`、claim active invocation。Waiting 分支在该临界区内完成 abort resolution、lifecycle、queue 处理和终态事件；running 分支只在临界区内进入 `aborting` 并处理已授权的队列变更。
2. **长工作不持有 mutation lock。** Provider、tool、model execution 和外部 signal 运行在 mutation 临界区外。running abort 触发 AbortController 后最多等待 `150ms` grace。
3. **forced-abort 是窄化同步 control-plane 例外。** grace 到点仍拥有 invocation 时，控制面不得重新进入可能被长写入占用的 Session mutation queue。`ownsInvocation` 检查、forced authorization 登记、`enqueueForcedAbort()` 调用和 ownership release 之间不插入 `await`；该同步 fence 防止合作路径重入并改变终态归属。
4. **唯一 forced lifecycle 仍经同一 write executor。** `enqueueForcedAbort()` 只接受单 Session、固定 cause `lifecycle.aborted.force`、单个非 projection `invocation_lifecycle(status: "aborted")`，且 entry invocationId 必须匹配授权。它同步占据该 Session 的 `SessionWriteExecutor` per-session write queue；后续普通 write/start 必须排在该 queue 槽位之后。
5. **成功 admission 不等于物理 append 已完成。** enqueue 返回后才释放 runtime ownership、发布唯一 `agent_end {status: "aborted"}` 并 resolve abort gate。HTTP 200 `{status: "aborted"}` 只承诺终态已被 write queue 接受，不承诺响应返回前 JSONL append、live state 或 after-write observer 已完成。
6. **同步 enqueue 失败必须保留 ownership。** 如果 `enqueueForcedAbort()` 在占据 queue 槽位前同步抛错，forced lifecycle 没有入队。Harness 保留 invocation 的 `aborting` ownership，不发布 `agent_end`，不 resolve abort gate，并抛结构化 `AgentAbortDurabilityError`。HTTP 映射为 503 `session_abort_durability_unavailable`、`retryable: true`；调用方可重试同一个 POST。若运行路径先合作收口，普通 aborting terminal seam 负责唯一 aborted lifecycle；否则重试再次尝试同一个 forced plan。
7. **物理失败使用同一 queue recovery。** enqueue 后 physical append、live-state publish 或 after-write 阶段失败时，SessionWriteExecutor 保留精确 Session/invocation plan 和 forced authorization 作为 pending recovery。恢复先检查精确 invocation 是否已经有 aborted lifecycle；已存在则幂等完成，否则在同一 per-session write queue 重放同一个 plan。恢复失败阻止后续 start/write 越过旧终态，并保留 retryable recovery；不直接写 repository，不建立第二套锁，不以 HTTP 200 伪造 durable success。进程重启不能从缺失 entry 猜测 aborted；只能按既有规则投影 interrupted。
8. **第一个 durable terminal 事实优先。** 合作 terminal 与 forced terminal 只有第一个匹配 invocation 的 aborted terminal 生效。ownership release 后的 provider/tool/settleRun/message_update/agent_end 经过 invocation fence 丢弃。没有显式 reason 时不写默认英文错误正文。
9. **错误是稳定领域合同。** `session_abort_not_allowed` 表示当前状态拒绝取消，HTTP 409；`session_abort_durability_unavailable` 表示 forced lifecycle 尚未被 write queue 接受，HTTP 503 且可重试。错误消息不得泄漏路径、Provider 原文或内部锁细节。

## 原因

普通 abort 的状态读取、授权和 claim 必须线性化，否则两个并发 abort 或一个 abort 与新 invocation admission 可能各自认为自己拥有 active invocation。forced-abort 的目标却是维持严格调用方上界；把它重新塞回 mutation queue 会让取消预算依赖合作路径的最坏写入时长。

把 forced lifecycle 送入同一个 per-session write queue 保留了唯一持久化顺序：控制面可以先释放内存 ownership，让调用方有界返回，但后续 invocation 的 `start` 仍不能越过旧 terminal append。双重 plan/authorization 校验和 pending recovery 防止队列等待、物理写和写后发布中的篡改或失败被误报为成功。

## 后果

- ordinary abort admission 与其它 Session mutation 保持相同的关系/Session policy 边界。
- forced-abort 的控制面不持有 Session mutation lock，代码审查必须同时检查同步 fence、ownership、write queue 和 recovery；这不是通用绕锁许可。
- HTTP 客户端必须把 503 视为取消尚未被接受并可重试；200 只表示 write queue admission，客户端如需 durable 证据应观察 SSE 或读取 recovery/snapshot。
- durable history 只允许一个匹配 invocation 的 aborted lifecycle；迟到运行结果不会污染新 invocation。
- 异步物理失败可能让后续写入暂时返回 retryable error，优先保证顺序和 fail-closed，而不是让用户看到不可证明的成功。

## 未采用方案

- **所有路径重新进入 `withSessionMutation()`**：锁语义简单，但合作 Provider/tool 的长写入会挡住 forced-abort，不能证明 `300ms` 上界。
- **forced-abort 直接调用 repository**：会绕过统一 SessionWriteExecutor、事件和 per-session ordering，可能让后续 start 越过旧 aborted lifecycle。
- **同步 enqueue 失败仍释放 ownership 并返回 200**：会发布没有 durable 事实支撑的 `agent_end`，并使重试无法确定谁拥有终态。
- **物理失败静默重试或重复 append**：无法区分已写入但发布失败与完全未写入，可能产生重复 aborted lifecycle；恢复必须先检查精确 durable history。
