---
标签: [state:inject]
别名: ["确认条", "就地改", "Confirm Bar"]
---

# ConfirmBar

就地改的确认条（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 16、29、30）：写明在改哪个字段，给按声明的输入控件、意图二选一、预览（写回哪里与带来的变化）、原因、保存与取消。受控：填的值、意图、预览与原因都由宿主给（`in-place-edit.ts`），它只把交互翻成事件。

## 布局与交互

贴在分页顶上（`sticky`），内容滚动时它不动；外框用强调色。依次是标题“改某某”、输入控件（`FieldInput`：数加单位、文字、有建议值的文字、选项、是否、引用、图片）、意图（只有一项时不显示）、预览、原因、取消与保存。

`variant: "inline"` 时是专门界面里就地改的内容（author-ui.md 输出 51）：没有标题、外框与吸顶，放进宿主给的浮层或编辑层；别的同上。

- 挂上时焦点进输入控件。
- 改值：发 `update:value`；换意图：发 `update:intent`。
- “保存”：发 `save`；预览没回来、没有预览、保存中或 `locked` 时不可用。原因（例如“这个值刚刚变了”）不锁保存：作者再点一次就行。
- “取消”或 Escape：发 `cancel`；Escape 落在输入法组字里时不发。
- 结局不明时原因后面有“再查一次”：发 `recheck`。

## 数据

```ts
type ConfirmBarKind = "number" | "text" | "suggest" | "enum" | "boolean" | "ref" | "image";
type EditIntent = "creative" | "story";

type ConfirmBarProps = {
    label: string;
    kind: ConfirmBarKind;
    options?: readonly string[];
    unit?: string;
    /** 数、文字、选项是字符串，是否是布尔，引用是条目 id 或 null，图片是 `{图片, 说明}` 或 null。 */
    value: unknown;
    /** 引用：条目选择器这一次的查找结果与当前值的名字。 */
    refResults?: EntryResults;
    refName?: string;
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
    /** 缺省 "bar"。 */
    variant?: "bar" | "inline";
    /** 文字输入的行数；缺省 2。 */
    rows?: number;
};

type ConfirmBarEmits = {
    (event: "update:value", value: unknown): void;
    /** 引用的条目选择器打开或打字。 */
    (event: "search-ref", query: string): void;
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
