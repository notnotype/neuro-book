# t37 整理拖动控制器，纯的部分抽进库：实施计划（第 2 稿）

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
- 工作方式：每一片都不改行为、可以单独回退。每片跑的 e2e 见“切片”。
- 第 2 稿按设计审查（Claude Sonnet，8 条，[`evidences/design-review.txt`](evidences/design-review.txt)）修订，逐条处理见 Task README。

## 技术选型

无：帧循环与指数逼近都是几十行的纯函数，没有要引入的库。

## 关键设计

### 删冗余：`layout-drag.ts`、`live-drag.ts`

- 删 `sourceCollapsed`：它与 `beforeCollapse !== null` 总是一起写、一起清；唯一的读者 `candidateDoc` 改读后者。
- 删 `LiveDrag.origin()`：没有调用方。
- `collapseSource` 的早退（`removeTab` 失败或还没冻结）不改，接口仍是 `void`。注释写明它为什么可以早退：
  - 还没冻结走不到：拿起后的 `nextTick` 就冻结（第一次判定走到 `dropAt` 时更早），帧在它之后才跑。
  - `removeTab` 失败走得到（从代码推断）：拖动中用快捷键关掉来源，指针不动、帧还在跑（卡片在缩），候选稳定后 `stepPreview` 收起来源。
    - 这时 `live-drag` 以为收起了、判定几何没换。下一次判定看到结构变了，整场取消，这一两帧的不一致看不出来。
    - 所以不抛错，也不加返回值：返回假的分支里预览按候选摆、几何没收起，换来的仍是不一致（审查第 2 条）。

### 每场的状态一个对象：`layout-drag.ts`

```ts
/** 一场拖动的状态：拿起时新建，收场时换成空闲的一份（只带着最后一次判定给 `onEnd`）。 */
interface DragRun {
    readonly previews: Map<string, LayoutDragDrop<LayoutDropAction>>;
    previewsOf: LayoutDoc | null;
    frozen: FrozenGeometry | null;
    beforeCollapse: FrozenGeometry | null;
    readonly pressedAt: GridDropPoint | null;
    readonly newContainer: string;
    windowDrag: WindowDrag | null;
    /** 最后一次判定：落点，以及有没有被拒绝、编辑器拒绝的是哪一个。 */
    judged: Judgement;
    /** 来源收起、展开那一刻屏幕上的判定：指针不动之前一直是它。`drop` 是宿主传来的屏幕上的落点，另外两项取自 `judged`。 */
    held: (Judgement & {readonly point: GridDropPoint | null}) | null;
    /** 标签条里排序：正在跟手的标签元素，与抓住的点占它的比例。 */
    readonly sort: {element: HTMLElement | null; grab: number | null};
    /** 上一次发布的落点与它的键（`stableDrop`）。 */
    shown: {readonly drop: LayoutDragDrop | null; readonly key: string};
}
interface Judgement {
    readonly drop: LayoutDragDrop | null;
    readonly rejected: boolean;
    readonly refusal: EditorRefusal | null;
}
let run: DragRun = idleRun(NOT_JUDGED);
```

- **寿命**：`run` 的类型里没有 `null`，读者不用处理空值。
  - `activate` 里 `run = freshRun({pressedAt, newContainer})`，`activate` 里原来逐个清的绑定都在这里。
  - `onActiveChange(false)` 照今天的顺序：撤光标标记，`live.end()`（它经 `run.sort` 放回排序中的标签），撤窗的预览，然后 `run = idleRun(run.judged)`。
  - 空闲的那份没有冻结的几何、没有整窗、没有排序，资源树的 `fileDrop` 与 `geometry` 读到的和今天 `onActiveChange(false)` 清过之后一样。
  - 以后加一个每场的字段，收场时自动不在了，不用记着去清；不初始化就是类型错误。
  - 键盘拿起时 `regions` 为空、会话不起拖（`drag-gesture.ts` 的 `startKeyboard`），这一份留到下一次拿起被换掉。键盘不冻结几何、来源不会是整窗，留着也没人读到旧值。
