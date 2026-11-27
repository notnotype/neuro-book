---
标签: [state:inject]
别名: ["字段表", "Field Table"]
---

# FieldTable

条目页数据分页的字段表（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 12、13）：一行一个字段，写显示名、值与单位、“第 N 章改过”这类标记；值是按钮，点了在这一行下面展开它的来历（插槽）。人物的界面另在语义档字段的值下面列出起点与之后记下的每一句。受控：各行由宿主给（`rows.ts` 的 `fieldRows`）。

## 布局与交互

每行左边是显示名（固定宽度），中间是值，右边是标记；列表字段的值是一列元素。值未知或不完整时用警告色，不完整时值后写“不完整”。宽度不够时换行，不横向滚动。

- 单击值按钮（或 Enter、空格）：发 `value`，参数是这个字段的路径；展开着的那一行 `aria-expanded` 为 true，下面是 `origin` 插槽。值按钮的可读名是“显示名：值”。
- `editing` 时可改的行在值后面有一个常显的“改”（可读名“改某某”，`data-edit` 是字段路径）：发 `edit`；不可用时禁用，悬停提示是原因。值按钮与“改”各是一个 Tab 停靠点，值在前。
- `editing` 时列表字段（带 `elementIds`）在这一行下面另列各元素，小缩进、不跟值那一列对齐（专门分页把字段表嵌在很窄的格子里）：每个元素一行写它的文字与“改”“去掉”（可读名“改某某”“去掉某某”），发 `edit-element`、`remove-element`（字段路径与元素 id）；末尾“＋ 添加一项”（`data-add-element` 是字段路径）发 `add-element`。不可用时同“改”。
- 一个字段也没有时写“这个分页还没有字段”。

## 数据

```ts
interface FieldRow {
    /** `<命名空间>.<字段>`。 */
    readonly path: string;
    readonly label: string;
    readonly display: string;
    readonly unknown: boolean;
    readonly incomplete: boolean;
    readonly mark: string | null;
    /** 列表字段的各元素。 */
    readonly items?: readonly string[];
    /** 列表字段的元素 id，与 `items` 一一对应。 */
    readonly elementIds?: readonly string[];
    /** 可以就地改（数、文字、选项、是否、引用、图片）。 */
    readonly editable?: boolean;
    /** 语义档的各句（人物的界面）。 */
    readonly notes?: readonly {readonly where: string; readonly text: string}[];
    /** 语义档只列了最近的一页时，更早的还有几步：各句前面写“还有更早的 N 句”。 */
    readonly notesEarlier?: number;
    /** 语义档还没归纳：各句后面写“还没归纳”。 */
    readonly notReduced?: boolean;
}

type FieldTableProps = {
    rows: readonly FieldRow[];
    /** 展开着来历的字段路径；默认没有。 */
    open?: string;
    /** 在可改的行（`editable`）上显示“改”；默认 false。 */
    editing?: boolean;
    /** “改”不可用的原因：按钮禁用、悬停提示是它；默认空（可用）。 */
    editReason?: string;
};

type FieldTableEmits = {
    (event: "value", path: string): void;
    (event: "edit", path: string): void;
    (event: "edit-element", path: string, element: string): void;
    (event: "remove-element", path: string, element: string): void;
    (event: "add-element", path: string): void;
};

type FieldTableSlots = {
    /** 展开着的那一行下面的来历。 */
    origin?(props: {path: string}): unknown;
};
```

## 状态

- 默认、空数据：如上。加载中、出错、禁用、只读：没有（由宿主处理）。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
