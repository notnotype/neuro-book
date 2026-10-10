---
标签: []
别名: ["书架页", "书房", "Bookshelf"]
---

# BookshelfPage

没打开项目时的首页（提案 [书架页](../../../../../../../docs/proposals/bookshelf.md) 的“书房”）：上半是继续写作，下半是书架，书架有书脊与列表两种视图。组件只呈现给定的数据、发出用户动作；取数、打开项目、确认与对话框由页面宿主负责。

## 布局

- 页面直接压在窗体底纹上（`--window-backdrop`），内容列封顶 1040px 居中，桌面左右留 32px，窄屏 16px；页面自身纵向滚动，不出现横向滚动。
- 顶部一行：左边“NeuroBook · 书房”，右边 ghost 按钮“进入工作台”（不打开作品，使用用户资产）。
- 继续写作：`ContinueCard`，选 `continueTarget()` 的那一部；没有任何编辑记录时换成一段欢迎文字（书架为空时提示先新建或加入一部作品）。
- 书架：标题行“书架 · N 部”，右侧视图切换（书脊、列表）与排序（最近编辑、书名、字数）；
  - 书脊视图：`SpineShelf`，选中作品的 `ShelfTitlePage` 显示在书架下方；
  - 列表视图：`ShelfList`。
- 宽度不足 720px：只用列表视图，视图切换不显示；继续写作上下排。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** loading：第一次取数还没回来；error：取数失败。 */
    status: "loading" | "ready" | "error";
    /** status 为 error 时的原因，已按当前语言写好。 */
    error?: string;
    items: ShelfItem[];
    /** ISO 时间。 */
    now: string;
    view: "spines" | "list";
    sort: ShelfSort;
    activeId: string | null;
    /** 顶部提示：刷新失败（带重试）、新标签被拦截、移出被拒这类不影响数据的事。 */
    notice?: {text: string; retry: boolean} | null;
};
type Emits = {
    "update:view": [view: "spines" | "list"];
    "update:sort": [sort: ShelfSort];
    "update:activeId": [id: string];
    continue: [id: string];
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
    create: [];
    "add-existing": [];
    "enter-workbench": [];
    /** 首次取数失败的“重试”，与提示里的“重试”都发它。 */
    retry: [];
    "dismiss-notice": [];
};
```

暴露 `focusShelf()`：焦点回到书架——书脊视图是列表框，列表视图是第一行，书架空了时是“新建作品”（移出作品后宿主调它）。

## 状态

- `loading`：继续写作与书架位置显示骨架，不显示空书架的文字。
- `error`：书架位置显示原因与“重试”。
- 空书架：欢迎文字加两根虚线书脊（或列表的两行按钮）。
- `activeId` 不在列表里时（作品刚被移出书架）：书脊视图不显示扉页，聚焦书架时选中第一部。