- **判定带回附带的结果**：`overRejected`、`editorRefusal` 两个 `let` 去掉。
  - `dropAt`、`resolveDrop` 返回 `Judgement`；`resolve` 回调把它存进 `run.judged`，再按它写光标标记。
  - `collapseSource`、`expandSource` 写 `held = {...run.judged, drop, point}`：`drop` 用宿主传来的，和今天一样。
  - `dropAt` 里指针没动时交回 `held`（去掉 `point`），和今天从 `held` 恢复两个 `let` 一样。
  - 逐帧等价：宿主回调只在帧里 `stepPreview` 调，那时这一帧的 `resolve` 已经返回、写好了 `judged`；`resolveDrop` 里的 `live.offer` 只是叫醒帧循环，不会同步进 `collapseSource`。
- **`onEnd`** 直接读 `run.judged.refusal`：收场时 `onActiveChange(false)` 先调，空闲的那份带着最后一次判定；`abort` 不调 `onEnd`，下一次拿起换掉它。
  - 这条路径（编辑器不让放的落点上松手，交给编辑器写提示）在 e2e 目录里按 `dropOutcome`、`refuse`、`未裁决` 没搜到用例。
  - 造“未裁决输入”要编辑区里两个视图同一修订各自提交（审查第 1 条指出 `area.test.ts` 有这个做法），e2e 里拿不拿得到这两个视图的句柄没核对。本 Task 记为未验证边界，改动只是读的位置从一个 `let` 换成 `run.judged`。
- 两个 `nextTick`（拿起后冻结、渲染后放排序中的标签）照今天按 `live.active` 判：同一个微任务里换场走不到。
- `dropFor` 照今天读 `run.previews`：文件来源的键是 `null`，不进缓存。
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
- `sortedOffset({rect, written, bounds, vertical, along, grab})`：标签条里排序时位移的算术，交回抓点与要写的 `translate` 字符串。`measureSorted`、`sortTargetOf`、`releaseSorted` 读写 DOM，留在 `layout-drag.ts`（审查第 7 条）。

`drag-keyboard.ts`（新增）：键盘停靠点。

- `pointOfCandidate(candidate, doc, panels, stripStops)`：标签条的停靠点由调用方注入（它要量 DOM），其余是纯的。
- `barStops(band, entries)`：原样搬。
- `stopsOf` 与 `keyboard.regions`、`start` 读 DOM 与 `options`，留在 `layout-drag.ts`。

留在 `layout-drag.ts`：

- 落点解析：`dropAt`、`dropFor`、`stripDrop`、`entryDrop`、`windowDrop`、`answeredByEditor`、`sectored`、`fileDrop`；
- 量 DOM：`geometryOf`、`measureGeometry`、`measureBands`、`freeze`，排序的 `measureSorted` 一族；
- 与 `live`、`session` 的装配。

量 DOM 的部分不拆：它读 `options` 与 `run`，拆出去没有可单测的东西（happy-dom 里矩形全是 0，design-10 也这样说）。

单元测试（bun，真的文档与投影：`state/default-tree.ts` 的 `defaultLayoutDoc`、`state/layout-constraints.ts` 的 `createLayoutPolicy`、`layoutProjectionOptions`；收起后的文档用真的 `removeTab`）：

- `drag-geometry.test.ts`：
  - 来源是右栏一节、底部面板一节、编辑组最后一个标签三种情况下，收起后每块面板的平移与伸缩，以及收起后不在的面板不再是落点；
  - 入口条上来源的入口没了，后面的往前补一格；并进来一节时落点那一段只到入口这一组；
  - `heldTabIn` 按下的点不在矩形里是 `null`；
  - `stripIndex` 遇到收进“更多”的标签（量到的邻居不是文档里相邻的）；
  - `windowRect` 夹取后大小仍是记录里的；
  - `sortedOffset`：抓点只在第一次定；夹在条的两端之间；竖向的写法是 `0px Npx`；元素上已有位移时按它算静止位置。
  - 拿起时的几何：每块面板的外框取收起前文档的 `previewPanelRects`，卡片、头、标签条各按不同的内边距往里缩（例如卡片 4px、头 28px 高、标签条左右各 12px），模拟真实 DOM 里几层盒子不重合。
    - 期望值按“收起前后两份投影的矩形差”手算写死，不再调 `previewPanelRects` 求期望，否则测试和实现算的是同一个式子。
    - 写完做一次变异：把“头的高度不变”改成头跟着下沿走，测试要红。
