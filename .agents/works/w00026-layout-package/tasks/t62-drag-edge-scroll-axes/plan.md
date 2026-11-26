# t62 实施计划：拖动的边缘滚动——横向与按指针下的滚动容器

第 1 稿（规划子代理起草，主会话 2026-11-26 核对定稿；待确认按推荐做）。探针副本在 [evidences/](evidences/)（`probe-plan.ts.txt`、`probe-plan.test.ts.txt` 用 `bun test` 跑，`probe-browser.mjs.txt` 用本机 Chrome 跑，`probe-happy.dom.test.ts.txt` 用 vitest 跑；原件在 `/tmp/claude-1000/w00026-plans/t62-probe/`）。主会话的改动：工作台的 planned 条目（下文“`ui/workbench-layout.md`”一节）这次不写进 Spec，记进 Work 的“后续”：没有排期的产品行为不先写成合同。下文写“探针 X”就是这几个文件里同名的结果。

## Context

- **问题**（t61 发现）：拖动会话的边缘滚动只看上下边，整场只有一个固定的滚动元素。
  - `nb-layout/src/drag-gesture.ts` 的 `edgeScrollStep` 只算上下边（第 180–187 行）。
  - `src/vue/drag-session.ts` 第 238–242 行只改 `scrollTop`。
  - 标签编组示例的标签条横向滚，有几条；拖到一条的两端它不会自己滚，示例 README 第 29 行把这写成了限制。
- **探针证实**：现在的函数对 400×32 的横向条，两端、越过右端、靠上边全是 0（探针“current strip 400x32”）。把条加高到 60，右端中段还是 0，靠下边反而算出竖向的 13（“current strip 400x60”）。
- **期望结果**：
  - 边缘滚动能横向滚，按指针此刻所在的容器滚：几条标签条各滚各的，指针在哪条的边缘带里就滚哪条。
  - 竖向列表（资源树、Lab 拖动场景）的行为不变。
  - 示例接上边缘滚动，README 删掉那条限制。
  - 工作台这次不接，理由见“不做与风险”。目标行为写成 `ui/workbench-layout` 的 planned 条目，交给后续 Task（待确认项 2）。
- **依据**：[`docs/specs/ui/layout-drag.md`](../../../docs/specs/ui/layout-drag.md) 输出 12、14 与验收 6；[`docs/specs/ui/workbench-layout.md`](../../../docs/specs/ui/workbench-layout.md) 输出 21、38；nb-layout 是 0.x，允许不兼容改动，要记进 `CHANGELOG.md` 的 `[Unreleased]`。
- **工作方式**（开发者定）：编码派 coder；主会话审 diff、自己跑验证并合入；不逐 Task 审查，这一批做完整段交 omp 一次。
- **并行的 t60**（浮动窗几何）在改 `NestedGrid.vue`、`FloatWindowHandles.vue`、`grid-rects.ts`、`grid-motion.ts` 与桌面示例，t62 不碰这些文件。两边都会改的文件：
  - `src/vue/drag-session.md`：t60 只在第 52 行一带加一句链接。t62 的改动放在第 29 行（选项表）和第 39 行之后（新的一段），离第 52 行十行以上，不会撞上。
  - `CHANGELOG.md` 的 `[Unreleased]`：两边都会加行，变基时可能冲突，按“两边都留”手工合。

## 技术选型

无。这次只扩展已有的拖动会话，不引入库。浏览器原生拖放（HTML5 DnD）自带边缘滚动，但会话用的是指针事件加根上的指针捕获，用不上它。

## 关键设计

### 接口：一个回调交候选容器，轴由容器的计算样式决定

推荐的形状：`autoScroll: {containers({point, top}) => HTMLElement[], edgePx?, maxStepPx?}`。依据：

1. **只给一个固定元素不够**：几条标签条要各滚各的，要按指针换容器。
2. **不能把所有容器都交上去**：输出 14 规定“已越过边缘”也滚，而且最快（现有单测 `y: 500 → 16`、`y: -50 → -16`）。
   - 后果：两条标签条并排时，指针在第二条中间，第一条的右端已被越过，它会按最快的 16 一直往右滚（探针“all strips”，`middle.x = {strip1, 16}`）。
   - 所以宿主只交指针所在的那个容器。用来判断的 `top` 由会话给，规则与 `resolve` 的相同（跳过 `data-drag-feedback`）。
   - 真实布局里，按 `top.closest(...)` 找到的就是指针下的那条（探针 browser 的 `s1RightEnd`、`s2LeftEnd`、`gapBetween`：缝里一个都不交）。
3. **固定的列表照旧能越过边缘滚**：资源树、Lab 场景交 `() => [element]`，不看 `top`。
   - 指针越过列表底边时，按 `top` 找是找不到容器的（探针 `pastListBottom` 交回空数组），所以这两处不能按 `top` 找。
   - 竖向列表在新规则下与现有 `edgeScrollStep` 逐点相同，横向不滚（探针“vertical list”，六个点就是 `drag-gesture.test.ts` 612–617 行的那六个）。
