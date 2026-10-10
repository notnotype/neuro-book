---
schema: nbook.task/v2
taskId: t13-harness-compaction
---

# nb-harness 的 compaction 模块

## 目标

写 [`harness.compaction`](../../../../../docs/specs/harness/compaction.md)（`planned`）并按它实现 `compaction` 模块：压缩方法的注册与按顺序选择、内置 `soft`（包 OMP 的 `prepareCompaction` 与 `compact`，关闭远程与原生压缩）、压缩条目与种子的一批写入、给运行时用的阈值判断、Profile 注册字段 `harness/compaction` 的 schema 与缺省值。Work 切片 5。

非目标：触发时机与状态机（`runtime`）；`remote` 等其它方法（推迟，见设计稿决策记录）；种子的渲染（`profile`）。

## 当前状态（2026-10-10）

- Spec 与实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进。
- **实现**（计划 S1，一个提交）：`src/compaction/`（`types.ts`、`settings.ts`、`registry.ts`、`soft.ts`、`trigger.ts`、`run.ts`、`compaction.ts`）；`package.json` 入口；模块表登记（依赖 `session` 类型、OMP `pi-agent-core` 运行时）。`bun test src/compaction` 9 pass（llm 冒烟 1 skip）；整包 176 pass、4 skip；变异检查九处（`unknown-method` 不提前返回、失败算作不适用、`run` 后不查中止、`soft` 自己不查中止、空摘要被接受、`append` 分两次、阈值比较 `>=`、不适用算失败、`remoteEnabled` 打开）都被报出。lab 实验（真实 OMP、不联网）确认并写进 Spec 的三件事：中止时 OMP 本地摘要不抛出而是返回只剩分隔符的“摘要”，所以 `soft` 以 `signal.aborted` 为准；模型回复 `error` 时 OMP 缺省重试三次（500 ms 起翻倍）；二次压缩从上一条 `firstKeptEntryId` 起并把上一条摘要交给模型迭代。Spec 加证据，注册表标“待晋升”。
- **审查（omp，与 t14 合一，进行中）**：涉及本模块的第 12 条（`details`、`preserveData` 不能如实表示时绕过方法级校验，到写日志才被拒，后面的方法没机会）——`outputProblem` 递归查 JSON 可表示性与 `preserveData` 的对象形状，不合规当作该方法失败换下一个；Spec 输出 4 写明；补两个坏方法加 soft 兜底的测试。其余各条见 [t14](../t14-harness-runtime/README.md)。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“压缩”“模块划分与推进顺序”；OMP `pi-agent-core` 的 `prepareCompaction`、`compact`、`SummaryOptions.completeImpl`、`calculateContextTokens`、`effectiveReserveTokens`。
- 开发者 2026-10-10：压缩作为单独模块、方法走注册；第一版只做 `soft`，`remote` 推迟；只追加；Profile 经注册字段声明方法顺序、阈值、保留多少与额外要求；压缩后重新写入种子。

## 下一步

omp 审查（计划与实现合一，与 t12 相同做法）→ 处理。
