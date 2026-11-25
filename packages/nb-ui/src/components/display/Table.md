---
标签: [state:inject]
---

# Table

`Table` 是以列定义和对象行数据呈现的轻量原生表格；它提供加载与空数据占位、按列定制单元格和行点击通知，但不把排序、选择或分页内置进表格。

## 布局与状态

表头按 `columns` 顺序生成，每个标题是 `scope="col"` 的原生表头单元格。数据行按 `rows` 顺序呈现，单元格默认直接显示对应字段值。窄容器下表格外层横向滚动，不要求页面整体变宽。`density` 只改变单元格内边距；`hoverable` 控制数据行的悬停高亮。

`loading` 为真时，正文只显示居中的 `Spinner`，不显示行或空态；否则 `rows` 为空时显示 `empty` 插槽，未提供时以 `emptyText` 作为 `EmptyState` 标题；有行时显示数据。表头在上述状态中都保留。组件没有 disabled、只读或错误状态。

`stickyHeader` 为真时表头吸顶：根改为两个方向都可滚动，并占满父容器的高度（`height: 100%`、`min-height: 0`），所以父容器要有确定的高度；表头单元格贴在根的顶边，底色取面板色（`--bg-panel`），下边一条边框色的线。吸顶只能贴在最近的滚动容器上，根本来就横向滚动，外面再包一层竖向滚动时表头不会吸顶，所以竖向滚动也交给根。表格放在别的底色上时表头仍是面板色。默认 false，根只横向滚动、高度随内容。

`nowrap` 为真时单元格不换行：每行一样高，列宽按内容算，放不下时表格在根里横向滚动，而不是把列挤窄、让长文字一字一行。只作用于 `Table` 自己画的单元格，不改插槽里放进来的内容（例如单元格里的子表格）。长文本列（备注、详情）在列定义上写 `wrap: true`，这一列照常换行，同时建议给它一个 `width`，否则列宽仍由表格按内容分配。列的 `wrap` 只在 `nowrap` 为真时有意义：`nowrap` 为假时所有单元格本来就换行。表头单元格总是不换行。默认 false，单元格照常换行。

## 数据

```ts
type TableColumn<Row extends object> = {
    /** 行对象的字符串字段名；必填 */
    key: keyof Row & string;
    /** 表头文字；必填 */
    label: string;
    /** CSS 列宽；可选，默认不设置、由表格分配 */
    width?: string;
    /** 单元格与表头对齐方式；可选，默认 "left" */
    align?: "left" | "center" | "right";
    /** 表格设了 nowrap 时这一列仍换行；可选，默认 false；nowrap 为假时没有作用 */
    wrap?: boolean;
};
type TableDensity = "default" | "compact";

interface TableProps<Row extends object> {
    /** 列定义；必填 */
    columns: TableColumn<Row>[];
    /** 行对象；必填 */
    rows: Row[];
    /** 用作行 key 的对象字段；可选，缺省使用当前行下标 */
    rowKey?: keyof Row & string;
    /** 是否显示加载行；可选，默认 false */
    loading?: boolean;
    /** 默认空态标题；可选，缺省按界面语言取（中文 "暂无数据"），有 empty 插槽时不显示 */
    emptyText?: string;
    /** 是否启用行悬停高亮；可选，默认 true */
    hoverable?: boolean;
    /** 单元格密度；可选，默认 "default" */
    density?: TableDensity;
    /** 表头吸顶，根承担两个方向的滚动并占满父容器的高度；可选，默认 false */
    stickyHeader?: boolean;
    /** 单元格不换行，列可以用 wrap 例外；可选，默认 false */
    nowrap?: boolean;
}

interface TableEmits<Row extends object> {
    /** 点击数据行时发出；参数依次为行对象和当前数组下标 */
    (event: "row-click", row: Row, index: number): void;
}

interface TableSlots<Row extends object> {
    /** rows 为空且未加载时替换默认空态 */
    empty?: () => any;
    /** 可选的单元格渲染；名称为 `cell-${column.key}`，参数含原行、字段值和行下标 */
    [name: `cell-${string}`]: (props: {row: Row; value: unknown; index: number}) => any;
}
```

`rowKey` 应指向稳定且唯一的字段；省略时用下标作为 Vue key，增删或重排行时不适合作为稳定身份。`row-click` 由数据行的点击触发，不包含表头或加载/空态行；行本身没有额外键盘交互。组件不提供 `expose` API。根节点是横向滚动容器，未声明的 attributes（包括 `class`、`style`）按 Vue 单根节点默认行为落到该容器。

## 不支持

不内置排序、选择、分页、行展开、列筛选或编辑；需要这些行为时由消费方组合。单元格默认值按 Vue 文本插值呈现，复杂内容应使用对应的 `cell-<key>` 插槽。

## 隐藏通道理由

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取空态的缺省标题，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `emptyText` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
