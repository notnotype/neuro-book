---
标签: []
别名: ["源文字输入", "Plain Source Input"]
---

# PlainSourceInput

主文字整篇源文字输入的退路：一个随内容增高的普通文本框，合同与编辑器插件交出的代码输入框（`nbook/plugins/editor/web/components/CodeInput.md`）相同。窗口里没有编辑器插件时（只装世界引擎的窗口、组件测试）`EntryTextEditor` 用它，整篇编辑照样能用，只是没有语法配色。

```ts
type Props = {
    /** 文字，受控。 */
    modelValue: string;
    /** 可访问名称。 */
    label: string;
    /** 合同里有的属性，这里用不上。 */
    language?: string;
    readonly?: boolean;
};

type Emits = {
    "update:modelValue": [text: string];
    focus: [];
    blur: [];
};

type Exposed = {
    /** 把焦点放进输入框；`caret` 把光标放到文首或文末，不给时不动光标。 */
    focus(caret?: "start" | "end"): void;
    /** 光标在文字里的偏移。 */
    cursorOffset(): number | null;
    /** 在光标处写入一段文字（有选区时换掉选区），光标落在它后面，照打字一样交出 `update:modelValue`；只读时不做，返回 false。 */
    insert(text: string): boolean;
};
```

没有 slots；attrs 落在文本框上。
