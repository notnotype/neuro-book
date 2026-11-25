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

omp（`@review`，审的是第 1 稿）14 条，按当前计划与代码逐条核实：1、3、12、13 与 Opus 那轮相同，已处理；4（`/plan 文字` 在没有模式的会话里切不成照样发出）、10（引用了模式、没有 `switch_mode` 时提示与闸门说明仍让模型调它）、14（迁移只记一次的断言）成立，已修（`7421ab8c5`）；5、7 补进 Spec（伴随只看硬依赖；引用的扩展的依赖不自动拉入）；6（子代理在检查与发送之间热重载摘掉模式）是窄场景，接受为已知限制。2、8、9、11 是起点上就有的内核缺陷，这次不扩大范围，记在下面的后续里。报告：[evidences/design-review-omp.txt](evidences/design-review-omp.txt)，复现脚本在 `evidences/repro/`。

## 后续（起点上就有的内核缺陷，omp 设计审查 2、8、9、11）

- 撤回扩展导致重新装配失败时，失败分支清掉撤回标记却不摘下旧扩展、不等清理，撤回的 Promise 先完成；同 id 同版本再发布时哈希相同走快路径，不换上新实现（第 2 条，`evidences/repro/repro-reassembly.ts`）。
- 同一入口交了两条扩展、停用时逐条撤回：第一条撤回触发的重新装配去取同代另一条的实现而抛错，没有硬依赖的会话也进 `reassembly-failed`（第 8 条，`evidences/repro/repro-provider-stop.ts`）。
- 插件扩展可以硬依赖 Profile 自带的扩展，装配序按组排、跨组的依赖顺序与环不检查（第 9 条，从代码推断）。
- 贡献句柄的 id 与扩展对象的 id 不一致时没有一处核对（第 11 条，从代码推断）。

## 下一步

按切片实施，执行位置 `.worktree/w00032-t46-profile-ext-refs`（分支 `feat/w00032-t46-profile-ext-refs`）；e2e 基线：起点上 `agent-conversation.e2e.ts` 26 条全过。omp 报告回来后单独处理。
