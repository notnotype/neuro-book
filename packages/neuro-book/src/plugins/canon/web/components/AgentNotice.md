---
标签: [state:inject]
别名: ["Agent 提示", "Agent Notice"]
---

# AgentNotice

Agent 改了设定的提示（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 的 Agent 提示）：页面顶上的一行，写“Agent 改了设定：最近一次的标题”，之前还改过几次时写出次数；带“看回执”“撤销”“看改动记录”与关闭。它和保存后的提示（`NoticeBar`）各占一行、互不顶掉：作者自己刚保存的那条“撤销”不会因为 Agent 又写了一次而不见。受控：点了什么发出什么，提示的去留由宿主定。

## 布局与交互

一行：机器人图标、文字（单行截断）、三个按钮、关闭。宽度不够时按钮换到下一行。“看回执”“撤销”指最近一次修订；“看改动记录”打开改动记录视图，作者在那里按写入者筛 Agent。最近一次已经被还原时（`undone`），“撤销”写“已撤销”、不再响应（`aria-disabled`）：还原对话框关闭时焦点回到这个按钮，所以不换成别的元素、也不用 `disabled`。

## 数据

```ts
type AgentNoticeProps = {
    title: string;
    /** 之前（这条提示还没关时）Agent 又改过几次，不算最近这次。缺省 0。 */
    earlier?: number;
    /** 最近一次已经被还原。缺省 false。 */
    undone?: boolean;
};

type AgentNoticeEmits = {
    (event: "receipt"): void;
    (event: "undo"): void;
    (event: "revisions"): void;
    (event: "close"): void;
};
```

没有插槽与 expose；attrs 落在根上。

## 隐藏通道理由

`state:inject`：经 canon 的翻译端口取文字。
