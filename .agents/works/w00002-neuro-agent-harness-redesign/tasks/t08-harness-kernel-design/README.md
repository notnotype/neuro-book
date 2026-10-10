---
schema: nbook.task/v2
taskId: t08-harness-kernel-design
---

# nb-harness 内核设计

## 目标

按开发者 2026-10-10 的决定，为 `nb-harness` 内核写设计稿 [Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)：会话、模型角色、Profile、模型与凭据、配置、Agent 运行时（ReAct 循环、排队、工具定义、工具审批）、压缩、事件与推送，并说明插件阶段的落脚点；写 [`harness.profile`](../../../../../docs/specs/harness/profile.md) 的 `planned` Spec（`harness.session` 的 Spec 归 [t09](../t09-harness-foundation-session/README.md)）。

非目标：不写代码；不做 `nbook.agent` 插件。

## 当前状态（2026-10-10）

- 分支 `feat/w00002-harness-kernel` 从 `refactor/w00017-runtime-foundation`（`ebecf836`）开出，worktree 沿用 `.worktree/w00002-neuro-agent-harness-redesign`；t07 分支 `docs/w00002-harness-specs` 已合入（`8a577b2d`），冲突取 w00017 的版本。
- 设计稿 `accepted`（2026-10-10，开发者确认第二轮审查的处理之后），开发者已逐项决定，待定项为空；决定过程见设计稿的决策记录。最近一轮写入：Profile 重新设计（全部走注册、`System`/`History`/`Appending` 三个布局节点、`History` 子节点为种子、提醒用 `<system-reminder>`、去掉条件节点、按角色拆分消息节点）、会话条目对齐 OMP、压缩模块、事件推送与分页、子代理的接口预留、插件落脚点补 Profile 与压缩的注册。
- `harness.profile` 的 `planned` Spec 写完并登记。
- 旧原型的五份现状 Spec、三包的 README、API 参考、示例与示例测试，以及 nb-session、nb-profile 的包级 AGENTS.md 已按开发者要求删除（`454a50ab`）；保留 OMP 能力报告 `packages/nb-harness/docs/omp-capabilities.md`。

## 依据

- 开发者 2026-10-10 在本 Work 对话中的逐项决定（设计稿决策记录）。
- 行为参照：旧应用 [Harness 黑盒合同](../../../../../packages/neuro-book-legacy/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)、[Profile 指南](../../../../../packages/neuro-book-legacy/assets/reference/agent/profile-guide.md)、[上下文构成](../../../../../packages/neuro-book-legacy/assets/reference/agent/context.md)、[SSE 合同](../../../../../packages/neuro-book-legacy/assets/reference/agent/sse.md)、[模型角色合同](../../../../../docs/proposals/model-roles-contract.md)、[拓扑设计第 9 节](../../../../../docs/proposals/multi-instance-runtime-topology.md)、[t07 审查](../t07-harness-specs-and-docs/walkthroughs/001-review-2026-10-01.md)；OMP 18.4.6 的会话、审批、子代理、压缩与 RPC 文档（本机安装包内 `dist/docs-index.generated.txt`）。

## 下一步

设计完成；按 Work 的切片实施（session 起步见 [t09](../t09-harness-foundation-session/README.md)）。
