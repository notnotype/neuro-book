---
标签: []
别名: ["面板头", "Panel Head"]
---

# WorkbenchPanelHead

一棵树的布局里工具面板的头（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 20）：32px 一行，顺序是标签带（只写标题时只有当前视图的标题）、当前视图的动作、框架按钮。右栏与面板有多个视图时靠它切视图，侧栏靠活动栏。标签的接参按统一标签条的形状（提案第 5 节 `TabStripProps`），换成统一标签条时不改调用方（w00026 t16）。

## 布局

固定 32px。标签带占框架按钮和动作之外的全部宽度，放不下时逐级让位、不横向滚动：完整标题，每个标签最宽 96px，选中的保留标题其余只留图标，放不下的收进末尾的“更多 N”；这一段来自 nb-layout `TabStrip` 的 `adapt`，外观在这里写。动作与框架按钮不让位。`390×844` 由 w00026 t11 的手机呈现决定，不在这里变。

## 交互

- 点标签、方向键、Home、End 发 `activate`，Alt 加方向键发 `reorder`。选中的标签是 Tab 停靠点，其余靠方向键。
- 标签的右键或菜单键发 `context-menu`（“移动到”由宿主开）。不是标签的地方右键不处理，留给浏览器。
- 框架按钮点了发 `action`；不可用时禁用，悬停提示是原因。
- 动作区带 `data-hover-actions`，随鼠标显示的范围由宿主给（`hover-actions.css`）。
- `titleOnly`（侧栏这一列，别的工具面板只有一个标签时；由外壳按已提交的文档算）时只有活动标签的标题：一个可聚焦的按钮，点了发 `activate`（面板收着时宿主展开），是这个视图的拖动源，名称是标题，`dragHint` 写在描述里。
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
    /** 切换类按钮是否开着（收起、最大化），写到 `aria-pressed`；不是切换类时不给。 */
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
    /** 框架按钮，按给定顺序排；默认无。 */
    frameActions?: ReadonlyArray<PanelFrameAction>;
};

type Emits = {
    (event: "activate", id: string): void;
    (event: "reorder", id: string, delta: -1 | 1): void;
    (event: "action", id: string): void;
    /** 坐标是视口坐标；菜单键时是标签左下角。 */
    (event: "context-menu", id: string, at: {x: number; y: number}): void;
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

不处理拖动（只写 `data-panel-head`、`data-panel-tab` 标记），不开菜单，不执行命令，不读写任何状态。
