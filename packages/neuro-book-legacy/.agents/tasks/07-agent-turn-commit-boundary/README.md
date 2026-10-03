# Agent Turn Commit Boundary

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## User Request

- 修复服务重启导致普通 tool call 在前端一直显示 running 的问题。
- 不要用 synthetic error `toolResult` hack；参考 `docs/research/pi-agent-harness.md` 和 PI 的 turn/message 生命周期，重新设计 Neuro Book harness 的 session 持久化边界。

## Goal

- 把普通 ReAct turn 的 durable commit 边界从 assistant `message_end` 改到 `turn_end`。
- 保证持久化到 JSONL 的普通 assistant tool call 要么和对应 toolResult 成组落盘，要么完全不落盘。
- 保留前端 live event：运行中仍能看到 assistant streaming、tool running、tool result。
- 保留 approval / user input 类工具的合法 suspend point：这类 assistant tool call 可以未闭合持久化，因为它等待用户 resolution。
- 避免下一轮 provider context 带入未闭合普通 tool call。

## Current State

- 当前 `NeuroAgentHarness.persistEvent()` 在收到 Pi `message_end` 时立即持久化 assistant / toolResult。
- PI 的事件顺序中，assistant `message_end` 会先于工具执行发生；把它直接当 durable commit 会产生半截历史窗口。
- 如果服务在 assistant toolCall 已写入、toolResult 尚未写入之间重启，JSONL 会留下普通未闭合 tool call。
- 前端从 snapshot 派生消息时会把缺失 `toolResult` 的 tool call 当成 streaming / running，导致工具卡永远转圈。
- 当前讨论中的临时 server-side synthetic closure 方案不作为目标方案；它应撤销或替换为 turn commit buffer。

## Walkthrough

- 读取 `docs/research/pi-agent-harness.md` 后确认 PI 的关键语义：
  - `message_end` 是 live message 完成事件和 tool preflight barrier。
  - `turn_end` 是一轮 LLM call + tool executions 完成后的边界。
  - 并行工具可以按完成顺序发 `tool_execution_end`，但最终 toolResult messages 应按 assistant source order 归档。
- 当前 bug 的真实 session 是 `workspace/.nbook/agent/sessions/novel-7/2.jsonl`：
  - 最后一条中断 assistant 写入了多个 tool call。
  - 其中 `bash find / -maxdepth 5 -name "workspace.ts"...` 和 `read novel-7/PROJECT-STATUS.md` 没有对应 toolResult。
  - 重启后 active invocation 丢失，这两个工具不会再收到 terminal event。

## Decisions

- 普通 assistant/toolResult 不再由 `persistEvent(message_end)` 直接写入 session。
- `runLoop()` 维护 turn commit buffer：
  - assistant streaming 和工具执行事件继续实时 publish 给前端。
  - 普通 turn 在 `turn_end` 后用单条 JSONL `batch` record 写入 assistant，再按 source order 写入 toolResult，最后在同一 batch 内移动 leaf。
  - 无工具 assistant 也在 `turn_end` 写入。
  - provider error / abort 的 assistant 可以在 turn terminal 时写入，用 `stopReason` / `errorMessage` 表达失败。
- approval / request-user-input 类工具是合法 suspend point：
  - assistant toolCall 必须持久化，供 snapshot 和前端 pending approval 恢复。
  - resolution 继续沿用当前设计：先写 toolResult，再进入 continue prepare。
- 不使用 hidden synthetic toolResult 修复 provider context。
  - 对新 session，通过 commit boundary 保证普通 tool call 不会半截落盘。
  - 对旧坏数据，前端可以显示“运行中断”，但模型上下文修复应通过显式 repair / fork clean branch 处理，而不是静默注入 synthetic message。

## Proposed Implementation

1. 收窄 `persistEvent()`
   - 保留 live event publish。
   - 停止在 assistant / toolResult `message_end` 中自动 append session message。
   - 如仍需持久化用户 prompt，继续由 `invokeAgent()` 显式 append prompt message。

2. 新增 turn commit buffer
   - 在 `runLoop()` 内记录本轮 assistant 和 toolResults。
   - `runToolBatch()` 返回 toolResults，顺序按 assistant tool call source order。
   - `turn_end` 后调用集中持久化函数，例如 `commitTurn({assistant, toolResults, mode})`。

3. 区分 normal turn 与 suspend turn
   - normal turn：写入 assistant + all toolResults。
   - no-tool turn：写入 assistant。
   - approval waiting：写入 assistant，暂不写 toolResult，session status 进入 waiting。
   - approval validation failure：这是普通 completed toolResult，写入 assistant + error toolResult。

