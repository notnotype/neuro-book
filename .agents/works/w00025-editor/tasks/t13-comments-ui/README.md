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
4. （2026-11-10，`r2` 的 `q4-coexist`）浮层与页边并存用 A：标签条上一个“批注 N”的页边开关，缺省关；关着时光标进批注出浮层；开着时意见排在页边，编辑组窄得放不下页边时退回浮层；开关按作品记住。第 1 轮的 `q3-overview` 被这一条取代（页边打开时就是总览）。
5. （2026-11-10，`r2` 的 `q5-look`，选项填的是“保持第 1 轮”，留言为准）“就用浮层和页边这两个卡片的，让它可编辑就行。不要第一轮的那个输入框边框。”即：写意见不另起一个输入框，就在查看用的那张卡片（浮层卡片、页边卡片）里原地编辑，卡片外观不变，没有输入框的边框与灰底；第 2 轮的便签（批注色淡底）与页边批语两种样子都不用。

## 当前状态

2026-11-10 设计评审两轮结束（[`artifacts/review/`](artifacts/review/index.html) v2），决定见上面 1–5。2026-11-11 开发者说“做 t13”，写了 Spec 与[计划](plan.md)，开发者看过后回“可以”，提交（`4d0873fe2`）。随后计划设计审查（Sonnet 子代理，[报告](evidences/design-review-1-sonnet.txt)、[处理](evidences/design-review-1-disposition.txt)：15 条，阻断 1、重要 10、建议 4，都按成立处理，只有键盘删除保持开发者已确认的“不做”），Spec 与计划按审查改成第二稿；有两处与开发者回“可以”时所见不同（页边开关改存本机记录、窗口失焦不丢意见），写在[待确认清单](../../pending-confirmations.md)并向开发者汇报。草稿 worktree `.worktree/w00025-t13-drafts`（分支 `w00025-t13/drafts`，不合并）只作样子的参照。代码在 worktree `.worktree/w00025-t13-comments-ui`（分支 `feat/w00025-t13-comments-ui`），按计划的五个切片实施。

## 进展

分支 `feat/w00025-t13-comments-ui`（worktree `.worktree/w00025-t13-comments-ui`），按计划的五个切片实施，六个提交（`e298dc5b6`、`bd53afc16`、`d992fa3e0`、`40bf3af72`、`41818080d`、`bd6e0e064`）：

- S1：`nb-markdown` 的批注数据操作（列出、按指纹找、改意见、去掉、跳转、标出）与浮层“进入”判断，20 条用例加 5 条纯函数用例，变异检查让相应用例失败（按类型删、不保序、不核指纹、数值比较）。写计划时担心的“保存后立刻打字并进撤销步”实测不会发生，计划里的 `closeHistory` 去掉了。
- S2：`comment` 动作与命令（Ctrl+Alt+M 的键位匹配在 `editor/web/key-event.ts`），改意见与删除是控件内部动作，不是命令。
- S3：nb-ui `Textarea` 加 `bare` 与自动长高；批注卡片、浮层与“写”的状态机；选区菜单的“批注”按钮、右键的“添加批注”；`MarkdownControl.dom.test.ts` 里 10 条行为用例（变异检查：进入判断、当前批注、打字收起各让一条失败）。
- S4：页边（`MarkdownCommentMargin`）、开关的本机记录 `editor.comment-margin`、命令 `nbook.editor.toggle-comment-margin`、公开键 `hasComments`/`commentMargin`、标签条上图标加数字的按钮（共享的 `TitleActions.vue`，宽度预算 `titleModelFor`）、控件句柄的 `comments.count`、稿纸让位与场景图隐藏；页边的 5 条行为用例（宽度迟滞、点摘要、待写卡片等，变异检查三处）。
- S5：`e2e/markdown-comments.e2e.ts` 11 例（真实键盘、鼠标、CDP 输入法、页边位置与宽度变化、只读），Lab 的 `EditorGroup/comments`、`comments-margin` 两个场景；UI 取证四种主题组合（[`evidences/ui-check.txt`](evidences/ui-check.txt)）与 200 条批注的性能（[`evidences/perf-margin.txt`](evidences/perf-margin.txt)：按键到下一帧中位数不变，p90 多约 16ms）。实机 e2e 发现只读正文拿不到焦点，批注层改按浏览器选区判断（计划第 9 节）。
- 窗口失焦不收起卡片只有组件测试（替换 `document.hasFocus`）；无头 Chrome 里没法造真实的窗口失焦，列为未验证，要看请在有头浏览器里切一下窗口。

## 下一步

收口验证（`markdown-comments`、`markdown-editing`、`editor-area` 三个 e2e 文件）通过后，派 Sonnet 子代理做实现审查，处理完合入 master。
