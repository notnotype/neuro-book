---
标签: [state:inject, io:read]
别名: ["谁知道什么", "Who Knows What"]
---

# SecretsPage

编辑区里的“谁知道什么”一页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 2 到 10）：canon 交的页头、分段筛选、选要看的人与保密表。数据来自一次 `nbook.plot/author` 的 `secrets`，挂在窗口的读取层里（canon 的读取服务的外部列表），世界变了、窗口换了线以后与 canon 的读取同一轮换上。

## 布局与交互

- 最上面是 canon 的页头（`PageHead`）：标题、两条以上线时的线选择、位置选择、“按计划”。
- 内容列封顶 1100 像素。分段筛选（全部、只有读者知道、读者还不知道、没打算怎么揭，各带条数）在左，“选要看的人”在右，窄时换行。
- 下面是表（`SecretsMatrix`）；容器宽度不足 640 像素时换成一行一条的列表。一页 200 行，读不完时末尾“再显示（还有 N 项）”。
- 秘密与人的名字点了打开它的条目页（页面给的 `open`）。

## 数据

```ts
interface SecretsPageState {
    /** 位置选择的值；空串是缺省位置。 */
    position: string;
    planned: boolean;
    segment: "all" | "readerOnly" | "readerUnaware" | "noPlan";
    /** 选的人；null 是还没选过（服务按缺省选：主要角色里按名字的前 3 个）。 */
    people: string[] | null;
}

type SecretsPageProps = {
    /** canon 的读取服务（窗口的读取层、页头、位置）。 */
    reads: CanonReads;
    /** `nbook.plot/author` 的调用。 */
    client: PlotAuthorClient;
    /** 标签的状态；就地改它（编辑器给的响应式对象）。 */
    state: SecretsPageState;
    /** 打开一个条目的条目页。 */
    open: (id: string) => void;
};
```

没有事件、插槽与 expose。

## 状态

- 没有绑定项目：一句“打开作品后可用”。
- 第一次读取期间：“读取中…”（`role="status"`）。之后重读期间保留旧内容。
- 读取失败：警告横幅写原因与“重试”；线读不到写“这条线读不到”。
- 没有秘密：一句“还没有秘密”。

## 隐藏通道理由

- `io:read`：页面自己经读取服务发起读取，读取结果的失效与换上由窗口的读取层管（与 canon 的条目页同一种宿主）。
- `state:inject`：界面文字。
