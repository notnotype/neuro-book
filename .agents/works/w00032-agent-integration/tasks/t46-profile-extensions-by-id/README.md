---
schema: nbook.task/v2
taskId: t46-profile-extensions-by-id
status: active
updated: 2026-11-25
---

# Profile 声明按 id 引用扩展，模式不再绑在 switch_mode 上

## 目标与范围

Profile 声明能按 id 引用可选装的扩展（第一个是模式扩展 nbook.agent.modes）；模式控件按会话装没装模式扩展显示，switch_mode 只决定 Agent 能不能主动切换；修掉插件 Profile 列了 switch_mode 却没装扩展时切换模式报 unknown-extension。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-25 经 nbdev 新建，尚未开工。

## 下一步

待补充。
