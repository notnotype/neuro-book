---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownCommentCard

一条批注的卡片（[`workbench/markdown-editing.md`](../../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 29）：光标进批注时浮层里的卡片与页边里的卡片是同一个组件，只管显示与发事件，摆在哪里、什么时候出由 `MarkdownCommentLayer` 与页边决定。有“看”“写”两种状态，写意见不另起输入框：同一张卡片里意见处原地变成多行输入（nb-ui `Textarea` 的 `bare` 与自动长高），字体、字号、行距与“看”一样，点“编辑”时文字不重排。

## 交互

- **看**：意见全文（保留换行，意见区最高约 12 行再滚动；意见为空时是一行灰字）；下面一行，左边是“第 i 条，共 n 条”与上一条、下一条（到头置灰），右边是编辑、删除，只读时没有这两个。`compact` 是页边里没展开的摘要：只有前两行，点它发 `select`。
- **写**：进入时预填 `body`（新批注为空），光标在末尾；`session` 变了（已经在写时换到另一条）也重新预填。Ctrl+Enter（macOS 上 ⌘Enter）或点保存：去掉首尾空白后为空发 `cancel`（空意见是取消，不是删除），否则发 `submit`；Esc 或点取消发 `cancel`；回车换行；输入法组字时的回车与 Esc 归输入法。
- **焦点**：点卡片的任何地方（按钮、空白）都不夺走焦点，输入控件除外（浮层里 `AnchoredPopover` 已做，页边里没有，所以写在卡片里）。写的时候焦点移到卡片外的别处发 `dismiss`；窗口失去焦点（切走窗口、点开发者工具）不算离开，回来时输入还在；焦点去了另一张批注卡片（页边与浮层互相切换时，退场动画里的旧卡片还在、新卡片已经抢了焦点）、卡片自己被摘掉时浏览器补发的 `focusout` 也不算。
- 每个出口之后焦点回正文由宿主做（卡片不认识编辑器）。

## 数据

```ts
interface CommentCardLabels {empty: string; counter: (index: number, total: number) => string /* 序号从 1 起 */; previous: string; next: string; edit: string; remove: string; save: string; cancel: string; body: string}

type MarkdownCommentCardProps = {
    body: string;
    index: number;   // 从 0 起
    total: number;
    mode: "view" | "write";
    readonly: boolean;
    compact?: boolean;
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
