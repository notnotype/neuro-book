---
标签: [state:local, env:portal]
别名: ["建议值输入", "Suggest Input"]
---

# SuggestInput

有建议值的文字字段的输入（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 51，[`canon/components.md`](../../../../../../../../docs/specs/canon/components.md) 输出 24 的 `suggestions`）：一个输入框，获得焦点时下面列出建议值。值始终是输入框里的字：点一条建议是把它填进输入框，不点也行，直接写别的照样是值。确认条、列表元素的对话框与专门界面的就地改都用它（经 `FieldInput` 的 `suggest` 种类）。

不建在 nb-ui 的 `SearchSelect` 上：那里打的字只是搜索词，不选就失焦会丢掉，回车会选中最像的一条。

## 布局与交互

nb-ui 的 `Input`（小号，宽度随父容器），下面挂 nb-ui 的 `SuggestionMenu`（宽度跟输入框，传送到 `body`）。`inline` 时（就地改的编辑卡里）不弹这一层：列表嵌在输入框下面、一直在（约 6 行高，在里面滚），点一项按下不抢输入框的焦点；Escape 不拦，交给外面的编辑卡（等同取消）。

- 输入框获得焦点时列出全部建议值（输入框里是当前值时，当前值那一条打勾）；作者打了字才只列包含这些字的，与输入框里的字完全相同的那一条也列着；点了一条以后回到全部。没有可列的就不显示列表。
- 上下键移动高亮，回车把高亮那一条填进输入框并收起列表；没有高亮时回车不拦（交给外面，例如表单提交）。Escape 在列表开着时只收起列表（不往外传，外面的浮层不因此关掉），列表收着时照常往外传。输入法组字时这些键都不处理。
- 点一条建议：填进输入框、收起列表，焦点留在输入框。
- 焦点离开输入框（并且不是落在列表上）时收起列表。

## 数据

```ts
type SuggestInputProps = {
    modelValue: string;
    suggestions: readonly string[];
    /** 输入框的可读名字。 */
    label: string;
    placeholder?: string;
    /** 列表嵌在输入框下面（编辑卡里）；缺省 false（弹出）。 */
    inline?: boolean;
};

type SuggestInputEmits = {
    (event: "update:modelValue", value: string): void;
};
```

没有插槽与 expose。

## 隐藏通道理由

`state:local`：列表开没开、高亮哪一项；`env:portal`：`SuggestionMenu` 传送到 `body`。
