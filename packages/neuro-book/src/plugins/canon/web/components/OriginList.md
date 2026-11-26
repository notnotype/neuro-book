---
标签: [state:inject]
别名: ["来历", "流水", "Origin List"]
---

# OriginList

一个值的来历（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 11、14）：一行一步，最近的在上，初值一行总在最后。条目页的文字分页、字段表与数值的流水共用。受控：各行由宿主给（`rows.ts` 的 `originRows`），它只把点击翻成事件。

## 布局与交互

没有表头，一步两行：第一行是位置、变化量、结果（有变化量时前面一个箭头）与由剧情变更给出的“改这一笔”，变化量、结果、按钮各占一列，列宽按所有行里最宽的那一格定（整张表一套列，各行用 subgrid 接过去），各行的数上下对齐，位置拿剩下的宽（至少四个字宽）；第二行是发生了什么（下面一行小字是依据，估计的用警告色），占满整行，窄的容器里也不挤。初值一行没有位置，第一行左边写“最初”，第二行只剩依据。核对点对不上时结果用危险色。变化量与结果前面各有只给读屏的“变化”“结果”。不横向滚动。

- 点“改这一笔”：发 `change`，参数是那条剧情变更的 id。
- 还有没读的步时末尾一个“再显示更早的（还有 N 步）”按钮：发 `more`。
- 读取失败时上面一行“来历没有读出来”、服务给的说明（`role="alert"`）与“重试”（发 `retry`）；读到过的行留着。

## 数据

```ts
interface OriginRow {
    readonly key: string;
    /** 位置；初值一行为空。 */
    readonly where: string;
    readonly what: string;
    readonly basis?: {readonly text: string; readonly estimate: boolean};
    readonly delta?: string;
    readonly result: string;
    readonly change?: string;
    readonly check?: "ok" | "mismatch";
}

type OriginListProps = {
    rows: readonly OriginRow[];
    /** 列表上方的一句；默认没有。 */
    caption?: string;
    /** 还有几步没读；默认 0。 */
    remaining?: number;
    /** 还没读到过；默认 false。有行时不显示“读取中”。 */
    loading?: boolean;
    /** 读取失败；默认 false。 */
    failed?: boolean;
    /** 失败时服务给的说明；默认空。 */
    reason?: string;
};

type OriginListEmits = {
    (event: "more"): void;
    (event: "retry"): void;
    (event: "change", id: string): void;
};
```

没有插槽与 expose；attrs 落在根元素上。

## 状态

- 默认：如上。
- 加载中：没有行时一行“读取中…”。
- 空数据：只有初值一行（由宿主给）。
- 出错：原因与“重试”，读到过的行留着。
- 禁用、只读：没有。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）；测试与 Lab 要注入登记了本插件目录的端口。
