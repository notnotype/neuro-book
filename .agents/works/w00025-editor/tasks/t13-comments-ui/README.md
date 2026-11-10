---
schema: nbook.task/v2
taskId: t13-comments-ui
status: active
updated: 2026-11-10
---

# 批注界面

## 目标与范围

加批注的输入、批注的查看、编辑与删除（侧栏或编辑框）；菜单入口由 t08 留位置

来源：t06 决定 13（批注界面另起计划）；开发者 2026-10-20 定不在 t08 做，t08 只留菜单入口。批注的格式已在 [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 11。

## 开发者的决定

1. （2026-11-10，`r1` 的 `q1-attention`）注意力排序同意：写作时只有波浪线；要看的那一条才展开；全部批注的总览默认不出现。
2. （2026-11-10，`r1` 的 `q2-where`，选了“浮层”并留言）“浮层和页边都要。同时这个编辑样式有点不太匹配。”即：两种显示都做，不是二选一；静态稿里写意见的那块（输入框与按钮）的样子与界面不协调，要重画。两者怎样并存（页边什么时候出现）还没定，留给第 2 轮。
3. `q3-overview`（总览做到哪一步）没有答。页边本身就是一种总览，这题在第 2 轮按“两种都要”重新问。

## 当前状态

2026-11-10 第 2 轮评审板已发布（[`artifacts/review/`](artifacts/review/index.html) v2），等开发者答复，未写计划、未改产品代码。

- 第 2 轮两题：`q4-coexist`（浮层与页边怎样并存，推荐 A：标签条上一个“批注 N”的页边开关，缺省关，窄时退回浮层，开关按作品记住）；`q5-look`（写意见的样子，推荐 B 便签：批注色淡底上直接写，没有输入框的框与按钮）。第 1 轮的 `q3-overview` 被取代（页边打开时本身就是总览）。
- 草稿：worktree `.worktree/w00025-t13-drafts`，分支 `w00025-t13/drafts`（不合并、不提交）；`CommentsDraft.vue` 加了 `look`、`marginToggle`，新零件 `CommentEditorDraft.vue`，Lab 场景 `r2-*` 七个。
- 第 1 轮“不单独问、按下面做的”六条在 [待确认清单](../../pending-confirmations.md)。

## 下一步

读第 2 轮的答复并记进上面的决定；定了之后写 Spec（`workbench/markdown-editing.md` 的批注一节）与 `plan.md`。
