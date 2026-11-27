---
标签: [state:local]
别名: ["活动栏", "侧轨", "工具条", "Activity Bar", "Side Rail"]
---

# WorkbenchToolStrip

一棵树的布局里的侧轨（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 22、50）：左轨就是活动栏（`region` 是 `sidebar`），右轨是右栏外侧那一条（`auxiliarybar`），同一个组件。上段列区域的容器，一个容器一个入口（输出 41），是区域的切换器，也是工具视图的落点；左轨的底段是贡献的全局项，右轨没有。列哪些容器、点了做什么都由宿主定。

## 布局

宽度由树里的条决定（48px），按钮 38px、竖排、间距 4px。入口多到放不下时，排在后面的收进上段末尾的“更多”，当前容器（`current`）的入口总在外面。底段贴着列底，不滚动、不让位。

入口有 `count` 时图标右上角压一个小号强调色的 `Badge`（`data-tool-count`，`aria-hidden`，不挡点击），超过 99 写“99+”；可访问名称写成“标题 数”（`docs/specs/workbench/views.md` 输出 17）。

## 交互

- 点入口发 `select(id)`，收在“更多”里的也一样。鼠标点不抢焦点：切容器、隐藏侧栏时焦点留在原处，原处看不见了去哪由宿主定。入口的 `aria-pressed` 是“当前容器且侧栏可见”，至多一项。按下的底色不画在按钮上，是条目区里一个独立的块（`data-tool-indicator`，`aria-hidden`；和右栏、底部面板入口条的按下的块共用 [`use-entry-indicator.ts`](use-entry-indicator.ts)），位置量按下的那个入口（沿 `offsetParent` 加到条目区，不含拖动中按钮外层的 `translate`）：`slideToken` 变了、按下的入口也换了的那一次它滑过去（`data-sliding`，`--motion-layout`、`--ease-layout`，和侧栏切换容器时的滚动同时走），滑到一半又换一次时从此刻接着滑，滑完（`transitionend`、没有别的 `transform` 过渡在走）才摘掉标记；别的原因换了按下的入口、窗口缩放、入口收进“更多”时直接到位；拖动中入口换位时直接到终点，和按钮的滑动差一段（已知限制）；没有按下的入口时在原处淡出，再按下时在新的位置淡入；挂上时第一次放下不淡入（`data-settled` 之前没有过渡）。
- 入口的可访问名称是容器的名称，悬停文字写出容器里的各个视图；没有图标可取（`icon` 是 null）时画中性的占位图标。
- 组件给每个入口写 `data-tool-entry`（容器 id）与稳定名 `workbench.container` 加容器 id，活动栏项写 `workbench.activity` 加项 id（`data-nb-target`、`data-nb-key`，[`agent/page-agent.md`](../../../../../../../docs/specs/agent/page-agent.md) 输出 6；Agent 的引导按它们找控件，不改名）。每个入口都是拖动源，可访问描述写怎么拿起（输出 46）：只含一个视图的入口另写 `data-tool-view`（视图 id），拖它就是拖这个视图；含几个视图的入口没有这个标记，宿主让它只在入口条里换序。条目区写 `data-tool-band`，它是工具视图的落点（输出 45），判定与插入线由宿主的拖动做。指针落在一个入口上（放下会并入这个容器）时，宿主经 `highlighted` 让这个入口盖一层并入的高亮，样子同面板的并入盖层（`--layout-merge-fill` 的底、`--layout-merge-border` 的内描边），入口写 `data-tool-merge`。实时布局下活动栏和别的标签条一样吸收来源：`placeholder` 这个入口留着盒子、看不见，别的入口滑开（`--motion-move`，只在拖动中开）。
- 入口的右键或菜单键发 `context-menu`（容器的菜单由宿主开，没有菜单项时宿主不开）。菜单键时坐标是入口朝着区域那一侧的上角（左轨右上角、右轨左上角），菜单往区域那边开。
- 底段有命令的条目点了发 `run-item(id)`；不可用时停用，原因写在原生 `title`（停用的按钮不触发悬停提示组件）。声明了切换状态的带 `aria-pressed`。
- 底段的占位不可聚焦、不可点，读屏读作一张带标题的图。
- 整条是一个 `nav` 地标，带 `data-rail`（区域）、`data-rail-state`（此刻生效的展开状态：`collapsed` 或 `expanded`，被预算拒绝时是 `collapsed`）、和区域卡片相连时的 `data-rail-joined`（不相连时没有这个属性，不写 `"false"`）。
- 整条是一条纵向工具条（输出 50 的“焦点与读屏”）：带 `data-rail-item` 的项（入口、“更多”、底段的可用项，以及视图借来的那一段里视图画的项）按 DOM 顺序是一条，只有一项 `tabindex=0`；上下方向键、Home、End 在条里走，不绕回。Tab 进来的是上次在条里的那一项，它不在了是按下的入口，再没有是第一项。条里的项增删（视图段 Teleport 进来、换画法）时重排。
- 悬停提示与菜单开在侧轨外侧的反方向：左轨往右，右轨往左。书脊装饰只画在左轨。

