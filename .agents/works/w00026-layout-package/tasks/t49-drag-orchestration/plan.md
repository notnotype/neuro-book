# t49 手感编排进库：计划第 4 稿

第 3 轮（细节：重要 4、建议 3，[证据](evidences/design-review-3-detail.txt)；整体：重要 4、建议 1，[证据](evidences/design-review-3-whole.txt)，都没有阻断）都成立，本稿按它们改（见文末“相对第 3 稿”）。同一对象已审满三轮，按停止条件交开发者定是否开工。

第 1 轮两份设计审查（细节 Claude Sonnet、从整体看 Claude Opus）改成第 2 稿；第 2 轮（细节：重要 5、建议 6，[证据](evidences/design-review-2-detail.txt)；整体：重要 4、建议 4，[证据](evidences/design-review-2-whole.txt)，都没有阻断）都成立，本稿按它们改，改了什么见文末“相对第 2 稿”。第 1 轮证据：[细节](evidences/design-review-1-detail.txt)、[整体](evidences/design-review-1-whole.txt)。

## Context

- 依据：[通用布局库提案](../../../../../docs/proposals/nb-layout-general-library.md)“手感引擎分两步”的第二步（开发者 2026-11-18 接受）；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)；Spec [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38、[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 68、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的 `lifted`。
- 为什么做：实时布局的编排（候选稳定才换预览、撕下来源、来源收起展开后换判定的几何、收起展开那一刻指针不动不重判、空位粘住、卡片、一帧的先后）写在工作台里（`plugins/workbench/web/live-drag.ts` 319 行，加 `layout-drag.ts` 里冻结、换几何与 `held` 几段）。第三方要实时布局得照抄，时序靠宿主先挂 `pointermove` 监听这种调用顺序成立，接线漏一处不报错。
- 已定：第二个宿主有 nb-story 的拖详情换边（t45 定“实时让位等 t49”）；0.x 全部 `@experimental`，写明 1.0 前签名会变；引擎不进插件 SDK。
- 工作方式：autonomous-delivery。计划审查阻塞，这是同一对象的第 3 稿，第 3 轮之后仍有实质问题就停下交开发者。改前的基线：分支起点上 `workbench-live-drag`、`workbench-dnd`、`workbench-drag-cost` 三份 68 条全过。

## 关键设计

### 分工与接线

引擎管“什么时候”；宿主管“是什么”。会话与引擎的接线、引擎与网格的接线都在库里，宿主只写领域判断。

| 谁 | 做什么 |
|---|---|
| 引擎（`createLiveDrag`） | 换不换预览、换成哪个；收起与展开来源；判定的几何；收起、展开那一刻起指针没动（`unmoved`）；卡片拿起、收回与矩形；帧循环与一帧的先后 |
| 合成（`createLiveDragSession`，`useLiveDragSession` 是它的组件版） | 一次建好会话与引擎：`sampled` 接 `wake`；宿主的 `live(source, keyboard)` 给出实时布局的来源才 `begin`；包住宿主的 `resolve`，把结果交给 `offer`；`onActiveChange(false)` 里 `end`（唯一的结束）；实时布局的这一场 `commitsUnderPointer` 为真；`judge`、`pointer` 由会话给；`origin`、`card.place`、拿起前 `settleMotion`、减少动效的判断都从网格（必填的 `grid`）取。先后见下面“合成的先后” |
| 宿主 | 落点与判定（`resolve`）；判定里先判自己更优先的落点，再问 `sticky`；`unmoved(point)` 为真时返回自己最近一次的判定（被拒绝之类跟着留下）；`facts`、`show`、`measure`、`collapsed`、`card.key`、`card.rect` |
| `NestedGrid` | 拿起的内容项（`lifted.key`）这一轮不在 `contents` 里时自己留住它（沿用内容层上一次的放置），实例不卸载；放下后照常回到叶上或停放 |

### `packages/nb-layout/src/live-drag.ts`（新）

纯 TS，不依赖 Vue 与 DOM（`boundary.test.ts` 守着），单元测试直接测它；引擎本身不公开，类型（宿主接口、状态、`LiveDropFacts`、`LiveShowTarget`）从 `./vue` 导出。复用 `live-drop.ts`、`drag-card.ts`、`frame-loop.ts`。

```ts
export interface LiveDropFacts {
    /** 摆出来一样的落点同一个键。 */
    readonly key: string;
    /** 放下去是原样。 */
    readonly inPlace: boolean;
    /** 落在这里还没离开来源：不收起来源。 */
    readonly home: boolean;
    /** 长出新块时的空位（视口坐标）；并入没有空位。 */
    readonly slotOnScreen: GridDropRect | null;
    /** 落进哪个吸收来源的容器（标签条、入口条）：卡片收回、来源在容器里跟手。可选，只有工作台验证过；不给就是 null。 */
    readonly container?: string | null;
}

/** 要摆的预览：按落点、来源收起的样子，或没有预览（已提交的样子）。 */
export type LiveShowTarget<D> = {readonly kind: "drop"; readonly drop: D} | {readonly kind: "source-removed"} | null;

export interface LiveDragHost<S, D, G> {
    facts(source: S, drop: D): LiveDropFacts;
    /**
     * 摆预览。返回真是按 `target` 摆出来了；摆不出来返回假，并且宿主自己摆兜底：来源收起着摆来源收起的样子，没收起摆已提交的样子。
     * 走了兜底也返回假。引擎先调 `collapsed` 或展开，再调 `show`；`collapsed` 是此刻来源收起着。
     */
    show(target: LiveShowTarget<D>, context: {readonly source: S; readonly collapsed: boolean}): boolean;
    /** 判定的几何：拿起后第一帧开头量（那时这一场的渲染已经做完）。 */
    measure(source: S): G;
    /** 来源收起后的几何；null 是收起不改几何（收起失败、或这个宿主收起来源不影响判定），引擎照旧用 `before`，也不开始 `unmoved`。 */
    collapsed(source: S, before: G): G | null;
    /** 来源那块摘掉它还在：要卡片时马上收起来源（撕下）。可选，只有工作台验证过；缺省恒假。 */
    staysWithoutSource?(source: S): boolean;
    card: {
        /** 卡片里放哪个内容项（`NestedGrid` 的 `lifted.key`）。 */
        readonly key: (source: S) => string;
        /** 某块的矩形（视口坐标）：`container` 为 null 是来源那块，否则是吸收过它的那块；量不到为 null。宿主读冻结的几何，不读 DOM。 */
        readonly rect: (source: S, container: string | null) => GridDropRect | null;
        /** 缩到多大（再不大于来源那块），缺省 380×260。 */
        readonly compact?: {readonly width: number; readonly height: number};
        /** 指针还在来源那块里时保持来源那块的大小、离开才缩，缺省假（一拿起就缩）；来源那块量不到时一律缩。 */
        readonly keepSizeInsideHome?: () => boolean;
        /** 尺寸多久写一次（毫秒），缺省 0（每帧）。 */
        readonly refreshMs?: () => number;
    };
    /** 容器里跟手：先读后写。可选，只有工作台验证过。 */
    follow?: {
        readonly read: (at: {readonly point: GridDropPoint; readonly container: string} | null) => () => void;
        readonly afterRender: (at: {readonly point: GridDropPoint; readonly container: string} | null) => void;
    };
    // 下面几项由 `createLiveDragSession` 接好；直接用 `createLiveDrag` 的宿主自己给。
    judge(): void;
    pointer(): GridDropPoint | null;
    origin(): GridDropPoint;
    place(rect: GridRect): void;
    changed?(state: LiveDragState): void;
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
}

export interface LiveDragState {
    readonly active: boolean;
    /** 此刻的预览：`live-drop` 已有的 `LivePreview`（无、来源收起、候选的键）。 */
    readonly preview: LivePreview;
    /** 按候选摆出来了（`show` 返回真）；原位、摆不出来为假。外壳按它画并入的盖层、空位。 */
    readonly previewed: boolean;
    readonly collapsed: boolean;
    readonly lifted: {readonly key: string} | null;
    /** 已显示的空位，相对网格根。 */
    readonly slotInGrid: GridRect | null;
}

export interface LiveDrag<S, D, G> {
    state(): LiveDragState;
    begin(source: S, point: GridDropPoint | null): void;
    offer(drop: D | null): void;
    wake(): void;
    /** 拿起后量到之前为 null：宿主这次判定现量一份传下去、不存。每次换几何（null 到首份、收起、展开）身份都变，宿主的预览缓存按身份作废。 */
    geometry(): G | null;
    /** 来源收起或展开（且几何换了）那一刻起指针没动：宿主返回自己最近一次的判定。键盘拖动不走实时布局，没有这一步。 */
    unmoved(point: GridDropPoint): boolean;
    /** 指针在已显示的空位里（含 8px 边距）：候选不变，返回它。 */
    sticky(point: GridDropPoint): D | null;
    /** 此刻按候选摆出来的落点（`previewed` 为真时的那个）；外壳要读落点内容时用。 */
    previewedDrop(): D | null;
    end(): void;
}
```

引擎的规则（写进 `live-drag.ts` 头注释与 Spec，单元测试按条列）：

- `facts` 在 `offer` 时算一次，存在这一场里，一帧里各处读这一份；`staysWithoutSource` 一场只问一次；`origin` 拿起时读一次（容器变了整场取消）。
- `unmoved`：来源收起或展开、并且几何换了（`collapsed` 返回非 null；展开时有收起前的那份可换回）时记下此刻的指针；之后第一次判定的指针与它不等就清掉，此后同一像素也不再为真。几何没换（`collapsed` 返回 null，或展开时没有可换回的）不开始。
- 稳定计时从第一帧起算（第一帧才 `initialLiveDrop(now)`），不从 `begin`。
- 立即换：`container !== null && (home || container === absorbedIn)`；否则等 `stepLiveDrop` 的稳定。
- 收起：预览换成来源收起，或换成 `!inPlace && !home` 的候选，且此刻没收起；展开：只在预览换了的那一帧、换成 `inPlace` 的候选且此刻收起着。
- 吸收：换成候选时，`inPlace` 或 `show` 返回真才 `absorbedIn = container`；来源收起的预览与撕下时置 null。
- 要不要卡片（`wantsCard`）：没有候选要；候选在容器里且（`inPlace` 或 `container === absorbedIn`）不要；其余都要。nb-story 与 Lab 没有容器，卡片一直要。
- 容器里跟手的位置（`follow` 的 `at`）：不要卡片且候选有容器时是 `{pointer, container}`，否则 null。
- 撕下：这一帧预览没换、没收起、要卡片、`staysWithoutSource` 为真时收起来源，预览换成来源收起、空位清掉。
- 卡片：来源那块的矩形第一次要卡片时问一次并记住（同一帧里在换预览之后）；离开容器重新拿起时问吸收过它的那块，量不到就是缩好的大小，不回退到来源那块；缩小的目标按 `compact` 夹到不大于来源那块。
- 一帧：`follow.read` → `judge`（若在里面结束，这一帧到此为止）→ 写 `follow` → 取指针 → 换预览 → 写卡片；预览或卡片变了再 `follow.afterRender`。第一帧开头先 `measure`。续帧：指针动了、预览换了、卡片还没到、候选还没等够稳定、在容器里跟手，任一成立。
- `end`：先放回跟手的（`follow.read(null)()`）再 `show(null)`，状态换成空闲的一份；`begin` 之前、`end` 之后的 `offer`、`wake` 什么都不做。宿主的 `follow.afterRender` 在渲染后执行时先看引擎还在不在这一场（今天 `layout-drag.ts` 的 `nextTick` 里那一句）。

### `packages/nb-layout/src/vue/live-drag-session.ts`（新）：`createLiveDragSession`

```ts
/** 网格这一侧要的四样：`NestedGrid` 的实例满足，包着它的组件代理这四样也满足。 */
export interface LiveGrid {
    origin(): GridDropPoint;
    placeLifted(rect: GridRect): void;
    settleMotion(): void;
    motionMs(): number;
}

export interface LiveDragSessionOptions<S, D, R, L, G> extends DragSessionOptions<S, D, R> {
    /** 这一场的来源走不走实时布局：返回实时布局的来源（可以收窄，例如工作台只有标签走），null 是照常落点指示。拿起时问一次；减少动效（`motionMs() === 0`）与 `grid()` 为 null 时库先判为不走，不问。 */
    live(source: S, keyboard: boolean): L | null;
    /** 宿主要写的那份：领域判断，按 `L` 定类型。 */
    host: LiveDragHost<L, D, G>;
    grid: () => LiveGrid | null;
    changed?(state: LiveDragState): void;
}
/** 选项用工厂给：工厂收到引擎，宿主的回调里读 `live.geometry()` 不必引用还没返回的变量。 */
export function createLiveDragSession<S, D, R, L, G>(root: HTMLElement, options: (live: LiveDrag<L, D, G>) => LiveDragSessionOptions<S, D, R, L, G>): {session: DragSession<S, D>; live: LiveDrag<L, D, G>; dispose(): void};
```

- 合成的先后（写进 `live-drag-session.md` 与 Spec，各一条 dom 测试）：
  - 拿起，全在包住的 `activate` 里：宿主的 `activate` 先；返回真才判 `grid()` 与减少动效、问 `live`；给出来源才 `settleMotion`、`begin`。手势在 `activate` 返回后取结构键，宿主的结构键读引擎的 `active` 时两次取到的一样，拿起不会被当成结构变了。
  - 判定：宿主的 `resolve` 返回后 `offer`。
  - 收场：`end` 先于宿主的 `onActiveChange(false)`：`end` 里放回跟手的要读宿主这一场的状态，宿主在自己的回调里才换成空闲的一份。
  - `commitsUnderPointer`：宿主的结果或实时布局这一场。
  - 会话的 `sampled` 由它接，不暴露给宿主二次设置。
- 宿主接口里由合成接好的几项（`judge`、`pointer`、`origin`、`place`、`changed`、帧调度）不在宿主要写的 `LiveDragHost` 里；引擎内部另有完整的那份。
- `useLiveDragSession(root, gridRef, () => options)`：组件版，状态成只读 `shallowRef`，根换掉重建（同 `useDragSession`），卸载时 `dispose`（不另调 `end`：`dispose` 经会话收场到 `onActiveChange(false)`）。
- 工作台在 `onMounted` 里建，用 `createLiveDragSession`，`grid: () => surface.value`（`WorkbenchSurface` 补代理 `origin`、`motionMs`）；它的外壳把 `changed` 接到自己的 `shallowRef`。nb-story 与 Lab 在 setup 里用 `useLiveDragSession`。
- 公开的只有 `createLiveDragSession`、`useLiveDragSession` 与宿主要写的接口、状态与几个类型；`createLiveDrag` 不公开（单元测试相对路径导入），出现不用 Vue 会话的宿主时再定。
- 备选里不做的：并进 `createDragSession`（会话多一个类型参数 `G`、不走实时布局的宿主也背着它；1.0 前有第二个第三方宿主时再定）；只给组件版（工作台在 `onMounted` 里建，用不上）。

### `packages/nb-layout/src/vue/drag-session.ts`：`sampled`

- `DragSessionOptions` 加 `sampled?(): void`：会话自己的 `pointermove` 处理一开头同步调，早于排发布的帧。只用 `createFrameLoop` 的宿主同样靠它排在发布前面。
- 收场顺序不动。Spec 输入那一节 `resolve` 的“不产生副作用”改成：不改布局与已提交的状态、不提交；可以记下这一场的判定（`unmoved` 依赖它）、保持落点对象的身份、在读完 DOM 之后写跟手的反馈（光标标记、拖影）；可以读宿主维护的状态。`drag-session.ts` 的注释照此同步。

### `packages/nb-layout/src/vue/NestedGrid.vue`

- `lifted.key` 这一轮不在 `contents` 里时，自己留住这一项：沿用内容层上一次的放置（叶、`insetTop`），不活动，矩形照旧由 `placeLifted` 写；`lifted` 变成 null 后按新的 `contents` 处理（回到叶上，或没有了就停放、卸载）。dom 测试：拿起期间去掉这一项，实例不卸载；放下后它在新的叶上；放下时已不在 `contents` 里则卸载。
- `defineExpose` 加 `origin()`（网格根左上角，视口坐标）与 `motionMs()`（网格元素上的 `layoutMotionMs`）。
- 工作台 `WorkbenchSurface.vue` 里补回拿起项的那一段与 `lifted.home` 删掉。

### 容器里跟手

`TabStrip` 与标签条几何在不发布的 L2，库里只留宿主钩子 `follow` 与可选的 `container`，不带标签条的词。`SortableList` 有自己的实时排序，不当引擎的容器，写成已知限制。提案的决策记录追加这一条（只追加）。

### 第二个形状：Lab 场景 `live-panels`

四块卡片面板在一个 `NestedGrid` 里，只经公开入口：

- 判定：`measure` 用 `placeGrid` 与布局结果量每块的矩形；`resolve` 在冻结的矩形上用 `resolveGridEdgeDrop` 判外缘，回到自己那块是原位。
- 预览：在快照复制出的 `createGrid` 上 `removeLeaf` 来源、在目标边 `splitLeaf` 出新叶，得到预览的 `node`；来源收起是只 `removeLeaf`。
- `collapsed`：`removeLeaf` 之后重新 `placeGrid` 得到收起后的矩形。
- 宿主的 `unmoved`、`sticky` 用法照接口写。验收：长出新块、来源收起、回原处展开、空位粘住、收起那一刻指针没动松手放到屏幕上那个、指针一动按新几何重判。

撕下与容器跟手只有工作台用，接口上写明可选、只有一个宿主验证过。

### `packages/neuro-book/src/plugins/workbench/web/`：工作台改用引擎

- `live-drag.ts` 删掉，适配并进 `layout-drag.ts`：`facts` 放今天的 `keyOf`、空位（`edge` 且非原位的 `preview.areaRect`）、`dropStripOf`（`container`）、`isHomeStrip(homeStripOf(action))`（`home`；`join-container` 时 `container` 为 null 而 `home` 可能为真）；卡片 380×260、`keepSizeInsideHome` 由 `dragCardShrink === "panel"` 给、`refreshMs` 由 `dragCardRefresh` 给。`live-drag.test.ts` 24 例迁到引擎的单元测试。
- `layout-drag.ts`：会话改用 `createLiveDragSession`；`DragRun` 去掉 `frozen`、`beforeCollapse`、`held`；`freeze` 变成 `measure`（`strips`、`heldTab` 跟着进几何；拿起前的 `settleMotion` 由合成做），几何换算变成 `collapsed`；`dropAt` 开头 `if (live.unmoved(point)) return run.judged`，之后一次判定只取一次几何（`geometry()` 为 null 时现量一份传下去），入口条照旧先于 `sticky`；预览缓存按几何身份作废（null 到首份也算，今天拿起后的那次重量不作废，是旧缺口，顺带修，补一条宿主测试）；`wakeLive` 的监听删掉；`stableDrop` 不动；`offer` 由合成做。
- 外壳读 `previewKey`、`card`、`slot`、`shownAction` 的地方改读 `state` 与 `previewedDrop()`；`data-live-preview` 等 e2e 标记由宿主从 `state.preview` 派生，取值不变。

### `packages/nb-story/src/web/shell/BookFrame.vue`：拖详情换边改成实时布局

- 用 `useLiveDragSession(gridBox, () => gridRef.value, …)`，`gridRef` 的类型改成 `NestedGrid` 的实例。
- 卡片：不给 `lifted-head`（`DetailShell` 自带头，给了就是两个头）；`compact` 取 320×240、`keepSizeInsideHome` 假、`refreshMs` 1000/30（详情里有人物卡、原文与节点图，按卡片大小重排不便宜）。
- 实时布局时旧的落点反馈 `swapPreview`、跟手的标题小块 `swap-chip` 都为空，只在落点指示时画。
- 拖一张的头：卡片拿起跟手，在另一张上停稳 150ms 后预览是对调后的样子，松手 `swapDetails`；实时布局时回到自己那一半是原位（`resolve` 返回 `inPlace` 的落点，`actionKey` 为 null），别处没有落点；Escape 取消。落点指示时（减少动效）自己那一半照旧是 null，指示不画在来源上。
- 判定几何冻结：`measure` 记两张的矩形，`resolve` 读它。
- 预览只换 `detailContents` 的叶（会话的 `details` 不动），`structure` 与 `resolve` 读已提交的 `shownDetails`，预览不改结构键。
- 来源不收起、不撕下：`collapsed` 返回 null；`show({kind: "source-removed"})` 摆原样、返回假。
- nb-story 没有键盘拖动，换边的键盘入口是“与另一张对调”。

## Spec 与文档改动

- `ui/layout-drag`：加“实时布局的编排”几条输出（上面引擎的规则逐条，`unmoved`、`sticky`、`sampled`、合成的接线、“预览只给渲染，`structure` 与 `resolve` 读已提交的状态”），标“（planned）”，做完去掉；输入那一节 `resolve` 的“不产生副作用”改写；非目标第 19 行改链接新输出；第 192 行（帧循环与会话一起用）改成用 `sampled` 或合成；“边界与兼容”“实现合同”补新名字，可选项写明只有一个宿主验证过。
- `ui/nested-grid`：`lifted` 那条加“不在 `contents` 里时留住”，标“（planned）”，做完去掉。
- `ui/workbench-layout` 输出 38：只留工作台的规则，通用语义改链接。
- `story/viewer` 输出 68：落点指示换成实时让位；减少动效照旧；删去键盘的说法。
- nb-layout：`drag-card.md` 第 26、52 行与 `frame-loop.ts` 头注释改指 `sampled`；`vue/drag-session.md` 选项表加 `sampled`；新文档 `vue/live-drag-session.md`；README 第 131 行一带改成先用合成，`live-drop` 几个名字作底层零件留着；`CHANGELOG.md` 的 `[Unreleased]` 加新增；`api/*.api.txt` 重生成。
- 提案：决策记录追加“容器跟手只留宿主钩子”。

## 切片

1. 引擎与单元测试：迁 24 例，按上面的规则逐条补（含 `judge` 里结束、`join-container` 的 `home`、`collapsed` 返回 null 时不开始 `unmoved`、指针离开再回到同一像素 `unmoved` 为假、几何身份、`show` 的调用先后与返回假、`wantsCard`、续帧、`staysWithoutSource` 一场一问、`begin` 前与 `end` 后无效）。注入的帧调度推进，不碰 DOM。
2. 会话的 `sampled`、`createLiveDragSession` 与 `useLiveDragSession`、`NestedGrid` 留住拿起项与两个 expose，dom 测试（`sampled` 先于发布的帧；合成的四条先后各一例；`live` 返回 null 的来源照常落点指示、引擎回调一个都不调；减少动效与 `grid()` 为 null 不走实时；留住与放下后的去处）。这一片落地就派一次后台实现审查（Claude Sonnet），不等收口。
3. 工作台改用：diff 以删为主；基线三份 e2e 对照；补预览缓存作废的宿主测试；`WorkbenchSurface` 补代理 `origin`、`motionMs`。这一片落地也派一次后台实现审查。
4. Lab 场景 `live-panels` 与 `lab-live-panels.e2e.ts`（含布局过渡进行中拿起，`measure` 量到的是过渡终点的矩形）。
5. nb-story 换边：`side-by-side.e2e.ts` 改与补（含停稳前甩过去松手也对调、减少动效时指示不画在来源上、实时布局时没有旧的落点反馈与标题小块、卡片只有一个头）。
6. Spec、文档、CHANGELOG、API 报告、提案的决策记录。

每片自跑：`packages/nb-layout` 的 `bun run typecheck`、`bun run test`、`bun run api:check`；动到应用的片加 `packages/neuro-book` 的 `bun run typecheck`；动到 nb-story 的片加它的 typecheck。

## 验收映射

- `ui/layout-drag` 新增各条 → 引擎单元测试（切片 1）、合成与会话的 dom 测试（切片 2）、`lab-live-panels.e2e.ts`（切片 4：收起、几何换算、`unmoved`、粘住在第二个形状上）。
- `ui/nested-grid` 的留住 → `NestedGrid.dom.test.ts`（切片 2）；工作台撕下与飞回 → `workbench-live-drag.e2e.ts` 现有用例。
- `ui/workbench-layout` 输出 38 不变 → 三份工作台 e2e 与基线对照（68 条），开销用例的每帧样式重算上限不变；收起那一刻被拒绝留着 → `workbench-live-drag.e2e.ts:324`。
- `story/viewer` 输出 68 → `nb-story/e2e/side-by-side.e2e.ts`：停稳后预览是对调的样子、松手对调、停稳前甩过去松手也对调、原位与别处松手不动、Escape 取消、减少动效下是落点指示且不画在来源上。

## 验证

三份工作台 e2e、`lab-live-panels.e2e.ts`、nb-story 的 `side-by-side.e2e.ts` 整份跑；`editor-area.e2e.ts`、`files-explorer.e2e.ts` 也用会话，跑一次确认 `sampled` 没碰到它们（共 7 个文件）。未验证边界：真机手感。

## 不做与风险

- 不进插件 SDK；不改落点指示那一路；不动整窗拖动。
- 风险：时序原样搬时丢一步。切片 3 先对基线，再删旧代码。
- **发布顺序**：t49 一律写进 nb-layout 的 `[Unreleased]`（进 0.2.0），不并进 0.1.0。合入 master 之前查 npm：0.1.0 还没发时先停下问开发者，不直接合入。`[Unreleased]` 的引擎条目旁写明 t55 合入之前不发 0.2.0（t55 可能给引擎改名）。

## 相对第 2 稿

- 会话与引擎、引擎与网格的接线进库：新 `createLiveDragSession`、`useLiveDragSession`，宿主的 `resolve` 回到无副作用，结束只有合成一个主人（整体第 1、4 条，细节第 4、5 条）。
- “指针不动不重判”进引擎：`unmoved(point)`；`collapsed` 只算几何，返回 null 时不开始 `unmoved`；`expanded` 回调删掉（整体第 2 条，细节第 6 条）。
- 拿起的内容不能卸载由 `NestedGrid` 自己留住，删掉 `withLifted` 与 `lifted.home`（整体第 3 条，细节第 1 条）。
- `show` 写明返回值、兜底与调用先后（细节第 2 条）；引擎的规则逐条写全（细节第 3 条）；`facts` 一次一算（细节第 8 条）。
- `container` 改可选；状态用已有的 `LivePreview`、去掉 `shown`；`LiveShowTarget`、`slotOnScreen`、`slotInGrid` 改名；`keepSizeInsideHome` 改名并写缺省（整体第 5、6 条，细节第 9 条）。
- 预览缓存按身份作废含 null 到首份，一次判定只量一次，补宿主测试（细节第 7 条）。
- Lab 场景写明用哪些公开函数（细节第 10 条）；文档清单补 `drag-card.md`、`drag-session.md`，Spec 行号改对（细节第 11 条）。
- nb-story 的预览不改结构键（整体第 7 条）；发布顺序加“t55 合入之前不发 0.2.0”（整体第 8 条）。

## 相对第 3 稿

- 合成的四条先后写死并各配 dom 测试（两份都提）。
- 来源类型分开：`live` 返回实时布局的来源 `L`，宿主接口按 `L` 定类型；选项用工厂给，工厂收到引擎（两份都提）。
- `grid` 必填、定成结构化的 `LiveGrid`，工作台给 `WorkbenchSurface` 并补两项代理（整体第 4 条）。
- `unmoved` 的清除规则与“几何没换不开始”（细节第 3 条）。
- Spec 里 `resolve` 的措辞改成允许记判定与写跟手的反馈（两份都提）。
- nb-story：不给 `lifted-head`、实时布局时关掉旧反馈、卡片参数定值（细节第 4 条）。
- 一场一问 `staysWithoutSource`、`origin` 读一次、工作台的响应性经 `changed`、`afterRender` 先看还在不在（细节第 5 条）；过渡中拿起量终点的真实运行时用例（细节第 7 条）。
- `createLiveDrag` 不公开（整体第 5 条）。
- 切片 2、3 落地各派一次后台实现审查。
