# 审查意见 1

根因复现与新增测试都对，产品测试的两处调整也接受（删掉的是 t34 为旧逐层恢复行为写的断言）。但修复改变了 `close()` 的启动时序，主 Agent 跑全量测试发现两条新失败。先用 `git status` 与 `git diff` 核对现状。

## 必须修改

1. **恢复 `close()`/`recover()` 原有的启动时序。** 全量 `bun run test` 中 `server/agent/harness/neuro-agent-harness.test.ts` 新增 2 条失败（修复前通过）：
   - `Project invocation持有exact generation到terminal，close abort后才允许reopen`（第 10682 行）
   - `Project close 触发 forced enqueue 同步失败时公开 invoke 有界返回 retryable error，Project completion 等待显式 abort 重试`（第 10780 行）

   两条都在调用 Project 关闭后只等一个 `await Promise.resolve()`，就断言 `projectOccupancy(...)` 已为 `null`。原因：现在 `#startAttempt` 把本作用域的 `#runAttempt` 也推迟到 microtask，`#advanceChildren` 在这个延后的执行里才运行，子作用域的尝试比调用方的后续代码晚一轮才开始。修复前，`close()` 调用的当下就同步级联启动了子作用域。

   要求：在 `close()`/`recover()` 被调用的同步段里，就登记整棵子树的在途尝试并排好它们的执行，再开始任何释放规划。这样子作用域的执行排在调用方的后续代码之前，与修复前的启动时序一致，同时保留“提供方规划时消费者分支已有在途尝试”这一修复效果。具体做法由你设计。这两条 harness 测试不得修改。

2. 修改后，在汇报中说明新的时序：调用 `close()` 返回时，哪些尝试已登记、哪些执行已排队，以及与修复前相比还有哪些差异。

## 验证

在 `packages/neuro-book` 下：
- `bun run test server/agent/harness/neuro-agent-harness.test.ts`：全部通过；
- `bun run test:runtime-foundation` 与 `bun run test server/runtime server/features`：全部通过，t36 新增的三条用例保持通过；
- `bun run typecheck:runtime-foundation`；
- 输出保存到证据目录（`rework-1-*.txt`），在 `delivery.md` 末尾追加“返工 1”一节。

命令一律从 worktree 根目录执行，证据写到根目录下的 `.agents/works/w00017-application-runtime-architecture/tasks/t36-lifecycle-recover-cascade/evidences/`。不要用 `rm -rf` 清理仓库内的目录，误写的文件逐个删除，删除前先确认它们不是已跟踪文件。
