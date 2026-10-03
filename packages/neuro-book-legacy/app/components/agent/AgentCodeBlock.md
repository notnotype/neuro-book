---
标签: []
别名: ["代码块", "Code Block"]
---

# Agent 代码块

工具详情里显示文件内容、diff、命令输出和原始参数的等宽代码块。可选的标题行写来源（文件路径、“参数”等）；可选行号；每行可以标成新增、删除或淡色，用于 diff 与补丁头。

超过最大高度时代码块内部纵向滚动；长行不折行，在代码块内部横向滚动，不撑宽消息流。内容只公开了预览时，末尾一行淡色提示“只公开了部分内容”。

## 数据

```ts
type AgentCodeBlockProps = {
    /** 要显示的行，必填；空数组时显示“无内容”。 */
    lines: Array<{text: string; tone?: "added" | "removed" | "muted"}>;
    /** 标题行，例如文件路径；默认空串不显示。 */
    label?: string;
    /** 第一行的行号；null 时不显示行号。默认 null。 */
    startLine?: number | null;
    /** 内容只是预览；默认 false。 */
    truncated?: boolean;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

新增、删除行在行首显示 `+`、`-` 并以状态色浅底标出；这由 `tone` 决定，文本本身不需要带前缀。
