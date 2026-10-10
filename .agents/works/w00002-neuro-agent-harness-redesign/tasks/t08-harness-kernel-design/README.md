---
schema: nbook.task/v2
taskId: t08-harness-kernel-design
---

# nb-harness 内核设计

## 目标

按开发者 2026-10-10 的决定，为 `nb-harness` 内核写设计稿 [Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)：会话、模型角色、Profile、模型适配器、配置、Agent 运行时（ReAct 循环、工具定义、工具审批），并说明插件阶段的落脚点。设计获批后写 `planned` Spec，再按 Work README 的切片实施。

非目标：不写代码；不做 `nbook.agent` 插件。行为合同未变：本 Task 只写设计稿，目前没有生效中的 harness Spec。旧原型的五份现状 Spec 与包文档已按开发者 2026-10-10 的要求删除，新的 Spec 在设计稿获批后建立。

## 当前状态（2026-10-10）

- 分支 `feat/w00002-harness-kernel` 从 `refactor/w00017-runtime-foundation`（`ebecf836`）开出，worktree 沿用 `.worktree/w00002-neuro-agent-harness-redesign`；t07 分支 `docs/w00002-harness-specs` 已合入（`8a577b2d`），冲突取 w00017 的版本。合入后三包测试、类型检查、`docs:check`、`governance:check` 通过。
- 设计稿 `draft`。开发者 2026-10-10 已逐项决定：排队进第一批、`Agent` 类、自建审批（四种模式、审批模型、只做审批恢复）、模型直接用 OMP、工具进 Profile、会话只定接口加 JSONL、合并三包、删除旧文档与 Spec；决定过程见设计稿的决策记录。会话按 OMP 的只追加条目做事件溯源，模块先做 `session` 与 `profile`；待定项已清空。
- 已删除旧原型的五份 Spec、三包的 README、API 参考、示例与示例测试，以及 nb-session、nb-profile 的包级 AGENTS.md；保留 OMP 能力报告 `packages/nb-harness/docs/omp-capabilities.md`。

## 依据

- 开发者 2026-10-10：单独开分支做 nb-harness 与 Agent 插件；先做内核不做插件，设计考虑插件 API；最基础的六项功能，之后做内置读写工具。
- 行为参照：旧应用 [Harness 黑盒合同](../../../../../packages/neuro-book-legacy/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)、[模型角色合同](../../../../../docs/proposals/model-roles-contract.md)、[拓扑设计第 9 节](../../../../../docs/proposals/multi-instance-runtime-topology.md)、[t07 审查](../t07-harness-specs-and-docs/walkthroughs/001-review-2026-10-01.md)。

## 下一步

开发者确认待定项 → 修订设计稿并提交 → omp 审查 → 改为 `accepted` → 写 `planned` Spec → 按切片实施。
