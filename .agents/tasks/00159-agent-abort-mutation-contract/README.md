---
schema: nbook.task/v1
taskId: 00159-agent-abort-mutation-contract
actionIssueId: null
worktreeId: .worktree/t159-agent-abort-contract
branchId: feat/t159-agent-abort-contract
status: completed
createdAt: 2026-08-25T09:56:19Z
updatedAt: 2026-08-26T06:15:48Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - api-and-interface-design
    - documentation-and-adrs
    - spec-driven-development
    - test-driven-development
    - code-review-and-quality
  verification:
    required:
      - focused-test
      - regression-test
      - typecheck
      - docs-check
      - diff-check
    notRun:
      - check: browser
        reason: 本 Task 不做浏览器人工验收；当前合同验证使用服务端行为测试和仓库门禁。
      - check: smoke
        reason: 未获真实 Provider 或运行时 smoke 授权；不以真实外部依赖替代确定性行为测试。
---

# Task 00159：Agent abort mutation 合同闭合

## 状态

**Completed。** Agent Session abort 公开合同、方案 B forced fence、waiting retry/recovery、HTTP boundary、SSE ordering 与黑盒证据已在 `.worktree/t159-agent-abort-contract` 闭合。

## 背景与目标

Task 147 的 bounded forced-cancellation 实现已经合入当前主线，但取消行为合同此前未闭合：稳定 Reference 要求 abort 与其它 Session mutation 共用 `withSessionMutation()` / `withSessionMutations()` 边界，forced-abort 实现却在宽限期结束后直接进入 `SessionWriteExecutor` 并释放 invocation ownership；现有 Harness 黑盒合同又明确把 abort endpoint 排除在覆盖范围外。

本 Task 新增并最终实现唯一规范 [`Agent Session Abort`](../../../docs/specs/agent/session-abort.md)，覆盖 HTTP 输入、成功/错误输出、状态、事件、lifecycle、队列、取消失败与恢复；本 Task 的目标不是“行为合同未变”，而是把现有实现与新的公开合同收敛为一套可验收行为。

## 关联

- Spec：[`Agent Session Abort`](../../../docs/specs/agent/session-abort.md)
- ADR：[`ADR 0019：Agent abort mutation boundary`](../../../packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md)
- Task 18 黑盒合同：[`HARNESS-BLACK-BOX-CONTRACT.md`](../../../packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)

## 已确认冲突

1. [`packages/neuro-book/assets/reference/agent/attachments.md:107-115`](../../../packages/neuro-book/assets/reference/agent/attachments.md) 规定 invocation claim、terminal transition、runtime command、附件登记、archive/restore 和 abort 共用 Session mutation 边界，并规定 relation lock -> Session mutation lock -> `SessionWriteExecutor` write lock 的顺序。
2. [`packages/neuro-book/server/agent/harness/neuro-agent-harness.ts:6485-6510`](../../../packages/neuro-book/server/agent/harness/neuro-agent-harness.ts) 的 `forceAbortInvocation()` 以同步控制面操作直接调用 `enqueueForcedAbortLifecycle()`、`finishInvocationState()` 和 `publishRuntimeEvent()`，没有重新进入 `withSessionMutation()`。
3. [`packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md:52-62`](../../../packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md) 明确暂不覆盖 abort endpoint，因此当前黑盒证据不能证明 HTTP abort、合作取消和 forced-abort 的公开合同。
4. `abortInvocationMatching()` 的 admission 阶段仍通过 `withSessionMutation()` 读取并 claim 当前 invocation；冲突集中在宽限期后的强制终态控制面，以及该路径与持久化 write queue 的关系。

## 决策（2026-08-25）

开发者已选择**方案 B：明确窄化例外**。宽限期到点的 forced-abort 保留同步 control-plane fence，以维持 `INVOCATION_ABORT_GRACE_MS = 150` 与 forced-abort `300ms` 上界；普通 abort admission 继续通过 `withSessionMutation()`，唯一 forced-abort `aborted` lifecycle 继续经同一个 SessionWriteExecutor，并由 per-session write queue 保证后续 `start` 排在旧终态之后。

方案 B 不是当前实现已合规的证明。实现还必须处理 forced enqueue 同步失败（保留 aborting ownership、HTTP 503 可重试）和已入队物理写失败（同一 write queue pending recovery），并由 Spec、ADR、Reference、Task 18 和行为测试共同证明。

方案 A 未选择；不要求本 Task 重新把 forced-abort 控制面塞回可能被长写入占用的 mutation lock。

## 实现范围

