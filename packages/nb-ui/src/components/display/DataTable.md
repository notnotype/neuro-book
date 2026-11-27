---
标签: [state:local, state:inject, env:timer]
别名: ["数据表格", "分页表格", "Data Table"]
---

# DataTable

带工具条与分页的数据表格：上面一条工具条（左边筛选、右边操作），中间是 [`Table`](Table.md)，下面一条是条数与 [`Pagination`](../navigation/Pagination.md)。和自己把三样拼起来的差别是三块的位置固定：首次加载、翻页加载、空、出错、最后一页不满时，工具条与页脚的元素与位置都不变，只换表格区里面的内容；表格区占满剩下的高度并在自己里面滚动，表头吸顶。

组件是受控的：页码、总条数、这一页的行、加载与出错都由使用方给，组件只发事件。取数、请求的先后、页码进不进地址栏都是使用方的事，要守的几条集中在“使用方的取数约定”。

## 数据

```ts
type DataTableProps<Row extends object> = {
    /** 列定义，与 Table 同一个类型；必填 */
    columns: TableColumn<Row>[];
    /** 这一页的行；必填。翻页加载时继续给旧的行，取回来以后换成新数组（引用变了才算换了一批，见“布局”） */
    rows: Row[];
    /** 用作行 key 的字段；可选，缺省用行下标 */
    rowKey?: keyof Row & string;
    /** 符合当前筛选与搜索的总条数；还不知道时给 null；必填 */
    total: number | null;
    /** 每页条数；必填，按它算总页数与这一页的起止 */
    pageSize: number;
    /** 有请求在飞；默认 false。组件等一小段时间（200 毫秒）后才显示加载，显示了至少停 400 毫秒 */
    loading?: boolean;
    /** 非空时表格区显示这条原因与重试按钮；给用户看的文字，不放原始的异常信息 */
    error?: string;
    /** 空态的标题；缺省经翻译端口取（中文“暂无数据”），有 empty 插槽时不显示 */
    emptyText?: string;
    /** 重试按钮的文字；缺省经翻译端口取（中文“重试”） */
    retryLabel?: string;
    /** 单元格密度，透传 Table；默认 "compact" */
    density?: TableDensity;
};

/** 当前页，从 1 起；必填的 v-model（v-model:page） */
type DataTableModel = {page: number};

type DataTableEmits<Row extends object> = {
    /** 出错时点了重试 */
    retry: [];
    /** 点了数据行，透传 Table；参数是行对象与这一页里的下标 */
    "row-click": [row: Row, index: number];
};

type DataTableSlots<Row extends object> = {
    /** 工具条左边：筛选、搜索 */
    filters?: () => any;
    /** 工具条右边：主操作 */
    actions?: () => any;
    /** 替换空态（total 为 0 或这一页没有行） */
    empty?: () => any;
    /** 替换页脚的条数文字，例如换量词；total 为 null 或 0、或这一页没有行时 from、to 都是 0 */
    count?: (props: {from: number; to: number; total: number | null}) => any;
    /** 单元格，透传 Table 的 `cell-<key>` */
    [name: `cell-${string}`]: (props: {row: Row; value: unknown; index: number}) => any;
};
```

没有 expose。未声明的 attribute 与 `class`、`style` 落在根节点上；根的高度、底色与圆角不能用类覆盖，见“注意事项”。

## 布局

根是竖排的面板（面板底色与圆角），`height: 100%`：**要放进有确定高度的容器**，否则表格区没有高度可占、不会在自己里面滚动。宽度由所在的上下文决定，放进 flex 行或按内容定宽的格子里也照常按内容撑开。

- **工具条**：至少 48px 高，左 `filters`、右 `actions`，放不下时换行（高度随宽度变，不随状态变）。
- **表格区**：占满剩下的高度，里面是吸顶表头、单元格不换行的 `Table`（`sticky-header`、`nowrap`），横竖滚动都在 `Table` 的根上。每行一样高，列宽按内容算，放不下时表格横向滚动，而不是把列挤窄、让长标题一字一行。长文本列（备注、详情这类）在列定义上写 `wrap: true` 并给一个 `width`，这一列照常换行（见 [`Table`](Table.md)）。行数不满一页时表格区照样占满，页脚留在底部。
- **回顶**：`rows` 换成新数组（引用变了）时表格区回到顶部，翻页与换筛选都是这样；翻页加载期间旧行留着、引用没变，不会先跳一下。就地改数组（`push`、改下标）不算换了一批，不回顶。
- **页脚**：至少 48px 高，左边条数（“第 1 到 20 条，共 1,284 条”），右边分页条，一行放得下时就是一行。页脚自己窄于 480px 时条数只写“共 N 条”；条数与分页条一行放不下时折成两行，条数一行、分页条一行靠右，条数不截断。是否折行只看页脚拿到的宽度，不看视口；高度随宽度变，不随状态变。
- 加载、空、出错的内容画在表格区中央，盖在表格上面，不占表格的行。内容比表格区高时（容器很矮）从表格区顶部排起，在自己里面滚动，不越过表格区盖住页脚。出错的内容约 230px 高，要整块放得下，组件的高度至少约 330px（工具条一行、页脚一行时）。

## 状态

