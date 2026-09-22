---
schema: nbook.task/v2
taskId: t01-agent-abort-mutation-contract
---

# Agent abort mutation 合同闭合

## 目标

使方案 B 在 Agent Session Abort Spec、ADR 0019、稳定 Reference、HTTP 黑盒合同、实现和行为测试中形成唯一一致的取消边界：普通 abort admission 经 Session mutation；`150ms` grace 后的 forced-abort 使用窄化同步 control-plane fence；唯一 `aborted` lifecycle 仍经同一 per-session `SessionWriteExecutor` queue；同步 admission 失败 fail closed。

行为合同未变。开发者已于 2026-08-25 选择方案 B；本 Task 不重新比较方案 A/B，也不改变 `INVOCATION_ABORT_GRACE_MS = 150` 或 forced-abort `300ms` 上界。

本 Task 从 legacy `00159-agent-abort-mutation-contract` 迁入；既有 walkthrough 保留原 Task ID，作为迁移前 provenance。

## Agent 工作

1. 读取当前工作树而不覆盖用户改动，逐项核对 Abort Spec、ADR 0019、Reference、Task 18 黑盒合同和候选实现是否表达同一 owner、锁顺序、durable ordering、ownership release、迟到结果隔离及 fail-closed 行为。
2. 权威后同步修复计划已批准业务实现范围；只在允许文件中补齐缺口，不得增加第二套锁、repository 旁路、tombstone 兼容分支或静默 fallback。
3. 用公开行为测试覆盖 HTTP abort、合作取消、非合作 Provider/tool forced-abort、重复取消、迟到结果、同步 enqueue 失败、物理恢复失败和后续 invocation ordering；不锁定私有调用顺序。
4. 运行 `focused-test`、`regression-test`、`typecheck`、`docs-check` 和 `diff-check`，把实际命令、退出码和关键结果追加到 Task walkthrough；未运行项保持未完成。
5. Reviewer核对 `150ms` grace、`300ms` 上界、唯一 durable `aborted` lifecycle、SessionWriteExecutor授权和 HTTP 200/503 语义，再由Leader更新状态。

## 开发者参与

开发者已选择方案 B，并批准 `local://post-sync-review-fixes-plan.md` 中 Abort 业务合同、源码和测试的可逆本地修改与验证。该授权不包括改变取消预算、HTTP 公开语义、durable truth 或采用计划外恢复机制；这类变化仍需开发者另行决策。

真实 Provider、浏览器人工验收、远端写入、push、PR、发布、部署、数据库迁移和数据删除继续分别授权。

## 任务产物

- Leader/架构合同消费者：`packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md`、`docs/specs/agent/session-abort.md`、`packages/neuro-book/assets/reference/agent/attachments.md`。
- Agent/HTTP与测试消费者：`packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md`。
- Agent/运行时消费者：`packages/neuro-book/server/agent/harness/neuro-agent-harness.ts`、`packages/neuro-book/server/agent/session/write-plan.ts` 及对应行为测试。
- Reviewer/下一位Leader：本 Task 的追加 walkthrough，记录diff、验证结果、残余风险与审查结论。

当前方案 B 实现、Reference、ADR、Spec 和状态矩阵测试已按批准计划闭合；最新验证与残余边界记录在 `walkthroughs/003-leader-2026-08-29-implementation-verification.md`。

## 修改计划

1. 固定当前候选diff与方案 B 的逐条映射，先找合同冲突和未覆盖行为。
2. 以行为测试证明缺口；修正 Spec、ADR、Reference、黑盒合同和实现中的同一根因。
3. 完成所有调用方与错误映射，不保留旧排除条目或第二套取消路径。
4. 运行required验证并由Reviewer复核；失败则保持 `blocked` 或进入有精确证据的返工，不弱化合同。

## 完成门禁

- 当前Reference、Abort Spec、ADR 0019、Task 18黑盒合同、代码和测试对方案 B 的边界一致。
- 黑盒合同覆盖合作取消与forced-abort的输入、返回、生命周期、终态事件、`activeInvocation: null`、重复取消、迟到结果隔离和503可重试边界。
- 后续 invocation 的 `start` 不先于旧 invocation 唯一 `aborted` durable lifecycle；authorization/plan非法和同步enqueue失败均fail closed。
- `focused-test`、`regression-test`、`typecheck`、`docs-check`、`diff-check` 有当前文件集合的真实通过结果；Reviewer没有未处理finding。

## Leader 完成条件

完成恢复所需最小集合：本 README、`context.md`、三份 walkthrough、Abort Spec、ADR 0019、Reference、Task 18 黑盒合同、当前实现 diff 和最新验证结果。完成门禁满足且 Reviewer 无未处理 finding 后，Leader 可将 Task 视为 completed；不预建另一份取消实现 Task。

## 允许文件

- `README.md`
- `context.md`
- `docs/specs/README.md`
- `walkthroughs/**`
- `docs/specs/agent/session-abort.md`
- `packages/neuro-book/assets/reference/agent/sse.md`
- `packages/neuro-book/docs/adr/0019-agent-abort-mutation-boundary.md`
- `packages/neuro-book/assets/reference/agent/attachments.md`
- `packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md`
- `packages/neuro-book/server/api/agent/sessions/[sessionId]/abort.post.ts`
- `packages/neuro-book/server/api/agent/sessions/[sessionId]/abort.post.test.ts`
- `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts`
- `packages/neuro-book/server/agent/harness/neuro-agent-harness.test.ts`
- `packages/neuro-book/server/agent/harness/neuro-agent-harness.black-box.test.ts`
- `packages/neuro-book/server/agent/session/write-plan.ts`
- `packages/neuro-book/server/agent/session/session-repo.ts`
- `packages/neuro-book/server/agent/session/abort-durability-error.ts`
- `packages/neuro-book/server/agent/session/abort-not-allowed-error.ts`
- `packages/neuro-book/server/agent/http.ts`
- `packages/neuro-book/server/agent/http.test.ts`
- `packages/neuro-book/shared/dto/agent-session.dto.ts`
- `packages/neuro-book/shared/dto/agent-session.dto.test.ts`
- `packages/neuro-book/server/agent/session/write-plan.test.ts`

当前不授权真实Provider、浏览器人工验收、远端Issue/Project写入、push、PR、发布、部署、数据库迁移或数据删除。
