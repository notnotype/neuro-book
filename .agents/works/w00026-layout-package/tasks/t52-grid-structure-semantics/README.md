---
schema: nbook.task/v2
taskId: t52-grid-structure-semantics
status: active
updated: 2026-11-22
---

# nb-layout 结构操作的语义：不压固定栏、setSize

## 目标与范围

从 t51 拆出（开发者 2026-11-22 定的“原地增删不压固定栏、加设宽度入口”，见 [t51 的“决定”](../t51-layout-api-gaps/README.md)）：结构操作与 `resize` 不改保留像素兄弟的意图、`setSize`；展平与拆分的老问题写成已知限制。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新增输出 153、154（planned）。

## 当前状态

2026-11-22：实现完成，在分支 `w00026/t52-grid-structure`（worktree `.worktree/w00026-t52-grid-structure`）两个提交：`6c42f6ab9`（代码与测试）、`e11a74773`（文档）。还没合入，等实现审查处理完。

- [计划](plan.md)第 3 稿：第 1 轮设计审查（重要 8、建议 6，[证据](evidences/design-review.txt)）与 API 形状审查（重要 8、建议 5，[证据](evidences/api-review.txt)）之后收回到开发者定的范围；第 2 轮合审（重要 4、建议 4，[证据](evidences/review-2.txt)）8 条都成立，改进第 3 稿后直接实施。
- 实施时对计划的一处偏离：`resize` 拖按比例分的节点时，分摊的候选只含按比例分、没收起的兄弟（第 3 稿写的是“照旧”，那样拖按比例分的节点仍会压保留像素的兄弟、把收起中的兄弟意图写成 0）。计划与 Spec 输出 153 已同步。
- 现有用例一个数都没变（nb-layout `bun test` 398 条、vitest 275 条照过），新规则靠新用例：`grid.test.ts` 新增“结构操作与 resize 不改兄弟的意图”七条、“收起与展开的入口”下 `setSize` 三条、失败码一条。
- 变异检查（改实现、跑 `grid.test.ts`、恢复）：`addLeaf` 回到兄弟补偿红 4 条；`resize` 拖固定节点也摊给兄弟红 1 条；平均份额不算收起中的兄弟红 2 条。
- 验证：nb-layout `typecheck`、`test`（bun 409、vitest 275）；应用 `typecheck`；`readme.test.ts`；Lab e2e `lab-grid-structure.e2e.ts` 15 条全过（负载约 2.3）；`docs:check` 只剩 master 上 `bots/view.md` 的两条，与本 Task 无关。
- 实现审查（Claude Sonnet，不阻塞）进行中，报告待处理。

交开发者的问题（已知限制里）：`splitLeaf` 拆保留像素的叶要不要直接失败（`wrong-sizing`）。本 Task 只写进文档。

## 下一步

处理实现审查 → Spec 输出 153、154 去掉 planned → 合入 master。
