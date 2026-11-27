---
标签: [state:local]
别名: ["入口条", "底部面板入口条"]
---

# WorkbenchRegionStrip

底部面板卡片顶上的入口条（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 47）：区域里一个容器一个入口（输出 41），是这个区域的容器切换器。右栏的入口在右轨上（[`WorkbenchToolStrip`](WorkbenchToolStrip.md)，输出 50），不用它。当前容器只有一节时，那一节的头由宿主放进默认插槽，接在入口后面，不多占一行。列哪些容器、点了做什么、头里画什么都由宿主定。

## 布局

占满入口条叶（32px 高的一行），左内边距同面板头。

- **入口**：标题按钮，水平内边距固定 4px（不随主题变），按下是按钮宽度上的一条下划线，同面板头标签带的选中标记。第一个入口的文字和分节头的标题文字同一条竖线。有计数时写在标题后（“通知 2”，`docs/specs/workbench/views.md` 输出 17，超过 99 写“99+”），读屏名称同样带上，量尺按带计数的字量。
- **按下的块**：底色与下划线都不画在按钮上，是入口这一组里一个独立的块（`data-region-indicator`，`aria-hidden`），大小与位置是按下的那个入口，和活动栏的按下的块同一套（[`use-entry-indicator.ts`](use-entry-indicator.ts)，[`WorkbenchToolStrip`](WorkbenchToolStrip.md)）：`slideToken` 变了、按下的入口也换了的那一次滑过去（`data-sliding`，`--motion-layout`、`--ease-layout`，和区域切换容器时的滚动同时走），滑到一半又换一次时从此刻接着滑；别的原因换了按下的入口、条的宽变了、入口收进“更多”时直接到位；没有按下的入口时在原处淡出，再按下时在新的位置淡入；挂上时第一次放下不淡入（`data-settled` 之前没有过渡）。
- **并进来的头**：默认插槽，占这一行剩下的宽度。
- **放不下时的让位**：先缩并进来的头（它的标题截断），缩到 `headMinWidth` 以下之前，排在后面的入口收进末尾的“更多”，当前容器的入口总在外面。头里视图动作收进“⋯”、框架按钮最后，由头自己按宿主给的预算做（[`WorkbenchPanelHead`](WorkbenchPanelHead.md)）。标题入口的宽度在一行看不见的量尺里量。

## 交互

- 点入口、Enter 发 `select`（宿主按 `regionEntryIntent` 切换容器或隐藏区域）；按下鼠标不抢焦点。
- 右键与菜单键发 `context-menu`，坐标是视口坐标（菜单键时在入口下面）。
- 每个入口是一个 Tab 停靠，同活动栏，没有方向键导航。读屏是一组带 `aria-pressed` 的按钮，组的名称是 `label`；入口的可访问名称就是它写的字。
- 入口是拖动源，同活动栏（输出 45、46）：带 `data-tool-entry`（容器 id），只含一个视图的另带 `data-tool-view`，拖它就是拖这个视图；含几个视图的拖的是容器。可访问描述是 `dragHint`。落点的判定与放下由宿主的拖动会话做（`layout-drag.ts`），这里只画：`placeholder` 的入口留着位置、看不见（它正被拖着），别的入口换位时滑过去；`highlighted` 的入口盖一层并入的高亮（`--layout-merge-*`）。每个入口外面一层 `data-entry-frame`，实时布局排序时宿主在它上面写跟手的位移。

## 数据

```ts
interface RegionStripEntry {
    /** 容器 id。 */
    readonly id: string;
    /** 容器的名称。 */
    readonly label: string;
    /** 没有图标可取时是 null，画占位图标。 */
    readonly icon: string | null;
    /** 悬停文字：写出容器里的各个视图。 */
    readonly tooltip: string;
    /** 只含一个视图的容器是那个视图的 id（拖它就是拖这个视图）；含几个视图的是 null。 */
    readonly viewId: string | null;
    /** 区域的当前容器：放不下时它总在外面。 */
    readonly current: boolean;
    /** 当前容器且区域可见；至多一项。 */
    readonly pressed: boolean;
    /** 计数：写在标题后（只含一个视图的容器，同那个视图的标签）。没有是 null 或不给。 */
    readonly count?: number | null;
}

defineProps<{
    /** 区域：写在根上（`data-region-strip`）。 */
    region: string;
    /** 入口这一组的可访问名称。 */
    label: string;
    moreLabel: string;
    entries: ReadonlyArray<RegionStripEntry>;
    /** 并进来的头至少要留多宽；没有并进来的头时是 0（缺省）。 */
    headMinWidth?: number;
    /** 宿主让区域的内容滚过去的那一次换一个新值，和按下的入口在同一次更新里变：只有这时按下的块滑过去；默认 0。 */
    slideToken?: number;
    /** 入口的可访问描述：怎么拿起拖动。 */
    dragHint?: string;
    /** 正被拖着、留着位置看不见的入口（容器 id）；默认 null。 */
    placeholder?: string | null;
    /** 盖并入高亮的入口（容器 id）；默认 null。 */
    highlighted?: string | null;
}>();

defineEmits<{
    (event: "select", id: string): void;
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
}>();
```

插槽：默认插槽是并进来的那一节的头（宿主以面板 id 为 `key`，换了并进来的那一节就是新的头）。

标记：入口带稳定名 `workbench.container` 加容器 id（`data-nb-target`、`data-nb-key`，[`agent/page-agent.md`](../../../../../../../docs/specs/agent/page-agent.md) 输出 6；Agent 的引导按它找入口，不改名）；根 `data-region-strip`（区域）；入口这一组 `data-region-entries`（拖动几何量它的末端）；入口 `data-region-entry` 与 `data-tool-entry`（容器 id）、`data-tool-view`、按下的 `data-pressed`、并入高亮的 `data-tool-merge`；外面一层 `data-entry-frame`；“更多” `data-region-more`；按下的块 `data-region-indicator`，显示着 `data-shown`、滑着 `data-sliding`。

## 状态

量出来的宽度（整条的宽、标题入口各自的宽），随尺寸观察更新；按下的块的位置、显示与滑动。

## 不支持

- 落点的判定与放下：宿主的拖动会话做，组件只画占位与并入的高亮。
