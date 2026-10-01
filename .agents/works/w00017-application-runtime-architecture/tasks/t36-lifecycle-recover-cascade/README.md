---
schema: nbook.task/v2
taskId: t36-lifecycle-recover-cascade
---

# 内核显式恢复一次完成整条依赖链

## 目标与范围

[t34](../t34-builtin-service-plugins/README.md) 已知问题 1：关闭时一处释放失败，故障排除后每次显式恢复只推进一层依赖，要连续调用多次才能关闭。[`runtime.lifecycle`](../../../../../docs/specs/runtime/lifecycle.md) 状态表要求失败资源重试成功即到已关闭，现状违反合同。本 Task 复现并修复内核，使一次显式恢复推进整条依赖链；同时把 `product-startup.test.ts` 的对应用例恢复为一次恢复即关闭。

不做：自有宿主入口与 `nbook.http`、停止来源汇合、其它内核重构。

编码由 omp 完成（`@default`，运行在 `openai-codex/gpt-6.1-sol`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过。

**根因**（复现证实）：`#runAttempt` 先同步调用 `#advanceChildren`，子作用域的 `recover()` 在同步段内就做释放规划。级联是深度优先的，提供方规划时，另一棵子树上的消费者还没有在途尝试，`#isActiveBorrower()` 把它当作已停滞的借用者，提供方资源判为 `blocked`，本次尝试随即结算。

**修复**（已写入 [`runtime.lifecycle`](../../../../../docs/specs/runtime/lifecycle.md) 实现合同）：`#startAttempt` 先同步递归登记整棵子树的尝试，级联的子作用域经私有入口 `#closeFromCascade`、`#recoverFromCascade` 启动，它们的释放规划排进 microtask；本作用域的规划仍在 `close()`/`recover()` 返回前开始。重试次数、在途清理不重入、deadline 语义、真停滞判 `blocked` 均不变。

**测试**：`lifecycle.test.ts` 新增跨子树借用者首次释放失败后一次恢复即关闭、借用者恢复仍失败时提供方保持 `blocked` 且不挂起两条；`plugins.test.ts` 新增 A→B→C 三层服务依赖一次恢复即关闭。修复前前一条与插件用例都得到 `incomplete`（[red-before-fix.txt](evidences/red-before-fix.txt)）。`product-startup.test.ts` 恢复为一次恢复即关闭，并删去 t34 为旧逐层恢复行为写的一处断言。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：首轮把本作用域的规划也推迟到 microtask，`close()` 返回后子作用域要晚一轮才开始收口，全量测试中 `server/agent/harness/neuro-agent-harness.test.ts` 两条在关闭 Project 后只等一轮就检查占用状态的用例因此失败（[acceptance-test-full-round1.txt](evidences/acceptance-test-full-round1.txt)）。返工后恢复原有启动时序，两条用例未改动即通过。

**过程事件**：omp 在包目录下用相对路径写证据，误写进 `packages/neuro-book/.agents`，清理时对该目录执行 `rm -rf`，随后用 `git restore --source=HEAD` 恢复了全部 857 个受跟踪文件，现状与 HEAD 一致（删除前是否有未跟踪文件无法核实，推断没有）。开发者已批准把“不用 `rm -rf` 清理仓库内目录、证据命令从仓库根执行”写入全局 omp 禁止清单。

**验证**（主会话运行，返工后）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation`；`test server/runtime server/features scripts/smoke/product-lifecycle server/agent/harness/neuro-agent-harness.test.ts` | 19 个文件 222 条；17 个文件 324 条，全部通过 | [acceptance-test-targeted.txt](evidences/acceptance-test-targeted.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 三种模式 | 全部通过 | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `smoke:product-lifecycle --only L1,L2,L3,L4,L5,L6`（含生产构建） | 与 t35 相同：L1、L2、L4、L5、L6 通过，L3 只有 `drain-new-request` 失败 | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json) |
| `bun run test` | 10 个文件 23 条失败、22 个 errors，与基线相同 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |

omp 的输出与汇报：`evidences/` 下的 `red-before-fix.txt`、`green-targeted.txt`、`rework-1-*.txt` 等与 `delivery.md`。

## 下一步

自有服务端宿主入口与 `nbook.http`：停止来源汇合、排空期间返回 503、删除启动中间件、`productRuntimeReady()` 与关闭控制器。
