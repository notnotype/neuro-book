---
标签: []
别名: ["面板头", "Panel Head"]
---

# WorkbenchPanelHead

一棵树的布局里工具面板的头（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 20）：32px 一行，顺序是标签带（只写标题时只有当前视图的标题）、当前视图的动作、框架按钮。右栏与面板有多个视图时靠它切视图，侧栏靠活动栏。标签的接参按统一标签条的形状（提案第 5 节 `TabStripProps`），换成统一标签条时不改调用方（w00026 t16）。

## 布局

固定 32px。标签带占框架按钮和动作之外的全部宽度，放不下时逐级让位、不横向滚动：完整标题，每个标签最宽 96px，选中的保留标题其余只留图标，放不下的收进末尾的“更多 N”；这一段来自 nb-workbench-layout `TabStrip` 的 `adapt`，外观在这里写。动作与框架按钮不让位。`390×844` 由 w00026 t11 的手机呈现决定，不在这里变。

能收成标题行时（`fold`，[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 20）标题前有展开标记：向右的 chevron，展开时转 90 度，和资源管理器树的展开箭头同一种画法与时长；标记与树第一层的箭头、标题与树第一层的文字左缘对齐（标记再往里 9px、和标题隔 5px）。标题展开时主字色，收着时次要字色（头带 `data-collapsed`）。没有 `fold` 的头不画标记，标题照旧从左内边距起。

活动视图接管标题区时（`viewHead`，[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 19）整行改成三列：左列是视图的位置；中列是标题按钮，里面一格是视图的位置；右列是视图的位置、当前视图的动作、框架按钮。两侧至少放得下自己的内容并平分剩下的宽度，所以标题按整行居中；两侧放不下时标题截断，两侧不让。

## 交互

- 点标签、方向键、Home、End 发 `activate`，Alt 加方向键发 `reorder`。选中的标签是 Tab 停靠点，其余靠方向键。
- 标签的右键或菜单键发 `context-menu`（“移动到”由宿主开）。不是标签的地方右键不处理，留给浏览器。
- 框架按钮点了发 `action`；不可用时禁用，悬停提示是原因。框架按钮里没有“收起”，收起是标题行的事。
- 动作区带 `data-hover-actions`，框架按钮的容器带 `data-hover-actions="frame"`，两者随鼠标显示的范围由宿主给（`hover-actions.css`）；框架按钮里有按下的（最大化着的还原）时这一组一直显示。收着时悬停范围就是这一行（头带 `data-hover-actions-scope`），展开着时是整张卡片（宿主写）。
- 有 `fold` 时整行是开关：标题按钮铺满标题这一格，标记在按钮里，按钮带 `aria-expanded` 与 `aria-controls`（内容 region 的 id）；点它先把焦点放到按钮上再发 `activate`，切换由宿主做（展开着收起，收着展开）。Enter 是按钮的点击；空格先交给键盘拖动。
- `titleOnly`（侧栏这一列，别的工具面板只有一个标签时；由外壳按已提交的文档算）时只有活动标签的标题：一个可聚焦的按钮，点了发 `activate`（面板收着时宿主展开），是这个视图的拖动源，名称是标题，`dragHint` 写在描述里。内容区的名称不指向这个按钮，指向一个带 `hidden` 的元素，写活动标签的标题（id 由 `panelTitleDomId` 算）。
- `titleInEntry`（底部面板并成一行时，入口条的入口写着标题，Spec 输出 47）：不画标题按钮，头里只有视图动作与框架按钮；隐藏的标题元素照旧在。拖动、右键与“焦点落到标题”由宿主交给那个入口。
- 接管标题区时有 `fold`：展开标记是左列最前面一个单独的按钮（`data-panel-fold`，名称是 `foldLabel`，带 `aria-expanded`），点了发 `toggle-fold`；它算进两侧等宽，标题照旧居中。标题按钮照旧是视图的弹层开关。
- **自绘头**（`ownHead`，[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 19 的“自绘头”，只写标题时才起作用，优先于 `viewHead`）：头不占一行，画成盖在内容顶上、高 `ownHead.band` 的一条（`position: absolute`，宿主把它放在这块窗的内容里、视图之前，层级压在视图之上），本身不接指针，指针穿过它落到视图画的头上；只有右端的视图动作与框架按钮接指针，竖直居中在这一条里。没有标签带、展开标记，不交标题区的位置。标题按钮（id、`data-panel-tab`、拖动描述、点击与右键都不变，名称是视图标题）在左上角，平时透明、不接指针，键盘聚焦（`:focus-visible`）时淡入：程序把焦点还给它（点了“浮动”、关了“移动到”）时不冒出来压住视图的头；用透明度不用 `display:none`，F6 与“焦点落到标题”要落得上。这一条自己是悬停范围（`data-hover-actions-scope`），指针或焦点在这块窗的内容上时宿主给 `actionsShown`，写 `data-hover-actions-active`。右端按钮一组的宽度加上到右缘的内边距与一个间距经 `own-head-inset` 交给宿主（量 `useLayoutExtent`；动作透明时也占位，只在动作增减时变）。头上写 `data-own-head`。
- 接管标题区时，标题按钮仍是这个组件画的：id、`data-panel-tab`、拖动描述、点击与右键都不变，名称是视图送进来的文字。`viewHead.popup` 不为 null 时按钮带 `aria-haspopup="dialog"` 与 `aria-expanded`。左列与右列视图的那一格带 `data-no-drag`，视图把可交互的东西放这里，不放进按钮。三个位置连同按钮经 `head-slots` 交出去；`viewHead.key` 变了（实例换代）就换一组新元素再交一次，不再接管或组件卸载时交 null。
- 面板头的空白处不起拖：整块面板不能拖（输出 24）。

## 数据

```ts
type PanelHeadTab = {
    /** 标签键，事件原样带回。 */
    id: string;
    /** 已按当前语言取好。 */
    label: string;
    /** nb-ui 图标 class。 */
    icon: string;
};

type PanelFrameAction = {
    /** 宿主的动作 id（产品里是命令 id），`action` 事件原样带回。 */
    id: string;
    /** 可访问名称与悬停提示。 */
    label: string;
    icon: string;
    /** 不可用时禁用按钮。 */
    disabled: boolean;
    /** 不可用的原因，作为悬停提示；可用时不给。 */
    reason?: string;
    /** 切换类按钮是否开着（最大化），写到 `aria-pressed`；不是切换类时不给。按下的框架按钮一直显示（不随悬停隐藏）。 */
    pressed?: boolean;
};

type Props = {
    /** 正被实时布局拖着、还在标签条里的标签：留着盒子、看不见。 */
    draggingTab?: string | null;
    /** 面板 id，写到 `data-panel-head`、`data-panel-band`、`data-panel-strip`。必填。 */
    panelId: string;
    /** 标签带的可访问名称；没有标签时显示它。必填。 */
    label: string;
    /** 必填，受控。 */
    tabs: ReadonlyArray<PanelHeadTab>;
    /** 活动标签键，受控。必填。 */
    active: string | null;
    /** “更多”的文字。必填。 */
    moreLabel: string;
    /** 标签与内容互相引用的 DOM id 前缀；默认 "workbench-panel"。 */
    idPrefix?: string;
    /** 标签的可访问描述；默认不写。 */
    dragHint?: string;
    /** 不画标签带，只写活动标签的标题；默认 false。没有活动标签时同没有标签。 */
    titleOnly?: boolean;
    /** 标题写在入口条的入口上：不画标题按钮，隐藏的标题照旧；默认 false。 */
    titleInEntry?: boolean;
    /** 框架按钮，按给定顺序排；默认无。 */
    frameActions?: ReadonlyArray<PanelFrameAction>;
    /** 只写标题时活动视图接管了标题区；默认 null。不是 `titleOnly` 或没有活动标签时不起作用。 */
    viewHead?: PanelViewHead | null;
    /** 这块面板在这里能收成标题行（宿主按已提交的文档、没有最大化时给）；默认 null，不画标记。 */
    fold?: {collapsed: boolean} | null;
    /** 接管标题区时单独的展开标记的名称（“展开 X”“收起 X”）；默认空。 */
    foldLabel?: string;
    /** 视图自绘头：盖在内容顶上那一条的高度（CSS px）。默认 null。 */
    ownHead?: {band: number} | null;
    /** 自绘头时右端的按钮该不该显示（指针或焦点在这块窗的内容上，宿主算）。默认 false。 */
    actionsShown?: boolean;
};

type PanelViewHead = {
    /** 视图实例的身份（视图 id 加代际）：变了就换一组新的位置。 */
    key: string;
    /** 标题按钮弹出的东西开着没有；null 是不弹出东西。 */
    popup: {expanded: boolean} | null;
};

/** 交给视图的位置，都是这个组件渲染的元素。 */
type PanelHeadSlots = {start: HTMLElement; title: HTMLElement; end: HTMLElement; handle: HTMLElement};

type Emits = {
    (event: "activate", id: string): void;
    (event: "reorder", id: string, delta: -1 | 1): void;
    (event: "action", id: string): void;
    /** 坐标是视口坐标；菜单键时是标签左下角。 */
    (event: "context-menu", id: string, at: {x: number; y: number}): void;
    /** 接管标题区时几个位置画出来了（或换了一组），不再接管、卸载时是 null；在渲染完成之后发。 */
    (event: "head-slots", slots: PanelHeadSlots | null): void;
    /** 接管标题区时点了单独的展开标记。 */
    (event: "toggle-fold"): void;
    /** 自绘头时右端按钮一组连同到右缘的留白占多宽（CSS px）。 */
    (event: "own-head-inset", width: number): void;
};

type Slots = {
    /** 当前视图的动作。不给时没有这一段。 */
    actions?(): unknown;
};
```

没有 expose；attrs 落在根 `<header>` 上。

## 状态

没有标签时显示 `label`（打开前的短暂状态；具名面板拖空后隐藏，无名面板拖空后移除）。框架按钮不可用见“交互”。没有加载、错误状态。

## 不支持

不处理拖动（只写 `data-panel-head`、`data-panel-tab` 标记），不开菜单，不执行命令，不读写任何状态。不往交出去的位置里写内容，也不知道视图送进来的是什么；面板收着时按标题只展开、不开视图的列表，由宿主判断。
