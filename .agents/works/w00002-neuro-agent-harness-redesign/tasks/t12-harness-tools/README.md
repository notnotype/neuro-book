---
schema: nbook.task/v2
taskId: t12-harness-tools
---

# nb-harness 的 tools 模块

## 目标

写 [`harness.tools`](../../../../../docs/specs/harness/tools.md)（`planned`）并按它实现 `tools` 模块：内核的工具协议（`defineTool`、`ToolOutcome`）、工具来源与可见工具、审批模式解析与判定、审批模型的调用、把内核协议的工具适配成 OMP `AgentTool`（参数校验、审批关卡、结构化错误、进度）。Work 切片 4。

非目标：等待用户与 `interaction` 条目（`runtime`）；内置读写工具（切片 7）；插件贡献点与项目级参数注入（插件阶段）。

## 当前状态（2026-10-10）

- Spec 与实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“工具定义”“工具审批”“插件的落脚点”；OMP `pi-agent-core` 的 `AgentTool`、`AgentToolResult`、`ToolTier`、`AgentToolUpdateCallback`。
- 开发者 2026-10-10：审批自建、借用三档等级；缺省 `auto`（绑定审批角色）或 `write`；审批等待在工具执行包装里，不在 `beforeToolCall`；不开启 OMP 的预测执行。

## 下一步

omp 计划审查 → 处理 → 实现 → omp 实现审查。