4. **交从里到外的列表，不交单个元素**：两个轴各自从前往后挑第一个合格的。
   - 嵌套时各滚各的轴：横向滚的一行放在竖向滚的标签区里，指针在那一行右端又靠标签区上边时，行往右滚、标签区往上滚（探针“nested”与 browser 的 `nestedRowRightNearListTop`）。
   - 里层到头了交给外层；外层这个轴不让滚时就不滚（探针 `rowAtEndChains`）。
5. **轴看计算样式，不看尺寸**：一个轴让不让滚，看计算样式的 `overflow-x`、`overflow-y` 是不是 `auto` 或 `scroll`。
   - 不能用 `scrollWidth > clientWidth` 判：`overflow-x: hidden` 的元素内容照样可以比它宽（669 对 150），程序赋 `scrollLeft = 40` 也照样生效（探针 `hiddenX`）。
   - 资源树就是这种元素：`ExplorerTree.vue` 第 609 行写了 `overflow-x-hidden`。按尺寸判的话，它一有横向溢出就会横着滚。
   - Chrome 里 `overflow: overlay` 的计算值是 `auto`（探针 `overlayComputed`），不用另判。
6. **滚动用 `scrollBy({behavior: "instant"})`**：容器设了 `scroll-behavior: smooth` 时，直接赋 `scrollTop += 16` 后马上读回来还是 0（探针 `smoothAssign`），现在的写法会在第一帧就当成到头。`instant` 读回 16（`smoothScrollByInstant`）。
7. **两个轴都在边缘带里时一起滚**（斜着走）。只能滚一个方向时只滚那个（探针“both axes”）。

另外两个时序依据：
- 键盘拖动不触发边缘滚动：只有指针的 `move` 调 `armAutoScroll`（第 436、445 行）。这一点不变。
- 现有的“每帧先发布再滚”（第 343–351 行）不变，虚拟列表的理由照旧成立。每帧开头重新取候选，所以指针不动、容器在指针下换了的时候，下一帧就换过去。

### `packages/nb-layout/src/drag-gesture.ts`（核心，不碰 DOM）

替换 `DragGestureAutoScroll`，新增两个类型与一个纯函数。这三个名字都不从 `src/index.ts` 导出（第 150–158 行只导出 `DRAG_GESTURE_DEFAULTS`、`defineDropKind` 与四个类型），模块里 `export` 只是给测试用。

```ts
/** 边缘滚动的一个候选容器此刻的样子（适配层每次现量）。 */
export interface DragScrollTarget {
    /** 视口坐标。 */
    readonly rect: GridDropRect;
    /** 四个方向还能滚多少像素；这个轴不让滚时两头都是 0。 */
    readonly room: {readonly left: number; readonly right: number; readonly up: number; readonly down: number};
    /** 滚一步（负数向左、向上）；返回是否真的滚动了。 */
    scrollBy(x: number, y: number): boolean;
}

export interface DragGestureAutoScroll {
    /** 指针在 `point` 时的候选容器，从里到外。没在滚时指针每次移动调一次，在滚时每帧开头调一次（`armAutoScroll` 在已排着滚动帧时不调）。 */
    targets(point: GridDropPoint): ReadonlyArray<DragScrollTarget>;
    readonly edgePx?: number | undefined;
    readonly maxStepPx?: number | undefined;
}

/** 一个轴上这一帧滚哪个容器、滚多少。 */
export interface EdgeScrollPick {
    readonly target: DragScrollTarget;
    readonly step: number;
}

/**
 * 一个轴上的步进（负数向左、向上）：指针在另一个轴的范围内、离这个轴的一端不到 `edgePx` 或已越过这一端时滚，越靠边越快；
 * 这个轴上短到两条边缘带相接时不滚。`axis: "y"` 的结果与原来的 `edgeScrollStep` 逐点相同。
 */
export function edgeScrollStep(rect: GridDropRect, point: GridDropPoint, axis: "x" | "y", edgePx = EDGE_PX_DEFAULT, maxStepPx = EDGE_MAX_STEP_PX_DEFAULT): number;

/** 两个轴各从前往后挑第一个“步进不为 0、这个方向还有余量”的容器；两个都没有是 null。 */
export function edgeScrollPlan(targets: ReadonlyArray<DragScrollTarget>, point: GridDropPoint, edgePx = EDGE_PX_DEFAULT, maxStepPx = EDGE_MAX_STEP_PX_DEFAULT): {readonly x: EdgeScrollPick | null; readonly y: EdgeScrollPick | null} | null;
```

