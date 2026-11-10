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

2026-11-10 开始设计评审（开发者用 autonomous-delivery 指定“先出设计稿”），停在等开发者答复第 1 轮，未写计划、未改产品代码。

- 评审板：[`artifacts/review/`](artifacts/review/index.html) v1，三道题：注意力排序（`q1-attention`）、意见显示在哪里（`q2-where`：浮层、页边、侧栏，推荐浮层）、总览做到哪一步（`q3-overview`，推荐只做逐条跳转）。板上“不单独问、按下面做的”六条（入口、输入、浮层何时出现、块批注、重叠、只读）记在 [待确认清单](../../pending-confirmations.md)。
- 草稿：worktree `.worktree/w00025-t13-drafts`，分支 `w00025-t13/drafts`（不合并、不提交）；静态稿是 `drafts/web/components/comments/CommentsDraft.vue`，Lab 组件 `CommentsDraft`，八个场景。
- 参照：旧应用的批注界面由子代理调研（结论留在本地 `.local/agent/works/w00025-editor/tasks/t13-comments-ui/legacy-research.txt`，要点已写进评审板的“现状与参照”）：选区菜单与右键加批注、弹对话框输入；右侧 360px 评论栏默认关，按住 Ctrl 点批注打开；没有作者、时间、回复与“已解决”。

## 下一步

出第 2 轮静态稿：页边与浮层怎样并存（页边由用户打开、放不下时退回浮层，还是有位置就自动出现）；重画写意见的样子（去掉表单感：不要灰底的输入框与实心蓝按钮）；在这个前提下重新问总览。
