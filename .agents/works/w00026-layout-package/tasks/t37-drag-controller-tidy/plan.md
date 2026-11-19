# t37 整理拖动控制器，纯的部分抽进库：实施计划（第 1 稿）

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“手感引擎分两步”的第一步（第一档第 6 项，开发者 2026-11-18 定）；t26 深入审查的 design-09、design-10（[`deep-review-design.txt`](../t26-layout-deep-review/evidences/deep-review-design.txt)）。
- 要做的三件：
  1. 在应用里把每场拖动的状态收进一个对象；
  2. 判定拆成纯函数，补单元测试；
  3. 把卡片的缩放与追赶、帧调度（含按住不动时停下）、卡片位置的换算抽进 nb-layout。
- 第二步（编排进库：`stepPreview`、撕下来源、收起后重判、指针不动不重判、空位粘住）不在本 Task。
- 验收（提案原话）：工作台手感不变，判据是 `workbench-live-drag`、`workbench-dnd` 两份 e2e 与相关 Lab 场景不变（对照基线）；新增的纯函数有单元测试。
- 现状（只读盘点 [`evidences/inventory.txt`](evidences/inventory.txt)，行号是 `b28277e7b` 的）：
  - `packages/neuro-book/src/plugins/workbench/web/layout-drag.ts` 1134 行，`createLayoutDrag` 闭包里有 14 个 `let`；复位分在 `activate`、`resolve`、`onActiveChange(false)` 三处；`held` 声明在用它的回调之后。
  - `live-drag.ts` 382 行，有 `live-drag.test.ts`。`layout-drag.ts` 没有单元测试。
  - 一场的收场顺序（`nb-layout/src/drag-gesture.ts` 的 `finish`）：`released` → `publish(null)` → `onActiveChange(false)` → `onEnd` → `commit`；`abort` 不调 `onEnd`。
- 工作方式：每一片都不改行为、可以单独回退。每片跑 e2e 对（`workbench-live-drag`、`workbench-dnd`）；第 2、3 片改到整窗拖动，另跑 `workbench-float`；第 4 片改到帧循环与卡片，另跑 `workbench-drag-cost`（每帧的样式重算与布局次数）。

## 技术选型

无：帧循环与指数逼近都是几十行的纯函数，没有要引入的库。

## 关键设计

### 删冗余：`layout-drag.ts`、`live-drag.ts`

- 删 `sourceCollapsed`：它与 `beforeCollapse !== null` 总是一起写、一起清；唯一的读者 `candidateDoc` 改读后者。
- 删 `LiveDrag.origin()`：没有调用方。
- `LiveDragHost.collapseSource` 改为返回 `boolean`（真的收起了没有）。`live-drag` 的 `collapsed` 只在它返回真时置位，`stepPreview` 与 `tearOff` 两处都改。
  - 这样“来源收起着”只剩两份：预览的（`live-drag`）与判定几何的（`layout-drag`），而且不会对不上。
  - 返回假时：
    - `stepPreview`：`collapsed` 留着假，照常按候选摆预览。判定几何也没收起，两边一致；候选摆不出来时显示已提交的文档（`collapsed` 为假的那一支）。下一次换预览时再试。
    - `tearOff`：返回假，不换预览、不写状态；下一帧照常再试。
    - 失败只有两种：还没冻结（拿起后到 `nextTick` 那一瞬，第一帧之前已经冻结），或来源不在文档里（结构变了，下一次判定整场取消）。所以重试最多几帧。
  - 今天这两种早退都走不到，这条不改可观察行为。
  - `live-drag.test.ts` 补两条：`stepPreview` 里返回假时不算收起，之后回到原处不调 `expandSource`；`tearOff` 里返回假时预览不换成来源收起，下一帧再试、成功后才换。

### 每场的状态一个对象：`layout-drag.ts`

```ts
/** 一场拖动的状态：拿起时新建；收场时丢掉，没收场就被下一次拿起换掉。 */
interface DragRun {
    readonly previews: Map<string, LayoutDragDrop<LayoutDropAction>>;
    previewsOf: LayoutDoc | null;
    frozen: FrozenGeometry | null;
    beforeCollapse: FrozenGeometry | null;
    readonly pressedAt: GridDropPoint | null;
    readonly newContainer: string;
    windowDrag: WindowDrag | null;
    /** 最后一次判定（含被拒绝、编辑器的拒绝）。 */
    judged: Judgement;
    /** 来源收起、展开那一刻的判定：指针不动之前一直是它。 */
    held: {readonly point: GridDropPoint | null; readonly judged: Judgement} | null;
    readonly sort: StripSortState;
    shown: {readonly drop: LayoutDragDrop | null; readonly key: string};
}
interface Judgement {
    readonly drop: LayoutDragDrop | null;
    readonly rejected: boolean;
    readonly refusal: EditorRefusal | null;
}
let run: DragRun | null = null;
```