- `edgeScrollStep` 照抄探针 `plan.ts` 的写法：两个轴共用一份代码，按 `axis` 取起止边与交叉轴的范围。
- `edgeScrollPlan` 照探针的写法，两个轴都没挑到时返回 null。余量判 `room > 0`。
- 状态机里的改法：
  - `armAutoScroll(point)`：`if (edgeScrollPlan(scroller.targets(point), point, scroller.edgePx, scroller.maxStepPx) !== null) scrollFrame = clock.requestFrame(autoScrollTick)`，其余守卫不变。
  - `autoScrollTick`：
    1. 先 `const plan = current === null || scroller === undefined ? null : edgeScrollPlan(scroller.targets(current.point), ...)`；plan 为 null 时 `autoScrolling = false` 并返回。
    2. 然后 `publish()`，接着 `if (active !== current) return`，再 `autoScrolling = true`。
    3. 然后 `if (!scrollPlan(plan))`：`autoScrolling = false` 并返回。
    4. 最后排下一帧。

    第 343 行那条注释原样保留。
  - 新增内部函数 `scrollPlan(plan): boolean`：
    - x、y 挑到的是同一个容器时调一次 `scrollBy(x.step, y.step)`；否则分别调 `scrollBy(step, 0)` 与 `scrollBy(0, step)`。
    - 两次调用的结果先存进两个常量再取“或”，不要写成 `a() || b()`：那样前一个返回真时后一个不会调。
  - 模块头与 `edgeScrollStep` 的注释改成两个轴的说法。
- 不变量：
  - 核心不引用 `window`、`document`（`boundary.test.ts` 守着）。
  - 发布先于滚动。
  - 滚动中松手的“放下中”一段一字不改（第 456–470 行）。

### `packages/nb-layout/src/vue/drag-session.ts`（DOM 适配）

`DragSessionOptions.autoScroll` 换成下面这样（照旧是内联类型，不新增导出的名字）：

```ts
/**
 * 边缘滚动（Spec `ui/layout-drag` 输出 14）；缺省不滚。
 * `containers`：指针此刻所在的、要边缘滚动的容器，从里到外；空数组不滚。没在滚时指针每次移动调一次，在滚时每帧开头调一次，可以现读状态。
 * 指针越过容器的一端也算在那一端的边缘带里：并排的几个容器只交指针所在的那个，不然指针在后一个里时前一个也在滚。
 * `top` 同 `resolve` 的（反馈元素不算，视口外为 null）；固定的列表不用看它，交 `() => [element]`。
 */
readonly autoScroll?: {
    containers(query: {readonly point: GridDropPoint; readonly top: Element | null}): ReadonlyArray<HTMLElement>;
    readonly edgePx?: number;
    readonly maxStepPx?: number;
};
```

- 新增模块内函数 `scrollTargetOf(element: HTMLElement): DragScrollTarget`：
  - 读 `view.getComputedStyle(element)` 的 `overflowX`、`overflowY`，值在 `new Set(["auto", "scroll"])` 里才算这个轴让滚。
  - `rect` 取 `getBoundingClientRect()` 的四边。
  - `room` 的四个方向：
    - `left`：`scrollLeft`；
    - `right`：`scrollWidth - clientWidth - scrollLeft`；
    - `up`：`scrollTop`；
    - `down`：`scrollHeight - clientHeight - scrollTop`。

    四个都先 `Math.max(0, …)`。这个轴不让滚时两头都是 0。
  - `scrollBy(x, y)`：先记下 `scrollLeft`、`scrollTop`，调 `element.scrollBy({left: x, top: y, behavior: "instant"})`，返回两者有没有变。
  - 注释写三件事：
    - 为什么只看计算样式：`overflow: hidden` 的元素程序照样滚得动；
    - 为什么用 `instant`：`scroll-behavior: smooth` 时赋值后马上读回来是旧值；
    - 从右到左排版（`scrollLeft` 为负）的横向余量不对，现在没有这样的使用方。
- 交给状态机的 `autoScroll`：`{edgePx, maxStepPx, targets: (point) => autoScroll.containers({point, top: topElementAt(document, point)}).map(scrollTargetOf)}`。切片 2 里公开选项还是 `element`，这一处先写成 `targets: () => [scrollTargetOf(autoScroll.element)]`，切片 3 再换成上面的写法。
  - `top` 每次调用都现算：在 `pointermove` 里调时，还没判定，没有现成的可用。代价是拖动中每次移动、每帧滚动各多一次 `elementsFromPoint`，固定列表的宿主不读它也照样要算。见“不做与风险”。
- 模块头不用改。

### `packages/nb-layout/src/vue/useDragSession.ts`

头注释第 6–8 行改成：“……`autoScroll`、`keyboard`、`scroll`、`config` 在建时定死；要随状态变的东西写成回调里现读的值，`autoScroll.containers` 每次现调，取 `v-if`、`v-for` 后面的模板 ref 也读得到当时的值。”删掉原来那句“可能还是 null”。

### `packages/nb-layout/src/vue/drag-session.md`

