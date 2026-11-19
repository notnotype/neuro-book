---
标签: [state:inject]
别名: ["节点带", "Node Band"]
---

# NodeBand

伏笔账本一行里的节点带（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 12）：一眼看出一个伏笔在哪几章埋、呼应、回收，哪些还只是打算。只画有节点的章，几百章的书也不会把一行撑满。

## 布局与交互

- 一排小格，按章序；同一章几个节点各占一格（写了的在前）。章号差 1 以上的两格之间插一个省略格（“…”，读屏跳过）。
- 每格上面一个字（埋、应、误、部、收），下面章号；写了的实心，打算写的虚线框；所选位置所在的章加一圈强调色。
- 每格有可读名（“第 3 章呼应，打算写”），只靠颜色与边框区分的写了与打算写，读屏照样读得出。
- 放不下时换行；页面在窄屏把整条带放到名字下面一行。

## 数据

```ts
type NodeBandProps = {
    /** 节点：角色、章、写了没有；必填。 */
    nodes: readonly {readonly role: "plant" | "echo" | "mislead" | "partial" | "payoff"; readonly chapter: string; readonly written: boolean}[];
    /** 章 id 到序号（从 1 起）；必填。 */
    chapters: ReadonlyMap<string, number>;
    /** 所选位置所在章的序号（初值是 0）；必填。 */
    now: number;
};
```

没有事件、插槽与 expose；`attrs` 落在根上。