- **寿命**：
  - `activate` 里 `run = freshRun(...)`；`activate` 返回 `false` 的分支置回 `null`（整窗没有矩形时）。
  - `onActiveChange(false)` 里先 `live.end()`：它要经 `run.sort` 放回排序中的标签。再撤窗，然后 `run = null`。
  - 有一条路径拿起了却不收场：键盘拿起时 `activate` 返回真、`regions` 为空，会话直接返回（`drag-gesture.ts` 的 `startKeyboard`），不调 `onActiveChange`。
    - 这时 `run` 留到下一次 `activate` 被换掉。
    - 键盘不走实时布局、来源不会是整窗，所以留下的 `run` 没有冻结的几何与窗，`fileDrop` 读到的和 `null` 一样。
    - 指针的路径都收场：`activate` 返回假时会话不起拖；捕获失败时 `start` 先调 `onActiveChange(true)` 再取消，照常收场。
  - 所以不变量写成“拿起时新建，下一次拿起前一定换掉；收场后为 `null`”，不写成“结束时一定为 `null`”。
  - 复位只剩“新建”一处，新加的每场字段不初始化就是类型错误。
- **判定带回附带的结果**：`overRejected`、`editorRefusal` 两个 `let` 去掉。
  - `dropAt`、`resolveDrop` 返回 `Judgement`；`resolve` 回调把它存进 `run.judged`，再按它写光标标记。
  - `held` 存的是 `{point, judged}`：`collapseSource`、`expandSource` 用宿主传来的 `drop` 加上 `run.judged` 的另外两项，和今天读两个 `let` 一样。
- **交给 `onEnd` 的拒绝**：`onEnd` 在 `onActiveChange(false)` 之后调，这时 `run` 已经是 `null`。
  - `onActiveChange(false)` 把 `run.judged.refusal` 交给一个 `let refusalAtEnd`，`onEnd` 读完清掉。
  - 会话总是紧接着调这两个（`finish` 的顺序）；`abort` 不调 `onEnd`，下一次收场会覆盖它。注释写明这条时序。
  - 这条路径（编辑器不让放的落点上松手，交给编辑器写提示）在 e2e 目录里按 `dropOutcome`、`refuse`、`未裁决` 没搜到用例：造“未裁决输入”要编辑器的冲突状态。本 Task 靠审查核对这三行，记为未验证边界（见“验证”）。
- **`run` 为 `null` 时的读者**：
  - 资源树的 `fileDrop`：不在这一场里，量当前的几何，和今天 `frozen === null` 时一样。
  - `panelRectIn`：不读每场状态。
  - 两个 `nextTick`（拿起后冻结、渲染后放排序中的标签）：先记下发起时的 `run`，回调里 `run` 已经换了或是 `null` 就什么都不做。今天按 `live.active` 判，同一个微任务里换场走不到，所以不改行为。
- **`dropFor` 的预览缓存**：作为参数传入，`fileDrop` 传 `null`（今天文件来源的键就是 `null`，不进缓存）。
- `rejected`（光标标记的 ref）、`live`、`session` 不是每场的，留在闭包里。

### 纯函数拆出来：`packages/neuro-book/src/plugins/workbench/web/`

`drag-geometry.ts`（新增）：判定几何的类型与纯计算，不读 DOM，不读 `run`。

- 类型：`DragGeometry`、`EntryBand`、`FrozenGeometry`、`WindowDrag`。
- 矩形工具：`offset`、`centerOf`、`contains`。
- `collapsedGeometry(kept, before, after, {extent, projection, dpr})`：今天的 `collapsed`，`extent`、`projection`、`dpr` 改成参数。不用的参数 `source` 删掉。
- `bandsAfterCollapse`：已经是纯的，原样搬。
- `heldTabIn(rect, pressedAt)`：`heldTabOf` 的计算部分。找矩形（快照里的 `excludedRect`，或 DOM 里的标签）留在调用方。
- `stripIndex`：原样搬。
- `windowRect(drag, point, extent)` 与 `keepVisible`、`wholeInTree`：`extent` 改成参数。

