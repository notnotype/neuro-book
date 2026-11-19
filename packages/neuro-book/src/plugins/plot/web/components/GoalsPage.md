---
标签: [state:inject, io:read]
别名: ["目标表", "Goals"]
---

# GoalsPage

编辑区里的“目标表”一页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 2 到 6、14、15）：canon 交的页头、按人筛、“也列达成与放弃的”开关、主要角色一组一组。数据来自一次 `nbook.plot/author` 的 `goals`（全部主要角色），挂在窗口的读取层里；按人筛在页面里做。

## 布局与交互

- 内容列封顶 760 像素（一组一列，不是宽表）。
- 顶上一行：按人筛的选择（“所有主要角色”与各人）、“也列达成与放弃的”开关。
- 每组：组名是折叠按钮（`aria-expanded`）加人名（按钮，打开条目页）；下面是 `GoalGroup`。收起的组存在标签的状态里。
- 组多于一页（50 组）时末尾“再显示”。

## 数据

```ts
interface GoalsPageState {
    position: string;
    planned: boolean;
    /** 只看这个人；null 是所有主要角色。 */
    holder: string | null;
    finished: boolean;
    /** 收起的组（持有者 id）。 */
    collapsed: string[];
}

type GoalsPageProps = {
    reads: CanonReads;
    client: PlotAuthorClient;
    state: GoalsPageState;
    open: (id: string) => void;
};
```

没有事件、插槽与 expose。

## 状态

同“谁知道什么”（`SecretsPage`）；没有主要角色时写“还没有主要角色”。

## 隐藏通道理由

同 `SecretsPage`。
