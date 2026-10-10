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
- **实现**（计划 S1、S2，一个提交）：`src/tools/`（`types.ts`、`define.ts`、`source.ts`、`approval.ts`、`judge.ts`、`adapter.ts`、`tools.ts`；测试辅助 `testing/scripted-agent.ts` 用真实 OMP `Agent` 跑脚本化回复）；`package.json` 入口；模块表登记。`bun test src/tools` 12 pass；整包 155 pass、3 skip；变异检查八处（判定表一格、步骤 3 的等级比较、审批模型失败时放行、跳过参数校验、`tool-unavailable`、`afterExecute`、风险函数抛错、可见工具不报冲突）都被报出。实测两件事写进了 Spec：OMP 的循环先按 schema 校验并转换参数（缺必填字段不到达适配层，数字会被转成字符串），一批工具调用并行执行、结果按完成顺序进历史。Spec 加“实现合同”与证据行，注册表标“待晋升”。计划审查未开（三个 omp 审查会话在跑，排队中）。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“工具定义”“工具审批”“插件的落脚点”；OMP `pi-agent-core` 的 `AgentTool`、`AgentToolResult`、`ToolTier`、`AgentToolUpdateCallback`。
- 开发者 2026-10-10：审批自建、借用三档等级；缺省 `auto`（绑定审批角色）或 `write`；审批等待在工具执行包装里，不在 `beforeToolCall`；不开启 OMP 的预测执行。

## 下一步

omp 计划审查 → 处理 → 实现 → omp 实现审查。
