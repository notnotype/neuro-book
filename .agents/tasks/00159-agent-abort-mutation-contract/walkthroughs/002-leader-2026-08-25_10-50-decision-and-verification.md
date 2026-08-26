---
schema: nbook.walkthrough/v1
taskId: 00159-agent-abort-mutation-contract
sequence: 2
role: leader
status: in-progress
createdAt: 2026-08-25T12:20:00Z
---

# 方案 B 决策与 Agent abort Spec 门禁

## 决策

开发者选择**方案 B：明确窄化例外**：

- 普通 abort admission 继续通过 `withSessionMutation()`。
- 宽限期到点的 forced-abort 保留同步 control-plane fence，不重新等待可能被长写入占用的 mutation lock。
- 唯一 forced-abort `aborted` lifecycle 继续经同一个 `SessionWriteExecutor`，由 per-session write queue 保证后续 invocation `start` 排在旧终态之后。
- 既有 `INVOCATION_ABORT_GRACE_MS = 150` 与 forced-abort `300ms` 上界不变。
- 同步 enqueue 失败保留 `aborting` ownership，HTTP 返回可重试 503；已入队物理失败由同一个 write queue pending recovery 处理，不能伪造 durable success。

## 规范门禁

- 新增唯一行为 Spec：[`Agent Session Abort`](../../../docs/specs/agent/session-abort.md)，当前 `status: planned`。
- Spec 覆盖 HTTP abort 输入、200/400/404/409/503 输出、Idle/Running/WaitingUser/Aborting 状态、事件/lifecycle 顺序、队列副作用、失败重试和 durable recovery。
- Task 00159 不再使用“行为合同未变”作为治理替代；本 Task 正在交付新的公开 abort 行为合同。

## 已验证前置

- 根工作区初始 `bun run docs:check`：exit code `1`，`checkedFiles: 5279`；唯一失败是 00158 缺少具体 Spec 链接。
- 00158 README 已补充主题 Spec 链接；根工作区随后 `bun run docs:check` 返回 `failures: []`、`checkedFiles: 5279`。
- 根工作区 `bun run governance:check` 返回 `failures: []`、`warnings: []`。
- Task 00159 的代码聚焦测试、Agent 回归、typecheck、Spec 晋升和 diff-check 尚未运行。

## 下一步

1. 完成 ADR 0019、attachments/SSE Reference 与 Task 18 黑盒合同的一致性。
2. 实现稳定 409/503 领域错误与 HTTP mapper；修复 forced enqueue 同步失败的 ownership/HTTP 语义。
3. 实现并测试同一 write queue 的 physical failure recovery、唯一 aborted lifecycle、事件顺序、迟到结果隔离和后续 start ordering。
4. 运行全部 required 门禁，补充实现证据；browser/真实 Provider smoke 继续按授权边界不运行。