- 第 29 行选项表那一行改成：“`autoScroll?` | `{containers({point, top}), edgePx?, maxStepPx?}`：指针靠近容器的边时自动滚动，见下面的“边缘滚动”；缺省不滚”。
- 在第 39 行（起拖门槛）之后、第 41 行（起拖时网格还在过渡）之前插入新的一段，原文草稿：

  > **边缘滚动**：没在滚时指针每次移动、在滚时每帧开头，会话调一次 `containers`，按交回的先后（从里到外）给横竖两个轴各挑一个容器：这个轴让滚（计算样式的 `overflow-x`、`overflow-y` 是 `auto` 或 `scroll`）、这个方向还没到头、指针离这一端不到 `edgePx`（缺省 24）或已越过它。两个轴都挑中时一起滚。越过一端也算，所以几条并排的标签条只交指针下的那条：`containers: ({top}) => { const strip = top?.closest<HTMLElement>("[data-tab-strip]"); return strip == null ? [] : [strip]; }`；固定的列表交 `() => [list]`，指针拖出列表上下边时照样滚，而且最快。每帧先按上一帧滚动后的内容判定、再滚，滚动中松手等下一帧再放下（Spec 输出 14）。

### `packages/nb-layout/api/vue.api.txt` 与 `CHANGELOG.md`

- 在 nb-layout 下先跑 `bun run api:report` 重写报告，再跑 `api:check`。只有 `DragSessionOptions.autoScroll` 这一段会变；SDK 的 `packages/neuro-book/src/sdk/nb-layout-surface.txt` 里没有 `DragSession` 相关的名字，不变。
- `[Unreleased]` 新增 `### 不兼容的改动` 小节（放在 `### 改动` 之前），并在 `### 新增`、`### 改动` 里各加一条。原文草稿：
  - 不兼容的改动：拖动会话的 `autoScroll` 不再收 `element`，改收 `containers({point, top})`：指针此刻所在的、要边缘滚动的容器，从里到外，没在滚时指针每次移动调一次，在滚时每帧开头调一次。原来的 `autoScroll: {element}` 改成 `autoScroll: {containers: () => [element]}`，竖向列表的行为不变（越过上下边照旧最快）。`overflow-y: hidden` 的元素以前给了就滚 `scrollTop`，现在不滚：轴看计算样式。
  - 新增：边缘滚动能横向滚。哪个轴滚由容器的计算样式定（`overflow-x`、`overflow-y` 是 `auto` 或 `scroll`），两个轴都在边缘带里时一起滚；几条标签条按指针各滚各的，嵌套的容器按从里到外的先后各挑各的轴。
  - 改动：边缘滚动改用 `scrollBy({behavior: "instant"})`，设了 `scroll-behavior: smooth` 的容器也一帧一步地滚。以前第一步之后读回来的位置没变，被当成滚到头停了。

### 调用方迁移（与适配层同一个提交，否则类型检查不过）

`autoScroll` 在 `packages/`（不含 legacy）下共 43 处引用，分布在 8 个文件里：

| 文件 | 处数 | 怎么处理 |
|---|---|---|
| `nb-layout/src/drag-gesture.ts` | 16 | 上面已写 |
| `nb-layout/src/drag-gesture.test.ts` | 12 | 测试改法见下 |
| `nb-layout/src/vue/drag-session.ts` | 9 | 上面已写 |
| `nb-layout/src/vue/useDragSession.ts` | 2 | 只改注释 |
| `nb-layout/src/vue/drag-session.md` | 1 | 上面已写 |
| `nb-layout/api/vue.api.txt` | 1 | 重新生成 |
| `neuro-book/src/plugins/explorer/web/components/ExplorerTree.vue:260` | 1 | `autoScroll: {element}` → `autoScroll: {containers: () => [element]}` |
| `neuro-book/src/plugins/lab/web/fixtures/nb-layout/DragSessionScene.vue:55` | 1 | `{element: scroller}` → `{containers: () => [scroller]}`，保留上面那个“读不到就报错”的检查 |

- `edgeScrollStep` 与 `DragGestureAutoScroll` 只在 `drag-gesture.ts` 和它的测试里出现。
- 插件 SDK 不导出这些类型。
- `useSortable`、`SortableList` 与工作台的 `layout-drag.ts` 都没传 `autoScroll`，行为不变。

### `packages/nb-layout/examples/tabbed-panels`

- `src/App.vue` 的 `useDragSession` 选项加一项，带注释：

  ```ts
  // 边缘滚动：只交指针下的那条标签条。越过一端也算在边缘带里，几条都交的话，指针在右边那条里时左边那条也在滚。
  // 标签条只横着滚（样式里 overflow-y: hidden），竖向的边缘带在 32px 高的条上本来也不算。
  autoScroll: {
      containers: ({top}) => {
          const strip = top?.closest<HTMLElement>("[data-tab-strip]") ?? null;
          return strip === null ? [] : [strip];
      },
  },
  ```

