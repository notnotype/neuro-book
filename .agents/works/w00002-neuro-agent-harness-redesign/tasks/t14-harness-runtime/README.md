---
schema: nbook.task/v2
taskId: t14-harness-runtime
---

# nb-harness 的 runtime 模块

## 目标

写 [`harness.runtime`](../../../../../docs/specs/harness/runtime.md)（`planned`）并按它实现 `runtime` 模块：每个会话一个 OMP `Agent`，外面加持久化、状态机与排队、Profile 装配、模型与凭据、工具与审批等待、审批恢复、压缩触发与类型化事件。Work 切片 6。完成时删除旧原型 `src/prototype/` 与 `nb-session`、`nb-profile` 两个包。

非目标：传输与推送；子代理、Skills、Workflow、附件、分支、`request_user_input`；内置工具（切片 7）；插件贡献点；溢出后的自动重试。

## 当前状态（2026-10-10）

- Spec 与实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进。
- **实现**（计划 S1，一个提交）：`src/runtime/`（`types.ts`、`fields.ts`、`accept.ts`、`session.ts`、`runtime.ts`；测试装配 `testing/harness.tsx`：真实 config/profile/models（SQLite 凭据库）/tools/compaction/session，模型流经 OMP `streamFn` 脚本化）；`package.json` 入口；模块表登记。`bun test src/runtime` 15 pass（llm 冒烟 1 skip）；整包 196 pass、4 skip；变异检查七处（种子每次都写、abort 不写拒绝应答、`scope: session` 不生效、追加队列在 aborted 后也处理、`maxTurns` 不生效、恢复后不写 resumed、不自动压缩）都被报出。实现中确认并写进 Spec 的事：OMP 的消息对象带值为 `undefined` 的可选字段，写入前按 JSON 往返去掉；插话要在工具批次结束前入队才会在下一次模型调用前送达（OMP 在批次结束时取队列），否则在停止边界送达；`abort` 时不写 `resumed`（拒绝应答后直接 `aborted`）；`close()` 要等调用收口所以是异步。Spec 加证据，注册表标“待晋升”。
- **审查（omp，与 t13 合一，进行中）**：已写出 11 条，全部成立并已修。第 1 条（阻断：异步受理期间两个 `prompt` 都受理、争同一个 Agent 与日志）与第 2 条（手动压缩无互斥）——受理与压缩期间会话被**占用**（`#reserved`），第二个 `prompt`/`continue`/`compact` 得 `busy`，受理失败或压缩结束即释放，Spec“状态与转换”写明；第 3 条——自动压缩写入的条目并入 `InvocationResult.entries`；第 4 条——每次调用持有控制器（`control`），自动压缩是调用的尾段，`abort()` 取消它（`compaction` 事件 `cancelled`）而调用结果仍是 `completed`，Spec 输出 14 写明；第 5 条——受理用局部候选 Profile，只在 `#start` 时记下；第 6 条（阻断：恢复执行不可中止、迟到结果重新完成已终止的调用）——恢复执行归 `#recovery` 控制器，工具收到信号，`abort()` 后每一步都不再写入；第 7 条——`resolve` 在任何 await 之前占用 `interactionId`（第二次 `already-answered`），`#write` 只在存储层失败时让句柄进入关闭态，`invalid-entry` 只让那一步失败；第 8 条——`refresh` 失败抛出让 OMP 在发请求前停下，以 `failed/profile` 收口；第 9 条——刷新与系统提示词重渲染移到 OMP `addBeforeModelCallHook`（它在 OMP 把 `state.systemPrompt` 放进本轮上下文之前运行），当次请求生效；第 10 条——`prepare`/`refresh` 传调用的信号，准备阶段中止不开始循环、直接写 `aborted`；第 11 条——调用的 `signal` 监听在收口时解除并核对仍是该次调用。每条都补了真实 OMP Agent 的测试（并发 prompt、并发 compact、尾段中止、Profile 不被失败受理替换、恢复期间 abort 与并发 resolve、数据源刷新时机与失败、prepare 期间中止、信号跨调用）。
- **删除旧原型与两个包**（计划 S3，一个提交）：`git rm` 掉 `packages/nb-harness/src/prototype/`、`packages/nb-session`、`packages/nb-profile`；包根入口 `.` 改指 `runtime`，`./testing` 入口去掉；`nb-harness` 不再依赖 `pi-natives`、`pi-utils`（剩余模块只用 `pi-agent-core`、`pi-ai`、`pi-catalog`）；根 `package.json` workspaces、`bun.lock`、`scripts/ci/workspace-package-matrix.ts`、两个工作流的路径过滤、`packages/AGENTS.md`、根 `AGENTS.md` 结构图、`README.md`/`README.en.md`、`docs/modules/monorepo-boundaries.md`、`docs/testing/README.md`、`nb-harness/AGENTS.md` 与 `docs/omp-capabilities.md`（使用位置表重写）同步；边界测试去掉原型例外。`bun install` 后 2 个包移除；nb-harness 170 pass、4 skip；CI 矩阵脚本对 `nb-profile` 路径不再产出条目；`docs:check`、`governance:check` 通过。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“Agent 运行时”“工具审批”“事件、推送与分页”“模块划分与推进顺序”“插件的落脚点”。
- 相邻 Spec：[`harness.session`](../../../../../docs/specs/harness/session.md)、[`harness.profile`](../../../../../docs/specs/harness/profile.md)、[`harness.config`](../../../../../docs/specs/harness/config.md)、[`harness.models`](../../../../../docs/specs/harness/models.md)、[`harness.tools`](../../../../../docs/specs/harness/tools.md)、[`harness.compaction`](../../../../../docs/specs/harness/compaction.md)。
- OMP `pi-agent-core` 实测（2026-10-10 读源码）：`Agent.prompt` 在 `isStreaming` 时抛 `AgentBusyError`；`transformContext(messages, signal)` 在每次模型调用前、`convertToLlm` 之前执行；`getApiKey(model)` 按次取；模型错误与中止都落在最后一条助手消息的 `stopReason`（`error`/`aborted`）与 `errorMessage`，并发 `agent_end`；`continue()` 对末尾是带未配对工具调用的助手消息会重跑这些调用，末尾是工具结果或用户消息则直接请求模型；`replaceMessages` 在运行中不影响已开始的循环（循环开始时拷贝消息）。

## 下一步

omp 审查（计划与实现合一）→ 处理 → 删除旧原型与两个包。
