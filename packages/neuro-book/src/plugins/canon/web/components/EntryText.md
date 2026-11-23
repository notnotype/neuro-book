---
标签: [state:inject, env:portal]
别名: ["条目文字", "Entry Text"]
---

# EntryText

条目页的文字分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 9、10）：显示世界服务给作者的渲染（[`canon/rendering.md`](../../../../../../../docs/specs/canon/rendering.md) 输出 7）。文字里的每个值是一个按钮，点了在它所在的块后面展开来历（插槽）。这是阅读视图：右上“编辑”进按块编辑（`EntryTextEditor`，输出 39）；所选位置是某一章时每一块另有一个剧情的菜单、文末“在剧情里加一块……”。改什么、怎样写进世界由宿主定。受控。

## 布局与交互

正文排版，宽度由父容器封顶。块是 mdast 的语法树：段落、标题、列表、引用、强调、删除线、行内代码、代码块、链接（只显示文字）、换行、分隔线、表格自己画，认不出的节点画它的子节点或文字。canon 的节点：

- 值：带虚线下划线的按钮，可读名是“显示名：值”；未知写“未知”、不完整后面写“不完整”，都用警告色；本条目的字段在所选位置之前改过的，后面用次级色写“第 N 章改过”这类标记（`marks`）。单击发 `value`（地址），展开着的值 `aria-expanded` 为 true。
- 算出来的值：次级色，悬停提示是表达式原文；不可点。
- 条目引用：到那个条目的链接，单击发 `entry`；已删除的写原来的名字，次级色，不可点。
- 占位、图片：次级色的一句。
- 出错的块：它的纯文本与一句原因（危险色），别的块照常。
- 能改（`editable`）：右上“编辑”，单击发 `edit`；没有主文字时是“还没有主文字”下面一个“开始写”。`editReason` 非空时它不可用，悬停写原因。
- 剧情的入口（`story`）：每一块上面右边一个“⋯”（可读名写第几块），平时淡、悬停或焦点在块里时清楚；点开是菜单“这一块在剧情里变了……”“在剧情里删掉这一块……”，各发 `story-edit`、`story-remove`（块 id）。文末“在剧情里加一块……”发 `story-add`。`storyReason` 非空时它们不可用，悬停写原因。

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
    /** 出“编辑”（没有主文字时是“开始写”）；默认 false。 */
    editable?: boolean;
    /** 不能进编辑的原因；非空时那个按钮不可用。默认空串。 */
    editReason?: string;
    /** 出每一块的剧情菜单与文末的“在剧情里加一块”；默认 false。 */
    story?: boolean;
    /** 剧情的入口不能用的原因；非空时它们不可用。默认空串。 */
    storyReason?: string;
};

type EntryTextEmits = {
    (event: "value", address: TextAddress): void;
    (event: "entry", id: string): void;
    (event: "edit"): void;
    (event: "story-edit", id: string): void;
    (event: "story-remove", id: string): void;
    (event: "story-add"): void;
};

type EntryTextSlots = {
    origin?(props: {address: TextAddress}): unknown;
};
```

`EntryTextNode` 见 `entry-text.ts`：只写了组件要读的字段，不引 mdast 的类型。

## 状态

- 默认：如上。空数据：没有块时写“还没有主文字”；能改时下面是“开始写”。禁用：`editReason`、`storyReason` 非空时对应的入口不可用。加载中、只读：没有。

## 不支持

- 改文字里的值：值的“改”在数据分页（输出 10）。
- 编辑主文字：在 `EntryTextEditor`，改的是每一块的源文字（Markdown 加表达式）。

## 隐藏通道理由

- `state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
- `env:portal`：块的剧情菜单是 nb-ui 的 `DropdownMenu`，浮层渲染到它的 Portal 目标。
