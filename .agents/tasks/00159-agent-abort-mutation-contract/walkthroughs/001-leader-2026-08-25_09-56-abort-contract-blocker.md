---
schema: nbook.walkthrough/v1
taskId: 00159-agent-abort-mutation-contract
sequence: 1
role: leader
status: blocked
createdAt: 2026-08-25T09:56:19Z
---

# Agent abort mutation 合同阻塞登记

## 结论

Task 147 的 bounded forced-cancellation 代码已在当前 `master`，但本次交付不能宣称取消治理闭合。现有稳定 Reference、实现和黑盒合同存在可定位的不一致，已创建本 Task 作为后续文档与测试闭环入口。

## 证据

- `packages/neuro-book/assets/reference/agent/attachments.md:107-115` 要求 invocation claim、terminal transition、runtime command、附件登记、archive/restore 和 abort 共用 `withSessionMutation()` / `withSessionMutations()`，并规定 relation lock -> Session mutation lock -> `SessionWriteExecutor` write lock 的顺序。
- `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts:3543-3635` 的 `abortInvocationMatching()` admission 阶段进入 `withSessionMutation()`；但 `:6485-6510` 的 `forceAbortInvocation()` 在宽限期后直接执行 forced-abort enqueue、释放 ownership 并发布终态事件，没有重新进入 mutation lock。
- `packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md:52-62` 明确把 abort endpoint 列为暂不覆盖，因此当前黑盒测试不能证明 HTTP abort 的公开合同。

## 处理

- 未修改 Reference、Task 18 黑盒合同或业务代码；不把实现现状反向写成合规合同。
- 创建 `.agents/tasks/00159-agent-abort-mutation-contract/README.md`，状态设为 `blocked`。
- 后续 Task 要求先在人类决策中选择：强制取消重新纳入统一 mutation 边界，或明确记录同步 control-plane fence 与 mutation lock 的拆分边界；两种方案都必须保留 150ms grace、300ms forced-abort 上界、单 invocation durable aborted lifecycle、ownership fence 与 write queue ordering。
- 决策后补充当前 Reference、HTTP abort 黑盒合同以及合作/非合作取消、重复取消、迟到结果和后续 invocation 顺序测试。

## 合并与工作区边界

- 当前 `master` HEAD 为 `bf07359d3966900ddf9bfc4ad0031fa2b956f29d`；取消修复提交 `6a79bfd9` 已是其祖先。
- 本轮没有重做 merge、reset、stash、checkout 或删除任何现有路径。
- 本 Task 的 README 和 walkthrough 是本轮新增的根 Task 文档；其余既有工作区内容保持原样。