## 视图段

宿主给 `segment` 时（当前容器借来的视图段，输出 50 的“三段”“展开”“轨宽手柄”）条里多出：

- `main`（`data-rail-segment="main"`）在入口带与底段之间，吃掉剩下的高度、自己滚动；`foot`（`data-rail-segment="foot"`）在底段，是视图段的固定项。两处都由视图 `Teleport` 进来，也都是拖动的拒收区（`data-drop-refuse`，松手取消、不开新窗，判定在宿主的拖动里）。挂上、拆掉时发 `segment-elements(main, foot)`（拆掉时两个都是 null），宿主转给视图。
- 加载中（`loading`）`main` 里画骨架（`data-rail-loading`），稳定尺寸、不带动画。
- 展开按钮（`data-rail-expand`、`aria-expanded` 是此刻生效的状态），点了发 `toggle-segment`。窗口太窄（`tooNarrow`）时名称与悬停写“窗口太窄”，带 `data-rail-too-narrow`。
- 展开时侧轨是两栏：48 一列贴窗口外缘不动（入口、底段、展开按钮留在原位），`main` 在朝区域的那一栏占满整高。
- 展开时 `main` 朝区域的那一边叠着轨宽手柄（`data-rail-handle`、`role=separator`、`aria-valuenow/min/max`、名称“调整侧轨宽度”）：命中区只在轨这一侧，不复用网格分隔线；亮起来的是贴着接缝的一条线，样子与时机同网格的分隔线（`--sash-line-*` 的线芯，悬停 250ms 后渐显，聚焦与拖动中立即全亮）。指针拖动跟手、触界即停，每帧至多发一次 `segment-width-preview(width)`，松手发一次 `segment-width-commit`；Esc、失去指针捕获、`revision` 在拖动中变了整场取消（预览发 null、不提交）；网格的分隔线手势进行中按下不起拖。键盘：朝区域的方向键变宽、反方向变窄，每次 10 像素；Home 与双击回声明的缺省。别的面板最大化着（`handleDisabled`）时没有手柄。手势的逻辑在 [`use-rail-handle.ts`](use-rail-handle.ts)。
- 焦点交接：焦点在视图段里、视图段收起或拆掉时，焦点所在的元素还在就留着；被拆掉、焦点掉到 body 时交给展开按钮，没有按钮时交给按下的入口。

## 数据

```ts
type ToolStripEntry = {
    /** 容器 id，事件原样带回。 */
    id: string;
    /** 容器的名称，已按当前语言取好。 */
    label: string;
    /** 没有图标可取时是 null，画占位图标。 */
    icon: string | null;
    /** 悬停文字：容器里的各个视图，已按当前语言拼好。 */
    tooltip: string;
    /** 只含一个视图的容器是那个视图的 id；含几个视图的是 null（拖它只换序）。 */
    viewId: string | null;
    /** 侧栏的当前容器。 */
    current: boolean;
    /** 当前容器且侧栏可见。 */
    pressed: boolean;
    /** 图标右上角的计数：容器里各视图 `badge()` 的合计；没有是 null 或不给。 */
    count?: number | null;
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
    /** 哪个区域的侧轨；默认 `sidebar`（活动栏）。`auxiliarybar` 是右轨：没有底段，提示朝左开。 */
    region?: "sidebar" | "auxiliarybar";
    /** 和区域的卡片相连（表面给的）；默认 false。 */
    joined?: boolean;
    /** “更多”按钮的名称。必填。 */
    moreLabel: string;
    /** 按显示顺序排好；受控，必填。 */
    entries: ReadonlyArray<ToolStripEntry>;
    /** 底段；默认无。 */
    items?: ReadonlyArray<ToolStripItem>;
    /** 入口的可访问描述（每个入口都能拖）；默认不写。 */
    dragHint?: string;
    /** 这个入口（容器 id）留着盒子、看不见：它正被拖着（实时布局）。宿主在这里排序时会把它显示出来、写 `translate` 让它竖着跟手，所以它不参与换位过渡。 */
    placeholder?: string | null;
    /** 这个入口（容器 id）盖一层并入的高亮；默认没有。 */
    highlighted?: string | null;
    /** 宿主让内容滚过去的那一次换一个新值，和按下的入口在同一次更新里变：只有这时按下的块滑过去；默认 0。 */
    slideToken?: number;
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

侧栏里没有容器时上段是空的，底段照常。不可用只有底段条目有，见“交互”。

## 不支持

不自己处理拖动。不判断点了做什么（见 `state/layout-present.ts` 的 `regionEntryIntent`），不执行命令。
