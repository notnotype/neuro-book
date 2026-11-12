---
验证入口: EditorGroup
标签: [state:local, env:global, env:timer]
---

# MarkdownCommentMargin

批注页边（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 33）：稿纸右边按段排的一列槽位，一个槽位一张卡片。由 `MarkdownCommentLayer` 在页边画出来时 Teleport 到滚动容器里，所以与稿纸同在一个滚动上下文：绝对定位、随正文滚，不另算滚动偏移。卡片是 `MarkdownCommentCard`，页边只管摆：槽位放在哪、多高、同一段几条批注怎么切、展开时怎么浮。

## 布局

- **槽位对着一段**：槽位的顶边与这一段（`anchor`，文档里一个文字块、表格的一行或叶子块的起点）的盒子顶边对齐，盒子取 `view.nodeDOM(anchor)`；段在折叠的提示块里时内容没有盒子，退回它最近的有盒子的祖先，也就是提示块自己（标题行）。按文档顺序往下排。
- **高度**（`margin-layout.ts` 的 `slotRange`，纯函数）：不小于这一段的高度，封顶约 8 行意见的高度（长段一句话不拖出一张空卡），也至少放得下一行意见；不高于这一段的高度，下一段没有批注（`nextCommented` 为假）时放宽到两倍段高、但不越过下一段的底边（没有下一段时不受限）；槽位之间留 4px 的空。卡片的实际高度是意见的自然高度夹在这个范围里；意见比放得下的行数长，用 CSS 变量 `--markdown-comment-lines`（由最大高度算出）限行，最后一行末尾省略。行高与卡片上下的内边距、描边读自真实样式，不写死。
- **槽位之间不互相盖住**：每个槽位只含自己这一段（最多加上没有批注的下一段），所以按构造不重叠；一行的短段放一行意见会比这一段稍高，靠“靠得太近的往下让”兜底（间隔 `SLOT_GAP`）。展开的槽位不参与这条排布。
- **展开**（`expanded`：点了卡片，或在写）：槽位自己的位置与高度不变（占位仍是展开之前的高度），卡片面在原地向下长到意见的自然高度（意见区最多约 12 行再滚动），浮在后面的槽位上面（`z-index`：展开的在当前的上面，当前的在其余上面）；别的槽位不动。
- **同一段几条批注**：一个槽位只显示 `active` 那一条，卡片右上角 `‹ 1/3 ›`（`pager`）；箭头发 `select`（目标那条，不展开）；到头置灰。哪一条是 `active` 由宿主定：写着的，否则光标所在的，否则上次看的，否则第一条。
- 横向：页边的左边在稿纸右边缘外一个空（16px），宽 264px（`margin-layout.ts`）；稿纸让出的宽度由 `MarkdownControl` 给滚动容器加右内边距。
- 卡片面的外观：当前的与写着的（`current`、`write`）用浮层的底、描边与阴影，其余（`idle`）是淡底；两种都带一圈同宽的透明或实色描边，所以切换时外框不变。没有左边框一类的侧边色条。

## 动画

只消费动效令牌（减少动态效果时为 0）：槽位首次排好位置之前不显示、也不过渡（透明且不接收指针，位置与高度先落下，下一帧才显示；不用 `visibility: hidden`，隐藏的元素拿不到焦点，待写的卡片一出来就要把焦点给输入框），所以换文档、第一次打开时不从顶上滑下来；显示时一次入场（透明度加向左约 8px 的位移，`--motion-move`）；已显示的槽位 `top` 变了（别的槽位增减、段落高度变）滑到新位置（`--motion-move`），卡片面的高度变了（意见变长、展开与收回）高度过渡（`--motion-move`）；当前与非当前之间底色、描边、阴影与按钮渐变（`--motion-fast`）；同一段里切换条目时直接换文字，没有动画；槽位移除时淡出（`--motion-fast`，绝对定位不挤别的）；整个页边移除时淡出。稿纸在 `padding-inline-end` 的过渡里平移时，页边每帧重排，槽位跟着稿纸走（`transitionrun`、`transitionend` 之间）。

## 重排

一帧里多个触发合成一次量（`requestAnimationFrame`）：槽位或事务变了、滚动容器与稿纸的尺寸变了（窗口变宽使段落重新折行而总高度不变时靠宽度）、任何一张卡片的自然高度变了（换了模式、意见变长、限行数变了）、字体加载完、稿纸在过渡中。限行数依赖段的盒子，卡片的自然高度又依赖限行数，所以第一遍排完卡片的高度可能还要再排一遍；排好两者之后才显示。只在页边画出来时才有这个组件，所以不画时不量。换文档之后到第一次重算之前，槽位里的位置可能超出新文档：取位置时夹在文档里，不抛错。

## 数据

```ts
interface MarginSlot {
    key: string;                          // 槽位身份：这一段的位置经事务映射后沿用的 key
    anchor: number;                       // 这一段的起点位置
    next: number | null;                  // 文档顺序里下一段的起点
    nextCommented: boolean;               // 下一段有没有批注
    infos: ReadonlyArray<CommentInfo>;    // 这一段的批注，按先后；待写的新批注为空
    active: number;                       // 显示 infos 里的哪一条
    mode: "current" | "write" | "idle";
    expanded: boolean;
    pending: boolean;                     // 还不在文档里的新批注（写）
}

type MarkdownCommentMarginProps = {editor: Editor; scroller: HTMLElement; slots: ReadonlyArray<MarginSlot>; total: number; readonly: boolean; labels: CommentCardLabels; session: number; version: number; draft: string | null /* 写着的字，宿主存 */};
```

事件：`edit(info)`、`remove(info)`、`select(info, expand)`（点卡片空白时 `expand` 为真，点同段的箭头为假）、`submit`、`update:draft`、`cancel`、`dismiss`。`expose` 一个 `layout()`：立刻排一次。

## 不支持

非当前的卡片是鼠标可点的，键盘够不到；键盘用户用 Ctrl+Alt+M 改意见、用正文里的批注波浪线与光标（Spec 输出 28：键盘只管添加与修改意见）。同一段里不能同时看两条批注。

`state:local`：每个槽位的位置、高度与限行数、是否已显示、页边的左边。`env:global`：`ResizeObserver`（滚动容器、稿纸、每张卡片）、`document.fonts` 的 `loadingdone`、滚动容器上的 `transitionrun`、`transitionend`、`transitioncancel`，卸载时摘掉。