- `drag-keyboard.test.ts`：缝的中点；收成标题行的分节停在标题行；标签条取同一下标的后一个位置；`float` 与缝两侧不在面板上的返回 `null`。

### 抽进库：`packages/nb-layout/src/`（L0，纯 TS）

`drag-card.ts`（新增）：一张卡片一个对象，记账藏在里面（审查第 6 条）。

```ts
export interface DragCardSize { readonly width: number; readonly height: number }
export interface DragCardOptions {
    readonly tauMs?: number;          // 缺省 90
    readonly stillPx?: number;        // 缺省 0.1
    readonly refreshSlackMs?: number; // 缺省 2
}
export interface DragCardFrame {
    readonly now: number;
    readonly elapsed: number;
    readonly pointer: GridDropPoint;
    /** 网格根左上角的视口坐标：交回的矩形相对它。 */
    readonly origin: GridDropPoint;
    readonly target: DragCardSize;
    /** 尺寸至多多久变一次；缺省 0，每帧都可以。宿主的设置一场里可能变，所以按帧给。 */
    readonly refreshMs?: number;
}
export interface DragCard {
    /** 一帧：交回要写的矩形，和上一次一样时是 null；`settling` 为真是尺寸或追赶还没到终点。 */
    step(frame: DragCardFrame): {readonly rect: GridRect | null; readonly settling: boolean};
}
/** 从内容此刻所在的矩形（视口坐标）拿起；量不到（null、宽或高不是正数）时是 `fallback` 大小、抓在上沿中点、不追赶。 */
export function createDragCard(from: GridDropRect | null, pointer: GridDropPoint, fallback: DragCardSize, options?: DragCardOptions): DragCard;
```

- 内容就是今天 `updateCard` 的后半段：
  - 逼近与截断（`stillPx`）；第一次 `step` 不按时间逼近；
  - 尺寸取整、按刷新间隔写，到终点马上写；
  - 位置按画出来的大小算，抓住的点一直在指针下。
- 退化输入（审查第 5 条）：`from` 宽或高不是正的有限数当 `null`；`elapsed` 不是有限数或为负按 0。应用里 `rectOf` 只交回正的矩形，不改应用的行为。
- 卡片的目标尺寸（缩到 380×260、不大于来源面板、`cardShrink` 设置）与刷新率设置的映射留在应用：它们是工作台的设置。
- “卡片位置的换算”就是 `origin` 这个参数：交回的矩形已经相对网格根，第三方不用自己换。
  - 通用的 `GridRect` 与视口矩形互转按提案“先不做”的那一条（体验 14）不做。
  - 应用里空位那一行换算留着；第三方用 `stepLiveDrop` 的空位时也要自己写这一行（待确认清单里写明）。

`frame-loop.ts`（新增）：

```ts
export interface FrameLoopOptions {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    /** 跑一帧。`elapsed` 是离上一帧的毫秒数（夹到 0）；`start` 后与停过之后的第一帧是 `nominalMs`。返回真就排下一帧。 */
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
}
export function createFrameLoop(options: FrameLoopOptions): FrameLoop;
```

- 跑一帧的过程中调 `wake` 不另排：这一帧的返回值决定。
- 帧里调了 `stop`：返回真也不再排；帧里 `stop` 后又 `start`：只排 `start` 那一帧。
- `frame` 抛错：异常照常抛出，循环回到停着，下一次 `wake` 照常排（`try/finally`，今天 `tick` 的 `ticking` 也是这样复位的）。
- 第一帧的 `elapsed` 今天是“离 0 的毫秒数”。只有卡片读它，而卡片第一次 `step` 不按时间逼近，所以改成 `nominalMs` 不改行为。
- 不出 `running`：没有读者（审查第 4 条）。
- 和手势会话一起用时的次序（审查第 4 条 d）：宿主在指针移动时调 `wake`，它的监听要先于会话按下时挂的 `pointermove` 监听挂上，帧循环的帧才排在会话发布的帧前面，一帧里先判定（读）再写卡片；挂反了不报错，只是每帧多一次强制重算样式。写进 Spec 输出 21 与库的短文档。

