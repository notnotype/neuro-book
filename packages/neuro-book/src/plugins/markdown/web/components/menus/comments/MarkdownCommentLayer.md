---
验证入口: EditorGroup
标签: [state:local, env:global]
---

# MarkdownCommentLayer

批注的浮层与“写”的状态机（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 28–32、34、35）。挂在 `MarkdownMenus` 里，卡片本身是 `MarkdownCommentCard`，数据操作在 `@notnotype/nb-markdown/editor` 的批注模块。

## 行为

- **何时弹**：光标“进入”一条批注才弹“看”卡片，判断是 `nb-markdown` 的纯函数 `commentEntry`（上一次光标处的批注集合、这一次的、事务有没有改文档、是否组字中）。只看改了文档或选区的事务；程序改的文档（重载、写回回填，不进历史）既不算输入也不算走进来。鼠标点进批注时指针没松开不弹，松开再弹（拖选不弹）。注音与双语卡片、右键菜单开着（`blocked`）、焦点不在正文时不弹。Esc 收起；换文档、变只读收起。
- **锚点**：光标所在行，块批注是块里第一个文字处；加批注时是选区的下沿（同注音卡片）。放不下由 `AnchoredPopover` 翻面。重叠的几条在一张浮层里上下排。
- **写**：加批注（`beginAdd`，选区菜单、右键菜单与 Ctrl+Alt+M）时原选区画成选中（`holdSelection`）；改已有批注（卡片的编辑、光标在批注里按 Ctrl+Alt+M）时正文里标出这条（`markShownComment`）。保存走 `menus.run("comment")` 或控件的 `comment-edit`（按卡片显示时记下的指纹核对），空意见是取消；取消、保存、删除之后焦点回正文，焦点自己去了别处（`dismiss`）不抢回。写着改已有批注时它按指纹找不到了（正文被程序换掉）就收起。
- **当前批注**：自己记着（跳转、点摘要写入），不从光标反推：两条批注紧挨或同起点、光标没动时，“下一条”照样换。
- 数据（列表、光标处的批注）每个事务现算，不缓存。

`state:local`：卡片是否开着、“写”的目标与进入次数、当前批注、焦点与指针。`env:global`：`window` 上的 `pointerup`、`pointercancel`，编辑器 DOM 上的 `keydown`，卸载时摘掉。
