---
标签: []
别名: ["书架列表", "Shelf List"]
---

# ShelfList

书架的列表视图（提案 [书架页](../../../../../../../docs/proposals/bookshelf.md) 的“扉页列表”）：每部作品一行，像文学期刊的目录。作品多、要按名字或时间找时用它；窄屏（不足 720px）下是唯一的视图。

## 布局

- 每行：左侧 4px 色条（与书脊同色），中间宋体书名与一行简介，右侧字数、篇数与最近编辑时间（窄屏时换到书名下方）。
- 行与行之间一条 `--divider` 分割线，不给每行画框。
- 行的主体是一个按钮：点它或按 Enter 打开作品；右侧“更多”按钮列出在新窗口打开、编辑信息、从书架移除。
- 列表末尾两行文字按钮：“新建作品”“加入已有目录”。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** 已排好序。 */
    items: ShelfItem[];
    /** ISO 时间，时间的相对写法按它算。 */
    now: string;
};
type Emits = {
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
    create: [];
    "add-existing": [];
};
```

## 状态

- 统计 `none` 的行右侧写“尚未统计”；`stale` 不另加说明（扉页里有），只写最近编辑时间。
- 正在打开的作品在书名后加“已打开”。
- 列表为空时只有两行文字按钮。
