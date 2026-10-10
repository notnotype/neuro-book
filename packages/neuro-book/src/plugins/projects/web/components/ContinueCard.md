---
标签: []
别名: ["继续写作", "Continue Writing"]
---

# ContinueCard

书架页上半的“继续写作”（提案 [书架页](../../../../../../../docs/proposals/bookshelf.md)）：最近编辑的那部作品、那个片段、末尾的一小段正文，以及今天与总字数；一个按钮直接回到那里接着写。

## 布局

- 一块稿面（`--page-surface`，配色的纸色），圆角取 `--radius-panel`。左右两栏，宽度不足 560px 时上下排：
  - 左栏：小字“继续写作”；宋体书名与片段名（“《长夜行》 · 雪线”）；片段末尾的一段，宋体 17px、行高 `--leading-reading`，最多三行，左侧一条细线引出，像从稿纸上摘下的一段；
  - 右栏：今天的字数（大号数字），其下是总字数；再下是主按钮“继续写作”。
- 统计不是最新（`stale`）时，右栏数字下一行小字“统计于某时”，不把旧快照当实时值。今天的统计不是今天的（`today` 为 null）时不显示今天这一行。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** 必须带 `stats.last`；父组件用 `continueTarget()` 选出。 */
    item: ShelfItem;
    /** ISO 时间。 */
    now: string;
};
type Emits = {
    continue: [id: string];
};
```

## 状态

- 只有一种完整状态。没有可继续的作品时父组件不渲染它，改为空书架或欢迎提示。
