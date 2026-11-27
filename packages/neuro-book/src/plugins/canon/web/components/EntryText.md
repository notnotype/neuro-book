---
标签: [state:inject]
别名: ["条目文字", "Entry Text"]
---

# EntryText

条目页的文字分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 9、10）：显示世界服务给作者的渲染（[`canon/rendering.md`](../../../../../../../docs/specs/canon/rendering.md) 输出 7）。文字里的每个值是一个按钮，点了在它所在的块后面展开来历（插槽）。这是阅读视图：右上“编辑”进整篇编辑（`EntryTextEditor`，输出 39）。改什么、怎样写进世界由宿主定。受控。

同一个组件也画编辑时的预览（输出 48）：`interactive` 为假时值与条目引用只是文字。

## 布局与交互

正文排版，宽度由父容器封顶。每块是源文加值表：组件对源文跑与内核同一份条目文法（`@notnotype/nb-canon/grammar`），段落、标题、列表、引用、强调、删除线、行内代码、代码块、链接（只显示文字）、换行、分隔线、表格自己画，正文里的实体画成它表示的字，行内代码与代码块里的标签照原文。活的标签按名字与起点对上值表里的一项：

- 值（`V` 的 `of`）：带虚线下划线的按钮，可读名是“显示名：值”；未知写“未知”、不完整后面写“不完整”，都用警告色；本条目的字段在所选位置之前改过的，后面用次级色写“第 N 章改过”这类标记（`marks`）。单击发 `value`（地址），展开着的值 `aria-expanded` 为 true。
- 算出来的值（`V` 的 `expr`）：次级色，悬停提示是式子原文；不可点。
- 条件（`If`）：只画生效的那一支；没有生效的支时，有判断未知就写“未知”（警告色），都不成立就什么都不画。
- 条目引用（`Ref`，或值是引用）：到那个条目的链接，单击发 `entry`；已删除的写原来的名字，次级色，不可点。
- 读不到的值（带原因）、图片（`Image` 与值是图片的 `V`）：次级色的一句，分别是原因与说明。
- 没登记的标签：次级色的“需要插件”。
- 出错的块：它的纯文本与一句原因（危险色），别的块照常。值表与源文对不上（某一项对不上活的标签，或某个活的标签没有项）的块同样按出错显示，不按位置猜。
- 不能点的画法（`interactive` 为假）：值是同样带虚线下划线的文字，悬停写它的显示名；条目引用是强调色的文字。都不发事件，也不写“改过”的标记。根上的标记从 `data-entry-text` 换成 `data-entry-preview`（找阅读视图的地方不该认到预览）。
- 块一级的元素（段落、标题、列表项、引用、代码块、分隔线、表格）带 `data-source-line`：它在这一块源文字里的行号（按词法单元的原文在源文里找到时才有）。预览跟着光标滚到对应的段落时按它找。
- 能改（`editable`）：右上“编辑”，单击发 `edit`；没有主文字时是“还没有主文字”下面一个“开始写”。`editReason` 非空时它不可用，悬停写原因。

## 数据

```ts
type EntryTextBlock =
    | {readonly id: string; readonly source: string; readonly values: readonly EntryTextValue[]}
    | {readonly id: string; readonly error: {readonly message: string; readonly line?: number; readonly column?: number}; readonly text: string};

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
    /** 出“编辑”（没有主文字时是“开始写”）；默认 false。 */
    editable?: boolean;
    /** 不能进编辑的原因；非空时那个按钮不可用。默认空串。 */
    editReason?: string;
    /** 值与条目引用能点。为假时它们只是文字（编辑时的预览）。默认 true。 */
    interactive?: boolean;
};

type EntryTextEmits = {
    (event: "value", address: TextAddress): void;
    (event: "entry", id: string): void;
    (event: "edit"): void;
};

type EntryTextSlots = {
    origin?(props: {address: TextAddress}): unknown;
};
```

`EntryTextValue` 是 nb-canon 的 `AuthorValue`（值表的一项，canon.rendering 输出 7），见 `entry-text.ts`；对齐与行号在那里的 `layoutBlock`。

## 状态

- 默认：如上。空数据：没有块时写“还没有主文字”；能改时下面是“开始写”。禁用：`editReason` 非空时“编辑”不可用。加载中、只读：没有。

## 不支持

- 改文字里的值：值的“改”在数据分页（输出 10）。
- 编辑主文字：在 `EntryTextEditor`，改的是整篇的源文字（Markdown 加标签）。
- 在剧情里改某一块、加一块或删掉一块：阅读视图没有这些入口（输出 39 的第一版把主文字当一整篇）。

## 隐藏通道理由

- `state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
