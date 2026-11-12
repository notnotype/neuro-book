---
验证入口: EditorGroup
标签: [state:local, env:global, env:timer]
---

# MarkdownCommentMargin

批注页边（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 33）：稿纸右边按段落顶边排的一列卡片。由 `MarkdownCommentLayer` 在页边画出来时 Teleport 到滚动容器里，所以与稿纸同在一个滚动上下文：绝对定位、随正文滚，不另算滚动偏移。卡片是 `MarkdownCommentCard`，页边只管摆。

## 布局

- 每张卡片的 `top` 取这条批注第一行的 `coordsAtPos`（相对滚动容器的内容）；批注在折叠的提示块里时内容没有盒子、`coordsAtPos` 给全 0，退回它最近的有盒子的祖先，也就是提示块自己的顶边。按文档顺序往下排，靠得太近的往下让（卡片间最小间距 6px），不互相盖住。待写的新批注（`info` 为 null）按选区起点（整块批注按块的位置）排进去。
- 横向：页边的左边在稿纸右边缘外一个空（16px），宽 264px（`margin-layout.ts`）；稿纸让出的宽度由 `MarkdownControl` 给滚动容器加右内边距。
- 卡片是同一个版式（`MarkdownCommentCard` 的 `variant="margin"`）：当前的一条（`current`、`write`）用浮层的底、描边与阴影，其余（`idle`）是淡底；两种都带一圈同宽的透明或实色描边，所以切换时外框不变。没有左边框一类的侧边色条。

## 动画

只消费动效令牌（减少动态效果时为 0）：卡片首次排好位置之前不显示、也不过渡（透明且不接收指针，位置先落下，下一帧才显示；不用 `visibility: hidden`，隐藏的元素拿不到焦点，待写的卡片一出来就要把焦点给输入框），所以换文档、第一次打开时不从顶上滑下来；显示时一次入场（透明度加向左约 8px 的位移，`--motion-move`）；已显示的卡片 `top` 变了（别的卡片增减、意见变长）滑到新位置（`--motion-move`）；当前与非当前之间底色、描边、阴影与按钮渐变（`--motion-fast`）；卡片移除时淡出（`--motion-fast`，绝对定位不挤别的）；整个页边移除时淡出。稿纸在 `padding-inline-end` 的过渡里平移时，页边每帧重排，卡片跟着稿纸走（`transitionrun`、`transitionend` 之间）。

## 重排

一帧里多个触发合成一次量（`requestAnimationFrame`）：条目或事务变了、滚动容器与稿纸的尺寸变了（窗口变宽使段落重新折行而总高度不变时靠宽度）、任何一张卡片的高度变了（换了模式、意见变长）、字体加载完、稿纸在过渡中。只在页边画出来时才有这个组件，所以不画时不量。换文档之后到第一次重算之前，条目里的位置可能超出新文档：取位置时夹在文档里，不抛错。

## 数据

```ts
interface MarginItem {key: string; info: CommentInfo | null /* null 是待写 */; mode: "current" | "write" | "idle"; anchor: number /* 顶边对着的文档位置 */}

type MarkdownCommentMarginProps = {editor: Editor; scroller: HTMLElement; items: ReadonlyArray<MarginItem>; total: number; readonly: boolean; labels: CommentCardLabels; session: number; version: number; draft: string | null /* 写着的字，宿主存 */};
```

事件是卡片事件的转发（带上卡片对应的批注）：`edit`、`remove`、`previous`、`next`、`select`、`submit`、`cancel`、`dismiss`。`expose` 一个 `layout()`：立刻排一次。

## 不支持

非当前的卡片是鼠标可点的，键盘够不到；键盘用户用上一条、下一条（Spec 输出 28：键盘只管添加与修改意见）。长意见在当前卡片里放开时高度变化瞬间完成，后面的卡片滑开，没有高度动画。

`state:local`：每张卡片的 `top` 与是否已显示、页边的左边。`env:global`：`ResizeObserver`（滚动容器、稿纸、每张卡片）、`document.fonts` 的 `loadingdone`、滚动容器上的 `transitionrun`、`transitionend`、`transitioncancel`，卸载时摘掉。
