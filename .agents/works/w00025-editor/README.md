---
schema: nbook.work/v1
workId: w00025-editor
issueId: null
status: active
updated: 2026-11-10
---

# 编辑器

## 目标

在已实现的编辑器区（workbench.editor）之上，与开发者定下下一阶段的编辑器需求，再按评审与计划实施

## 集成分支

t02 之后的 Task 叠在一条线上：t03 从 t02 的分支 `feat/w00025-t02-editor-types` 拉出，之后的 Task 依次从线上最后一个拉出；打磨完一次性合入 master（开发者 2026-10-15 定）。t03 之后先做 t06 Markdown 打磨（开发者 2026-10-15 定），t04 自动保存、t05 Monaco 打磨随后。

2026-10-16 开发者授权先把 t02、t03、t06 合入 master（合并提交 `c948c588a`）；t04、t05 以后从 master 拉分支。

## 2026-11-10 起的推进

开发者 2026-11-10 用 autonomous-delivery 指定：先做 [t04 自动保存](tasks/t04-autosave/README.md)、[t05 Monaco 打磨](tasks/t05-monaco-polish/README.md)，[t13 批注界面](tasks/t13-comments-ui/README.md) 先出设计稿；本会话的审查不用 omp，改派 fable 子代理。

- t04、t05 在分支 `feat/w00025-editor` 上完成，2026-11-10 合入 master（快进到 `de519d6f9`），worktree 与分支已删；不 push。t13 两轮设计评审已定，下一步写 Spec 与计划。
- 照推荐先做、等追认的决定：[待确认清单](pending-confirmations.md)。
- t02 到 t19 的状态以各 Task README 与 `nbdev status --work w00025` 为准；t19 已撤销，由 [w00041](../w00041-themes-and-backgrounds/README.md) 重做。

