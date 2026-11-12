---
验证入口: EditorGroup
标签: [state:local, env:global, env:timer]
---

# MarkdownCommentLayer

批注的浮层与“写”的状态机（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 28–32、34、35）。挂在 `MarkdownMenus` 里，卡片本身是 `MarkdownCommentCard`，数据操作在 `@notnotype/nb-markdown/editor` 的批注模块。

## 行为

- **何时弹**：鼠标停在批注的文字上约 0.4 秒（`hoverDelay`）弹“看”卡片，不需要正文有焦点，只读文档也弹；光标走进批注（点击、方向键）不弹。只听滚动容器里的 `pointermove`：目标在 `comment`、`.nb-comment-block` 里时起计时，到点按指针坐标取位置（`posAtCoords`，取不到时用元素的 `posAtDOM`）再 `commentsAtPos` 取批注，没有就不弹。指针换到另一条批注上重新计时，旧卡片留到新的弹出来。指针离开批注文字、又没进卡片 `closeDelay`（约 0.25 秒）后收起，进了卡片取消收起。注音与双语卡片、右键菜单开着（`blocked`）、页边画着（`marginDrawn`）、正在写时不弹。
- **收起**：在正文里按下指针、改了文档（输入）、选区不空、Esc（`document` 上的 `keydown`，只读文档也一样）、换文档、变只读、开始写，立刻收起；同一次悬停不再弹，指针离开批注文字再回来才重新计时。
- **位置与对齐**：卡片在指针所在那一行（`commentLineAnchor`，取这一行的上下沿）的下面，放不下由 `AnchoredPopover` 翻面，`align="start"`：左边缘对齐这条批注的文字在这一行的起点（重叠的几条取最左的）。重叠的几条在一张浮层里上下排。点上一条、下一条：光标与卡片都移到目标批注开头那一行，卡片留着。新批注的“写”在选区下面（`selectionAnchor`），左边缘对齐选区的左边；整块批注的“写”在这一块第一行下面（`blockAnchor`）。
- **写**：加批注（`beginAdd`，选区菜单、右键菜单与 Ctrl+Alt+M）时原选区画成选中（`holdSelection`）；块菜单的“批注”（`beginAddBlock(pos)`，代码块、引用、表格、分割线等）把这一块整个画成选中（`holdBlock`），保存时走 `comment-block`（按块的位置包进块批注，位置上的块已经不是打开时那一块就失败）；改已有批注（卡片的编辑、光标在批注里按 Ctrl+Alt+M）时正文里标出这条（`markShownComment`）。保存都经控件句柄同步执行：新批注是 `comment`，加不上（选区折了、所在的块不再允许批注）时留在“写”里、字还在，不关成“已保存”；已有的是 `comment-edit`（按卡片显示时记下的指纹核对），空意见是取消；取消、保存、删除之后焦点回正文，焦点自己去了别处（`dismiss`）不抢回。写着改已有批注时它按指纹找不到了（正文被程序换掉）就收起。写着的字存在这里（`draftText`），卡片在浮层与页边之间换位置时不丢。
- **页边**（`marginDrawn`，`MarkdownControl` 按开关与宽度算出）：画出来时不出浮层，卡片在 `MarkdownCommentMargin` 里（Teleport 到滚动容器）：每条批注一张，光标所在的那条是当前批注，写着的那条在写；加批注的“写”卡片作为一张待写的卡片按选区起点（整块批注按块的位置）排进去。点卡片等于跳到那条。正在写别的一条时点卡片先放下那一条（点卡片不夺焦，不会自己发 `dismiss`）。页边的开与关带淡入淡出。
- **当前批注**：自己记着（跳转、点卡片写入），不从光标反推：两条批注紧挨或同起点、光标没动时，“下一条”照样换。判断“是哪一条”按序号加指纹（`matchComment`），两条意见与开头文字都相同的批注不会一起成为当前、一起进入“写”。
- **换文档**：只换编辑状态、不产生事务，所以列表（`tick`）要自己重算。标出的批注装饰在控件存状态时由 `MarkdownControl` 清掉。
- 数据（列表、悬停处与光标处的批注）每个事务现算，不缓存。

`hoverDelay`、`closeDelay` 是属性（缺省 400、250 毫秒）：测试传小值，不用假计时器。

`state:local`：悬停的批注与卡片是否开着、“写”的目标与进入次数与写着的字、当前批注、两个计时器、指针是否在卡片上。`env:global`：`window` 上的 `pointerup`、`pointercancel`，`document` 上的 `keydown`，编辑器 DOM 上的 `keydown`，滚动容器上的 `pointermove`、`pointerleave`、`pointerdown`，卸载时摘掉并清掉计时器。
