---
标签: [state:inject, io:read]
别名: ["经历", "Experience"]
---

# ExperienceTab

人物条目页的“经历”分页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 18）：canon 的附加分页（`canon.entry-tabs`，要求条目启用 `nbook.canon.person`）。

## 布局与交互

- 他在场的剧情变更，从新到旧，按章分段（小标题“第 N 章”“前史”）；每条写变更的文字（按钮，打开变更详情页），“记得原线上的”另带一个小标记，下面一行写同时在场的人。
- 一页 50 条，读不完时末尾“再显示更早的”；末尾写“还有 N 条没记谁在场”（N 为 0 时不写）。
- 没有经历时写“还没有经历”。

## 数据

```ts
type ExperienceTabProps = {
    /** 条目页给的附加分页 context（canon/author-ui.md 输出 36）。 */
    context: EntryTabContext;
    reads: CanonReads;
    client: PlotAuthorClient;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

同 `KnowingView`：`io:read` 读 `experience`；`state:inject` 是界面文字。
