---
验证入口: EditorGroup
标签: [state:local, env:global, env:timer]
---

# MarkdownCommentLayer

批注的浮层与“写”的状态机（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 28–32、34、35、38）。挂在 `MarkdownMenus` 里，卡片本身是 `MarkdownCommentCard`，数据操作在 `@notnotype/nb-markdown/editor` 的批注模块。

## 行为

- **何时弹**：三条路，都不需要正文有焦点，只读文档也弹；光标走进批注（点击、方向键）、没按 Ctrl 的悬停与点击都不弹。
  - **按住 Ctrl（⌘ 也行）悬停或点击**：滚动容器上的 `pointermove`，Ctrl 或 ⌘ 按着、目标在 `comment`、`.nb-comment-block` 里就立刻按指针坐标取位置（`posAtCoords`，取不到时用元素的 `posAtDOM`）再 `commentsAtPos` 取批注，没有就不弹；先停在批注上再按下 Ctrl 也弹（文档上的 `keydown`，用最后一次 `pointermove` 的位置）；按住 Ctrl 点击（`click`）同样弹，并把这张卡片记为“点开的”。Ctrl 加按下时在捕获阶段 `preventDefault`，不让 ProseMirror 把这次点击当成“选中整个块”，光标也不动。
  - **点小符号**：批注末尾的小符号（`MarkdownCommentMarkers`，`[data-comment-marker]`）在 `click` 里处理：用 `posAtDOM` 取符号的位置，卡片里是在这里结束的批注（`commentsEndingAt`），点开的；再点同一个符号收起。符号上的 `mousedown` 在捕获阶段 `preventDefault`，不移动光标、不夺焦。
  - **键盘**：光标在批注里按 Ctrl+Alt+M 直接进“写”。
- **关与收**：“点开的”卡片鼠标离开不收；按 Ctrl 悬停出来的卡片指针离开批注文字、又没进卡片 `closeDelay`（约 0.25 秒）后收起，进了卡片取消收起。两种都在正文里按下指针（没按 Ctrl）、改了文档（输入）、选区不空、Esc（`document` 上的 `keydown`，只读文档也一样）、换文档、变只读、开始写时立刻收起，点开的另外在卡片与正文之外按下指针（`document` 上的 `pointerdown`）时收起；收起之后同一次悬停不再弹，指针离开批注文字再回来才重新算。注音与双语卡片、右键菜单开着（`blocked`）、页边画着（`marginDrawn`）、正在写时不弹。
- **位置与对齐**：卡片在指针（点小符号时是符号）所在那一行（`commentLineAnchor`，取这一行的上下沿）的下面，放不下由 `AnchoredPopover` 翻面，`align="start"`：左边缘对齐这条批注的文字在这一行的起点（重叠的几条取最左的）。重叠的几条在一张浮层里上下排。点上一条、下一条：光标与卡片都移到目标批注开头那一行，卡片留着。新批注的“写”在选区下面（`selectionAnchor`），左边缘对齐选区的左边；整块批注的“写”在这一块第一行下面（`blockAnchor`）。
- **写**：加批注（`beginAdd`，选区菜单、右键菜单与 Ctrl+Alt+M）时原选区画成选中（`holdSelection`）；块菜单的“批注”（`beginAddBlock(pos)`，代码块、引用、表格、分割线等）把这一块整个画成选中（`holdBlock`），保存时走 `comment-block`（按块的位置包进块批注，位置上的块已经不是打开时那一块就失败）；改已有批注（卡片的编辑、光标在批注里按 Ctrl+Alt+M）时卡片贴的位置由入口给（悬停卡片上的编辑是悬停处，Ctrl+Alt+M 是光标，页边里的编辑是这条批注的开头），正文里标出这条（`markShownComment`）。保存都经控件句柄同步执行：新批注是 `comment`，加不上（选区折了、所在的块不再允许批注）时留在“写”里、字还在，不关成“已保存”；已有的是 `comment-edit`（按卡片显示时记下的指纹核对），空意见是取消；取消、保存、删除之后焦点回正文，焦点自己去了别处（`dismiss`）不抢回。写着改已有批注时它按指纹找不到了（正文被程序换掉）就收起。写着的字存在这里（`draftText`），卡片在浮层与页边之间换位置时不丢。
- **页边**（`marginDrawn`，`MarkdownControl` 按开关与宽度算出）：画出来时不出浮层，也不画小符号，卡片在 `MarkdownCommentMargin` 里（Teleport 到滚动容器）：按段分组（`territoryOf`、`nextTerritory`），一段一个槽位（`MarginSlot`），同一段的几条批注合用，槽位里显示写着的、光标所在的、上次看的（`activeMemory`，按内容记）、第一条，依次取第一个有的；光标所在的那一条所在的槽位是当前，写着的那条所在的槽位在写；加批注的“写”卡片是一个单独的待写槽位，锚在选区起点（整块批注是块的位置）所在的段。点卡片的空白（`select(info, true)`）：这条成为当前批注、光标移过去（已经在这一条里不挪）、卡片展开（`expanded`）；点同一段里的箭头（`select(info, false)`）只切换。展开与当前一样每个改了文档或选区的事务就清掉，Esc 也收回。正在写别的一条时点卡片先放下那一条（点卡片不夺焦，不会自己发 `dismiss`）。页边的开与关带淡入淡出。槽位的 key 要跨事务稳定（位置过渡与入场都按 key 记）：槽位的身份是这一段的起点位置，前面每打一个字就变，所以层里自己记，位置经每个事务映射后沿用，同一段里增减批注不改 key。
- **当前批注**：自己记着（跳转、点卡片写入），不从光标反推：两条批注紧挨或同起点、光标没动时，“下一条”照样换。判断“是哪一条”按序号加指纹（`matchComment`），两条意见与开头文字都相同的批注不会一起成为当前、一起进入“写”。
- **换文档**：只换编辑状态、不产生事务，所以列表（`tick`）要自己重算。标出的批注装饰在控件存状态时由 `MarkdownControl` 清掉。
- 数据（列表、悬停处与光标处的批注）每个事务现算，不缓存。

`closeDelay` 是属性（缺省 250 毫秒）：测试传小值，不用假计时器。没有打开用的计时器。

`state:local`：卡片开着的位置与是否点开的、“写”的目标与进入次数与写着的字、当前批注、收起用的计时器、指针是否在卡片上、Ctrl 是否按着。`env:global`：`document` 上的 `keydown`、`keyup`、`pointerdown`，编辑器 DOM 上的 `keydown`，滚动容器上的 `pointermove`、`pointerleave`、`pointerdown`、`mousedown`（捕获）、`click`，卸载时摘掉并清掉计时器。