`live-drag.ts` 改用这两个：

- `begin` 调 `loop.start()`，`offer`、`wake` 调 `loop.wake()`，`end` 调 `loop.stop()`；
- `tick` 变成 `frame(now, elapsed)`，`ticking`、`resumed`、`lastFrame`、`frame` 四个 `let` 去掉；
- `updateCard` 只剩“要不要卡片、目标多大”：卡片不要了就丢掉 `DragCard`，要的时候按此刻显示着它的那块面板 `createDragCard`，每帧 `step`。`cardSize`、`grab`、`chase`、`written`、`sizeDue` 五个 `let` 去掉。

库的测试：`drag-card.test.ts`、`frame-loop.test.ts`，注入时钟与 `requestFrame`，不用假计时器。

- 卡片：第一次 `step` 不按时间逼近（离目标不到 `stillPx` 时照样取终点）；逼近到 `stillPx` 以内就是终点，之后 `settling` 为假；`refreshMs` 为 30 帧每秒时尺寸隔帧写、到终点那一帧马上写；位置每帧跟手；抓住的点在指针下（缩放中也是）；追赶归零；`from` 宽为 0 时按 `fallback` 拿起，几帧后 `settling` 为假；`elapsed` 为负或 `NaN` 时这一帧不逼近。
- 帧循环：返回假就停；停着时 `wake` 排一帧，那一帧的 `elapsed` 是 `nominalMs`；时间戳回退时 `elapsed` 是 0；帧里 `wake` 不重复排；`stop` 后 `wake` 不排；帧里 `stop` 后不再排、`stop` 后又 `start` 只排一帧；`frame` 抛错之后 `wake` 照常排。

入口与文档：

- `src/index.ts` 的显式清单加 `createDragCard`、`createFrameLoop` 与类型 `DragCard`、`DragCardSize`、`DragCardOptions`、`DragCardFrame`、`FrameLoop`、`FrameLoopOptions`，`exports.test.ts` 跟着改；
- 新增 `src/drag-card.md`（随包发布）：卡片与帧循环一起讲，一段 15 行左右的例子（建循环、拿起、帧里 `step` 并写矩形、卡片不要了丢掉、`wake` 的监听次序）；不引输出编号（`readme.test.ts` 扫描）；
- README 的“我要做 X 用哪个导出”加一行“实时拖动的卡片与帧循环”，连同已有的 `stepLiveDrop`、`insideShownSlot`，链到 `drag-card.md`。

## Spec 与文档改动

- [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)（第 1 稿时已写成 planned，第 2 稿按上面的形状改）：
  - “输入与前置条件”的“跟手的零件”一段：`createDragCard`、`DragCardFrame`；`FrameLoop` 去掉 `running`；
  - 输出 20：拿起改成 `createDragCard`，退化输入的规则，“拿起那一帧不缩、不追”改成“第一次 `step` 不按时间逼近”；
  - 输出 21：`elapsed` 夹到 0、`frame` 抛错后的状态、`wake` 监听的次序。
