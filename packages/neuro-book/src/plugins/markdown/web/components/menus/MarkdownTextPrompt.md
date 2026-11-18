---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownTextPrompt

注音、双语、链接要一段文字时的一行卡片（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 9）：贴在选区下方，文字直接写在卡片里（nb-ui `Input` 的 `bare`，没有输入框的框），右边是确定；给了 `removeLabel` 时确定前面多一个移除按钮（图标缺省是垃圾桶，`removeIcon` 可换，去掉链接用断开的链环）。没有说明文字，输入的可访问名称是 `label`。

## 交互

- 打开时把 `initial` 放进去（没有就空着），光标放在末尾、聚焦；开着时 `session` 变了（宿主换到另一段）也重来一遍，`initial` 与上一次相同也一样。
- 输入框里回车与点确定：去掉首尾空白后为空时是取消，否则确定。清空了再回车也是取消，不是移除：移除只经移除按钮。焦点在卡片的按钮上时，回车是那个按钮的动作。
- Esc 取消。输入法组字时的回车与 Esc 归输入法，卡片不处理。焦点离开卡片时收起（`dismiss`），焦点去哪里由用户定，不抢回。点卡片里的按钮不算离开。
- 卡片开着时正文的选区仍画着高亮，由宿主（`MarkdownMenus`）负责。
- `wide`（链接地址）：卡片宽到放得下一个网址，窄屏夹在窗口内（`min(26rem, 100vw - 32px)`）。
- `accepts`：这段文字不能确认时（链接地址的方案检查，`javascript:` 等）确认按钮置灰、输入框标出错误、回车不提交；空文字不看它（空的是取消）。
- `locked`：输入框与确认都不能用，只剩移除（碰到的几条链接地址不同，输出 52）；焦点进移除按钮，Esc 仍取消。

## 数据

```ts
type MarkdownTextPromptProps = {
    open: boolean;
    /** 宿主每打开一次就加一（开着时换到另一段也算）：变了就重新预填。 */
    session: number;
    anchor: PopoverAnchor | null;
    /** 输入的可访问名称。 */
    label: string;
    /** 确定按钮的名称。 */
    confirmLabel: string;
    /** 打开时放进去的文字；默认空。 */
    initial?: string;
    /** 给了才有移除按钮，也是它的名称。 */
    removeLabel?: string;
    /** 移除按钮的图标；缺省是垃圾桶。 */
    removeIcon?: string;
    /** 宽卡片（链接地址）。 */
    wide?: boolean;
    /** 输入框与确认都不能用，只剩移除。 */
    locked?: boolean;
    /** 这段文字（去掉首尾空白后）能不能确认。 */
    accepts?: (text: string) => boolean;
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
