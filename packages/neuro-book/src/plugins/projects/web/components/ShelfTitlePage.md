---
标签: []
别名: ["扉页", "Title Page"]
---

# ShelfTitlePage

书架上选中的那部作品的扉页（提案 [书架页](../../../../../../../docs/proposals/bookshelf.md)）：书名、简介、字数、篇数、最近编辑、统计的新鲜度与目录路径，以及打开、在新窗口打开、编辑信息、从书架移除四个操作。显示在书脊书架下方，也用作列表视图里展开的一行。

## 布局

- 左侧一条 4px 的色条，与书脊同色；右侧内容：
  - 书名，宋体 `--text-xl`；没有书名时显示短名；
  - 简介，宋体，`--text-secondary`，最多三行；没有时不占位；
  - 一行统计：字数 · 篇数 · 最近编辑于某时 · 新鲜度说明（`stale` 写“统计于某时”，`none` 写“尚未统计，打开后开始统计”）；
  - 目录路径，等宽小字，`--text-muted`，过长时从中间省略之外的部分换行；
  - 操作行：主按钮“打开”，其余三个为 ghost，“从书架移除”用危险色。
- 390px 宽时操作换行，按钮不截断。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    item: ShelfItem;
    /** ISO 时间，“今天”“昨天”按它算；Lab 里固定，页面里是当前时间。 */
    now: string;
};
type Emits = {
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
};
```

## 状态

- 统计三种新鲜度：`fresh` 不加说明；`stale` 说明统计时间；`none` 不显示字数与篇数，只写“尚未统计”。
- 作品正在打开（`state` 不是 `stopped`）时，统计行前加“已打开”；“从书架移除”仍可点，由服务端以 `project-running` 拒绝并提示。