- [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38：已加“缩放与追赶的逐帧步进见 ui/layout-drag 输出 20”“按需排帧见输出 21”。行为不变。
- 待确认清单两行（第 1 稿已加，按第 2 稿改）：
  - 新增的公开导出：名字改成 `createDragCard`、`createFrameLoop` 与类型；
  - “卡片位置的换算”按 `origin` 参数做：补一句局限，空位的同一种换算第三方仍要自己写一行。
- 工作台的 Spec、组件同名 `.md`：不改（外壳接口不变）。

## 切片

每片单独提交；每片跑应用的 `live-drag.test.ts` 与新增的单元测试、应用 `typecheck`。e2e 每片按下面列的跑，一次不超过 8 个文件。

1. **删冗余**：`sourceCollapsed`、`LiveDrag.origin`、`collapseSource` 早退的注释。只删没有读者的东西，单元测试与类型检查兜底；e2e 和第 2 片一起跑，失败时按提交分开重跑。
2. **每场一个对象**：`DragRun`、`Judgement`、`idleRun`。e2e：`workbench-live-drag`、`workbench-dnd`、`workbench-float`，加 `files-explorer.e2e.ts:550`（拖到编辑组在那一组打开）与 `:876`（文件拖出树走工作台的落点）两条：资源树的 `fileDrop` 读 `geometry`（审查第 3 条）。
3. **拆纯函数**：`drag-geometry.ts`、`drag-keyboard.ts` 与两份测试。只搬与改参数，不改算法。e2e 同第 2 片。
4. **抽进库**：nb-layout 的 `drag-card.ts`、`frame-loop.ts` 与测试、入口、`drag-card.md`、README；`live-drag.ts` 改用。e2e：`workbench-live-drag`、`workbench-dnd`、`workbench-drag-cost`；另跑性能脚本。
5. **晋升**：`ui/layout-drag` 输出 20、21 去掉 planned，补实现入口与合同测试（主工作区）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 手感不变：`ui/workbench-layout` 输出 25、28、31、37 到 39、45 到 47 | `workbench-live-drag.e2e.ts`、`workbench-dnd.e2e.ts`、`workbench-float.e2e.ts`；收口另加 `editor-area.e2e.ts`、`workbench-containers.e2e.ts` |
| 资源树的文件落到工作台（`fileDrop`） | `files-explorer.e2e.ts:550`、`:876`（第 2、3 片与收口） |
| 输出 38“开销” | `workbench-drag-cost.e2e.ts`（第 4 片与收口） |
| 新的纯函数有单元测试 | `drag-geometry.test.ts`、`drag-keyboard.test.ts` |
| `ui/layout-drag` 输出 20、21 | `nb-layout/src/drag-card.test.ts`、`frame-loop.test.ts` |
| 预览与卡片的状态机不变 | `live-drag.test.ts`（全部原有用例不改断言） |
| Lab 场景不变 | `lab-drag-session.e2e.ts`（收口） |

## 验证

- 基线：master 上 `workbench-live-drag`、`workbench-dnd`、`workbench-float` 已跑过一次（76 条全过）；收口时失败项在同一 master 提交的对照 worktree 上对照。
- 收口：上表 8 个 e2e 文件（`files-explorer` 只跑那两条），不超过 8 个，不用 `NB_E2E_WIDE`。
- 第 4 片改了热路径：`workbench-drag-cost` 数次数，不计时。另用 `scripts/perf/layout-frames.ts` 的 `live-hold`、`live-path` 在基线与分支上交替各跑 3 轮，按中位数对照（t26 的做法），负载写进证据。
- 留下的未验证边界：
  - 编辑器不让放的落点上松手、交给编辑器写提示：没有 e2e，改动只是读的位置；
  - 触摸与笔的拖动只走手势层，e2e 只用鼠标；
  - 真实 120Hz 屏上的刷新率设置，e2e 在无头 Chrome 的 60Hz 上。

## 不做与风险

- 不做第二步（编排进库），不改 `LiveDragHost` 的形状。
- 不拆量 DOM 的部分（见上文）。
- 风险：第 2 片改动面最大。`run` 不会是 `null`，风险换成“读到空闲那份的旧值”：
  - 按盘点里“`onActiveChange(false)` 之后仍被读的绑定”逐个核对：只有 `onEnd` 读最后一次判定，空闲的那份就是为它带着的；
  - e2e 兜底，含资源树的文件拖动。
- 风险：`live-drag` 的 `pointermove` 监听要排在会话按下时挂的监听前面（`wakeLive`），这条时序今天只靠挂的先后成立。本 Task 不动它挂在哪、什么时候挂：`wake` 换成 `loop.wake()`，挂监听的那一行不变；库里把这条写成使用者要遵守的次序。
