---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownTextPrompt

注音、双语要一段文字时的一行卡片（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 9）：贴在选区下方，文字直接写在卡片里（nb-ui `Input` 的 `bare`，没有输入框的框），右边是确定；给了 `removeLabel` 时确定前面多一个移除按钮。没有说明文字，输入的可访问名称是 `label`。

## 交互

- 打开时把 `initial` 放进去（没有就空着），光标放在末尾、聚焦；开着时 `initial` 变了也重来一遍。
- 回车（输入法组字时不算）与点确定：去掉首尾空白后为空时是取消，否则确定。清空了再回车也是取消，不是移除：移除只经移除按钮。
- Esc 取消；焦点离开卡片时收起（`dismiss`），焦点去哪里由用户定，不抢回。点卡片里的按钮不算离开。
- 卡片开着时正文的选区仍画着高亮，由宿主（`MarkdownMenus`）负责。

## 数据

```ts
type MarkdownTextPromptProps = {
    open: boolean;
    anchor: PopoverAnchor | null;
    /** 输入的可访问名称。 */
    label: string;
    /** 确定按钮的名称。 */
    confirmLabel: string;
    /** 打开时放进去的文字；默认空。 */
    initial?: string;
    /** 给了才有移除按钮，也是它的名称。 */
    removeLabel?: string;
};

type MarkdownTextPromptEmits = {
    (event: "submit", text: string): void;
    (event: "cancel"): void;
    (event: "dismiss"): void;
    (event: "remove"): void;
};
```

没有插槽与 expose。

`state:local`：写着的文字，每次打开换成 `initial`。
