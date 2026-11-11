---
标签: [state:inject]
别名: ["保存后的提示", "Notice Bar"]
---

# NoticeBar

保存后的提示（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 18、30）：页面顶上的一行，写这次修订的标题，后面是“看回执”“撤销”与关闭。受控：显示哪一条由宿主（窗口里一份 `notices.ts`）决定。

## 布局与交互

一行：成功色的勾、标题（过长截断）、“看回执”、“撤销”、关闭（只有图标的按钮，可读名“关闭”）。`role="status"`。

- “看回执”：发 `receipt`；“撤销”：发 `undo`（宿主打开还原的对话框并收起提示）；关闭：发 `close`。

## 数据

```ts
type NoticeBarProps = {title: string};
type NoticeBarEmits = {
    (event: "receipt"): void;
    (event: "undo"): void;
    (event: "close"): void;
};
```

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
