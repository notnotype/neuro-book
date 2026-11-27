---
标签: [state:inject]
别名: ["情节", "Plot List"]
---

# PlotList

条目页的情节分页（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 15）：涉及这个条目、在所选位置上已经算进去的剧情变更，从新到旧。受控：各行由宿主给（`rows.ts` 的 `plotRows`）。

## 布局与交互

一行一条：位置、文字（计划用次级色），下面一行是“计划”“待定”“已撤销”这些标记与它对这个条目的改动（“存款 −300”）。

- 单击文字：发 `open`（变更 id）。
- 还有没读的时末尾一个“再显示（还有 N 项）”：发 `more`。
- 没有一条时写“还没有涉及它的情节”；还没读到时一行“读取中…”。

## 数据

```ts
interface PlotRow {
    readonly id: string;
    readonly where: string;
    readonly text: string;
    readonly flags: readonly ("plan" | "held" | "undone")[];
    readonly patches: readonly string[];
}

type PlotListProps = {
    rows: readonly PlotRow[];
    /** 默认 0。 */
    remaining?: number;
    /** 默认 false。 */
    loading?: boolean;
    /** 读取失败：写“没有读出来”，读到过的行留着，世界下一次变化时重读；默认 false。 */
    failed?: boolean;
};

type PlotListEmits = {
    (event: "open", id: string): void;
    (event: "more"): void;
};
```

没有插槽与 expose。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
