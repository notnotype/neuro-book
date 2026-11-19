---
标签: [state:inject]
别名: ["条目文字", "Entry Text"]
---

# EntryText

条目页的文字分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 9、10）：显示世界服务给作者的渲染（[`canon/rendering.md`](../../../../../../../docs/specs/canon/rendering.md) 输出 7）。文字里的每个值是一个按钮，点了在它所在的块后面展开来历（插槽）。能改时每一块旁边有“改这一段”“删掉这一段”，文末“加一段”；改什么、怎样写进世界由宿主定。受控。

## 布局与交互

正文排版，宽度由父容器封顶。块是 mdast 的语法树：段落、标题、列表、引用、强调、删除线、行内代码、代码块、链接（只显示文字）、换行、分隔线、表格自己画，认不出的节点画它的子节点或文字。canon 的节点：

- 值：带虚线下划线的按钮，可读名是“显示名：值”；未知写“未知”、不完整后面写“不完整”，都用警告色；本条目的字段在所选位置之前改过的，后面用次级色写“第 N 章改过”这类标记（`marks`）。单击发 `value`（地址），展开着的值 `aria-expanded` 为 true。
- 算出来的值：次级色，悬停提示是表达式原文；不可点。
- 条目引用：到那个条目的链接，单击发 `entry`；已删除的写原来的名字，次级色，不可点。
- 占位、图片：次级色的一句。
- 出错的块：它的纯文本与一句原因（危险色），别的块照常。
- 能改（`editable`）：每一块右上一行“改这一段”“删掉这一段”（可读名写第几段），平时淡、悬停或焦点在块里时清楚；文末“＋ 加一段”。单击各发 `edit-block`（块 id）、`remove-block`（块 id）、`add-block`。`editReason` 非空时这几个按钮不可用，悬停写原因。

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
    /** 出块的改、删与文末的加一段；默认 false。 */
    editable?: boolean;
    /** 不能写的原因；非空时那几个按钮不可用。默认空串。 */
    editReason?: string;
};

type EntryTextEmits = {
    (event: "value", address: TextAddress): void;
    (event: "entry", id: string): void;
    (event: "edit-block", id: string): void;
    (event: "remove-block", id: string): void;
    (event: "add-block"): void;
};

type EntryTextSlots = {
    origin?(props: {address: TextAddress}): unknown;
};
```

`EntryTextNode` 见 `entry-text.ts`：只写了组件要读的字段，不引 mdast 的类型。

## 状态

- 默认：如上。空数据：没有块时写“还没有主文字”；能改时下面是“加一段”。禁用：`editReason` 非空时块的按钮不可用。加载中、只读：没有。

## 不支持

- 改文字里的值：值的“改”在数据分页（输出 10）；这里改的是一整块的源文字。
- 所见即所得：改一段是改它的源文字（Markdown 加表达式），渲染错误保存后才看得到。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
