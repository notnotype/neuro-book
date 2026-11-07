---
标签: [state:local]
别名: ["标签条", "Tab Strip"]
---

# TabStrip

工具面板和编辑组共用的标签条（[`ui/workbench-layout.md`](../../../../docs/specs/ui/workbench-layout.md) 输出 19、20、21）：`tablist` 语义、方向键、Home、End、Alt 加方向键换序、菜单键、多行的纵向导航、分区、放不下时的逐级让位都只写在这里。拖动不在这里：拖动手势由宿主的会话做，标签条只写 `data-panel-tab` 这些标记，插入位由 [`resolveTabStripInsertion`](tab-strip-geometry.ts) 量。

它只有结构必需的样式，外观归宿主。两种外观（工具面板的下划线、编辑组的块状加竖线分隔）靠几个变量表达不了，所以宿主用 `:deep` 写，下面“外观钩子”是公开合同，改它们算改接口。

## 布局

根是一行：标签区占满，`adapt` 时后面可能跟“更多”。标签区里每个分区一行（`[data-tab-row]`），每个标签一个 `.nb-tab-frame`，里面是 `role="tab"` 的按钮（`.nb-tab`）和 `action` 插槽。

- `overflow="scroll"`：一行，放不下时这一行横向滚动。
- `overflow="wrap"`：一行放不下时折行。标签区的高度上限由宿主写（`.nb-tab-strip__list`），超了宿主让它纵向滚动。
- `partitions`：每个分区一行，各自按 `layout`。`overflow` 不再起作用。
- `overflow="adapt"`：放不下时逐级让位，不滚动：完整标题，每个标签最宽 `maxItemWidth`，选中的保留标题其余只留图标，放不下的收进末尾的“更多 N”。选中的始终带标题。`adapt` 只用缺省内容（图标加标题），不和 `tab` 插槽、`partitions` 一起用：测量层要量同款的盒子，渲染插槽会多一份实例。

活动标签换了就滚到完整可见（只动标签条自己的滚动）。

## 交互

- 点标签发 `activate`，双击发 `keep`。
- ←、→ 在全部标签里循环并激活，Home、End 到首尾，焦点跟到新标签；多行时 ↑、↓ 到上一行或下一行里水平位置最近的标签。收在“更多”里的标签也走得到，它会换出来。
- Alt+←、→ 发 `reorder`，Delete 与中键发 `close`，右键、Shift+F10、菜单键发 `context-menu`。宿主不要这些事件时不接就是。
- 选中的标签是 Tab 停靠点，没有选中时是第一个。`action` 插槽里的按钮宿主写 `tabindex="-1"`。

## 数据

```ts
type TabStripItem = {
    /** 写到 `data-panel-tab`，事件原样带回。 */
    id: string;
    /** 缺省内容、“更多”菜单与只留图标时的可访问名称。 */
    title: string;
    /** 属于哪个分区，写到 `data-tab-partition`；缺省第一个。 */
    partition?: string;
    /** 缺省内容的图标；`adapt` 的“只留图标”看它。 */
    iconClass?: string;
    /** 悬停提示；缺省截断时是 `title`。 */
    tooltip?: string;
    /** 写到按钮上的属性（标记、`aria-*`）。 */
    attrs?: Readonly<Record<string, string>>;
};

type Props = {
    /** 受控，必填。 */
    items: ReadonlyArray<TabStripItem>;
    /** 活动标签，受控，必填。 */
    active: string | null;
    /** `tablist` 的名称，必填。 */
    label: string;
    /** 分区，按给定顺序一行一个；缺省一个分区。 */
    partitions?: ReadonlyArray<{id: string; layout: "scroll" | "wrap"}>;
    /** 缺省 "scroll"。 */
    overflow?: "scroll" | "wrap" | "adapt";
    /** 这个标签留着盒子、看不见（`aria-hidden`）：它正被拖着，跟手的是拖影。 */
    placeholder?: string | null;
    /** 同一行里换位时滑过去（`--motion-move`）；只在拖动中开，平时换序直接到位。跨行不动画。 */
    animateMoves?: boolean;
    /** `adapt` 的截断宽度；缺省 96。 */
    maxItemWidth?: number;
    /** `adapt` 的“更多”文字；缺省空。 */
    moreLabel?: string;
    /** “更多”按钮的图标类：要在宿主的样式引擎里，所以由宿主给；缺省没有。 */
    moreIconClass?: string;
    /** 标签的可访问描述：怎么拿起拖动；缺省不写。 */
    dragHint?: string;
    /** 标签元素的 DOM id：内容用它写 `aria-labelledby`。 */
    tabIdOf?: (id: string) => string;
    /** 标签控制的内容的 DOM id，写到 `aria-controls`。 */
    panelIdOf?: (id: string) => string;
};

type Emits = {
    (event: "activate", id: string): void;
    (event: "reorder", id: string, delta: -1 | 1): void;
    (event: "close", id: string): void;
    (event: "keep", id: string): void;
    /** 坐标是视口坐标；键盘打开时是标签左下角。 */
    (event: "context-menu", id: string, at: {x: number; y: number}): void;
};

type Slots = {
    /** 按钮里的内容；缺省图标加标题。 */
    tab?(props: {item: TabStripItem; active: boolean}): unknown;
    /** 按钮之后的东西（关闭、图钉）：按钮不能嵌按钮。 */
    action?(props: {item: TabStripItem; active: boolean}): unknown;
};

type Exposed = {focusTab(id: string): void};
```

attrs 落在根上。

## 外观钩子

| 钩子 | 是什么 |
|---|---|
| `[data-tab-strip]` | 根 |
| `.nb-tab-strip__list` | 标签区（`role="tablist"`），上限高度与纵向滚动写在这里 |
| `[data-tab-row]`、`[data-layout]` | 一行；`data-tab-row-partition` 是它的分区 |
| `.nb-tab-frame`、`.is-active` | 一个标签的外框 |
| `.nb-tab` | 按钮；测量层也用它，所以字号、内边距、间距写在它上面才量得准 |
| `.nb-tab__icon`、`.nb-tab__title`、`.nb-tab--more`、`.nb-tab__chevron` | 缺省内容与“更多” |
| `[data-tabs-level]`、`[data-tabs-more]` | 当前让位档、“更多”按钮 |

## 状态

没有标签时是空的一行。没有加载、错误状态。

## 不支持

不处理拖动，不开菜单，不关标签，不读写任何状态。没有 `canInsert` 与 `trailing` 插槽（和提案第 5 节的差别）：分区限制在宿主放下时判；标题动作在头里、标签条外面，标签条不用知道。

## 注意事项

- `.nb-tab__icon` 的尺寸由宿主写：测量层和真实标签都用它。
- 被拖动时焦点、活动标签不归标签条管：拖动中方向键归拖动会话（它在捕获阶段接）。