4. 清理临时方案
   - 删除 server-side `closeInterruptedToolCallsForModel()` synthetic closure。
   - 保留或调整前端 snapshot 防御，使旧坏 session 不再显示永远 running。
   - 增加文档说明：前端防御只负责展示旧坏数据，不改变模型上下文。

5. 可选旧数据处理
   - 后续设计显式 session repair 命令。
   - repair 可以追加 branch summary / label / fork clean branch，而不是读 snapshot 时静默改写历史。

## Files Changed

- 计划文档新增：`docs/tasks/07-agent-turn-commit-boundary/README.md`
- Harness：`server/agent/harness/neuro-agent-harness.ts`
  - 删除 server-side synthetic error `toolResult` closure。
  - `message_end` 不再自动写 session。
  - 新增 `commitTurn()`，普通 turn 在 `turn_end` 写入 assistant + toolResults。
  - 新增未闭合普通 tool call 检查，旧坏历史会拒绝继续发送给 provider。
- Session repository：`server/agent/session/session-repo.ts`、`server/agent/session/types.ts`
  - 新增 JSONL `batch` record 和 `appendEntries()`，让普通 turn 的 assistant + toolResults + final leaf 在一次 append 中落盘。
- Tools：`server/agent/tools/builtin-tools.ts`
  - 修复 `invoke_agent` 错误设置 `terminate` 的问题。子 agent completed 只表示子调用完成，父 agent 应看到 toolResult 后继续下一轮 ReAct；父 agent 的结束仍由普通 assistant stop 或 `report_result` 决定。
  - `invoke_agent` 改为上下文工具并禁止调用当前 session 自己，避免自调用被误处理为当前 session 的 follow-up queue。
- 前端投影：`app/components/novel-ide/agent/agent-message.ts`
  - 旧坏 session 中无 active invocation、无 pending approval 的缺失 toolResult 普通 toolCall 显示为中断错误。
- 测试：`server/agent/harness/neuro-agent-harness.test.ts`、`app/components/novel-ide/agent/agent-message.test.ts`
- 测试配置：`vitest.config.ts`
  - 纳入 `app/components/novel-ide/agent/**/*.test.ts` 纯逻辑测试。
- 文档：`docs/modules/agent/harness.md`
  - 同步 `turn_end` durable commit 语义。

## Verification

- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/session-tree.test.ts app/components/novel-ide/agent/task-list.test.ts`
  - 结果：通过，4 个测试文件，39 个测试。
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/harness/neuro-agent-harness.test.ts app/components/novel-ide/agent/agent-message.test.ts`
  - 结果：通过，3 个测试文件，41 个测试。
- `bunx tsc --noEmit --pretty false --skipLibCheck`
  - 结果：通过。

## Implementation Notes

- 计划中的 server-side synthetic closure 已撤销；这是本任务的核心偏差修正。
- Review 后发现第一版 `commitTurn()` 仍通过多次 `appendMessage()` 写入，assistant 与 toolResult 之间还有崩溃半提交窗口；已改为 repository 级 `appendEntries()`，用单条 JSONL `batch` record 表达完整 turn commit。
- Review 后继续发现 mixed approval batch 问题：同一条 assistant message 中如果 approval tool 后还有普通 tool call，早退等待会让后续普通 tool call 缺少 toolResult，从而触发 `assertTurnClosed()` error。已将 approval 处理为 batch barrier：approval 之前的普通工具照常完成；遇到第一个合法 approval 后，本轮暂停，后续未执行 tool call 写入明确的 error toolResult，只留下该 approval tool call 作为唯一 pending。
- 诊断 `invoke_agent` 后发现：工具返回 `terminate: result.status === "completed"` 会让父 harness 把当前 turn 当作终止 turn，导致父 agent 看不到子 agent toolResult 后的第二轮模型调用。已删除该 `terminate`，并用回归测试锁定。
- 继续审查 `invoke_agent` 后发现：工具原本没有 `executeWithContext()`，因此调用当前 session 自己时会被 `invokeAgent()` 当作 follow-up queue，而不是清晰错误。已改成上下文工具并禁止 self invoke；仍允许调用任意其他 sessionId，不收紧为 owned agent。
- 继续排查 session JSONL 膨胀问题后发现：`invoke_agent` toolResult 的 `details` 直接持久化完整 `InvokeAgentResult`，其中 `events` 包含子 agent 的全量流式事件；`message_update` 又携带累积式 assistant 快照，导致父 session 按 O(n²) 膨胀。已将 `invoke_agent` 的持久化 details 收敛为调用摘要，保留直接 HTTP/API 返回里的 `events` 合同。
- 当前没有自动修复旧 JSONL 坏历史。旧坏历史在前端会显示中断；如果继续 invoke，harness 会拒绝把未闭合普通 tool call 发送给 provider。
- 未来如果需要恢复旧 session，应实现显式 repair / fork clean branch，而不是 snapshot 读取时静默改写历史。

