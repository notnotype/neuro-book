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

- t04、t05 在分支 `feat/w00025-editor` 上完成，2026-11-10 合入 master（快进到 `de519d6f9`），worktree 与分支已删；不 push。t13 已做完（见下）。
- 照推荐先做、等追认的决定：[待确认清单](pending-confirmations.md)。
- 2026-11-10 开发者试用 t04、t05 后提了选区菜单、注音、菜单动效与源码编辑器底色的问题，建 [t20](tasks/t20-selection-menu-polish/README.md)：要看外观的三项出静态稿评审，其余直接修。开发者在场，这一段不按 autonomous-delivery 推进。2026-11-11 两段都做完、审查处理完，合入 master（`ad53fd721`）。取证时发现的“含注音的行里 End 到不了行尾”另建 [t21](tasks/t21-end-key-after-ruby/README.md)，同日修好合入（`df63a2cbe`）。
- 2026-11-11 开发者说“做 t13”：写了 Spec（`workbench/markdown-editing.md` 输出 28–35）与计划，计划与实现各过一轮 Sonnet 审查，同日实现完成合入 master（`7f4433e2d`，不 push）：批注的浮层、写意见的卡片、页边与标签条上的开关。见 [t13](tasks/t13-comments-ui/README.md)。
- 2026-11-12 开发者试用 t13 后提了批注界面的五条反馈（浮层位置、重叠波浪线、点击不该弹卡片、页边样式与动画、块批注样式与入口）和“编辑批注内的文字”的核对，建 [t22](tasks/t22-comments-feedback/README.md)，开发者在场，方案会话里确认。
- 2026-11-12 开发者试用 t22 后提了第二轮反馈：悬停弹卡片改成 Ctrl 悬停与小符号、页边按段排槽位（同段多条切换、展开浮着），建 [t23](tasks/t23-comments-margin-by-block/README.md)，开发者在场，方案会话里确认（“可以”）。
- 2026-11-18 开发者提出 Markdown 正文字体设置与编辑器里的 Ctrl+滚轮调字号，建 [t27](tasks/t27-editor-font-size/README.md)（由 w00046 的桌面试用中问到字号设置引出）；同日完成并合入 master（b611b2ca4）：Markdown 正文字体、字号、行距设置，桌面里编辑器上的 Ctrl+滚轮改字号，界面缩放不再受滚轮影响。
- t02 到 t19 的状态以各 Task README 与 `nbdev status --work w00025` 为准；t19 已撤销，由 [w00041](../w00041-themes-and-backgrounds/README.md) 重做。

