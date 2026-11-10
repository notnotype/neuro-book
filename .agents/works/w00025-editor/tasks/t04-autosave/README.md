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

2026-11-10 开工（开发者用 autonomous-delivery 指定先做 t04、t05）。执行位置：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`（从 master `25451818c` 拉出）。

- **计划审查**（2026-11-10）：独立审查，一个 fable 子代理（开发者指定本会话不用 omp）。12 条：阻断 0、重要 5、建议 7，全部成立；10 条改进计划（第二稿），第 6 条里的两项与第 9、12 条里的几项接受取舍、进待确认清单。报告 [`evidences/design-review-fable.txt`](evidences/design-review-fable.txt)，逐条处理 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。主要改动：停手后的定时不在输入法组字途中强制结算；条件恢复后补存；失败闸不借用 `saveProblem`；换下活动标签算一次离开、源码编辑器的查找框不算；磁盘已变化时不自动保存；窗口失焦排除同页 iframe。
- 照推荐先做、等开发者追认的决定记在 [待确认清单](../../pending-confirmations.md)（t04 八行）。

## 下一步

按计划第二稿的四个切片实施。
