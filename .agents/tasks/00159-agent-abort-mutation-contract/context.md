# 任务上下文

快照时间：2026-08-26T05:04:28Z

## 基线与授权

- checkout：`.worktree/t159-agent-abort-contract`
- branch：`feat/t159-agent-abort-contract`
- baseline revision：`dd3bdab5`（从最新 `origin/master` 创建）
- `actionIssueId: null`：开发者明确要求实现已批准的 Task 00159 完整计划；实现、文档和测试只在该 worktree 进行。
- 不执行远端 Issue/Project 写入、push、PR 更新、发布、部署、真实 Provider/Model、浏览器人工验收或数据删除。

## 规范与当前合同

- 唯一公开行为规范：[`docs/specs/agent/session-abort.md`](../../../docs/specs/agent/session-abort.md)，已由 `planned` 原地晋升为 `implemented` 并登记在 `docs/specs/README.md`。
- 方案 B：普通 abort admission 继续通过 `withSessionMutation()`；forced-abort 保留同步 control-plane fence；唯一 `aborted` lifecycle 经 `SessionWriteExecutor` 的 per-session write queue。
- 取消预算保持 `INVOCATION_ABORT_GRACE_MS = 150`、forced-abort `300ms`、external-signal `1_000ms` 和外层测试 `30_000ms`。
- 同步 forced enqueue 失败保留 `aborting` ownership，不发布 `agent_end`、不 resolve abort gate，HTTP 返回 503 `session_abort_durability_unavailable` 且可重试。
- 已入队 physical write/post-write 失败必须由同一个 write queue 的 pending recovery 幂等重放；不得直接 repository 写、第二套锁或伪造 durable success。
- waiting partial lifecycle 的 auto leaf repair 也必须以 `ensureAutoLeaf` write op 经同一 `SessionWriteExecutor` queue 执行；幂等 no-op 不发空事件。

## 已验证前置

- 初始仓库级 `bun run docs:check`：exit code `1`，`checkedFiles: 5279`；唯一失败是 00158 缺少具体 Spec 链接。
- 00158 README 已补充 `docs/specs/theme/system.md` 链接；根工作区 `bun run docs:check` 已返回 `failures: []`、`checkedFiles: 5279`。
- 根工作区 `bun run governance:check` 已返回 `failures: []`、`warnings: []`。
- 隔离 worktree 已安装 frozen hoisted 依赖；未生成或提交 Prisma/其它 generated artifacts。

## 已完成实现与验证

- `docs/specs/agent/session-abort.md` 已由 `planned` 原地晋升为 `implemented`，并登记在 `docs/specs/README.md`；唯一公开行为规范与实现、测试保持一致。
- `packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md`、SSE/Workflow/Mutation Reference 与 Task 18 黑盒合同已同步；ADR→Task 链接已修正为 `../../../../.agents/tasks/00159-agent-abort-mutation-contract/README.md`，实际目标位于当前 worktree 根 `.agents/tasks/`。
- `AgentAbortNotAllowedError`、`AgentAbortDurabilityError`、HTTP mapper、Harness ownership fence 与 SessionWriteExecutor pending recovery 已实现。
- `abortInvocationMatching()` 先解析 runtime projection；归档状态在 claim 前 fail closed 为 `AgentAbortNotAllowedError`（HTTP 409），非归档才读取 active invocation；无 active（包括 Profile unavailable 的 Idle）保持幂等 idle，仅有匹配 active 时才校验 `interaction.canAbort`。
- 不可运行 Profile 的历史 Session 回归确认 profile 标记为 `unloadable` 时，Idle abort 仍返回幂等 idle 且不写 lifecycle。
- `Archived` 与非归档 `Idle` 的无 active abort 黑盒回归：2 passed；分别验证归档 409 `session_abort_not_allowed` 与 Idle 幂等 idle。
- `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.black-box.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/session/write-plan.test.ts server/api/agent/sessions/[sessionId]/abort.post.test.ts server/agent/http.test.ts --reporter=dot --silent`：5 files / 289 passed。
- `bun run --cwd packages/neuro-book typecheck`：exit code 0。
- 隔离 worktree `bun run docs:check`：`failures: []`、`checkedFiles: 5285`。
- 根 checkout `bun run docs:check`：exit code 0；原始 JSON 为 `{"failures": [], "checkedFiles": 5281}`。
- 隔离 worktree `bun run governance:check`：`failures: []`、`warnings: []`。
- `git diff --check`：通过；仅有 LF/CRLF 转换警告。

## 未运行

- 浏览器人工验收、真实 Provider/Model smoke、远端 CI、push、PR 更新、发布、部署和数据删除继续未运行/未授权。
