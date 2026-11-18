---
schema: nbook.task/v2
taskId: t34-unified-errors
status: active
updated: 2026-11-18
---

# 统一失败形状与错误码

## 目标与范围

按提案第一档第 2 项：{ok:false, code, message, params?}，L0 的 35 处中文 reason 与 L2 的 rejected 归并成码，码集合开放；issues 只发新增；改两份 Spec 的失败与恢复

合同：布局行为不变，失败与诊断的形状、码与文字改变：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 失败与恢复、输出 68 与新增的诊断条目，[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 失败与恢复的码表。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“错误与诊断一种形状”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 当前状态

2026-11-18 经 nbdev 新建。计划第 1 稿见 [`plan.md`](plan.md)，在等设计审查（Claude Sonnet）。

- 盘点时发现提案“错误与诊断”有一句与代码不符：L1 的提交回调已有上下文已切换、版本已变、处理器抛出等失败，提案说不预设这些码。本 Task 给它们定码，提案追加决策记录，记入[待确认清单](../../pending-confirmations.md)。
- 代码在 t33 合入 master 之后开 worktree。

## 下一步

1. 设计审查（Claude Sonnet，阻塞），处理后改计划。
2. master 上写两份 Spec 的 planned 条目。
3. t33 合入后开 worktree，按计划四片实施。
