---
标签: [state:inject]
别名: ["代码块", "Code Block"]
---

# CodeBlock

等宽代码块：文件内容、diff、命令输出、原始参数。可选的标题行写来源（文件路径、“参数”等）；可选行号；每行可以标成新增、删除或淡色，用于 diff 与补丁头。不做语法高亮。

## 布局与交互

超过最大高度（280px）时块内纵向滚动；长行不折行，在块内横向滚动，不撑宽外层。新增、删除行在行首显示 `+`、`-` 并以状态色浅底标出，这由 `tone` 决定，文本本身不需要带前缀。内容只是预览时，末尾一行淡色说明。窄屏同一结构。

## 数据

```ts
type CodeBlockLine = {text: string; tone?: "added" | "removed" | "muted"};

type CodeBlockProps = {
    /** 要显示的行，必填；空数组时显示 emptyText。 */
    lines: CodeBlockLine[];
    /** 标题行，例如文件路径；默认空串不显示。 */
    label?: string;
    /** 第一行的行号；null 时不显示行号。默认 null。 */
    startLine?: number | null;
    /** 内容只是预览；默认 false。 */
    truncated?: boolean;
    /** 没有行时的文字；默认“无内容”。界面文字由调用方按语言传入。 */
    emptyText?: string;
    /** 预览时块底的说明；默认“只公开了部分内容”。 */
    truncatedText?: string;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 状态与边界

- 纯展示，没有内部状态。
- 文字可以选中，即使外层是 `select-none`；行号与 `+`、`-` 标记不进选区。每行是一个块，选中多行粘出来的是按行换行的原文。
- 空行靠最小行高占位，不写入空格，所以选中复制出来的空行是空的。

## 隐藏通道理由

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取空态与截断说明的缺省文案，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `emptyText`、`truncatedText` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
