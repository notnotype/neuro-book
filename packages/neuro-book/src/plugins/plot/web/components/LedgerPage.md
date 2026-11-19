---
标签: [state:inject, io:read]
别名: ["伏笔账本", "Foreshadowing Ledger"]
---

# LedgerPage

编辑区里的“伏笔账本”一页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 2 到 6、11 到 13）：canon 交的页头、分段筛选（还没收、很久没提、没打算怎么收、已放弃、全部，各带条数）、一行一个伏笔。数据来自一次 `nbook.plot/author` 的 `ledger`，挂在窗口的读取层里。

## 布局与交互

- 表格：伏笔（名字按钮、重要程度，没打算怎么收的下面一行写“还没打算怎么收”）、到哪一步、上次提到（久没提的另一行写“N 章没提”，警告色）、接下来（“第 N 章呼应”；没有又没收完写“没有打算”，警告色）、节点带（`NodeBand`）。表下一行图例。
- 容器宽度不足 640 像素时换成一行一条的列表：名字一行、状态一行、节点带一行。
- 一页 200 行，读不完时末尾“再显示（还有 N 项）”。名字点了打开条目页。

## 数据

```ts
interface LedgerPageState {
    position: string;
    planned: boolean;
    segment: "unpaid" | "silent" | "unplanned" | "dropped" | "all";
}

type LedgerPageProps = {
    reads: CanonReads;
    client: PlotAuthorClient;
    state: LedgerPageState;
    open: (id: string) => void;
};
```

没有事件、插槽与 expose。

## 状态

同“谁知道什么”（`SecretsPage`）：没有绑定项目、读取中、读取失败（横幅与“重试”）、没有伏笔。

## 隐藏通道理由

同 `SecretsPage`：`io:read` 是页面经读取服务发起的读取；`state:inject` 是界面文字。
