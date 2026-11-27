---
标签: [state:inject]
别名: ["强行解除", "Force Release"]
---

# BreakExclusiveDialog

待处理视图里“强行解除”的二次确认（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 22、23、29）：别的调用方持有独占写入、作者要强行解除时，写明是谁在写、解除以后它的下一次写入会失败。受控：开着没有、是否正在解除、失败的原因都由宿主给（`PendingViewHost`）；结果回来之前宿主让 `saving` 为真，对话框不关、按钮不可用。

## 布局与交互

- nb-ui `Dialog`（`md`）：标题“强行解除“谁”的独占写入？”，正文一句后果；失败时下面一行原因（`role="alert"`）。
- 底部“取消”与“强行解除”；“强行解除”发 `confirm`。`saving` 时两个按钮都不可用，按 Esc、点遮罩不关。

## 数据

```ts
type BreakExclusiveDialogProps = {
    open: boolean;
    /** 持有者申请独占时给的那句（“第 3 章记账”）。 */
    holder: string;
    saving?: boolean;
    /** 解除失败的原因；默认空。 */
    error?: string;
};
type BreakExclusiveDialogEmits = {
    (event: "update:open", value: boolean): void;
    (event: "confirm"): void;
    (event: "closed"): void;
};
```

没有插槽、没有 expose。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
