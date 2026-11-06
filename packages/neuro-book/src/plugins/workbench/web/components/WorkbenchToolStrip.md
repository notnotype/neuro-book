---
标签: [state:local]
别名: ["活动栏", "工具条", "Activity Bar"]
---

# WorkbenchToolStrip

一棵树的布局里的活动栏（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 22）：上段列侧栏这一列的视图，是侧栏的切换器，也是工具视图的落点；底段是贡献的全局项。列哪些视图、点了做什么都由宿主定。

## 布局

宽度由树里的条决定（48px），按钮 38px、竖排、间距 4px。视图多到放不下时，排在后面的收进上段末尾的“更多”，按下的（有效可见的）总在外面。底段贴着列底，不滚动、不让位。

## 交互

- 点视图条目发 `select(id)`，收在“更多”里的也一样。鼠标点不抢焦点：隐藏面板时焦点留在原处。条目的 `aria-pressed` 是视图有效可见。条目是拖动源，组件只写 `data-tool-entry` 标记；条目区写 `data-tool-band`，它是工具视图的落点，判定与插入线由宿主的拖动做。
- 条目的右键或菜单键发 `context-menu`（“移动到”由宿主开）。菜单键时坐标是条目右上角。
- 底段有命令的条目点了发 `run-item(id)`；不可用时停用，原因写在原生 `title`（停用的按钮不触发悬停提示组件）。声明了切换状态的带 `aria-pressed`。
- 底段的占位不可聚焦、不可点，读屏读作一张带标题的图。
- 整条是一个 `nav` 地标。

## 数据

```ts
type ToolStripEntry = {
    /** 视图 id，事件原样带回。 */
    id: string;
    /** 视图标题，已按当前语言取好。 */
    label: string;
    icon: string;
    /** 视图有效可见。 */
    pressed: boolean;
};

type ToolStripItem = {
    id: string;
    title: string;
    icon: string;
    /** 没有命令的条目是不可点的占位。 */
    interactive: boolean;
    /** 切换状态；不是切换按钮为 null。 */
    pressed: boolean | null;
    /** 不可用的原因；可用时为 null。 */
    disabledReason: string | null;
};

type Props = {
    /** `nav` 的名称。必填。 */
    label: string;
    /** “更多”按钮的名称。必填。 */
    moreLabel: string;
    /** 按显示顺序排好；受控，必填。 */
    entries: ReadonlyArray<ToolStripEntry>;
    /** 底段；默认无。 */
    items?: ReadonlyArray<ToolStripItem>;
    /** 条目的可访问描述；默认不写。 */
    dragHint?: string;
};

type Emits = {
    (event: "select", id: string): void;
    (event: "run-item", id: string): void;
    /** 坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {x: number; y: number}): void;
};
```

没有 slots，没有 expose；attrs 落在根 `<nav>` 上。

## 状态

没有视图时上段是空的，底段照常。不可用只有底段条目有，见“交互”。

## 不支持

不自己处理拖动。不判断点了做什么（见 `state/layout-present.ts` 的 `toolEntryIntent`），不执行命令。
