---
标签: [state:inject]
别名: ["确认条", "就地改", "Confirm Bar"]
---

# ConfirmBar

就地改的确认条（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 16、29、30）：写明在改哪个字段，给按声明的输入控件、意图二选一、预览（写回哪里与带来的变化）、原因、保存与取消。受控：填的值、意图、预览与原因都由宿主给（`in-place-edit.ts`），它只把交互翻成事件。

## 布局与交互

贴在分页顶上（`sticky`），内容滚动时它不动；外框用强调色。依次是标题“改某某”、输入控件（数 `NumberInput` 加单位、文字 `Textarea`、选项 `Select`、是否 `Switch`）、意图（只有一项时不显示）、预览、原因、取消与保存。

- 挂上时焦点进输入控件。
- 改值：发 `update:value`；换意图：发 `update:intent`。
- “保存”：发 `save`；预览没回来、没有预览、保存中或 `locked` 时不可用。原因（例如“这个值刚刚变了”）不锁保存：作者再点一次就行。
- “取消”或 Escape：发 `cancel`。
- 结局不明时原因后面有“再查一次”：发 `recheck`。

## 数据

```ts
type ConfirmBarKind = "number" | "text" | "enum" | "boolean";
type EditIntent = "creative" | "story";

type ConfirmBarProps = {
    label: string;
    kind: ConfirmBarKind;
    options?: readonly string[];
    unit?: string;
    /** 数、文字、选项是字符串，是否是布尔。 */
    value: string | boolean;
    intents: readonly EditIntent[];
    intent: EditIntent;
    preview?: {readonly route: string; readonly impact: readonly string[]} | null;
    previewing?: boolean;
    /** 原因（`role="alert"`）；默认空。 */
    error?: string;
    recheck?: boolean;
    saving?: boolean;
    /** 保存不可用；默认 false。 */
    locked?: boolean;
};

type ConfirmBarEmits = {
    (event: "update:value", value: string | boolean): void;
    (event: "update:intent", value: EditIntent): void;
    (event: "save"): void;
    (event: "cancel"): void;
    (event: "recheck"): void;
};
```

## 状态

- 默认、预览中（“正在预览…”）、有原因、保存中、锁住：如上。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