`drag-keyboard.ts`（新增）：键盘停靠点。

- `pointOfCandidate(candidate, doc, panels, stripStops)`：标签条的停靠点由调用方注入（它要量 DOM），其余是纯的。
- `barStops(band, entries)`：原样搬。
- `stopsOf` 与 `keyboard.regions`、`start` 读 DOM 与 `options`，留在 `layout-drag.ts`。

`strip-sort.ts`（新增）：标签条里排序跟手。

- `sortTargetOf`、`releaseSorted`、`measureSorted` 搬过来，状态是 `run.sort`（`{element, grab}`）。
- 位移的计算拆成纯的 `sortedOffset({rect, written, bounds, vertical, along, grab})`，返回抓点与要写的 `translate`。

留在 `layout-drag.ts`：

- 落点解析：`dropAt`、`dropFor`、`stripDrop`、`entryDrop`、`windowDrop`、`answeredByEditor`、`sectored`、`fileDrop`；
- 量 DOM：`geometryOf`、`measureGeometry`、`measureBands`、`freeze`；
- 与 `live`、`session` 的装配。

量 DOM 的部分不拆：它读 `options` 与 `run`，拆出去没有可单测的东西（happy-dom 里矩形全是 0，design-10 也这样说）。

单元测试（bun，真的文档与投影：`state/default-tree.ts` 的 `defaultLayoutDoc`、`state/layout-constraints.ts` 的 `createLayoutPolicy`、`layoutProjectionOptions`；收起后的文档用真的 `removeTab`）：

- `drag-geometry.test.ts`：
  - 来源是右栏一节、底部面板一节、编辑组最后一个标签三种情况下，收起后每块面板的平移与伸缩，以及收起后不在的面板不再是落点；
  - 入口条上来源的入口没了，后面的往前补一格；并进来一节时落点那一段只到入口这一组；
  - `heldTabIn` 按下的点不在矩形里是 `null`；
  - `stripIndex` 遇到收进“更多”的标签（量到的邻居不是文档里相邻的）；
  - `windowRect` 夹取后大小仍是记录里的。
  - 拿起时的几何：每块面板的外框取收起前文档的 `previewPanelRects`，卡片、头、标签条各按不同的内边距往里缩（例如卡片 4px、头 28px 高、标签条左右各 12px），模拟真实 DOM 里几层盒子不重合。
    - 期望值按“收起前后两份投影的矩形差”手算写死，不再调 `previewPanelRects` 求期望，否则测试和实现算的是同一个式子。
    - 写完做一次变异：把“头的高度不变”改成头跟着下沿走，测试要红。
- `drag-keyboard.test.ts`：缝的中点；收成标题行的分节停在标题行；标签条取同一下标的后一个位置；`float` 与缝两侧不在面板上的返回 `null`。
- `strip-sort.test.ts`（纯的 `sortedOffset`）：抓点只在第一次定；夹在条的两端之间；竖向的写法是 `0px Npx`；元素上的位移被 Vue 换掉后按元素上的值算。

### 抽进库：`packages/nb-layout/src/`（L0，纯 TS）

`drag-card.ts`（新增）：

```ts
export interface DragCardSize { readonly width: number; readonly height: number }
export interface DragCard {
    readonly size: DragCardSize;           // 此刻的尺寸，未取整
    readonly grab: GridDropPoint;          // 抓住的点占卡片的比例
    readonly chase: GridDropPoint;         // 离跟手的位置还差多少（px）
    readonly written: GridRect | null;     // 上一次要写的矩形
    readonly sizeDue: number;              // 尺寸下一次该写的时刻
}
export interface DragCardOptions {
    readonly tauMs?: number;          // 缺省 90
    readonly stillPx?: number;        // 缺省 0.1
    readonly refreshMs?: number;      // 缺省 0：每帧写尺寸
    readonly refreshSlackMs?: number; // 缺省 2
}
/** 从内容此刻所在的矩形（视口坐标）拿起；量不到时是 `fallback` 大小、抓在上沿中点。 */
export function liftDragCard(from: GridDropRect | null, pointer: GridDropPoint, fallback: DragCardSize): DragCard;
/** 一帧：尺寸向 `target` 指数逼近、追赶量归零；交回要写的矩形（相对 `origin`），和上一次一样时是 null。第一次写之前不算时间。 */
export function stepDragCard(card: DragCard, input: {
    readonly now: number; readonly elapsed: number; readonly pointer: GridDropPoint;
    readonly origin: GridDropPoint; readonly target: DragCardSize;
}, options?: DragCardOptions): {readonly card: DragCard; readonly rect: GridRect | null; readonly settling: boolean};
```

