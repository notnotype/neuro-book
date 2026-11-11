---
验证入口: EditorGroup
标签: [state:local, env:global]
---

# MarkdownCommentMargin

批注页边（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 33）：稿纸右边按段落顶边排的一列卡片。由 `MarkdownCommentLayer` 在页边画出来时 Teleport 到滚动容器里，所以与稿纸同在一个滚动上下文：绝对定位、随正文滚，不另算滚动偏移。卡片是 `MarkdownCommentCard`，页边只管摆。

## 布局

- 每张卡片的 `top` 取这条批注第一行的 `coordsAtPos`（相对滚动容器的内容）；批注在折叠的提示块里时内容没有盒子、`coordsAtPos` 给全 0，退回它最近的有盒子的祖先，也就是提示块自己的顶边。按文档顺序往下排，靠得太近的往下让（卡片间最小间距 6px），不互相盖住。待写的新批注（`info` 为 null）按选区起点排进去。
- 横向：页边的左边在稿纸右边缘外一个空（16px），宽 264px（`margin-layout.ts`）；稿纸让出的宽度由 `MarkdownControl` 给滚动容器加右内边距。
- 当前的一条（`view`、`write`）用浮层的底与阴影，其余（`compact`）是批注色边的淡底摘要，最多两行。

## 重排

一帧里多个触发合成一次量（`requestAnimationFrame`）：条目或事务变了、滚动容器与稿纸的尺寸变了（窗口变宽使段落重新折行而总高度不变时靠宽度）、任何一张卡片的高度变了（换了模式、意见变长）、字体加载完。只在页边画出来时才有这个组件，所以不画时不量。`top` 变化有一个很短的过渡，`prefers-reduced-motion` 下没有。

## 数据

```ts
interface MarginItem {key: string; info: CommentInfo | null /* null 是待写 */; mode: "view" | "write" | "compact"; anchor: number /* 顶边对着的文档位置 */}

type MarkdownCommentMarginProps = {editor: Editor; scroller: HTMLElement; items: ReadonlyArray<MarginItem>; total: number; readonly: boolean; labels: CommentCardLabels; session: number; version: number};
```

事件是卡片事件的转发（带上卡片对应的批注）：`edit`、`remove`、`previous`、`next`、`select`、`submit`、`cancel`、`dismiss`。`expose` 一个 `layout()`：立刻排一次。

`state:local`：每张卡片的 `top` 与页边的左边。`env:global`：`ResizeObserver`（滚动容器、稿纸、每张卡片）、`document.fonts` 的 `loadingdone`，卸载时摘掉。
