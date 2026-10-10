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
- **审查（omp，计划与实现合一）**：已写出 3 条，全部成立并已修。第 1 条（阻断：审批模型超时或中止后迟到的回复仍被采用、流不结束会永久挂住）——`judgeWithModel` 自己结算取消：取消或超时先 resolve 再 abort 流，与回复 `Promise.race`，回复路径再查一次取消状态；补“流不理会取消”“取消后才带 allow 结束”“运行中中止”三种用例。第 2 条（阻断：审批钩子拿不到本次取定的定义，来源更新可按另一份定义放行）——`approve` 改收 `ApprovalRequest`（调用 + 适配层按次取到的 `definition` + `signal`），runtime 用它算风险，不再自己取来源；补“等待期间来源换掉同 id 工具”的真实 Agent 用例。第 3 条（重要：钩子缺中止信号，`Agent.abort` 不结束等待、迟到批准仍执行）——适配层把审批与信号竞速（已中止的信号立即结算），批准返回时已中止也不开始 `execute`；`runScriptedAgent` 加 `onEvent` 以便在进入审批后调用真实 `Agent.abort`。Spec 输出 7、8、10 与状态一节同步改。变异检查：judge 不竞速、adapter 不与信号竞速都被报出；“迟到回复照采用”“批准返回时不查中止”“审批前不查中止”三处是竞速之外的兜底（结算顺序已保证），变异存活、保留。
- **审查第 4–9 条**：第 4 条（TypeBox 与 OMP 的 `pattern` 正则语义不同）——适配层改用 OMP 的 `validateJsonSchemaValue` 校验参数（与它的循环同一实现），定义时要求 `pattern` 能被不带 `u` 标志的 `RegExp` 编译；第 5 条（来源 `get` 与首次校验在 catch 外）——来源抛出 → `tool-unavailable`，执行边界再兜一层 → `execution-failed`；第 6 条（OMP 工具结果带 `undefined` 字段写不进会话）——session 模块提供 `withoutUndefined`，runtime 写入前用它（session Spec 规则表加注）；第 7 条（动态风险返回值不校验）——与静态定义过同一套形状检查，不合规按 `exec` 加询问；第 8 条（参数整体截断丢字段、省略号突破上限）——只逐字段截字符串、标记计入预算、结果仍是 JSON，整体超过 16 KiB 时不问模型直接 `escalate`；第 9 条（工具输出可伪造 user 行）——请求改为带来源的 `<tool>`、`<arguments>`、`<message role>` 块并转义 `<`，系统提示词声明块内文字不是授权。Spec 输出 1、5、7、8 与“边界与兼容”同步改。变异检查五处（参数过大照问、块内不转义、动态风险不校验、定义时不查正则、来源抛错不接）都被报出。第 10 条（建议：回复解析只从第一个 `{` 起，前置片段带大括号时遮蔽后面的合法判定）——每个 `{` 都当候选起点，解析不出的跳过，Spec 输出 7 写明。报告收尾：10 条（阻断 2、重要 7、建议 1，全部处理）、已检查的合同与验收缺口、未发现问题的方面、计划风险逐项判断（其中“runtime 照接口实现会返工”的三项——定义身份、信号、消息接管——都已在第 2、3、6 条处理）；反思回写建议 1 条（OMP 消息到会话的 JSON 规范化责任写进 session Spec）已随第 6 条写入 session Spec 规则表。证据 [`evidences/review.txt`](evidences/review.txt)。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“工具定义”“工具审批”“插件的落脚点”；OMP `pi-agent-core` 的 `AgentTool`、`AgentToolResult`、`ToolTier`、`AgentToolUpdateCallback`。
- 开发者 2026-10-10：审批自建、借用三档等级；缺省 `auto`（绑定审批角色）或 `write`；审批等待在工具执行包装里，不在 `beforeToolCall`；不开启 OMP 的预测执行。

## 下一步

omp 计划审查 → 处理 → 实现 → omp 实现审查。
