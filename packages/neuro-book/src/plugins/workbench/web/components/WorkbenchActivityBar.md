---
标签: []
别名: ["活动栏", "Activity Bar"]
---

# WorkbenchActivityBar

主体左侧的通高卡片：上段是 Sidebar 的 Switcher，一个容器一个图标按钮；底段留给全局项（账号、设置，随对应插件加入，现在为空）。它只画按钮与选中标记，点了只发 `select`；切换哪个容器、要不要同时打开被隐藏或拖到零的 Sidebar，由宿主决定（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 15）。

## 布局

卡片宽度由外壳的 ActivityBar 叶决定，按钮 40px 见方、竖排、间距 4px；容器多到放不下时上段在卡片内纵向滚动，不撑破卡片。选中标记只在 `sidebarVisible` 为 true 时出现：Sidebar 看不见时没有“当前在看”的容器。

## 交互

- 点任何一个按钮都发 `select(id)`，包括已选中的那个（宿主据此打开被隐藏或拖到零的 Sidebar）。
- 每个按钮也是整容器的拖动源，上段是 Sidebar 的 Switcher 条目带（外壳三输出 19–23）：组件只写标记，拖动由外壳的拖放会话处理。按住移动或聚焦后按空格拿起；按钮带 `aria-description`（`dragHint`）说明这一点。
- 每个按钮是普通按钮，各自是一个 Tab 停靠点；`aria-pressed` 表示它是 Sidebar 当前显示的容器；悬停提示与可访问名称是容器标题。
- 整条是一个 `nav` 地标，名称由 `label` 给出。

## 数据

```ts
type ActivityContainer = {
    /** 容器 id，`select` 原样带回。 */
    id: string;
    /** 容器标题（已按当前语言取好）：可访问名称与悬停提示。 */
    label: string;
    /** nb-ui 图标 class。 */
    icon: string;
};

type Props = {
    /** 地标名称。 */
    label: string;
    /** Sidebar 里的容器，按顺序；受控。 */
    containers: ReadonlyArray<ActivityContainer>;
    /** Sidebar 选中的容器；没有容器时为 null。受控。 */
    selected: string | null;
    /** Sidebar 此刻看得见（未隐藏、未拖到零）；受控。 */
    sidebarVisible: boolean;
    /** 按钮作为拖动源的说明，写到 `aria-description`，例如“按空格拿起并拖动”。 */
    dragHint: string;
};

type Emits = {
    (event: "select", id: string): void;
};
```

没有 slot、没有 expose；attrs 落在根 `<nav>` 上。上段带 `data-switcher-band="sidebar"`，每个按钮带 `data-switcher-entry` 与 `data-drag-container`（容器 id）。

## 不支持

不处理拖放手势（会话按标记处理）；没有角标、右键菜单与溢出菜单；不读写任何状态。