- 更新 `agent.session-abort` Spec、ADR 0019、Agent mutation/SSE Reference，使选定边界、锁顺序、ownership release、迟到事件隔离、durable lifecycle ordering 和 fail-closed 行为唯一且无矛盾。
- 扩展 Task 18 黑盒合同，正式纳入 `POST /api/agent/sessions/:sessionId/abort` 的黑盒输入、返回、状态、错误、恢复和事件合同。
- 为 HTTP abort、合作取消、非合作 provider/tool 的 forced-abort、重复取消、迟到结果、物理写恢复和后续 invocation 顺序补行为测试。
- 复核并实现 `SessionWriteExecutor` 的 forced-abort 授权仍然单 session、单 invocation、单 `aborted` lifecycle、fail closed，并提供 pending recovery。

## 非目标

- 不改变 compaction 算法或 Task 147 的上下文压缩合同。
- 不增加第二套锁、直接 repository 写入、tombstone 旁路或静默兼容分支。
- 不通过放宽 timeout、忽略持久化失败或删除黑盒断言来消除失败。
- 不执行真实 Provider、浏览器人工验收、远端写入、push、PR 更新、发布或部署，除非另行获得明确授权。
## 验收

- [x] 方案 B 已选定，取消失败的 ownership、HTTP 结果、重试和 recovery 合同已写入 Agent Session Abort Spec 与 ADR 0019。
- [x] 当前 Reference、Spec、Task 18 黑盒合同、代码和测试对 abort 边界一致；forced control-plane 例外与 write queue recovery 已有 ADR 解释。
- [x] 黑盒合同覆盖 abort endpoint：合作取消与 forced-abort 均有输入、返回、生命周期顺序、终态事件、`activeInvocation: null`、重复取消、迟到结果和 durable recovery 断言。
- [x] 后续 invocation 的 `start` 不先于旧 invocation 唯一 `aborted` durable lifecycle；forced-abort 授权缺失或 plan 非法时 fail closed。
- [x] `focused-test`、`regression-test`、`typecheck`、`docs-check` 和 `diff-check` 全部通过；实际命令与结果记录在 [最终 walkthrough](walkthroughs/003-tasker-2026-08-26-abort-contract-final.md)。

## 当前基线与证据

- 实现 worktree：`.worktree/t159-agent-abort-contract`；分支：`feat/t159-agent-abort-contract`。
- 基线 revision：`dd3bdab5`（从最新 `origin/master` 创建）；Task 147 取消实现祖先为 `6a79bfd96dbefbe017bfb9f912985507d0ba1b72`。
- 初始仓库级 `bun run docs:check`：exit code `1`，`checkedFiles: 5279`；唯一失败为 00158 缺少具体 Spec 链接。根工作区已补充 00158 的主题 Spec 链接；隔离 worktree 也已同步该文档修复。
- `bun run governance:check`：通过，`failures: []`、`warnings: []`（根工作区计数校正阶段）。

## 当前验证状态（已完成）

- `agent.session-abort` Spec 已原地晋升 `implemented`，并登记到 `docs/specs/README.md`。
- HTTP 领域错误、SessionWriteExecutor forced-abort recovery、Harness ownership fence、waiting failure retry、SSE ordering、队列化 partial leaf repair、路由/HTTP/写计划/黑盒测试已实现。
- `abortInvocationMatching()` 先解析 runtime projection；归档状态在 claim 前 fail closed 为 `AgentAbortNotAllowedError`（HTTP 409），非归档才读取 active invocation；无 active（包括 Profile unavailable 的 Idle）保持幂等 idle，仅有匹配 active 时才校验 `interaction.canAbort`。
- `Archived` 与非归档 `Idle` 的无 active abort 分支黑盒回归：2 passed；分别验证 409 `session_abort_not_allowed` 与幂等 200 idle，均不写 invocation lifecycle；不可运行 Profile 的历史 Session 也覆盖 Idle abort 幂等。
- `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.black-box.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/session/write-plan.test.ts server/api/agent/sessions/[sessionId]/abort.post.test.ts server/agent/http.test.ts --reporter=dot --silent`：5 files / 289 passed。
- `bun run --cwd packages/neuro-book test:agent -- --reporter=dot --silent`：156 files / 1460 passed。
- 隔离 worktree `bun run docs:check`：`failures: []`、`checkedFiles: 5286`。
- 根 checkout `bun run docs:check`：exit code 0；原始 JSON 为 `{"failures": [], "checkedFiles": 5281}`。
- 隔离 worktree `bun run governance:check`：`failures: []`、`warnings: []`。
- `git diff --check`：通过；仅有 LF/CRLF 转换警告。

## 未运行

- 浏览器人工验收、真实 Provider/Model smoke、远端 CI、push、PR 更新、发布、部署和数据删除继续未运行/未授权。
