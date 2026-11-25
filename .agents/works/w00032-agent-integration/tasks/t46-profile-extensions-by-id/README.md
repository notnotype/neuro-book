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

## 下一步

计划审查（内核装配，Opus 加 omp @review），再按切片实施。
