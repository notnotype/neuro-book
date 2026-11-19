---
标签: [state:inject]
别名: ["线选择", "Line Select"]
---

# LineSelect

页头的线选择（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 34）：改的是窗口在看的线，条目页与剧情侧的几种页面共用。只有主线时不画。

## 布局与交互

- nb-ui 的 `Select`（小号），可读名“看哪条线”。
- 第一项“跟着章（此刻：线名）”，线名是这一页按自己的位置实际读的那条线（`resolved`）；其余是可选的线，主线写“主线”，子线按线的树用全角空格缩进。
- 选了发 `update:line`：“跟着章”是空串，别的是线的 id。

## 数据

```ts
type LineSelectProps = {
    /** 可选的线：主线在最前（`name` 为 null），其余按线的树先序。 */
    options: readonly {readonly id: string; readonly name: string | null; readonly depth: number}[];
    /** 窗口在看的线；空串是跟着章。 */
    line: string;
    /** 这一页按自己的位置实际读的线。 */
    resolved: string;
};
```

没有插槽；`attrs` 落在 `Select` 上。
