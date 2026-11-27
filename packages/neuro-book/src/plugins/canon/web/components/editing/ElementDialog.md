---
标签: [state:inject]
别名: ["列表元素", "Element Dialog"]
---

# ElementDialog

给列表字段加一项、改一项（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 的列表；[`canon.revisions`](../../../../../../../../docs/specs/canon/revisions.md) 输出 25 的 `listAdd` 与元素子字段的 `set`）。以条目为键的列表（例如“知情”指向知识点）先选这一行指向的条目，别的列表填这一项的名字；子字段按声明用 `FieldInput` 画。受控：各值由宿主给，改了发新值；确认后宿主发一次改几处。

## 布局与交互

nb-ui 的 `Dialog`（中号），一列：

- 以条目为键的列表：“指向的条目”（`EntryPicker`）；改一项时不能换。别的列表：“名字”输入框。
- 每个子字段一行：显示名、`FieldInput`。语义档子字段在改一项时只读，写当前的文字与“在剧情里记一句来改”。
- 有两个意图可选时，底部一个“改设定 / 剧情里变了”。
- “保存”发 `confirm`；取消、Escape、点遮罩发 `update:open(false)`（保存中不发）。失败的原因写在对话框里。

## 数据

```ts
type ElementDialogProps = {
    open: boolean;
    title: string;
    /** 以条目为键的列表。 */
    keyed: boolean;
    /** 改一项（不是加一项）。 */
    editing: boolean;
    keyValue: string | null;
    keyName?: string;
    keyResults: EntryResults;
    label: string;
    fields: readonly ElementField[];
    /** 各子字段填的值，按子字段 id；编码同 `FieldInput`。 */
    values: Readonly<Record<string, unknown>>;
    /** 引用子字段当前值的名字，按子字段 id。 */
    refNames?: Readonly<Record<string, string>>;
    /** 引用子字段的查找结果（同一时间只有正在查的那个字段用它）。 */
    refResults: EntryResults;
    intents: readonly EditIntent[];
    intent: EditIntent;
    saving?: boolean;
    error?: string;
};

type ElementDialogEmits = {
    (event: "update:open", value: boolean): void;
    (event: "update:keyValue", value: string | null): void;
    (event: "search-key", query: string): void;
    (event: "update:label", value: string): void;
    (event: "update:value", field: string, value: unknown): void;
    (event: "search-ref", field: string, query: string): void;
    (event: "update:intent", value: EditIntent): void;
    (event: "confirm"): void;
};
```

## 不支持

- 在对话框里记语义档子字段的一句：改一项时语义档只读，去条目页记一句（或交给 Agent）。

## 隐藏通道理由

`state:inject`：经 canon 的翻译端口取文字。
