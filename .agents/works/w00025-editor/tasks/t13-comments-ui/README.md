---
schema: nbook.task/v2
taskId: t13-comments-ui
status: done
updated: 2026-11-11
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

**已完成，2026-11-11 合入 master**（分支 `feat/w00025-t13-comments-ui` 的 `37df6f3ed`，合并 master 后快进到 `7f4433e2d`，不 push；worktree 与分支已删）。Spec 输出 28–35 与验收 11–17 实现；两轮 Sonnet 审查（计划 15 条、实现 14 条，[处理记录](evidences/design-review-1-disposition.txt)、[实现审查处理](evidences/impl-review-1-disposition.txt)）都已处理。

- **在哪里体验**：Component Lab 的 `EditorGroup`：场景“批注：光标进批注出浮层，Ctrl+Alt+M 加批注”与“批注：页边开着（视口够宽时画在稿纸右边）”；产品里在编辑 Markdown 时，标签条右侧的批注开关（鼠标移到编辑区上才显示）。
- **操作**：选中文字后 Ctrl+Alt+M、选区菜单的“批注”或右键“添加批注”；光标进批注出卡片（上一条、下一条、编辑、删除）；标签条的开关打开页边。
- 验证：见下“进展”；收口时 `markdown-comments`（11 例）、`markdown-editing`、`editor-area` 三个 e2e 文件，改完审查后又重跑了 `markdown-comments` 与 `markdown-editing`（55 例）全过。
- **要开发者定**：见[待确认清单](../../pending-confirmations.md) t13 的各行；其中“重叠在同一段上的批注，保存并重新打开后先后可能互换”是编解码器既有的行为，要不要改编解码器（读入时里层编号靠前、写出时第一个标记当外层，改一边即可）请定。

## 进展

分支 `feat/w00025-t13-comments-ui`（worktree `.worktree/w00025-t13-comments-ui`），按计划的五个切片实施，六个提交（`e298dc5b6`、`bd53afc16`、`d992fa3e0`、`40bf3af72`、`41818080d`、`bd6e0e064`）：

- S1：`nb-markdown` 的批注数据操作（列出、按指纹找、改意见、去掉、跳转、标出）与浮层“进入”判断，20 条用例加 5 条纯函数用例，变异检查让相应用例失败（按类型删、不保序、不核指纹、数值比较）。写计划时担心的“保存后立刻打字并进撤销步”实测不会发生，计划里的 `closeHistory` 去掉了。
- S2：`comment` 动作与命令（Ctrl+Alt+M 的键位匹配在 `editor/web/key-event.ts`），改意见与删除是控件内部动作，不是命令。
- S3：nb-ui `Textarea` 加 `bare` 与自动长高；批注卡片、浮层与“写”的状态机；选区菜单的“批注”按钮、右键的“添加批注”；`MarkdownControl.dom.test.ts` 里 10 条行为用例（变异检查：进入判断、当前批注、打字收起各让一条失败）。
- S4：页边（`MarkdownCommentMargin`）、开关的本机记录 `editor.comment-margin`、命令 `nbook.editor.toggle-comment-margin`、公开键 `hasComments`/`commentMargin`、标签条上图标加数字的按钮（共享的 `TitleActions.vue`，宽度预算 `titleModelFor`）、控件句柄的 `comments.count`、稿纸让位与场景图隐藏；页边的 5 条行为用例（宽度迟滞、点摘要、待写卡片等，变异检查三处）。
- S5：`e2e/markdown-comments.e2e.ts` 11 例（真实键盘、鼠标、CDP 输入法、页边位置与宽度变化、只读），Lab 的 `EditorGroup/comments`、`comments-margin` 两个场景；UI 取证四种主题组合（[`evidences/ui-check.txt`](evidences/ui-check.txt)）与 200 条批注的性能（[`evidences/perf-margin.txt`](evidences/perf-margin.txt)：按键到下一帧中位数不变，p90 多约 16ms）。实机 e2e 发现只读正文拿不到焦点，批注层改按浏览器选区判断（计划第 9 节）。
- 窗口失焦不收起卡片只有组件测试（替换 `document.hasFocus`）；无头 Chrome 里没法造真实的窗口失焦，列为未验证，要看请在有头浏览器里切一下窗口。

- 实现审查后的修正：批注层换文档时重排并重记“进入”；页边按序号加指纹判断展开与写；删块批注后光标平移；草稿在浮层与页边之间不丢；只读 Esc；页边没有过渡、排完前藏着；`Textarea` 的行高 normal、边框、观察器；`Textarea` 的 Lab 场景；页边排布、开关记录、批注层单独挂载的用例。

## 下一步

无。开发者体验后如有意见另建 Task。
