---
标签: [state:inject]
别名: ["书架页", "书房"]
---

# BookshelfPage

没有打开作品时的首页（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 1 到 8）。直接压在窗体底纹上，内容列至多 1120px 宽、居中。自上而下：

- 标题栏：品牌标志与字标后接“· 书房”；右侧一个齿轮按钮（打开设置窗口；窗口开着时画成按下：灰底、正文色）紧挨在头像位左边，头像位只预留，不可点，提示“个人资料尚未开放”。切换主题、明暗、界面语言在命令面板与设置窗口里，作品目录在设置窗口的“作品”分区里改。
- 案头 [`ShelfDesk`](ShelfDesk.md)：统计、最近写到、看板娘；空书架时是问候。
- 书架：标题“书架 N 部”，右侧视图切换（卡片、列表）、排序（最近编辑、书名、字数）、“打开已有作品…”与“新建作品”。下面是 [`ShelfCards`](ShelfCards.md)（卡片，空书架时是两张待写的书）或 [`ShelfList`](ShelfList.md)。

带场景的主题（书房）下，整页铺场景图，上面罩一层页面底色（`--bg-main` 的 62%），场景钉在视口上；高对比度偏好下不画（[`theme/skins.md`](../../../../../../../docs/specs/theme/skins.md) 输出 14）。

宽度不足 720px 时只用列表视图，视图切换不显示；空书架时不论视图都显示两张待写的书。加载中显示骨架，骨架外的容器带 `aria-busy="true"` 与一句给读屏的“正在读取书架”（`role="status"`）；首次取数失败显示原因与“重试”。

## 数据

```ts
type Props = {
    status: "loading" | "ready" | "error";
    error?: string;
    items: ReadonlyArray<ShelfItem>;
    now: string;
    view: "cards" | "list";
    sort: "recent" | "title" | "words";
    activeId: string | null;
    /** 作品目录，空书架的“新建作品”卡上写它。 */
    library: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
    /** 本页的设置窗口开着（公开状态 `nbook.settings/windowOpen`）：齿轮画成按下（`aria-pressed`）。缺省 false。 */
    settingsOpen?: boolean;
};
type Emits = {
    "update:view": [view]; "update:sort": [sort]; "update:activeId": [id: string];
    continue: [id: string]; open: [id: string]; "open-new-window": [id: string]; edit: [id: string]; remove: [id: string];
    create: []; "add-existing": []; retry: [];
    /** 点了齿轮。 */
    "open-settings": [];
};
```

`focusShelf()`（expose）：焦点回到书架（卡片视图的列表框、列表的第一行；书架空了时是“新建作品”）。根节点带 `data-bookshelf-page`；按钮 `data-shelf-create`、`data-shelf-add`、`data-shelf-settings`。

## 隐藏通道理由

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不取数、不开窗口：数据与动作由 [`BookshelfHost`](BookshelfHost.md) 接页面模型。
