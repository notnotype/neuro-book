# t49 手感编排进库：计划第 2 稿

第 1 稿两份设计审查（细节 Claude Sonnet：阻断 1、重要 7、建议 4，[证据](evidences/design-review-1-detail.txt)；从整体看 Claude Opus：阻断 1、重要 7、建议 2，[证据](evidences/design-review-1-whole.txt)）都成立，本稿按它们改。改了什么见文末“相对第 1 稿”。

## Context

- 依据：[通用布局库提案](../../../../../docs/proposals/nb-layout-general-library.md)“手感引擎分两步”的第二步（开发者 2026-11-18 接受）；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)；Spec [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38、[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 68。
- 为什么做：实时布局的编排（候选稳定才换预览、撕下来源、来源收起展开后换判定的几何、空位粘住、卡片、一帧的先后）写在工作台里（`plugins/workbench/web/live-drag.ts` 319 行，加 `layout-drag.ts` 里冻结与换几何的几段）。第三方要实时布局得照抄，而它的时序靠宿主先挂 `pointermove` 监听这种调用顺序成立。
- 已定：
  - 第二个宿主有 nb-story 的拖详情换边：t45 定“拖动先做落点指示，实时让位等 t49”。
  - 0.x 期间全部 `@experimental`，新名字照此标，并写明 1.0 前签名会变（开发者 2026-11-23）。
  - 引擎不进插件 SDK。
- 工作方式：autonomous-delivery。计划审查阻塞（细节 Claude Sonnet，从整体看 Claude Opus）；实现审查一次、不阻塞。改前的基线：分支起点上 `workbench-live-drag`、`workbench-dnd`、`workbench-drag-cost` 三份 68 条全过。

## 关键设计

### 编排的分工

引擎管“什么时候”：什么时候换预览、收起与展开来源、换判定的几何、拿起与收回卡片，一帧里各步的先后。宿主管“是什么”：落点、判定（含被拒绝这类宿主自己的结论）、按落点摆的预览、几何怎么量、收起之后的几何怎么算。

| 谁驱动 | 什么 |
|---|---|
| 引擎 | 预览换不换、换成哪个（经 `show`）；来源收起与展开（经 `collapsed`、`expanded`）；判定的几何（`geometry()`）；卡片拿起与收回、矩形（经 `card.place`）；帧循环 |
| 宿主 | 判定（会话的 `resolve`）里先问 `sticky`，再现判；判定之后 `offer`；收起、展开那一刻记下自己的判定、指针再动才重判（工作台的 `held`）；结束（会话的 `onActiveChange(false)` 里 `end`） |
| 会话 | 自己的 `pointermove` 一开头调宿主的 `sampled`（宿主接到引擎的 `wake`），不再靠宿主先挂监听 |
| `useLiveDrag` | 把引擎的状态变成 ref；`NestedGrid` 的 `lifted`、`dragging` 直接用；`withLifted(contents)` 在预览摘掉来源那块时把拿起的内容项补回内容层，实例不卸载 |

### `packages/nb-layout/src/live-drag.ts`（新）

纯 TS，不依赖 Vue 与 DOM（`boundary.test.ts` 扫描守着），单元测试直接测它。公开名字只从 `./vue` 导出：唯一能驱动它的会话在 `./vue`。复用 `live-drop.ts`、`drag-card.ts`、`frame-loop.ts`。

```ts
export interface LiveDropFacts {
    /** 摆出来一样的落点同一个键。 */
    readonly key: string;
    /** 放下去是原样。 */
    readonly inPlace: boolean;
    /** 落进哪个吸收来源的容器（标签条、入口条）：卡片收回，来源在容器里跟手；不是为 null。 */
    readonly container: string | null;
    /** 落在这里还没离开来源（来源自己的容器，或宿主认为算自己的位置）：不收起来源。必填。 */
    readonly home: boolean;
    /** 长出新块时的空位（视口坐标）；并入没有空位。 */
    readonly slot: GridDropRect | null;
}

/** 引擎要摆的预览：按落点、来源收起的样子，或没有预览（已提交的样子）。 */
export type LivePreviewTarget<D> = {readonly kind: "drop"; readonly drop: D} | {readonly kind: "source-removed"} | null;

export interface LiveDragHost<S, D, G> {
    facts(source: S, drop: D): LiveDropFacts;
    /** 摆预览；返回假是摆不出来（引擎记为“没摆出来”，状态的 `previewed` 为 null）。`collapsed` 是来源此刻收起着。 */
    show(target: LivePreviewTarget<D>, context: {readonly source: S; readonly collapsed: boolean}): boolean;
    /** 让判定做完这一帧（会话的 `flush`）；可能在里面结束这一场。 */
    judge(): void;
    pointer(): GridDropPoint | null;
    /** 判定的几何：拿起后第一帧开头量（那时这一场的渲染已经做完）。 */
    measure(source: S): G;
    /** 来源收起后的几何；null 是收起不改几何（引擎照旧用 `before`）。 */
    collapsed(source: S, before: G, drop: D | null): G | null;
    /** 来源展开回原位，几何换回拿起时的那份；宿主在这里记下此刻的判定。 */
    expanded(source: S, drop: D): void;
    /** 来源那块摘掉它还在：要卡片时马上收起来源（撕下）。缺省恒假。 */
    staysWithoutSource?(source: S): boolean;
    origin(): GridDropPoint;
    card: {
        /** 卡片里放哪个内容项（`NestedGrid` 的 `lifted.key`）。 */
        readonly key: (source: S) => string;
        /** 某块的矩形（视口坐标）：`container` 为 null 是来源那块（引擎第一次要卡片时问一次并记住），否则是吸收过它的那块；量不到为 null。 */
        readonly rect: (source: S, container: string | null) => GridDropRect | null;
        readonly place: (rect: GridRect) => void;
        /** 缩到多大（再不大于来源那块），缺省 380×260。 */
        readonly compact?: {readonly width: number; readonly height: number};
        /** 指针还在来源那块里时不缩，缺省假。 */
        readonly shrinkOutsideHome?: () => boolean;
        /** 尺寸多久写一次，缺省 0（每帧）。 */
        readonly refreshMs?: () => number;
    };
    /** 容器里跟手（可选，只有工作台验证过）：先读后写。 */
    follow?: {
        readonly read: (at: {readonly point: GridDropPoint; readonly container: string} | null) => () => void;
        readonly afterRender: (at: {readonly point: GridDropPoint; readonly container: string} | null) => void;
    };
    /** 可见状态变了（`useLiveDrag` 接到 ref）。 */
    changed?(state: LiveDragState<D>): void;
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
}

export interface LiveDragState<D> {
    readonly active: boolean;
    /** `none`、`source-removed` 或候选的键：e2e 等它。 */
    readonly previewKey: string;
    /** 此刻显示的候选（空位粘住用）；没有为 null。 */
    readonly shown: D | null;
    /** 摆出来了的候选；原位、摆不出来为 null（外壳按它画并入的盖层、空位）。 */
    readonly previewed: D | null;
    readonly collapsed: boolean;
    readonly lifted: {readonly key: string} | null;
    /** 已显示的空位（相对网格根）。 */
    readonly slot: GridRect | null;
}

export interface LiveDrag<S, D, G> {
    state(): LiveDragState<D>;
    begin(source: S, point: GridDropPoint | null): void;
    /** 这一刻判定的落点。帧循环停着时排一帧。 */
    offer(drop: D | null): void;
    /** 有新的指针样本：帧循环停着时排一帧。 */
    wake(): void;
    /** 拿起后量到之前为 null：宿主现量、不存。 */
    geometry(): G | null;
    /** 指针在已显示的空位里（含 8px 边距）：候选不变，返回它；宿主可以先判自己更优先的落点再问它。 */
    sticky(point: GridDropPoint): D | null;
    end(): void;
}
```

- 引擎的规则写死：`immediate = container !== null && (home || container === absorbedIn)`；落到别处收起来源 `= preview 是 source-removed，或候选 !inPlace && !home`；回到 `inPlace` 的候选展开。工作台的 `home` 取今天 `isHomeStrip(homeStripOf(action))`：只有入口上的并入（`join-container`）`container` 为 null 而 `home` 可能为真，单元测试列这一例。
- 一帧的顺序写死：`follow.read` → `judge`（若在里面结束，这一帧到此为止）→ 写 `follow` → 取指针 → 换预览 → 写卡片；预览或卡片变了再 `follow.afterRender`。第一帧开头先 `measure`（帧回调晚于 Vue 的渲染刷新，量到的是渲染之后的矩形）；同一个同步段里第一次判定时 `geometry()` 为 null，宿主现量、不存。`end` 里先放回跟手的（`follow.read(null)()`）再 `show(null)`。
- 卡片：来源那块的矩形第一次要卡片时问一次（同一帧里在换预览之后，单个标签的面板收起后量不到就是 null）；重新拿起时问吸收过它的那块，量不到就是缩好的大小，不回退到来源那块。缩小的目标按 `compact` 夹到不大于来源那块。
- 每场的状态在一个对象里，`end` 换成空闲的一份；`begin` 之前、`end` 之后的 `offer`、`wake` 什么都不做。

### `packages/nb-layout/src/vue/drag-session.ts`：会话的 `sampled`

- `DragSessionOptions` 加 `sampled?(): void`：会话自己的 `pointermove` 处理一开头同步调，早于排发布的帧。不只给引擎用：只用 `createFrameLoop` 的宿主同样靠它排在发布前面。
- 不改收场顺序：宿主照旧在 `onActiveChange(false)` 里 `end`（今天的位置，Spec 的收场顺序不动）。
- `useDragSession` 透传。

### `packages/nb-layout/src/vue/useLiveDrag.ts`（新）

- `useLiveDrag(host)`：setup 期用，建引擎、帧调度缺省用窗口的、`changed` 接到只读 `shallowRef`，卸载时 `end`。返回 `{live, state, lifted, dragging, withLifted}`：`lifted`、`dragging` 是 `NestedGrid` 同名属性要的形状；`withLifted(contents)` 在拿起的内容项不在 `contents` 里时补上一项（叶取拿起时它所在的叶、不活动），工作台今天 `WorkbenchSurface.vue` 里补的那一段移进库。
- 工作台的引擎在 `createLayoutDrag` 里建（它的回调要读那里的 `run`），用 `createLiveDrag`，同样从 `./vue` 导入。

### 容器里跟手（提案“标签条排序与标签条几何一起设计”）

`TabStrip` 与标签条几何已在不发布的 L2，库里只留宿主钩子 `follow`，不带标签条的词。`SortableList` 有自己的实时排序，不当引擎的容器：两者合不合并等有第三方要时再定，写成已知限制。提案的决策记录追加这一条（只追加，不改正文）。

### 第二个形状：Lab 场景 `live-panels`

nb-story 的两张卡只验证候选稳定、几何、卡片、帧顺序与唤醒；收起与几何换算、空位粘住只有工作台用。加一个 Lab 场景（`plugins/lab/web/fixtures/nb-layout/LivePanelsScene.vue`）：四块卡片面板在一个 `NestedGrid` 里，拖一块的头到另一块的外缘长出新块、来源那块收起（树里摘掉、兄弟补上），回到原处展开，空位粘住；只经 `@notnotype/nb-layout` 与 `./vue` 的公开入口。它是提案点名的“不是标签页的宿主”。撕下（`staysWithoutSource`）与容器跟手（`follow`）只有工作台用，接口上写明是可选项。

### `packages/neuro-book/src/plugins/workbench/web/`：工作台改用引擎

- `live-drag.ts` 删掉，`LiveDragHost` 的适配并进 `layout-drag.ts`（`facts` 里放今天的 `keyOf`、`candidateOf` 的空位判断、`dropStripOf`、`homeStripOf`、`isHomeStrip`；卡片的 380×260 与两个设置）。`live-drag.test.ts` 24 例逐条迁到引擎的单元测试，宿主相关的留在应用。
- `layout-drag.ts`：`DragRun` 去掉 `frozen`、`beforeCollapse`，冻结变成 `measure`、几何换算变成 `collapsed`；`held` 留在宿主，在 `collapsed`、`expanded` 回调里记 `{...run.judged, point}`（被拒绝、编辑器的拒绝跟着留下，同今天）；预览缓存在 `geometry()` 换身份时作废（今天拿起后第二次冻结不作废，是旧缺口，顺带修，不算“行为不变”）；`wakeLive` 的监听删掉，改 `sampled`；`stableDrop` 不动，仍在 `resolve` 里；`offer` 仍在 `resolveDrop` 里。
- 外壳读 `previewKey`、`card`、`slot`、`shownAction` 的地方改读 `state`（`shownAction` 换成 `previewed?.action`）；`data-live-preview` 这类 e2e 标记不变。

### `packages/nb-story/src/web/shell/BookFrame.vue`：拖详情换边改成实时布局

- 用 `useLiveDrag`。拖一张的头：卡片拿起跟手（`lifted` 与 `lifted-head` 插槽写标题），在另一张上停稳 150ms 后预览是对调后的样子（`detailContents` 换叶），松手 `swapDetails`；回到自己那一半是原位（`resolve` 返回 `inPlace` 的落点，`actionKey` 为 null），预览回原样；别处没有落点；Escape 取消。
- 判定几何冻结：`measure` 记下两张的矩形，`resolve` 读它，不现量（现量的话预览把另一张换走、候选变空，会来回抖）。
- 来源不收起、不撕下：`collapsed` 返回 null，没有 `staysWithoutSource`、`follow`；`show({kind: "source-removed"})` 摆原样。
- 减少动效时照旧是落点指示：在 `NestedGrid` 的根上读 `layoutMotionMs`（变量写在网格元素上，会话根 `gridBox` 读到的是回退值）。nb-story 没有键盘拖动，换边的键盘入口是“与另一张对调”。
- `NestedGrid` 接 `dragging`、`lifted`，内容层用 `withLifted`。

## Spec 与文档改动

- `ui/layout-drag`：加“实时布局的编排”几条输出（候选稳定、`home` 与收起展开、判定几何的时机与换法、空位粘住、卡片拿起与收回、一帧的顺序、`sampled`、`withLifted`），标“（planned）”，做完去掉；非目标第 19 行改成链接新输出；输出 21 的“宿主先挂 wake 监听”改成用会话的 `sampled`；“边界与兼容”“实现合同”补新名字，可选项写明只有一个宿主验证过。
- `ui/workbench-layout` 输出 38：只留工作台的规则，通用语义改链接。
- `story/viewer` 输出 68：落点指示换成实时让位；减少动效照旧；删去键盘的说法（本来就没有）。
- nb-layout：`frame-loop.ts` 头注释改指 `sampled`；README 第 131 行一带改成先用引擎，`live-drop` 几个名字作底层零件留着；`CHANGELOG.md` 的 `[Unreleased]` 加新增；`api/*.api.txt` 重生成。
- 提案：决策记录追加“容器跟手只留宿主钩子”。

## 切片

1. 引擎与单元测试（迁 `live-drag.test.ts` 24 例，补：`judge` 里结束、`join-container` 的 `home`、`collapsed` 返回 null、几何身份换了、`begin` 前与 `end` 后调用无效）。用注入的帧调度推进，不碰 DOM。
2. 会话的 `sampled`、`useLiveDrag`（含 `withLifted`）与 dom 测试：`sampled` 先于发布的帧；`withLifted` 补回与拿起结束后不再补。
3. 工作台改用引擎：diff 以删为主；基线三份 e2e 对照。
4. Lab 场景 `live-panels` 与 e2e `lab-live-panels.e2e.ts`：长出新块、来源收起、回原处展开、空位粘住、收起那一刻指针没动松手放到屏幕上那个。
5. nb-story 换边：`side-by-side.e2e.ts` 改与补。
6. Spec、README、CHANGELOG、API 报告、提案的决策记录。

每片自跑：`packages/nb-layout` 的 `bun run typecheck`、`bun run test`、`bun run api:check`；动到应用的片加 `packages/neuro-book` 的 `bun run typecheck`；动到 nb-story 的片加它的 typecheck。

## 验收映射

- `ui/layout-drag` 新增各条 → 引擎单元测试（切片 1）、会话与 `useLiveDrag` 的 dom 测试（切片 2）、`lab-live-panels.e2e.ts`（切片 4，收起、几何换算、粘住在第二个形状上）。
- `ui/workbench-layout` 输出 38 不变 → 三份工作台 e2e 与基线对照（68 条），开销用例的每帧样式重算上限不变；收起那一刻被拒绝留着 → `workbench-live-drag.e2e.ts:324` 那条。
- `story/viewer` 输出 68 → `nb-story/e2e/side-by-side.e2e.ts`：停稳后预览是对调的样子、松手对调、原位与别处松手不动、Escape 取消、减少动效下是落点指示。

## 验证

三份工作台 e2e、`lab-live-panels.e2e.ts`、nb-story 的 `side-by-side.e2e.ts` 整份跑；`editor-area.e2e.ts`、`files-explorer.e2e.ts` 也用会话，跑一次确认 `sampled` 没碰到它们（共 7 个文件）。未验证边界：真机手感。

## 不做与风险

- 不进插件 SDK；不改落点指示那一路；不动整窗拖动。
- 风险：时序原样搬时丢一步。切片 3 先对基线，再删旧代码。
- **发布顺序**：t49 一律写进 nb-layout 的 `[Unreleased]`（进 0.2.0），不并进 0.1.0：首发不带只验证了一轮、紧接着 t55 还可能改名的接口。合入 master 之前查 npm：0.1.0 还没发时先停下问开发者（先发 0.1.0，或从合入前的提交发），不直接合入。

## 相对第 1 稿

- 落点 `D` 只是落点：`offer` 留在宿主，被拒绝这类宿主的结论由宿主在 `collapsed`、`expanded` 回调里自己留（两份审查的阻断）。
- 不要 `connect`：会话只加通用的 `sampled`；结束只有宿主一个主人，收场顺序不变。
- 公开名字只从 `./vue` 出；去掉 `subscribe`，改 `changed` 回调；去掉 `P`，三个预览回调合成 `show(target): boolean`；帧调度与卡片参数给缺省。
- `measure` 由引擎在第一帧开头调；卡片补 `key`，`lifted` 是 `{key}`；状态分开 `shown` 与 `previewed`，补 `collapsed`；`home` 必填并写死两条规则。
- 加 Lab 场景作收起与粘住的第二个形状；撕下与跟手写明可选、只有工作台验证过；`withLifted` 把“拿起的内容不能卸载”放进库。
- nb-story 一节补冻结几何、原位落点、减少动效的读法，删去键盘。
- 发布顺序定死：进 `[Unreleased]`，0.1.0 没发时合入前停下问。
