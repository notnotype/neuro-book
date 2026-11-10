---
schema: nbook.task/v2
taskId: t04-autosave
status: active
updated: 2026-11-10
---

# 自动保存

## 目标与范围

自动保存做成设置项，模式参照 VS Code：关闭、停手若干毫秒后、失焦时、窗口失焦时。默认“失焦时保存”（开发者 2026-10-15 同意）。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改“不承诺”里的自动保存）。

实施计划：[plan.md](plan.md)。

## 当前状态

2026-11-10 开工（开发者用 autonomous-delivery 指定先做 t04、t05）。执行位置：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`（从 master `25451818c` 拉出）。计划已写，正在做计划审查（fable 子代理，开发者指定本会话不用 omp）。

照推荐先做、等开发者追认的决定记在 [待确认清单](../../pending-confirmations.md)。

## 下一步

处理计划审查的结论，再按计划的切片实施。
