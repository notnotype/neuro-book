---
schema: nbook.task/v2
taskId: t10-harness-profile
---

# nb-harness 的 profile 模块

## 目标

按 [`harness.profile`](../../../../../docs/specs/harness/profile.md)（`planned`）实现 `profile` 模块：TSX 节点与 JSX 运行时、主机与注册（节点类型、数据源、字段）、准备与校验、渲染（系统提示词、种子、追加消息、请求）、内置节点（含有状态的 `Reminder`）、加载与目录。Work 切片 2。

非目标：runtime 对 Profile 的调用时序（以后的 `harness.runtime`）；插件系统的贡献点；旧原型 `nb-profile` 的兼容或删除（`runtime` 完成时删）。

## 当前状态（2026-10-10）

- 实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进：计划 → omp 计划审查 → 实施 S1–S5 → omp 实现审查。
- 计划时发现 Spec 缺 `UserInput`、`Profile`、`PreparedProfile` 三个类型与内置节点的 id，已随计划补进 Spec。
- **计划审查（omp）**：报告 [`evidences/plan-review.txt`](evidences/plan-review.txt)，写出 6 条后因模型额度中断（没有“未发现问题的方面”一节）。逐条核实全部成立并已处理：第 1 条助手示例消息的元数据——实现本来填占位值，Spec 输出 9 写明并加测试把渲染出的消息写进 session；第 2 条数据源与字段的 schema 不限定对象——实现本来如此，计划与 Spec 输出 1 改清措辞；第 3 条准备结果的所有权——注册表存定义的冻结副本（数组另复制）、取数结果与上下文接管为冻结副本、时刻固定成数字、状态复制，补测试；第 4 条 render 返回的节点绕过静态校验——渲染时按同样规则再查并丢弃，各渲染输出带诊断，`renderSystem` 加 `diagnostics`（Spec 输出 6）；第 5 条 Fragment 透明——实现本来用展开后的子节点，补等价测试；第 6 条 `defineProfile` 的定义错误被报成 `module-load-failed`——加 `ProfileDefinitionError`，加载器映射为 `invalid-profile`，补真实文件负例。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“Profile”一节与决策记录。
- 开发者 2026-10-10：Profile 全部走注册；`Appending` 只在 ReAct 循环之前写入会话；种子只能是 `User`、`Developer`；提醒用 `<system-reminder>`；Profile 文件全部信任。
- t09 的做法沿用：TypeBox 按判别字段选变体校验；测试用真实依赖、两种输入各跑一遍；每片做变异检查。

## 下一步

处理 omp 计划审查 → omp 实现审查 → 处理。
