---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.layout-drag
owners:
  - nb-layout
---

# 布局拖动：手势会话与落点登记

## 目标与非目标

工作台、编辑器标签、资源树都要“按住、拖到别处、放下”。本能力给它们一份手势实现：从按下到放下、与拖的是什么无关的部分（起拖门槛、锁定指针、逐帧更新、键盘操作、取消、吞掉末尾的 click），再加上落点登记，让一个插件的来源能落到另一个插件的元素上，不用读对方的 DOM 标记。拖的是什么、落点长什么样、放下做什么都由宿主给。现在每个根一个会话，是过渡形态；合并成工作台的一个会话随一棵树写进本 Spec。

不承诺：

- 落点的几何与规则：工作台布局的在 [ui.workbench-layout](workbench-layout.md)，标签的在 [workbench.editor](../workbench/editor.md)，树的在 [workbench.files-explorer](../workbench/files-explorer.md)。[布局提案](../../proposals/workbench-single-tree-layout.md#3-拖动) 第 3 节的有序规则随一棵树写进本 Spec。
- 实时布局里落点长什么样、预览摆成什么、判定的几何怎么量：由宿主给（工作台的见 [ui.workbench-layout](workbench-layout.md) 输出 38）。这里管什么时候换预览、收起与展开来源、换判定的几何、拿起与收回卡片（输出 22、23），以及跟手的零件（输出 20、21）。
- 分隔线手势：见 [ui.nested-grid](nested-grid.md)。
- 跨窗口拖动。

## 术语与参与者

- **会话**：装在一个根元素上的手势实现。一个根一个会话；几个会话的来源互不重叠，同一个按下只属于其中一个。
- **一场**：从拿起到放下或取消。
- **来源**：被拖的东西，形状由宿主定。
- **落点**：这一刻指针处的判定结果，形状由宿主定；可以没有落点（`null`）。
- **动作**：放下要做的事。落点可以只显示、没有动作（放回原位）。
- **反馈**：拖影、插入线、区域高亮这些宿主按会话状态画的东西。
- **落点种类**：一种来源能落到哪些元素的约定，由提供方定义、双方共用。

## 输入与前置条件

```ts
// @notnotype/nb-layout：纯 TS，不依赖 Vue 与全局 window、document
export const DRAG_GESTURE_DEFAULTS: DragGestureConfig; // {distancePx: 6, touchDelayMs: 200, touchTolerancePx: 6}
export type DragCancelReason = "escape" | "pointer-cancel" | "capture-lost" | "blur" | "hidden" | "focus-left" | "pressed-elsewhere" | "structure-changed" | "disposed";
export type DragEnd = {readonly kind: "committed"} | {readonly kind: "no-action"} | {readonly kind: "cancelled"; readonly reason: DragCancelReason};
export function defineDropKind<T>(id: string): DropKind<T>;

// @notnotype/nb-layout/vue
export function createDragSession<S, D, R = never>(options: DragSessionOptions<S, D, R>): DragSession<S, D>;
export function useDragSession<S, D, R = never>(root: Readonly<Ref<HTMLElement | null>>, createOptions: (root: HTMLElement) => Omit<DragSessionOptions<S, D, R>, "root">): DragSessionHandle<S, D>; // {session, state}，见输出 18

export interface DragSessionOptions<S, D, R> {
    /** 手势的范围：来源只认这里面的，指针捕获由它持有。 */
    readonly root: HTMLElement;
    /** 按下处的来源；`null` 不起拖。 */
    sourceAt(target: Element): S | null;
    /** 过了门槛：宿主冻结它要的东西；返回 `false` 不起拖。`keyboard`：这一场是键盘拖动。`at`：按下处与过门槛时指针的位置，键盘拖动是 `null`。 */
    activate?(source: S, keyboard: boolean, at: {readonly pressed: GridDropPoint; readonly point: GridDropPoint} | null): boolean;
    /** 放下时提交此刻判定的动作，不要求与最后显示的相同（输出 6）。缺省假。 */
    commitsUnderPointer?(keyboard: boolean): boolean;
    /** 此刻的结构键；一场里它变了整场取消。缺省不比较。 */
    structure?(): string;
    /** 同步判定这一刻的落点：不改布局与已提交的状态、不提交；可以记下这一场的判定、保持落点对象的身份、在读完 DOM 之后写跟手的反馈（光标标记、拖影），可以读宿主维护的状态。 */
    resolve(query: DragQuery<S, R>): D | null;
    /** 落点要做的动作的比较键；只显示、不提交的落点为 `null`。 */
    actionKey(drop: D): string | null;
    /** 放下且与最后显示过的动作相同。 */
    commit(drop: D, source: S, keyboard: boolean): void;
    /** 一场结束，`last` 是最后发布的状态。 */
    onEnd?(end: DragEnd, last: DragState<S, D>): void;
    /** 一场开始与结束（宿主写光标与禁选的标记）。 */
    onActiveChange?(active: boolean): void;
    /** 滚动时：重新判定（缺省），或撤下落点直到指针再动；窗口尺寸变化一律重新判定（输出 12）。 */
    readonly scroll?: "reevaluate" | "withdraw";
    /** 边缘滚动：指针此刻所在的容器，从里到外；缺省不滚（输出 14）。 */
    readonly autoScroll?: {
        containers(query: {readonly point: GridDropPoint; readonly top: Element | null}): ReadonlyArray<HTMLElement>;
        readonly edgePx?: number;
        readonly maxStepPx?: number;
    };
    /** 键盘拖动；缺省只有指针。 */
    readonly keyboard?: DragKeyboardOptions<S, R>;
    /** 起拖门槛。 */
    readonly config?: Partial<DragGestureConfig>;
}

export interface DragQuery<S, R> {
    readonly source: S;
    readonly point: GridDropPoint;
    /** 指针处最上层的业务元素（输出 5）。 */
    readonly top: Element | null;
    /** 键盘停在的区域；指针拖动为 `null`。 */
    readonly region: R | null;
}

export interface DragState<S, D> {
    readonly source: S;
    readonly point: GridDropPoint;
    readonly drop: D | null;
    readonly keyboard: boolean;
}

export interface DragSession<S, D> {
    readonly state: Readonly<ShallowRef<DragState<S, D> | null>>;
    /** 内容变了而指针没动：撤下落点，直到指针再动。 */
    invalidate(): void;
    /** 有排着的发布就马上做：宿主这一帧要写 DOM 时先调它，判定（读）才在写前面，不强制重算样式。 */
    flush(): void;
    /** 宿主那边已经结束了这场：收场，不调 `onEnd`。 */
    abort(): void;
    dispose(): void;
}

export interface DragKeyboardOptions<S, R> {
    /** 按下空格时焦点处的来源；焦点不在来源或它的把手上时为 `null`。 */
    sourceAt(target: Element): S | null;
    /** 拿起时取一次的落点区域，整场不变；为空不拿起。 */
    regions(source: S): ReadonlyArray<R>;
    /** 区域里能停的位置与方向键的轴。 */
    stops(region: R): {readonly axis: "horizontal" | "vertical" | "both" | null; readonly points: ReadonlyArray<GridDropPoint>};
    /** 起点：第几个区域的第几个位置，或来源自己的坐标（直接 Enter 不移动）。 */
    start(source: S, regions: ReadonlyArray<R>, origin: HTMLElement): {readonly region: number; readonly at: number | GridDropPoint};
    /** 拿起时的元素已被换掉时，同一个来源此刻的元素。 */
    refocus(source: S): HTMLElement | null;
}

// 跟手的零件（nb-layout 包内的纯 TS，不从入口导出：实时布局的编排用它们，时钟与排帧由编排给）
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
    readonly origin: GridDropPoint;   // 网格根左上角的视口坐标
    readonly target: DragCardSize;
    readonly refreshMs?: number;      // 缺省 0：每帧都可以写尺寸
}
export interface DragCard {
    step(frame: DragCardFrame): {readonly rect: GridRect | null; readonly settling: boolean};
}
export function createDragCard(from: GridDropRect | null, pointer: GridDropPoint, fallback: DragCardSize, options?: DragCardOptions): DragCard;

export interface FrameLoopOptions {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    frame(now: number, elapsed: number): boolean;
    readonly nominalMs?: number; // 缺省 1000 / 60
}
export interface FrameLoop {
    start(): void;
    wake(): void;
    stop(): void;
}
export function createFrameLoop(options: FrameLoopOptions): FrameLoop;

// 落点登记
export function registerDropTarget<T>(element: Element, kinds: ReadonlyArray<DropKind<T>>, data: () => T): () => void;
export function useDropTarget<T>(element: Readonly<Ref<Element | null>>, kinds: ReadonlyArray<DropKind<T>>, data: () => T): void;
export function dropTargetAt<T>(top: Element | null, kind: DropKind<T>): {readonly element: Element; readonly data: T} | null;
```

## 输出与可观察行为

1. **起拖门槛**：主指针的主键按下。鼠标与笔移动 6 px；触摸按住 200 毫秒且移动不超过 6 px，先动了就放弃，让给滚动。没过门槛的按下照常是点击。待起拖时收到没有按键的鼠标或笔移动（`buttons` 为 0，松手事件丢了），放弃这次按下。
2. **按下的归属**：会话在根的冒泡阶段接收按下。内层先处理并停止传播的按下（分隔线的命中带）不起拖。
3. **拿起**：`activate` 返回 `false` 时不起拖。否则清掉已选中的文字、调 `onActiveChange(true)`，指针拖动时根取得指针捕获，并按当前坐标立即发布第一次判定。来源元素在拖动中被卸载不算取消。
4. **逐帧**：指针移动每帧最多判定并发布一次。`state` 是一场进行中的唯一输出。
5. **遮挡**：`top` 是指针处从上往下第一个不在 `data-drag-feedback` 元素里的元素。菜单、对话框挡着时它就是菜单或对话框里的元素；坐标在视口外时为 `null`。设了 `pointer-events: none` 的元素本来就不在命中里；`data-drag-feedback` 给要接指针的反馈元素。
6. **放下**：用松手的坐标再判一次，这一次不发布。`actionKey` 不为 `null` 且与最后显示过的落点的键相同才提交，一场最多提交一次；否则结束为 `no-action`。`commitsUnderPointer` 为真时只要 `actionKey` 不为 `null` 就提交，不要求相同；落点撤下期间（输出 12）仍不提交。
7. **取消**：下列情况都结束一场、不提交、撤下反馈：Escape、`pointercancel`、失去指针捕获、窗口失焦、页面隐藏、焦点移到根之外、键盘拖动中有指针按下、结构键变化、会话销毁。其中：
   - 失去捕获只认根自己。触摸按下时浏览器把指针隐式捕获给被按的元素，捕获换到根时，旧元素上的 `lostpointercapture` 会冒泡到根，这一次不算。
   - 窗口失焦只认窗口自己，页面里的元素失焦不算。
   - 捕获取不到（`setPointerCapture` 报指针不存在或根不在文档里，即 `NotFoundError`、`InvalidStateError`；或调用后 `hasPointerCapture` 为假）按失去捕获算，别的异常照常抛出。
   - 松手之后浏览器紧接着释放捕获，这一次不算（输出 14 的等待里一场还没结束）。
8. **结构键**：拿起时记下，每次判定与放下前比较，变了按 `structure-changed` 取消。
9. **吞掉 click**：指针拖动结束后吞掉同一手势末尾的那次指针 click（`detail` 不为 0），吞过或下一次按下时清除。键盘触发的 click 不吞。
10. **按键归属**：一场进行中，空格、Enter、Escape、Tab、方向键、Home、End 在窗口捕获阶段拦下，内层收不到。指针拖动里只有 Escape 有动作。键盘拿起用的那一下空格的 keyup 也拦下，否则按钮在抬起时激活。
11. **触摸**：一场进行中，根上的 `touchmove` 阻止默认动作，页面不滚动。
12. **滚动与窗口尺寸**：只算根里面的滚动（含后代）。`scroll` 为 `reevaluate` 时按当前坐标重新判定并发布；为 `withdraw` 时撤下落点（发布 `drop: null`，最后显示过的动作清空），直到指针再动，这期间放下不提交。边缘滚动自己滚出来的滚动不撤下。窗口尺寸变化一律重新判定。
13. **撤下**：`invalidate()` 与 `withdraw` 的撤下相同。
14. **边缘滚动**：配了 `autoScroll` 时，没在滚时指针每次移动、在滚时每帧开头调一次 `containers`（`top` 同输出 5），按交回的先后（从里到外）给横竖两个轴各挑一个容器。容器在一个轴上被挑中要同时满足：这个轴让滚（计算样式的 `overflow-x` 或 `overflow-y` 是 `auto` 或 `scroll`），这个方向还没滚到头，指针在它另一个轴的范围内、离这个轴的一端不到 `edgePx`（缺省 24）或已越过这一端；这个轴上短到两条边缘带相接（不超过 `2 × edgePx`）时不挑。挑中的逐帧滚，越靠边越快，每帧最多 `maxStepPx`（缺省 16）；两个轴都挑中时一起滚。每一帧先按上一帧滚动后的内容判定并发布，再滚这一帧。两个轴都挑不到、或滚了没动时停，等指针再动。滚动中松手：先停滚，等下一帧，判定并发布一次，按这一次的落点放下。
15. **键盘拖动**：配了 `keyboard` 时，焦点在来源或它的把手上按空格拿起；Tab 与 Shift+Tab 在区域间循环并停在区域的第一个位置，方向键沿区域的轴逐个位置移动（轴为 `both` 时右、下往后，左、上往前），Enter 放下，Escape 取消。判定与放下规则同指针。结束后的焦点：放下（不论有没有提交）在下一帧还，提交引起的重渲染在那之前完成；其余取消立即还；焦点移到根之外造成的取消和会话销毁不还。还到拿起时的元素，它已被换掉时用 `refocus` 找。
16. **落点登记**：`dropTargetAt(top, kind)` 从 `top` 往上找最近的、登记了这个种类的元素，返回元素与查询这一刻的 `data()`；没有或 `top` 为 `null` 时为 `null`。种类按 `id` 比较，同一个 `id` 定义两次是同一个种类。登记不依赖会话，也不写 DOM 标记。注销（`useDropTarget` 随组件卸载）之后不再命中。
17. **不画东西**：会话不创建元素，除了只读 `data-drag-feedback`，也不读写 DOM 标记。拖影、插入线、高亮都由宿主按 `state` 与 `onEnd` 画，所以换一种反馈不用改会话。
18. **组件里的会话**：`useDragSession(root, createOptions)` 在有根时建会话：调用时根已有值就立即建，模板 ref 的根在组件挂载后的那次刷新里建（挂载回调里还是 null）。根换了先销毁旧的再建新的，根没了或所在的作用域结束时销毁；换根与销毁时进行中的拖动按销毁收尾。返回会话与它的 `state`，没有根时两者都是 null。
19. **组件里的会话：选项**：`createOptions(root)` 每在一个根上建会话时调一次，交回这个会话的选项，会话建好后不再读（选项里读到的响应式值之后变了，会话不重建）。`createOptions` 抛错时这个根上没有会话（`session` 为 null），错误交给应用的错误处理。
20. **拖动卡片**：拖动中跟手的那张卡片，逐帧缩放并追到指针下。
    - **拿起**：`createDragCard(from, pointer, fallback)` 从内容此刻所在的矩形（视口坐标）拿起：尺寸是这个矩形的；抓住的点是指针在它上面的比例，夹在 0 到 1；追赶量是这个矩形与“抓住的点在指针下”的位置之差。`from` 为 null、宽或高不是正的有限数时，尺寸是 `fallback`，抓在上沿中点，不追赶。
    - **一帧**：`step` 把尺寸按 `1 - e^(-elapsed / tauMs)` 的比例向 `target` 逼近，追赶量同样向 0 逼近；离终点不到 `stillPx` 就取终点，逼近才有尽头。第一次 `step` 不按时间逼近（离终点不到 `stillPx` 时照样取终点）。`elapsed` 不是有限数或为负时按 0。
    - **交回的矩形**：相对 `origin`，宿主不用自己换算。尺寸取整到像素；位置按画出来的尺寸算，抓住的点一直在指针下（缩放中也是），再加上追赶量。
    - **写的频率**：位置每帧跟手。尺寸至多每 `refreshMs` 变一次，帧的时间戳差 `refreshSlackMs` 以内算到了；尺寸到了终点那一帧马上写。和上一次交回的矩形相同时交回 `null`。
    - `settling` 为真是尺寸或追赶还没到终点，宿主要再排一帧。卡片不要了就丢掉这个对象，再要时重新拿起。
21. **帧循环**：`createFrameLoop` 按需排帧，没有要做的事就停，按住不动时不空转。
    - `start()` 撤掉排着的帧并排第一帧。`frame` 返回真才排下一帧，返回假就停；停着时 `wake()` 排一帧。没有 `start` 或 `stop()` 之后，`wake` 不排。
    - `elapsed` 是离上一帧的毫秒数，时间戳回退时是 0；`start` 之后与停过之后的第一帧是 `nominalMs`：真实间隔可能是好几秒，按它算，缩放一步就到了终点。
    - 跑一帧的过程中调 `wake` 不另排，由这一帧的返回值决定。帧里调了 `stop`，返回真也不再排；帧里 `stop` 之后又 `start`，只排 `start` 的那一帧。
    - `frame` 抛错时异常照常抛出，循环回到停着，之后 `wake` 照常排。
    - 和会话一起用：在会话的 `sampled` 里调 `wake`（会话自己的 `pointermove` 处理一开头同步调它，早于排发布的帧）。这样帧循环的帧排在会话发布的帧前面，一帧里先判定（读 DOM）、再写卡片；顺序反了不报错，只是每帧多一次强制的样式重算。实时布局的会话（输出 23）已经这样接好。
22. **实时布局的编排**：拖动中布局真的变，反馈就是布局本身。宿主对每个落点给几样描述：键（摆出来一样的落点同一个键）、是不是原位、算不算还没离开来源（`home`）、长出新块时的空位、落进哪个吸收来源的容器（`container`，可选）。
    - **换预览**：候选连续 150ms 不变才按它摆（`live-drop` 的稳定）；落进来源自己的容器、或已经吸收它的那个容器时马上换。预览过又没有候选了，同样等 150ms，换成来源收起的样子。稳定计时从拿起后的第一帧起算。
    - **收起与展开**：预览换成来源收起，或换成不是原位、也不是 `home` 的候选时收起来源；之后换成原位的候选时展开。先收起或展开，再摆预览：摆的时候宿主读到的是此刻的状态。
    - **判定的几何**：拿起后第一帧开头量一份（这一场的渲染已经做完）；量到之前判定现量、不存。收起时换成宿主按收起前的算出的收起后的那份，宿主说收起不改几何时照旧；展开时换回拿起时的那份。每换一次，几何的身份都变。
    - **指针不动不重判**：收起或展开、几何换了那一刻起，指针没动之前判定沿用那一刻的结论（宿主自己的，含被拒绝之类）；指针一动就按换过的几何重判，此后回到同一像素也不再沿用。
    - **空位粘住**：指针在已显示的空位里（含 8px 边距）候选不变，就是换预览那一刻的候选；原位与并入没有空位。
    - **卡片**：候选在容器里、并且是容器里的原位或已经被这个容器吸收时不拿卡片（来源在容器里跟手）；别的时候都拿着，原位也是。从此刻显示着它的那块开始缩（来源那块第一次要卡片时量一次；离开容器重新拿起时是吸收过它的那块，量不到就是缩好的大小），缩到不大于来源那块的紧凑大小（缺省 380×260）；指针还在来源那块里时可以保持原大小（宿主选）。
    - **撕下**（可选，只有工作台验证过）：来源那块摘掉它还在时，要拿起卡片的那一帧就收起来源，不等第一个落点。
    - **容器里跟手**（可选，只有工作台验证过）：不拿卡片、候选在容器里时，宿主在每帧开头读、判定之后写来源在容器里的位置；预览或卡片变了，渲染之后再放一次。
    - **一帧的顺序**：跟手先读 → 判定 → 跟手写 → 取指针 → 摆预览 → 写卡片 → 交出状态 → 渲染之后的跟手。判定里这一场结束时，这一帧到此为止。指针动了、预览换了、卡片还没到、候选还没等够稳定、在容器里跟手，任一成立就排下一帧，否则停。
    - **预览只给渲染**：结构键与判定读已提交的状态，预览不改结构键。
23. **实时布局的会话**：`createLiveDragSession(root, (live) => options)`（组件里用 `useLiveDragSession`）一次建好会话与编排，宿主只写落点与领域判断。接线的先后：
    - 拿起全在 `activate` 里：宿主的 `activate` 先；返回真、网格在、网格的过渡时长不为 0（减少动效时是 0）时，先把网格的过渡送到终点（键盘拖动、`live` 不给来源的这一场也是）；又不是键盘拖动时才问 `live(source)`，它给出实时布局的来源才开始。别的照常是落点指示。
    - 宿主的 `resolve` 返回之后，结果交给编排；收场时编排先结束（撤预览、放回跟手的），再调宿主的 `onActiveChange(false)`，都在提交之前，同一个同步段里不闪。
    - 实时布局的这一场放下时提交指针下的候选（与宿主自己的 `commitsUnderPointer` 取“或”）。会话的 `sampled` 接到编排。网格的位置拿起时读一次。

## 状态与转换

| 状态 | 事件 | 结果 |
|---|---|---|
| 空闲 | 按下处有来源 | 待起拖 |
| 空闲 | 焦点在来源上按空格 | 拖动中（键盘），区域列表取一次 |
| 待起拖 | 过门槛且 `activate` 接受 | 拖动中（指针） |
| 待起拖 | 松手、`pointercancel`、触摸先动了、`activate` 拒绝 | 空闲，没有 `onEnd` |
| 待起拖 | 收到没有按键的移动（输出 1） | 空闲，没有 `onEnd` |
| 待起拖 | `dispose()` | 空闲，没有 `onEnd` |
| 拖动中 | 放下 | 空闲，`committed` 或 `no-action` |
| 拖动中 | 输出 7 的情况 | 空闲，`cancelled` |
| 拖动中 | `abort()` | 空闲，没有 `onEnd` |

时序与寿命：

- `createDragSession` 返回后立即生效；`dispose()` 后不再响应，进行中的一场按 `disposed` 取消。
- 收场顺序固定：拆监听、释放捕获、`state` 置空、`onActiveChange(false)`、`onEnd`、`commit`、键盘拖动还焦点（输出 15）。最后的状态由 `onEnd` 的 `last` 给；`commit` 时反馈已经撤下，里面可以同步改布局。
- `state` 在判定之后同步写入。宿主的副作用要严格先于 `commit` 时用 `flush: "sync"` 的 `watch`：默认的 `watch` 在微任务里跑，输出 14 的“发布加放下”在同一个调用栈里，它会晚于 `commit`。
- `resolve` 同步，不能等异步结果；异步校验归宿主在 `commit` 里做。
- 一个会话同一时间只有一场：指针拖动中的第二次按下被忽略；键盘拖动中的指针按下按输出 7 取消这一场，按在来源上时照常进入待起拖。

## 副作用与数据

只在内存里。不写持久化记录，只在一场进行中改全局：指针捕获、已选中文字被清掉。

## 失败与恢复

无失败码。宿主回调抛出的异常不被会话吞掉；`commit` 抛出时一场已经收场，不留监听；键盘拖动这时不还焦点（收场顺序里还焦点排在 `commit` 之后）。

## 边界与兼容

公开接口是上面的类型、`@notnotype/nb-layout` 的 `DRAG_GESTURE_DEFAULTS` 与 `data-drag-feedback` 标记，以及实时布局的 `createLiveDragSession`、`useLiveDragSession` 与宿主要写的 `LiveDragHost`（0.x 期间都是 `@experimental`，1.0 前签名会变；其中撕下与容器里跟手两项只有工作台一个宿主验证过）。库不知道来源与落点的语义，也不引用外壳、编辑器或资源树。

落点登记目前只给内置插件用，SDK 没有导出。登记表在模块里，同一页面要只有一份 `nb-layout`；开放给第三方时要经 SDK 导出，并把 `nb-layout` 加进纯度检查的禁止打包项，否则两份登记表互相看不见，也没有报错。

## 验收与 Smoke

1. Given 工作台的视图、编辑器标签、资源树的文件三种来源，When 拖动中分别按 Escape、失去指针捕获、窗口失焦、把焦点移到根之外，Then 三处都不写、反馈撤下，松手时的 click 不选中标签也不打开文件。
2. Given 资源树拖文件到编辑组，When 去掉编辑组根元素上的 `data-editor-group`，Then 仍能落到并在那一组打开。
3. Given 工作台的拖动源压在分隔线的命中带里，When 在命中带里按下并拖动，Then 是调整大小，不出现拖影。
4. Given 工作台的视图，When 拖动中按方向键，Then 标签带不切换；编辑器标签与资源树同样不响应这些键。
5. Given 触摸按下后手指有 1 px 抖动，When 按住 200 毫秒再拖到落点松开，Then 一场不被取消，放下生效。
6. Given 资源树的文件拖到树的下边缘开始自动滚动，When 滚动中松手，Then 文件落到松手时指针下的位置。
7. Given 标签编组示例里一条标签条放不下、滚在最左，When 拖别的编组的标签到它右边那个编组的标签条右端，Then 放不下的这一条不滚；When 再拖到放不下的这一条的右端停住，Then 它往右滚到头，插入线跟着换，松手插在最后；When 拖到它的左端停住，Then 滚回最左。

无头 Chrome 没有真实的窗口失焦与页面隐藏，这两种取消由派发 `blur`、`visibilitychange` 事件验证。

Smoke：`packages/neuro-book/e2e/lab-drag-session.e2e.ts`、`packages/nb-layout/e2e/tabbed-panels.e2e.ts`（输出 14 的横向与按指针挑容器，验收 7）、`workbench-dnd.e2e.ts`、`editor-area.e2e.ts`、`files-explorer.e2e.ts`；拖动卡片与帧循环（输出 20、21）是 `workbench-live-drag.e2e.ts`、`workbench-drag-cost.e2e.ts`；实时布局的编排（输出 22、23）在两个宿主上是 `workbench-live-drag.e2e.ts` 与 `lab-live-panels.e2e.ts`，nb-story 的换边是 `packages/nb-story/e2e/side-by-side.e2e.ts`。

## 实现合同

- 公开入口：核心入口 `@notnotype/nb-layout` 的 `DRAG_GESTURE_DEFAULTS`、`defineDropKind` 与类型 `DragCancelReason`、`DragEnd`、`DragGestureConfig`、`DropKind`；跟手的卡片与帧循环（输出 20、21）是包内零件，经实时布局的编排使用，不从入口导出；`./vue` 的 `createLiveDragSession`、`useLiveDragSession` 与类型 `LiveDragHost`、`LiveDragState`、`LiveDropFacts`、`LiveShowTarget`、`LiveGrid`（输出 22、23），`createDragSession`、`useDragSession`、`registerDropTarget`、`useDropTarget`、`dropTargetAt` 与类型 `DragSession`、`DragSessionOptions`、`DragSessionHandle`、`DragQuery`、`DragKeyboardOptions`、`DragState`。签名与用法见 [drag-session](../../../packages/nb-layout/src/vue/drag-session.md) 与 [drag-card](../../../packages/nb-layout/src/drag-card.md)。
- owner 与依赖方向：owner 是 `ui`；手势状态机在核心入口，不依赖 Vue 与 DOM；DOM 适配与落点登记在 `./vue`。工作台、编辑器标签与资源树只经这两个入口用它，库不引用它们（[ADR 0054](../../adr/0054-nb-layout-general-library.md)）。
- 不变量：
  - 状态机只收事件、出状态与收场，不碰 DOM；核心源码不引用全局 `window`、`document`，整个会话不写持久化、不发网络请求（[`boundary.test.ts`](../../../packages/nb-layout/src/boundary.test.ts) 扫源码守着）。
  - 指针监听与捕获挂在根上，拿起后来源被移除，这一场照常跟手与放下（输出 3）。
  - 收场先拆监听、释放捕获、`state` 置空，再调 `onEnd` 与 `commit`：`commit` 抛出时不留监听，下一场照常开始（“状态与转换”的收场顺序）。
  - 登记表是模块级的一张表，登记与注销不改落点元素（输出 16）。
  - 编排引擎（`nb-layout/src/live-drag.ts`）是纯 TS，不从入口导出：会话、网格与引擎的接线只在 `createLiveDragSession` 一处，先后由它的 dom 测试守着（输出 23）。

## 证据

- 批准依据：[布局提案](../../proposals/workbench-single-tree-layout.md) 第 3、10 节（开发者 2026-11-05 接受）；[ADR 0044](../../adr/0044-workbench-single-layout-tree.md)；输出 20、21 依据[通用布局库提案](../../proposals/nb-layout-general-library.md)的“手感引擎分两步”（开发者 2026-11-18 接受）；输出 22、23 依据同一提案“手感引擎分两步”的第二步。
- 实现入口：[`nb-layout/src/drag-gesture.ts`](../../../packages/nb-layout/src/drag-gesture.ts)、[`nb-layout/src/vue/drag-session.ts`](../../../packages/nb-layout/src/vue/drag-session.ts)、[`nb-layout/src/vue/useDragSession.ts`](../../../packages/nb-layout/src/vue/useDragSession.ts)、[`nb-layout/src/vue/drop-targets.ts`](../../../packages/nb-layout/src/vue/drop-targets.ts)、[`nb-layout/src/drag-card.ts`](../../../packages/nb-layout/src/drag-card.ts)、[`nb-layout/src/frame-loop.ts`](../../../packages/nb-layout/src/frame-loop.ts)（输出 20、21）、[`nb-layout/src/live-drag.ts`](../../../packages/nb-layout/src/live-drag.ts)、[`nb-layout/src/vue/live-drag-session.ts`](../../../packages/nb-layout/src/vue/live-drag-session.ts)、[`nb-layout/src/vue/useLiveDragSession.ts`](../../../packages/nb-layout/src/vue/useLiveDragSession.ts)（输出 22、23）
- 合同测试：[`nb-layout/src/drag-gesture.test.ts`](../../../packages/nb-layout/src/drag-gesture.test.ts)、[`nb-layout/src/vue/drag-session.dom.test.ts`](../../../packages/nb-layout/src/vue/drag-session.dom.test.ts)、[`nb-layout/src/vue/useDragSession.dom.test.ts`](../../../packages/nb-layout/src/vue/useDragSession.dom.test.ts)（输出 18、19）、[`nb-layout/src/vue/drop-targets.dom.test.ts`](../../../packages/nb-layout/src/vue/drop-targets.dom.test.ts)、[`nb-layout/src/boundary.test.ts`](../../../packages/nb-layout/src/boundary.test.ts)（只在内存里、核心不引用全局 `window` 与 `document`）、[`nb-layout/src/drag-card.test.ts`](../../../packages/nb-layout/src/drag-card.test.ts)（输出 20）、[`nb-layout/src/frame-loop.test.ts`](../../../packages/nb-layout/src/frame-loop.test.ts)（输出 21；“和会话一起用”的监听次序没有单元测试，由 `workbench-drag-cost.e2e.ts` 的每帧至多一次样式重算间接守着）、[`nb-layout/src/live-drag.test.ts`](../../../packages/nb-layout/src/live-drag.test.ts)（输出 22）、[`nb-layout/src/vue/live-drag-session.dom.test.ts`](../../../packages/nb-layout/src/vue/live-drag-session.dom.test.ts)（输出 21 的 `sampled`、输出 23）
- Smoke：[`e2e/lab-drag-session.e2e.ts`](../../../packages/neuro-book/e2e/lab-drag-session.e2e.ts)、[`e2e/workbench-dnd.e2e.ts`](../../../packages/neuro-book/e2e/workbench-dnd.e2e.ts)、[`e2e/editor-area.e2e.ts`](../../../packages/neuro-book/e2e/editor-area.e2e.ts)、[`e2e/files-explorer.e2e.ts`](../../../packages/neuro-book/e2e/files-explorer.e2e.ts)、[`e2e/workbench-live-drag.e2e.ts`](../../../packages/neuro-book/e2e/workbench-live-drag.e2e.ts)、[`e2e/workbench-drag-cost.e2e.ts`](../../../packages/neuro-book/e2e/workbench-drag-cost.e2e.ts)、[`e2e/lab-live-panels.e2e.ts`](../../../packages/neuro-book/e2e/lab-live-panels.e2e.ts)、[`nb-story/e2e/side-by-side.e2e.ts`](../../../packages/nb-story/e2e/side-by-side.e2e.ts)（输出 22、23）
