---
标签: [state:inject]
别名: ["剧情", "Plot Sidebar"]
---

# PlotSidebar

侧栏视图“剧情”的内容（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 1）：作者找剧情侧几张表与剧情线的入口。受控，数据与选中项由宿主给。

## 布局与交互

- 两组，各有小标题：“表”下面是“谁知道什么”“伏笔账本”“目标表”；“剧情线”下面是种类为“剧情线”的条目（按条目树的顺序，写名字，长了截断）。没有剧情线时写“还没有剧情线”；还没读到时这一组只有标题。
- 每一项是按钮（Tab 到达、Enter 打开）；最后显示出来的那张表是选中的样子（`aria-current="page"`）。
- 窗口没有绑定项目时只有一句“打开作品后可用”。

## 数据

```ts
type PlotTable = "secrets" | "ledger" | "goals";

type PlotSidebarProps = {
    /** 窗口没有绑定项目；默认 false。 */
    unbound?: boolean;
    /** 剧情线的条目 id；还没读到时为 null（默认）。 */
    lines?: readonly string[] | null;
    /** 名字表；默认空。 */
    names?: Readonly<Record<string, {readonly name: string; readonly type: string}>>;
    /** 最后显示出来的那张表；默认 null。 */
    active?: PlotTable | null;
};

type PlotSidebarEmits = {
    (event: "table", table: PlotTable): void;
    (event: "line", id: string): void;
};
```

没有插槽、没有 expose；`attrs` 落在根上。
