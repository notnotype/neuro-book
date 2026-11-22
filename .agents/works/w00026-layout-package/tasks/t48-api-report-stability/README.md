---
schema: nbook.task/v2
taskId: t48-api-report-stability
status: active
updated: 2026-11-22
---

# API 报告 CI 与 @stable、@experimental 标注

## 目标与范围

公开入口出 API 报告并在 CI 里比对，全部公开符号标 @stable 或 @experimental（提案第二档第 2、3 项）；报告与导出名清单测试的分工、与 @stable 范围的对应在这个 Task 定。

合同：行为合同未变（不改 Spec；标注是包的发布承诺，写在包 README 与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条）。

## 当前状态

2026-11-22：[计划](plan.md)第 1 稿，开工前三个探针（[证据](evidences/probes.txt)）；计划审查（Claude Sonnet）在跑。现在 `ui/nested-grid`、`ui/layout-drag` 是 `planned`，按映射规则全部名字标 `@experimental`；晋升 Spec、让一部分名字成为 `@stable` 是开发者的决定，与 nb-layout 首发一起交。

## 下一步

计划审查 → t47 合入之后开 worktree 实施。
