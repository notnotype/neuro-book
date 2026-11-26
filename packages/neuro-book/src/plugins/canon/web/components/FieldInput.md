---
标签: [state:inject]
别名: ["字段输入", "Field Input"]
---

# FieldInput

按字段的种类画一个输入控件（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 的就地改与列表元素）：数、选项、是否、文字、有建议值的文字（`SuggestInput`，候选是 `options`，值照样能写别的）、引用（`EntryPicker`）、图片（`ImageInput`）。确认条与列表元素对话框共用它，同一种字段在两处的输入与解析一样。受控：填的值由宿主给，改了发新值；引用的查找结果由宿主给（`useEntryFind`）。

## 数据

```ts
type FieldInputProps = {
    kind: ConfirmBarKind;
    /** 填的值：数、文字、选项是字符串，是否是布尔，引用是条目 id 或 null，图片是 `{图片, 说明}` 或 null。 */
    value: unknown;
    /** 可读名。 */
    label: string;
    /** 选项字段的选项；`suggest` 时是建议值。 */
    options?: readonly string[];
    unit?: string;
    refResults?: EntryResults;
    refName?: string;
    /** 文字的行数；缺省 2。1 时是单行的输入框（就地改的浮层里的短文字，回车由外面的确认条当保存）。 */
    rows?: number;
    /** 放在就地改的编辑卡里：建议值嵌在输入框下面、成段的文字按内容长高；缺省 false。 */
    inline?: boolean;
};

type FieldInputEmits = {
    (event: "update:value", value: unknown): void;
    (event: "search-ref", query: string): void;
};
```

没有插槽与 expose；attrs 落在根上。

## 隐藏通道理由

`state:inject`：经 canon 的翻译端口取文字（单位、图片输入的字）。