- 内容就是今天 `updateCard` 的后半段：
  - 逼近与截断（`stillPx`）；
  - 尺寸取整、按刷新间隔写，到终点马上写；
  - 位置按画出来的大小算，抓住的点一直在指针下。
- 卡片的目标尺寸（缩到 380×260、不大于来源面板、`cardShrink` 设置）与刷新率设置的映射留在应用：它们是工作台的设置。
- “卡片位置的换算”就是 `origin` 这个参数：交回的矩形已经相对网格根，第三方不用自己换。
  - 通用的 `GridRect` 与视口矩形互转按提案“先不做”的那一条（体验 14）不做。
  - 应用里空位那一行换算留着。

`frame-loop.ts`（新增）：

```ts
export interface FrameLoopOptions {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    /** 跑一帧。`elapsed` 是离上一帧的毫秒数；刚开始与停过之后的第一帧是 `nominalMs`。返回真就排下一帧。 */
    frame(now: number, elapsed: number): boolean;
    readonly nominalMs?: number; // 缺省 1000 / 60
}
export interface FrameLoop {
    /** 开始：撤掉排着的帧，排第一帧。 */
    start(): void;
    /** 有新输入：开始了、没有排着的帧、不在跑这一帧时排一帧。 */
    wake(): void;
    /** 停：撤掉排着的帧；之后 `wake` 不排，直到再 `start`。 */
    stop(): void;
    readonly running: boolean;
}
export function createFrameLoop(options: FrameLoopOptions): FrameLoop;
```

- 跑一帧的过程中调 `wake` 不另排：这一帧的返回值决定。
- 帧里调了 `stop`：返回真也不再排；帧里 `stop` 后又 `start`：只排 `start` 那一帧。
- 第一帧的 `elapsed` 今天是“离 0 的毫秒数”。只有卡片读它，而卡片拿起那一帧不算时间，所以改成 `nominalMs` 不改行为。

`live-drag.ts` 改用这两个：

- `begin` 调 `loop.start()`，`offer`、`wake` 调 `loop.wake()`，`end` 调 `loop.stop()`；
- `tick` 变成 `frame(now, elapsed)`，`ticking`、`resumed`、`lastFrame`、`frame` 四个 `let` 去掉；
- `updateCard` 只剩“要不要卡片、目标多大”和调 `liftDragCard`、`stepDragCard`。

库的测试：`drag-card.test.ts`、`frame-loop.test.ts`，注入时钟与 `requestFrame`，不用假计时器。

- 卡片：拿起那一帧不缩；逼近到 `stillPx` 以内就是终点，之后 `settling` 为假；`refreshMs` 为 30fps 时尺寸隔帧写、到终点那一帧马上写；位置每帧跟手；抓住的点在指针下（缩放中也是）；追赶归零。
- 帧循环：返回假就停；停着时 `wake` 排一帧，那一帧的 `elapsed` 是 `nominalMs`；帧里 `wake` 不重复排；`stop` 后 `wake` 不排；帧里 `stop` 后不再排。

入口与文档：

- `src/index.ts` 的显式清单加 `createFrameLoop`、`liftDragCard`、`stepDragCard` 与几个类型，`exports.test.ts` 跟着改；
- README 的“我要做 X 用哪个导出”加一行“实时拖动的卡片与帧循环”，连同已有的 `stepLiveDrop`、`insideShownSlot`。

## Spec 与文档改动

- [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)：
  - “输入与前置条件”加两段签名；
  - 输出加两条（planned）：20 拖动卡片（拿起、逼近与截断、尺寸按间隔写、到终点马上写、位置相对网格根且抓点在指针下）；21 帧循环（按需排、停过之后第一帧的时长、帧里 `wake` 不重排、`stop` 的语义）；
  - “目标与非目标”里“实时布局的让位……见 workbench-layout 输出 38”一句改成：卡片与帧循环在本 Spec，让位、粘滞与稳定时长仍在 workbench-layout。
