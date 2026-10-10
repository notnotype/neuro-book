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

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“Agent 运行时”“工具审批”“事件、推送与分页”“模块划分与推进顺序”“插件的落脚点”。
- 相邻 Spec：[`harness.session`](../../../../../docs/specs/harness/session.md)、[`harness.profile`](../../../../../docs/specs/harness/profile.md)、[`harness.config`](../../../../../docs/specs/harness/config.md)、[`harness.models`](../../../../../docs/specs/harness/models.md)、[`harness.tools`](../../../../../docs/specs/harness/tools.md)、[`harness.compaction`](../../../../../docs/specs/harness/compaction.md)。
- OMP `pi-agent-core` 实测（2026-10-10 读源码）：`Agent.prompt` 在 `isStreaming` 时抛 `AgentBusyError`；`transformContext(messages, signal)` 在每次模型调用前、`convertToLlm` 之前执行；`getApiKey(model)` 按次取；模型错误与中止都落在最后一条助手消息的 `stopReason`（`error`/`aborted`）与 `errorMessage`，并发 `agent_end`；`continue()` 对末尾是带未配对工具调用的助手消息会重跑这些调用，末尾是工具结果或用户消息则直接请求模型；`replaceMessages` 在运行中不影响已开始的循环（循环开始时拷贝消息）。

## 下一步

omp 审查（计划与实现合一）→ 处理 → 删除旧原型与两个包。
