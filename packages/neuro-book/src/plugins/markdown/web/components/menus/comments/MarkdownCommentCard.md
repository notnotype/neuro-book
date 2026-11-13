---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownCommentCard

一条批注的卡片（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 29、33）：浮层里的卡片与页边里的卡片是同一个组件，只管显示与发事件，摆在哪里、什么时候出由 `MarkdownCommentLayer` 与页边决定。有“看”“写”两种状态，写意见不另起输入框：同一张卡片里意见处原地变成多行输入（nb-ui `Textarea` 的 `bare` 与自动长高），字体、字号、行距与“看”一样，点“编辑”时文字不重排。

**状态之间外框与版式不变**（[`ui-development-spec.md`](../../../../../../../../../packages/nb-ui/docs/ui-development-spec.md) 第 3 节第 4 条）：浮层里的卡片是意见区加一个固定高度的底行，底行的零件在不同状态下只换内容或显隐，占位不变。页边里的卡片没有底行（一段可能只有一行高，放不下）：按钮浮在卡片右上角，位置在意见第一行里一直留着（文字绕开，按钮显现时不压字、文字也不重排），只是显隐；卡片的高度由页边定（见 `MarkdownCommentMargin`），卡片自己只管意见的行数与里面的零件。浮层与页边里的区别是 `variant`。

## 交互

- **看**：意见全文（保留换行；意见为空时是一行灰字）。`variant="float"`（浮层）：下面一行（底行，固定高度），左边是“第 i 条，共 n 条”，右边是上一条、下一条（到头置灰）、编辑、删除，只读时没有编辑与删除；意见区最高约 12 行再滚动。`variant="margin"`（页边）：没有底行与计数；右上角一组浮着的控件：有 `pager`（同一段有几条批注）时常显 `‹ 1/3 ›`；编辑、删除只在 `current`、指针停在卡片上或焦点在里面时显现（`visibility` 加透明度）。两组控件的位置（按它们的总宽，只读又只有一条时没有）在意见区开头用一个浮动的占位留着，第一行文字绕开，所以按钮从不盖住文字；意见区的行数由宿主给的 CSS 变量 `--markdown-comment-lines` 限（省略号在最后一行末尾），`expanded` 时放开到约 12 行再滚动；点不是 `expanded` 的卡片（不含按钮）发 `select`。
- **写**：进入时预填 `body`（新批注为空），光标在末尾；`session` 变了（已经在写时换到另一条）也重新预填。Ctrl+Enter（macOS 上 ⌘Enter）或点保存：去掉首尾空白后为空发 `cancel`（空意见是取消，不是删除），否则发 `submit`；Esc 或点取消发 `cancel`；回车换行；输入法组字时的回车与 Esc 归输入法。
- **焦点**：点卡片的任何地方（按钮、空白）都不夺走焦点，输入控件除外（浮层里 `AnchoredPopover` 已做，页边里没有，所以写在卡片里）。写的时候焦点移到卡片外的别处发 `dismiss`；窗口失去焦点（切走窗口、点开发者工具）不算离开，回来时输入还在；焦点去了另一张批注卡片（页边与浮层互相切换时，退场动画里的旧卡片还在、新卡片已经抢了焦点）、卡片自己被摘掉时浏览器补发的 `focusout` 也不算。
- 每个出口之后焦点回正文由宿主做（卡片不认识编辑器）。
- 页边里点卡片上的按钮只发按钮自己的事件，不发 `select`。页边里 `previous`、`next` 是同一段里切换（`pager` 的两个箭头），不是整份文档的上一条、下一条。

## 数据

```ts
interface CommentCardLabels {empty: string; counter: (index: number, total: number) => string /* 序号从 1 起 */; previous: string; next: string; edit: string; remove: string; save: string; cancel: string; body: string}

type MarkdownCommentCardProps = {
    body: string;
    index: number;   // 从 0 起
    total: number;
    mode: "view" | "write";
    readonly: boolean;
    /** 浮层或页边里的卡片，缺省浮层。 */
    variant?: "float" | "margin";
    /** 页边里这条是当前批注（光标所在的、写着的）：编辑、删除按钮显现。 */
    current?: boolean;
    /** 页边里这张卡片展开了（点了卡片或在写）：意见放开行数，点卡片空白不再发 `select`。 */
    expanded?: boolean;
    /** 页边里同一段有几条批注时给：右上角 `‹ index+1/count ›`（`index` 从 0 起），箭头发 `previous`、`next`，到头置灰。 */
    pager?: {index: number; count: number};
    labels: CommentCardLabels;
    session: number;
    /** 写着的字由宿主存：为 null 是这次“写”还没有字，按 `body` 预填；有字就用它。 */
    draft?: string | null;
};

type MarkdownCommentCardEmits = {
    (event: "edit"): void;
    (event: "remove"): void;
    (event: "previous"): void;
    (event: "next"): void;
    (event: "select"): void;
    (event: "submit", text: string): void;
    (event: "update:draft", text: string): void;
    (event: "cancel"): void;
    (event: "dismiss"): void;
};
```

没有插槽与 expose。

`state:local`：写着的文字，每次进入“写”换成 `body`。
