# ADR 0001：Agent 用户输入的 Transport Unknown 语义

- 状态：Accepted
- 日期：2026-07-24
- 关联任务：[Task 108](../../.agents/tasks/108-agent-image-attachment-references/README.md)

## 背景

prompt、steer、follow-up 和历史重跑通过 HTTP 发起，但用户输入可能先进入队列或写入 Session JSONL，HTTP 响应随后才因连接中断而丢失。此时客户端只知道没有收到 `acceptance`，不能判断服务端是尚未接受，还是已经持久化。

`clientMessageId` 可以关联 HTTP、SSE、queue projection 和 recovery 中的同一次提交，但当前系统没有 durable request inbox，也不能把任意 invocation 安全地自动重放。

## 决策

前端统一把 invocation 对账结果归一为：

- `accepted`：durable SSE/recovery 已出现相同 `clientMessageId`，或 HTTP receipt 为 `queued` / `persisted`。
- `rejected`：HTTP receipt 为 `not_accepted`。
- `unknown`：transport 失败且没有任何 durable 证据或 receipt。

durable 证据优先于 HTTP receipt。`unknown` 的行为固定为：

- 保留 optimistic 消息并标记“发送结果未知”。
- 保留提交时的纯文本草稿，不自动回滚、重试或触发发送专用 recovery。
- 后续正常 SSE 或 Session recovery 若发现相同 `clientMessageId`，收敛为 `accepted`。
- 用户可以手动移除该 optimistic attempt；显式重新发送会生成新的 `clientMessageId`，并提示可能产生重复输入。
- unknown attempt 不写 localStorage。页面刷新后只恢复纯文本草稿，不恢复该 attempt 的 UI 状态。

草稿清理采用提交上下文的 `workspaceKey + sessionId + generation + revision + text` 做 compare-and-clear。迟到 acceptance 只能清理原上下文中仍与提交快照一致的草稿，不能删除用户后来输入的正文，也不能影响已经切换到的 Session。

`clientMessageId` 只是关联 ID，不是幂等键。服务端不会因为看到相同 ID 自动去重或重放 invocation。

## 原因

没有 receipt 时自动回滚会把已落盘输入显示成失败，自动重试则可能重复执行带工具副作用的 invocation。为了消除这段不确定性而增加 durable inbox/outbox、幂等执行和重放协议，会扩大持久化模型、工具副作用合同和恢复状态机，超出当前本地 Session 输入的实际需求。

当前决策保留了可观察性和人工恢复路径，同时不声称具备尚未实现的 exactly-once 语义。

## 后果

- 短暂网络故障后，用户可能看到一个持续到 SSE/recovery 收敛或手动处理的 unknown 状态。
- 页面刷新会丢失 unknown 的 UI 标记，因此可能只看到仍保留的草稿；这是已接受的产品限制。
- 所有 invocation 调用方必须消费 `acceptance`，不能从 HTTP `status` 或模型错误推断输入是否已接受。
- 若未来需要自动重试，必须先独立设计 durable inbox、工具副作用幂等边界和跨重启恢复，不得把 `clientMessageId` 偷换成通用幂等键。

## 未采用方案

- transport 失败后立即回滚：无法区分服务端已持久化的请求。
- transport 失败后自动重试：可能重复用户消息、Provider 请求和工具副作用。
- transport 失败后立即发起专用 recovery：仍不能证明 admission 正在进行或 HTTP 响应尚未到达，并会为发送路径增加第二套恢复协议。
- 本轮增加 durable inbox/outbox：需要完整的幂等执行语义，复杂度与当前问题不匹配。
