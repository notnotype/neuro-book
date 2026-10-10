---
schema: nbook.task/v2
taskId: t09-harness-foundation-session
---

# nb-harness 底座与 session 模块

## 目标

1. 搭好 `nb-harness` 的底座：一个模块一个子路径入口，模块边界由 `src/architecture.test.ts` 检查，旧原型整体移到 `src/prototype/`。
2. 写 [`harness.session`](../../../../../docs/specs/harness/session.md) 的 `planned` Spec，交 omp 设计审查。
3. Spec 定稿后写实施计划（`plan.md`），按 Spec 实现 `session` 模块与 JSONL 存储。

非目标：`profile`（先讨论扩展性）、`config`、`models`、`tools`、`runtime`；不删除旧原型与 `nb-session`、`nb-profile` 两个包（`runtime` 完成时删）。

## 当前状态（2026-10-10）

- 底座完成：旧原型（原 `src/`、`tests/`）移到 `packages/nb-harness/src/prototype/`，包根入口 `.`、`./testing` 指向它；新增入口 `./session`（目前只有模块头注释）；新增 `src/architecture.test.ts`（模块表、只经公开入口、单向依赖、OMP 与 Node 内置模块的使用范围、禁止 `pi-coding-agent`、旧原型隔离、无动态 import、模块表无环）；加 `typebox` 依赖；包 `AGENTS.md` 改写为模块规则。验证：`bun test` 30 pass、2 skip（原型的真实模型用例）；`bun run typecheck` 通过；边界测试的变异检查（在 `session.ts` 临时加入 Node 内置模块、OMP 运行时导入、引用原型三种违规）三条都被报出，恢复后通过。
- `session` 的 `planned` Spec 写完，待 omp 设计审查。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`draft`）的“会话”“模块划分与推进顺序”与决策记录。
- 开发者 2026-10-10：先打好 nb-harness 底座、项目结构与文件结构；旧原型移到 `src/prototype/`；Profile 第一版先不做，先把 `session` 做好；写完后让 omp 审查。

## 下一步

omp 设计审查（设计稿与 `session` Spec）→ 处理审查意见并请开发者确认 → `plan.md` → 实现与合同测试。