- `README.md`：
  - 删掉第 29 行那条限制。
  - “读的顺序”第 3 条的括号里加一项“边缘滚动（`autoScroll`）”。
- `src/TabBar.vue` 第 70 行的注释后面接一句：“拖到条的两端时它自己滚（`App.vue` 的 `autoScroll`）。”

## Spec 与文档改动

当前的最大编号：`ui/layout-drag` 输出 23、验收 6；`ui/workbench-layout` 输出 51、验收 37。新条目只在末尾追加。Spec 在主工作区的 master 上改（切片 1）。

### `docs/specs/ui/layout-drag.md`

1. **输入类型块第 68–69 行**换成：

   ```ts
       /** 边缘滚动：指针此刻所在的容器，从里到外；缺省不滚（输出 14）。 */
       readonly autoScroll?: {
           containers(query: {readonly point: GridDropPoint; readonly top: Element | null}): ReadonlyArray<HTMLElement>;
           readonly edgePx?: number;
           readonly maxStepPx?: number;
       };
   ```

2. **输出 14 原地改写**（编号不变；新句子标 planned，收口时去掉）：

   > 14. **边缘滚动**：配了 `autoScroll` 时，没在滚时指针每次移动、在滚时每帧开头调一次 `containers`（`top` 同输出 5），按交回的先后（从里到外）给横竖两个轴各挑一个容器（planned）。容器在一个轴上被挑中要同时满足：这个轴让滚（计算样式的 `overflow-x` 或 `overflow-y` 是 `auto` 或 `scroll`），这个方向还没滚到头，指针在它另一个轴的范围内、离这个轴的一端不到 `edgePx`（缺省 24）或已越过这一端；这个轴上短到两条边缘带相接（不超过 `2 × edgePx`）时不挑（planned）。挑中的逐帧滚，越靠边越快，每帧最多 `maxStepPx`（缺省 16）；两个轴都挑中时一起滚（planned）。每一帧先按上一帧滚动后的内容判定并发布，再滚这一帧。两个轴都挑不到、或滚了没动时停，等指针再动。滚动中松手：先停滚，等下一帧，判定并发布一次，按这一次的落点放下。

3. **验收新增 7**：

   > 7. （planned）Given 标签编组示例里一条标签条放不下、滚在最左，When 拖别的编组的标签到它右边那个编组的标签条右端，Then 放不下的这一条不滚；When 再拖到放不下的这一条的右端停住，Then 它往右滚到头，插入线跟着换，松手插在最后；When 拖到它的左端停住，Then 滚回最左。

4. **Smoke 与证据**的 Smoke 各加一项：`packages/nb-layout/e2e/tabbed-panels.e2e.ts`（输出 14 的横向与按指针挑容器，验收 7）。

### `docs/specs/ui/workbench-layout.md`（planned，后续 Task 实现）

> 52. **标签条的边缘滚动**（planned）：拖动中指针停在一条横向滚动的标签条的两端（关掉多行时编辑组的那一行、多行时固定标签那一行），这一条自己往那头滚（规则同 [ui.layout-drag](layout-drag.md) 输出 14），插入位跟着滚动换；指针在哪条上滚哪条，别的标签条不动。两种手感都这样：实时布局下被拖的标签停在条的那一端，内容从它底下滚过，邻居照样按它的位置让开（输出 38“标签条上”）。多行时标签区的纵向滚动不随拖动滚；工具面板的标签条放不下时收进“更多”，不滚。

> 38. （planned）Given 关掉多行、一个编辑组的标签横向放不下，When 把另一组的标签拖到这一组标签条的右端停住，Then 标签条往右滚到头，插入线（实时布局下是让开的位置）跟着走，松手插在指针下的位置；另一组的标签条不动。减少动效、手感设成落点指示时同样（键盘拖动没有边缘滚动）。

同时在 Task README 记一行：后续 Task 实现输出 52 与验收 38，链接本计划的“不做与风险”。

## 切片

| 片 | 内容 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|---|
| 0 | 基线 | — | 不提交 | 在分支起点跑“验证”里的 e2e 清单，记下结果 |
| 1 | Spec 草稿（主工作区 master）：主会话已做，只改了 `ui/layout-drag`（输入类型块、输出 14 的 planned 改法、验收 7）；Smoke 一行收口时加 | Spec 一节 | 已提交 | — |
| 2 | 核心与适配层的内部映射 | `drag-gesture.ts`；`drag-session.ts` 里新增 `scrollTargetOf`，公开选项先不动，内部映射成 `targets: () => [scrollTargetOf(autoScroll.element)]` | 一个提交：源码加核心测试 | 在 nb-layout 下 `bun test src/drag-gesture.test.ts`、`bun test src/boundary.test.ts`、`bun run typecheck`；`bunx vitest run src/vue/drag-session.dom.test.ts`（原有用例照过） |
| 3 | 公开接口改名与迁移 | `drag-session.ts` 的 `autoScroll` 换成 `containers`、`top` 的计算；`useDragSession.ts`、`drag-session.md`、api、CHANGELOG、两处调用方 | 一个提交 | 见下 |
| 4 | 示例 | 示例一节、tabbed-panels e2e | 一个提交 | 见下 |
| 5 | 收口 | 去掉 layout-drag 的 planned 标记；Task README | 一个提交（主工作区） | 全部验证 |

