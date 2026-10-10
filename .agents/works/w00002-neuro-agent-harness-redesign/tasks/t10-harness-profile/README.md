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

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“Profile”一节与决策记录。
- 开发者 2026-10-10：Profile 全部走注册；`Appending` 只在 ReAct 循环之前写入会话；种子只能是 `User`、`Developer`；提醒用 `<system-reminder>`；Profile 文件全部信任。
- t09 的做法沿用：TypeBox 按判别字段选变体校验；测试用真实依赖、两种输入各跑一遍；每片做变异检查。

## 下一步

处理 omp 计划审查 → omp 实现审查 → 处理。