## Test Plan

- Harness tests：
  - 普通 tool turn 成功后，JSONL active path 顺序为 `user -> assistant -> toolResult...`。
  - 普通 tool turn 的 assistant + toolResult + final leaf 写入同一条 JSONL `batch` record。
  - `message_end` 时不会提前写入 assistant/toolResult，`turn_end` 后才成组写入。
  - 旧坏普通 tool call 会被拒绝发送给 provider。
  - approval waiting 时，JSONL 保留 `assistant(toolCall)` 且 snapshot 能恢复 pending approval。
  - approval resolution 时，`toolResult` 先于 continue prepare appending messages 写入。
  - `invoke_agent` 子调用 completed 后，父 agent 继续进入下一轮 ReAct，而不是停在 tool call assistant。
  - `invoke_agent` 拒绝调用当前 session 自己。
- Frontend projection tests：
  - 旧坏 session 中缺失 toolResult 且无 activeInvocation 的普通 toolCall 显示为中断/错误。
  - pending approval 缺失 toolResult 仍保持等待态。
  - mixed approval batch 中 approval 后续普通 tool call 会被显式跳过并闭合，session 仍进入 pending approval。
- Regression commands：
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`
  - `bunx vitest run app/components/novel-ide/agent/agent-message.test.ts`
  - `bunx tsc --noEmit --pretty false --skipLibCheck`

## Latest Verification

- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "approval 后面的普通 tool call"`
  - 结果：通过，确认 mixed approval batch 会保留 pending approval，并把后续普通 tool call 显式闭合为 skipped error toolResult。
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/session/session-repo.test.ts app/components/novel-ide/agent/agent-message.test.ts`
  - 结果：通过，3 个测试文件，41 个测试。
- `bunx tsc --noEmit --pretty false --skipLibCheck`
  - 结果：通过。
- `bun run test server/agent/harness/neuro-agent-harness.test.ts -t "invoke_agent"`
  - 结果：通过，1 个测试文件，2 个 invoke_agent 测试；确认父 session 的 `invoke_agent` toolResult details 包含 `sessionId/status/finalMessage` 摘要且不再包含 `events`。

## 契约破窗与修复（2026-08-04，Task 139）

本 task 定下的这条协议**在真实运行中从未生效过**：

> provider error / abort 的 assistant 可以在 turn terminal 时写入，用 `stopReason` / `errorMessage` 表达失败。

配套实现一直都在（`sanitizePartialAssistant()`、`messageStatus: "interrupted"`、`executeTurn` 的 `stopReason === "aborted"` 分支），但实测 556 个真实会话里 **40 次取消 0 次保存过半截消息**。

根因：真实 provider SDK 用**抛异常**表达取消（`throw new Error("Request was aborted")`），异常一抛 `await stream.result()` 永不执行，已接收文本烂在 stream 内部；异常冒泡后走 `createRuntimeErrorAssistant(error)`（正文为空）→ `sanitizePartialAssistant` 因无非空文本返回 `null` → 什么都不写。

**测试没照出来的原因**：faux provider 的 abort 语义与真实 SDK 不一致——faux 推 `{type: "error", reason: "aborted"}` 事件并 `stream.end(createAbortedMessage(partial))`（保留 partial），真实 SDK 直接 throw。测试替身比现实宽容，这条路径在 CI 里一直是绿的。

[Task 139](../139-agent-abort-error-projection/README.md) 已在 `streamAssistant` 的流式循环外补 try/catch 接住取消并复用现成链路。同时新增一条不变量：**错误详情只记在 `invocation_lifecycle` entry 上，assistant entry 只承载正文**，`sanitizePartialAssistant` 不再持久化 `errorMessage`（两处都写会让同一段错误渲染成两个气泡）。

## TODO / Follow-ups

- 评估是否需要把旧坏 session 的前端中断文案加上“可 fork clean branch / repair”的操作入口。
- 评估是否需要显式 session repair / fork clean branch 机制处理历史坏数据。