**切片 2 的测试**：改 `src/drag-gesture.test.ts` 的 `describe("输出 14：边缘滚动")`。
- 现有两条 `edgeScrollStep` 用例补上 `"y"` 参数，期望值不变。
- 新增 `"x"` 的同构用例：两端、越过一端、交叉轴范围外、窄到两条带相接。
- `scroller(limit)` 改成交 `targets: () => [target]`，`target` 的 `room` 给足，`scrollBy` 照旧按 `limit` 返回真假。
- 新增四条用例：
  1. “两个轴各挑各的：里层只横向滚、外层只竖向滚时，角上两个都滚；里层这个方向没余量时交给外层；外层这个轴不让滚时不滚”；
  2. “两个轴都挑中、是同一个容器：一帧滚一次，两个方向都动”；
  3. “候选每帧现取：指针不动，下一帧 `targets` 交回别的容器，就滚那一个”；
  4. “余量为 0 时指针进边缘带不排帧”（`pendingFrames` 只剩发布的那一帧：先 `clock.frame()` 跑完发布，再断言为 0）。
- 原有的“滚到头停下，指针再动才接着试”：最后一步断言改成“指针再动：有余量就接着滚，没余量不滚”。

**切片 3 的测试**：`src/vue/drag-session.dom.test.ts` 新增 `describe("输出 14：边缘滚动的容器与轴")`。
- 夹具：在根里放一个容器元素。用 `Object.defineProperty` 给这个实例定 `getBoundingClientRect`、`scrollWidth`、`clientWidth`（happy-dom 里它们是 0；探针 `happy.dom.test.ts` 证实计算样式读得到样式表里的 `overflow`，`scrollBy({behavior: "instant"})` 会改 `scrollLeft`，但 `scrollLeft` 不夹在最大值内）。帧用真的 `requestAnimationFrame`，等法照文件里已有的写法：`await new Promise((r) => requestAnimationFrame(r))`。
- 四条用例：
  1. “`containers` 收到指针坐标与 `top`（跳过反馈元素）”：`hit` 设成 `[反馈元素, 容器]`，断言 `top` 是容器；
  2. “`overflow-x: auto` 的容器，指针在右端带里：`scrollLeft` 逐帧变大”；
  3. “`overflow-x: hidden` 的容器，内容比它宽，指针在右端带里：`scrollLeft` 不变”。这是否定断言：先排一帧能看见的发布（`state.value.point` 变了）再断言；
  4. “`containers` 交回空数组不滚”。

切片 3 自跑：
- 在 nb-layout 下：`bunx vitest run src/vue/drag-session.dom.test.ts src/vue/useDragSession.dom.test.ts`、`bun run typecheck`、`bun run api:report`、`bun run api:check`。
- 在 neuro-book 下：`bun run typecheck`、`bun test src/sdk/sdk.test.ts`（证明 SDK 快照没变）、`bunx vitest run src/plugins/explorer/web/components/ExplorerTree.dom.test.ts`。

**切片 4 的测试**：改 `packages/nb-layout/e2e/tabbed-panels.e2e.ts`。

- **改第 116 行那条**（t61 的“插到第一个滚出去的前面”）：现在的指针在 `visibleRight - 3`，在 24px 的边缘带里，接上之后标签条会在静止的指针下自己滚，断言的插入位跟着变。改法照 `editor-area.e2e.ts:943–950`：
  1. 把标签条滚到某个标签的右缘正好贴着条的右缘：`row.scrollLeft += frame.right - view.right`。
  2. 指针放在 `last.rect.right - (EDGE + 2)`，`EDGE = 24` 并注释“库的缺省，drag-session.md”。
  3. 加两条前置断言：`last.rect.width / 2 > EDGE + 2`（指针在它后半，又在边缘带外），以及后继整个在条右缘外。
  4. 再断言标签条的 `scrollLeft` 等两帧后不变，证明没在边缘滚动。

  这条规则另有单测守着：`src/grid-drop.test.ts:203`。