- **首次加载**（`rows` 为空、`loading` 为真）：表头在，表体空着；等一小段时间后中央淡入转圈与“加载中”。页脚条数写“—”（`total` 为 null 时），分页条按 1 页、不可用。
- **翻页或换筛选时加载**（`rows` 非空、`loading` 为真）：旧行留着，表格区带 `aria-busy`；等一小段时间后盖一层半透明遮罩（淡入），读屏听到“加载中”。遮罩一旦出现至少停 400 毫秒，短请求不闪一下就没；加载完、遮罩还在停的那一小段，底下已经是新行，不再 `inert`。加载中遮罩盖着时旧行所在的那一层是 `inert`：指针与键盘都碰不到被盖住的行内按钮。工具条与页脚不受影响，分页条已经显示新页码（受控），仍可点。
- **空**（`total` 为 0，或不在加载、这一页没有行）：中央显示 `empty` 插槽或 `EmptyState`；页脚“共 0 条”，分页条 1 页、不可用。
- **出错**（`error` 非空，优先于别的状态）：中央显示原因与重试按钮，整块是 `role="alert"`；点重试发 `retry`。页脚照常按 `total` 与页码显示：使用方保留上一次的总数，条数与页码就留着。
- 加载很快结束（短于那一小段时间）时什么都不显示，不闪一下。状态之间换内容时淡入淡出，减弱动效时没有过渡。

条数的区间按这一页实际拿到的行算：起点按页码与每页条数算，终点是起点加行数减一；这一页没有行时只写“共 N 条”，与表格区的空态一致。页码越界（例如数据变少）时分页条按夹到边界的值显示，条数的起点也按夹过的页码算；组件不改 `page`，改不改由使用方定（见“使用方的取数约定”）。

## 交互

- 组件不加自己的按键。Tab 顺序是工具条、表格里的可聚焦元素、分页条。
- 点行发 `row-click`（透传 `Table`）；行本身不可聚焦，只靠点行才能做的事，使用方要在行里另给按钮。
- 点分页条发 `update:page`；组件不自己取数。
- 焦点：焦点在表格区里、表格区换了内容以后没地方落时，组件把焦点接到表格区自己（`tabindex="-1"`，不滚动、不画焦点环）上，不让它掉回 `body`，下一次 Tab 从表格区往后走。三种情况：点了“重试”、使用方清掉 `error` 后出错层离场；遮罩盖上来、焦点所在的行变成 `inert`；行换了一批、焦点所在的行内按钮被移走。焦点原本不在表格区里（例如在工具条或分页条上）时不动焦点；分页条自己的焦点规则见 [`Pagination`](../navigation/Pagination.md)。

## 不支持

- 不内置排序、选择、列筛选、每页条数的选择、跳页输入框。
- 不支持无限滚动或“加载更多”。
- 不支持把工具条或页脚换成别的布局；只开放上面列的插槽。

## 使用方的取数约定

组件不取数，下面几条要由使用方做；几个列表页都要做时，在使用方那边写一个组合函数收口，不放进组件。

1. **页码放在使用方**：要刷新、后退回到同一页时，页码放进地址栏的查询参数，`v-model:page` 绑它；组件不读路由。
2. **丢弃后到的旧请求**：每次取数领一个序号，回来时序号不是最新的就丢掉；组件按收到的 `rows` 画，分不出哪个请求先发。
3. **换筛选或搜索**：页码回到 1。`total` 可以留着旧数（页脚与分页条不动，遮罩盖着旧行），也可以清成 `null`（条数写“—”、分页条不可用，直到新的总数回来）；翻页时不要清 `total`，否则分页条每翻一页都要变成不可用一次。
4. **最后一页没有行了**（例如删掉了最后一页的唯一一行）：取回来 `rows` 为空、`total` 大于 0 时，把页码改成 `ceil(total / pageSize)` 再取一次。组件不改页码，只按夹过的页码显示、条数只写总数。
5. **点重试**：收到 `retry` 时清掉 `error` 并把 `loading` 置真，再取一次；`error` 不清，出错层就一直在。
6. **`error` 是给用户看的文字**：把异常换成一句用户读得懂的原因，不放原始的异常信息或状态码。

```ts
const page = ref(1), rows = ref<Row[]>([]), total = ref<number | null>(null);
const loading = ref(false), error = ref<string>();
let seq = 0;

async function load(): Promise<void> {
    const mine = ++seq;
    loading.value = true;
    error.value = undefined;
    try {
        const result = await fetchPage({page: page.value, pageSize: PAGE_SIZE, filter: filter.value});
        if (mine !== seq) return;                       // 后到的旧请求
        if (result.rows.length === 0 && result.total > 0) {
            page.value = Math.ceil(result.total / PAGE_SIZE);  // 最后一页没有行了：改页码，watch 再取一次
            return;
        }
        rows.value = result.rows;                       // 新数组：表格区回顶
        total.value = result.total;
    } catch {
        if (mine === seq) error.value = "列表没有取回来，请稍后重试";  // 给用户看的原因
    } finally {
        if (mine === seq) loading.value = false;
    }
}
```

`watch(page, load)` 接翻页，换筛选时先把 `page` 设成 1 再取；`@retry="load"`。

## 注意事项

- 首次加载的转圈与出错的内容在整个表格区里居中，表头也算在里面，所以比表体的正中略偏上半个表头高。
- `total` 不知道时（null）条数写“—”，分页条不可用；知道了再给。
- 尺寸由父容器给：根的高度、底色与圆角写在组件自己的样式里，传给根的原子类（`h-96`、`rounded-none`、`bg-*`）压不过它们。要定高就给外面包一层定高的容器。

## 隐藏通道理由

`state:local`：组件自己持有“加载指示该不该显示了”这一个状态：`loading` 变真后等一小段时间才显示、显示后停够最短时长（nb-ui 的 `useDelayedVisibility`），短请求不闪（[frontend.md](../../../../../docs/standards/code/frontend.md) 的“加载态延时显示”）。页码、行与总数都不在这里，由使用方给。

`env:timer`：上面的延时与最短停留用浏览器计时器做，组件卸载时清掉。

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取条数文字、重试按钮与空态的缺省文字，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `emptyText`、`retryLabel`，或用 `count` 插槽时以调用方为准。
