---
schema: nbook.task/v2
taskId: t46-profile-extensions-by-id
status: active
updated: 2026-11-25
---

# Profile 声明按 id 引用扩展，模式不再绑在 switch_mode 上

## 目标与范围

Profile 声明能按 id 引用可选装的扩展（第一个是模式扩展 nbook.agent.modes）；模式控件按会话装没装模式扩展显示，switch_mode 只决定 Agent 能不能主动切换；修掉插件 Profile 列了 switch_mode 却没装扩展时切换模式报 unknown-extension。

合同：改 agent.contributions、agent.modes、harness.extensions 与 harness.runtime 输出 57（见 plan.md 的“Spec 与文档改动”）。

## 当前状态

2026-11-25 计划第 1 稿写好（[plan.md](plan.md)），开发者 2026-11-25 回“可以”，计划要点全部按推荐：伴随规则照做；Profile 面板里开关扩展不做；旧会话写一次 profileChanged 可以接受。此前已定：开发者已定：声明里按 id 引用扩展；模式控件跟着扩展走，switch_mode 只管 Agent 主动切。

## 计划的设计审查（2026-11-25）

快速审查：Claude Opus 一份 14 条（阻断 1、重要 4、建议 9），全部成立，已改进 [plan.md](plan.md)；omp（`@review`）在后台审同一份第 1 稿，回来后按“先在当前计划上核实”处理。要点：内核里“打开时装配失败、提供方晚到后恢复”会把会话解锁成占位 Profile（阻断，审查者实验复现，先单独修）；伴随只在同一插件内；界面只按目录判，并修两处“只有主创有模式”；插件 Profile 只认声明、合并结果按句柄缓存；字段两处都叫 `referencedExtensions`；引用缺失用新码 `referenced-extension-missing`；目录加 `extensions-missing`；`complete()` 忽略引用；子代理建好后再核模式。已知：面板绑定加的 `switch_mode` 在没模式的 Profile 上仍交给模型、调用得 `mode-unavailable`。报告：[evidences/design-review-opus.txt](evidences/design-review-opus.txt)。

## 下一步

按切片实施，执行位置 `.worktree/w00032-t46-profile-ext-refs`（分支 `feat/w00032-t46-profile-ext-refs`）；e2e 基线：起点上 `agent-conversation.e2e.ts` 26 条全过。omp 报告回来后单独处理。