- [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38：“卡片”一段末尾加“缩放与追赶的步进见 ui/layout-drag 输出 20”，“开销”一段加“帧循环见输出 21”。行为不变。
- 两条输出与链接在计划定稿时就写进主工作区的 Spec，标 planned；实现与验证之后晋升。
- 待确认清单两行：
  - 新增的公开导出（`createFrameLoop`、`liftDragCard`、`stepDragCard` 与类型）；
  - 提案的“卡片位置的换算”按 `stepDragCard` 的 `origin` 参数做（交回相对网格根的矩形），不另出通用的视口与 `GridRect` 互转函数：提案同一节的“先不做”里有这一条（体验 14），两句合在一起读是这样。改回的代价小：以后加一个互转函数，不动 `stepDragCard`。
- 工作台的 Spec、组件同名 `.md`：不改（外壳接口不变）。

## 切片

每片单独提交；每片跑 `layout-drag` 一族的单元测试（`live-drag.test.ts` 与新增的）、应用 `typecheck`，以及 e2e 对。

1. **删冗余**：`sourceCollapsed`、`LiveDrag.origin`、`collapseSource` 返回值，加 `live-drag.test.ts` 的两条。
2. **每场一个对象**：`DragRun`、`Judgement`、`refusalAtEnd`。e2e 对加 `workbench-float`。
3. **拆纯函数**：`drag-geometry.ts`、`drag-keyboard.ts`、`strip-sort.ts` 与三份测试。只搬与改参数，不改算法。e2e 对加 `workbench-float`。
4. **抽进库**：nb-layout 的 `drag-card.ts`、`frame-loop.ts` 与测试、入口、README；`live-drag.ts` 改用。e2e 对加 `workbench-drag-cost`，另跑性能脚本。
5. **晋升**：`ui/layout-drag` 输出 20、21 去掉 planned，补实现入口与合同测试（主工作区）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 手感不变：`ui/workbench-layout` 输出 25、28、31、37 到 39、45 到 47 | `workbench-live-drag.e2e.ts`、`workbench-dnd.e2e.ts` 每片；收口另加 `workbench-float.e2e.ts`、`editor-area.e2e.ts`、`workbench-containers.e2e.ts` |
| 输出 38“开销” | `workbench-drag-cost.e2e.ts`（第 4 片与收口） |
| 新的纯函数有单元测试 | `drag-geometry.test.ts`、`drag-keyboard.test.ts`、`strip-sort.test.ts` |
| `ui/layout-drag` 输出 20、21 | `nb-layout/src/drag-card.test.ts`、`frame-loop.test.ts` |
| 预览与卡片的状态机不变 | `live-drag.test.ts`（全部原有用例不改断言） |
| Lab 场景不变 | `lab-drag-session.e2e.ts`（收口） |

## 验证

- 基线：master 上这几份 e2e 已跑过一次（live-drag、dnd、float 共 76 条全过）；收口时在同一 master 提交的对照 worktree 上对照失败项。
- 收口：上表 7 个 e2e 文件，不到 8 个，不用 `NB_E2E_WIDE`。
- 第 4 片改了热路径：`workbench-drag-cost` 数次数，不计时。另用 `scripts/perf/layout-frames.ts` 的 `live-hold`、`live-path` 在基线与分支上交替各跑 3 轮，按中位数对照（t26 的做法），负载写进证据。
- 留下的未验证边界：
  - 编辑器不让放的落点上松手、交给编辑器写提示（`refusalAtEnd` 的交接）：没有 e2e，靠审查核对；
  - 触摸与笔的拖动只走手势层，e2e 只用鼠标；
  - 真实 120Hz 屏上的刷新率设置，e2e 在无头 Chrome 的 60Hz 上。

## 不做与风险

- 不做第二步（编排进库），不改 `LiveDragHost` 的形状（除了 `collapseSource` 的返回值）。
- 不拆量 DOM 的部分（见上文）。
- 风险：第 2 片改动面最大，`run` 的读者漏一处就是运行时的 `null`。
  - 靠类型兜：`run` 的类型是 `DragRun | null`，每个读者都要处理 `null`；
  - 再按盘点里“`onActiveChange(false)` 之后仍被读的绑定”逐个核对；
  - e2e 对兜底。
- 风险：`live-drag` 的 `pointermove` 监听要排在会话按下时挂的监听前面（`wakeLive`），这条时序今天只靠挂的先后成立。本 Task 不动它挂在哪、什么时候挂：`wake` 换成 `loop.wake()`，挂监听的那一行不变。