- **新增一条**：“标签条放不下时拖到它的右端：这一条自己往右滚到头、插入线跟着换，指针在旁边那条里时它不动；拖到左端滚回最左；滚到头再松手插在最后（docs/specs/ui/layout-drag.md 输出 14、验收 7）”。步骤：
  1. 同第 116 条的准备：窗口 1000×800，把 notes.txt、styles.css 挪进 group-1，断言 `scrollWidth > clientWidth`。
  2. `pickUp` group-3 的 index.html，把 group-1 的 `scrollLeft` 置 0。
  3. 移到 group-2 标签条右端往里 4px 处，`moveTo` 期望 `/^insert:group-2:/`；`twoFrames` 之后断言 group-1 的 `scrollLeft` 仍是 0。
  4. 移到 group-1 右端往里 4px 处，`moveTo` 期望 `/^insert:group-1:/`；`expect.poll(scrollLeft)` 等于 `scrollWidth - clientWidth`；`data-drop` 最终是 `insert:group-1:end`。
  5. 移到 group-1 左端往里 4px 处，`moveTo` 期望 `/^insert:group-1:/`；`expect.poll(scrollLeft)` 等于 0；`data-drop` 是 `insert:group-1:README.md`。
  6. 回到右端，等滚到头再 `mouse.up`；`expectTabs` 的顺序是原来六个加末尾的 index.html。

  前提是 group-2 在 group-1 右边、两条标签条在同一高度：先断言两条的 `top` 相同，group-2 的 `left` 大于 group-1 的 `right`。

切片 4 自跑：在 nb-layout 下 `bun run typecheck`、`bun scripts/examples.ts build`，然后 `bunx playwright test -c e2e/playwright.config.ts e2e/tabbed-panels.e2e`。

**变异检查**（每条先提交或备份再改，照 docs/testing 的“变异检查”）：

| 改坏 | 应该失败的用例 |
|---|---|
| `edgeScrollPlan` 去掉 `room > 0` | 切片 2 的第 1 条与“余量为 0 不排帧” |
| `scrollTargetOf` 把 `hidden` 也算作让滚 | 切片 3 的第 3 条 |
| `scrollPlan` 写成 `a() \|\| b()` | 切片 2 的第 1 条（角上两个容器都要滚） |
| 示例的 `containers` 改成交全部 `[data-tab-strip]` | 切片 4 新增那条的第 3 步 |
| 去掉第 116 条里改过的指针位置（放回 `visibleRight - 3`） | 它的 `scrollLeft` 不变断言 |

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| `ui/layout-drag` 输出 14（轴、按候选从里到外挑、两个轴一起滚、先发布再滚、到头停、滚动中松手） | `drag-gesture.test.ts` 的“输出 14”（原有与新增）；`drag-session.dom.test.ts` 的“输出 14：边缘滚动的容器与轴”；`lab-drag-session.e2e.ts:239`；`tabbed-panels.e2e.ts` 新增那条 |
| 输出 12 的“边缘滚动自己滚出来的滚动不撤下” | 原有的 `drag-gesture.test.ts`“自己滚出来的滚动不撤下”；`lab-drag-session.e2e.ts:255` |
| 验收 6 | `lab-drag-session.e2e.ts:239`、`files-explorer.e2e.ts:1011` |
| 验收 7（新） | `tabbed-panels.e2e.ts` 新增那条 |
| `ui/workbench-layout` 输出 52、验收 38 | 后续 Task |

## 验证

**单测与 dom**：见各切片的自跑命令；收口时在仓库根跑 `bun run test:affected`。

**合入前跑一次的 e2e 清单**（切片 0 先在起点跑一遍作基线），共 4 个文件：
- nb-layout：在 nb-layout 下 `bun scripts/examples.ts build`，然后 `bunx playwright test -c e2e/playwright.config.ts e2e/tabbed-panels.e2e`（整份；起点 15 条，做完 16 条）。
- 应用：在 neuro-book 下先 `bun run build && bun run build:e2e`，然后 `bunx playwright test -c e2e/playwright.config.ts e2e/lab-drag-session.e2e e2e/files-explorer.e2e.ts:545 e2e/files-explorer.e2e.ts:1011`。
  - 加上 `e2e/editor-area.e2e.ts:929` 作对照：它在实时布局里拖到滚出视口的标签条右缘，工作台没接 `autoScroll`，结果应当不变。
  - 不跑 `workbench-drag-cost.e2e.ts` 与工作台其余拖动 e2e：工作台不传 `autoScroll`，状态机里改到的只有 `armAutoScroll` 与 `autoScrollTick`，没配 `autoScroll` 时第一行就返回。

**实施中改动后只重跑**：
- 切片 2：只跑单测。
- 切片 3：跑 dom 测试，加 `lab-drag-session.e2e`、`files-explorer.e2e.ts:545`、`:1011`。
- 切片 4：跑 `tabbed-panels.e2e`。

跑长验证前先看 `cat /proc/loadavg`，写探针时它是 19。

**留下的未验证边界**：
- 从右到左排版的容器。
- 横向边缘滚动中途松手：只有核心单测，e2e 等滚到头再松手。
- 触摸拖到边缘：只有指针移动会触发，与竖向相同，没有单独的 e2e。

## 不做与风险

**工作台这次不接**，理由如下（待确认项 2）：

