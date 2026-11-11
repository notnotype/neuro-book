---
标签: [state:inject]
别名: ["条目文字", "Entry Text"]
---

# EntryText

条目页的文字分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 10）：显示世界服务给作者的渲染（[`canon/rendering.md`](../../../../../../../docs/specs/canon/rendering.md) 输出 7）。文字里的每个值是一个按钮，点了在它所在的块后面展开来历（插槽）。受控。

## 布局与交互

正文排版，宽度由父容器封顶。块是 mdast 的语法树：段落、标题、列表、引用、强调、删除线、行内代码、代码块、链接（只显示文字）、换行、分隔线、表格自己画，认不出的节点画它的子节点或文字。canon 的节点：

- 值：带虚线下划线的按钮，可读名是“显示名：值”；未知写“未知”、不完整后面写“不完整”，都用警告色；本条目的字段在所选位置之前改过的，后面用次级色写“第 N 章改过”这类标记（`marks`）。单击发 `value`（地址），展开着的值 `aria-expanded` 为 true。
- 算出来的值：次级色，悬停提示是表达式原文；不可点。
- 条目引用：到那个条目的链接，单击发 `entry`；已删除的写原来的名字，次级色，不可点。
- 占位、图片：次级色的一句。
- 出错的块：它的纯文本与一句原因（危险色），别的块照常。

## 数据

```ts
type EntryTextBlock =
    | {readonly id: string; readonly tree: EntryTextNode}
    | {readonly id: string; readonly error: {readonly message: string}; readonly text: string};

interface TextAddress {
    readonly entry: string;
    readonly path: string;
}

type EntryTextProps = {
    blocks: readonly EntryTextBlock[];
    /** 这个条目的 id：值节点不写条目时指它自己。 */
    self: string;
    /** 本条目各字段的“改过”标记，按路径；默认没有。 */
    marks?: Readonly<Record<string, string>>;
    /** 展开着来历的值（`addressKey(address)`，即“条目 id|路径”）；默认没有。 */
    open?: string;
};

type EntryTextEmits = {
    (event: "value", address: TextAddress): void;
    (event: "entry", id: string): void;
};

type EntryTextSlots = {
    origin?(props: {address: TextAddress}): unknown;
};
```

`EntryTextNode` 见 `entry-text.ts`：只写了组件要读的字段，不引 mdast 的类型。

## 状态

- 默认：如上。空数据：没有块时什么也不画（条目没有主文字时条目页不出这个分页）。加载中、禁用、只读：没有。

## 不支持

- 文字分页里没有“改”（要改到数据分页，输出 10）。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
