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

## 实现与实现审查（2026-11-25）

切片：`d2bbce5cd`（内核占位修正）、`7574c8419`（内核按需扩展）、`5a13f34a2`（agent 插件与 bot）、`2deac611a`（界面）、`7421ab8c5`（omp 设计审查 4、10、14）；Spec 在 master 上（`b59a4b646`、`c1503ad6d`）。

快速审查：Claude Opus（后端）5 条、Claude Sonnet（前端）7 条，全部成立，已修：占位修正漏的一条路径（打开时缺依赖、之后 Profile 解析不到、再来插件发布会把占位写进日志）补了判断与用例（变异检查通过）；从占位换上真 Profile 时的 `fromPlaceholder ? "code-updated"` 是多余分支（占位的版本是 `unknown`，原有判断就给出 `code-updated`），删掉；`referencedExtensions` 写成非数组时内核报 `bad-extension-id`、目录不再整个抛错；声明与实现引用不一致的诊断补了用例；伴聊 bot 改从 `agent/shared/contracts` 取模式扩展的 id（架构测试拦下跨插件深导入）；前端判据收成一个函数，测试改成数 `changeSettings` 调用并补草稿模式丢弃、`unknown-extension` 提示、没会话时按主创判三条（变异检查：去掉 `setMode` 的判据，用例失败）；`/plan` 切换期间换了会话不再把文字发到新会话、切不成不改输入框；`/mode` 先判有没有模式。没补用例的两处：子代理建好后再核模式的分支只在两次解析拿到不同 Profile 的竞态里到得了；按句柄缓存的效果在插件 Profile 上观察不到（同一代句柄只在建、开会话时解析），保留缓存与注释。omp 的实现审查在后台，回来后单独处理。报告：[evidences/impl-review-opus.txt](evidences/impl-review-opus.txt)、[evidences/impl-review-sonnet-frontend.txt](evidences/impl-review-sonnet-frontend.txt)。

## 下一步

按切片实施，执行位置 `.worktree/w00032-t46-profile-ext-refs`（分支 `feat/w00032-t46-profile-ext-refs`）；e2e 基线：起点上 `agent-conversation.e2e.ts` 26 条全过。omp 报告回来后单独处理。