1. **会横着滚的标签条很少**：
   - 编辑器标签默认多行（`editor/shared/settings.ts` 的 `wrapTabsSetting` 缺省 `true`），只有关掉多行，或多行时固定标签那一行，才横着滚（`EditorTabBar.vue` 第 57–61 行）。
   - 工具面板的标签条是 `overflow="adapt"`，放不下时收进“更多”，那一行是 `overflow: hidden`（`TabStrip.vue` 第 320–322 行），从不滚。
2. **实时布局（缺省手感）在拿起时冻结了标签条的量取**（`layout-drag.ts` 的 `freeze`、`stripSnapshot` 读 `frozen()?.strips`），边缘滚动一滚这份就过期了，插入位会判错。要按每行拿起时的 `scrollLeft` 平移快照（可以借现成的 `translateTabStrip` 的写法），这已经碰到判定的几何。
3. **实时布局还假定指针不动时内容不动**：
   - `live.unmoved(point)`（`layout-drag.ts:846`）：收起、展开之后，指针没动就沿用那一刻的结论；
   - `live.sticky(point)`（第 709 行）：指针在已显示的空位里时候选不变。

   边缘滚动时指针不动、内容在动，两条都会让插入位停在滚动之前。这要改 `nb-layout/src/live-drag.ts` 或宿主，得先在真实浏览器里跑探针（内核时序设计先跑探针）。
4. **`TabStrip` 的 `reveal` 会在活动标签变的时候自己滚那一行**（`TabStrip.vue` 第 115–134 行）。实时预览让被拖的标签成为目标条的活动标签时，它和边缘滚动会不会一起滚，没有核过。
5. **要改写现有 e2e**：`editor-area.e2e.ts:929` 的指针在 `edge.right - 3`，在边缘带里，接上就要改。
6. **还要跑开销 e2e**：接上后 `containers` 会在 `pointermove` 里读 DOM，`workbench-drag-cost.e2e.ts`（每帧至多一次样式重算）要先跑基线再对照。

所以只写 planned 条目，由后续 Task 带着探针做。

**其他风险**：
- **开销**：拖动中每次指针移动都多一次 `elementsFromPoint`、一次 `getComputedStyle` 与几个滚动尺寸的读取，边缘滚动中每帧再来一次。读的时机在 `pointermove` 里（上一帧渲染完，布局是干净的），或在边缘滚动那一帧的开头，不会强制额外的样式重算；资源树与 Lab 场景的拖动没有开销 e2e 守着。
- **行为变化**：`overflow-y: hidden` 的元素不再被边缘滚动。现有两处调用方都是 `auto`（资源树 `overflow-y-auto`，Lab `overflow: auto`），不受影响；npm 上的使用方看 CHANGELOG。
- **与 t60 的冲突**：只可能在 `CHANGELOG.md` 的 `[Unreleased]`；`drag-session.md` 的改动位置已错开（见 Context）。
- **独立设计**：implementation-planning 要求的“独立设计”这一步没有做：本草稿由子代理写，没有再开子代理另出一版。主会话可以决定要不要补。

## 待确认项（缺省按推荐做）

1. **`autoScroll` 去掉 `element`，只留 `containers`**。推荐去掉：一个机制，0.x 允许不兼容，仓库里只有两处调用方要迁移，迁移是一行。另一个做法是留 `element` 作简写、内部归一成 `() => [element]`，代价是公开面上两种写法、说明里多一段。
2. **工作台这次不接**。推荐不接：Spec 写 planned 的输出 52、验收 38，另开一个后续 Task。理由见“不做与风险”第 1–6 条，主要是默认配置下几乎没有横着滚的标签条，而实时布局的冻结几何、`unmoved`、`sticky` 都要改，要先跑探针。另一个做法是这次接，这样要多两片（工作台接线、快照按滚动平移，外加 `unmoved`、`sticky` 的处理），e2e 清单要加 `editor-area.e2e.ts:929` 的改写与 `workbench-drag-cost.e2e.ts`。
3. **多行标签区的纵向滚动不随拖动滚**（写进了输出 52）。推荐不滚：标签区至多 3 行，高 102px（`EditorTabBar.vue` 的 `--editor-tab-h: 34px` 乘 3），24px 的边缘带盖住第一行的大半，拖进第一行就开始往上滚。
4. **`scroll-behavior: smooth` 不进 Spec**。推荐照草稿：实现照做（`scrollBy` 带 `behavior: "instant"`），只写进 `drag-session.ts` 的注释与 CHANGELOG，输出 14 不写这一句：没有 dom 或 e2e 能断言它（happy-dom 不模拟平滑滚动），只有探针 `smoothScrollByInstant`。另一个做法是写进 Spec 并在 Lab 场景里加一个平滑滚动的容器做 e2e。
5. **两个轴同时在边缘带里时斜着滚**。推荐照做：与浏览器原生行为一致，规则就是“每个轴各挑各的”，不另加判断。现在的使用方里只有既能横滚又能竖滚的容器才会碰到，资源树与示例都碰不到。
