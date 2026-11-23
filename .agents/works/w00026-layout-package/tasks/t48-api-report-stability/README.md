---
schema: nbook.task/v2
taskId: t48-api-report-stability
status: active
updated: 2026-11-23
---

# API 报告 CI 与 @stable、@experimental 标注

## 目标与范围

公开入口出 API 报告并在 CI 里比对，全部公开符号标 @stable 或 @experimental（提案第二档第 2、3 项）；报告与导出名清单测试的分工、与 @stable 范围的对应在这个 Task 定。

合同：nb-layout 的行为合同未变（标注是包的发布承诺，写在包 README 与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条）；[`runtime/plugin-code-loading`](../../../../../docs/specs/runtime/plugin-code-loading.md) 的“共享入口即兼容承诺”加 nb-layout 名字跟着 nb-layout 的标注走（开发者 2026-11-23 定）。

## 当前状态

2026-11-23：开发者在会话里定了第 2 轮停下的两件，连同 nb-layout 可以首发、`ui/nested-grid` 与 `ui/layout-drag` 可以晋升：
1. **稳定范围**：nb-layout 0.x 期间全部名字 `@experimental`，包括插件 SDK 转出的；SDK 写明它转出的 nb-layout 名字跟着 nb-layout 的标注走。
2. **`@stable` 由谁定**：nb-layout 自己的标注；SDK 加一行转出不替 nb-layout 许诺。

据此写了[计划](plan.md)第 3 稿，交第 3 轮（最后一轮）设计审查。

此前：第 2 轮设计审查（Claude Sonnet，重要 7、建议 3，[证据](evidences/design-review-2.txt)）十条都成立，其中第 2、4 条牵涉对外承诺，停下等开发者；第 1 轮（Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）都成立，改出第 2 稿；探针见[证据](evidences/probes.txt)。

## 下一步

第 3 轮设计审查（最后一轮）→ 实施 → 实现审查；之后 nb-layout 首发（发布手册“新包首发”）。
