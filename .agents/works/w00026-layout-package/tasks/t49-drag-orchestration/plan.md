# t49 手感编排进库：计划第 1 稿

## Context

- 依据：[通用布局库提案](../../../../../docs/proposals/nb-layout-general-library.md)“手感引擎分两步”的第二步（开发者 2026-11-18 接受）；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)；Spec [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)（2026-11-23 晋升）、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38、nb-story [`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 68。
- 为什么做：实时布局的编排（候选稳定才换预览、撕下来源、来源收起展开后按换过的布局重判、收起展开那一刻的落点留到指针再动、空位粘住、卡片、帧顺序）现在写在工作台里（`plugins/workbench/web/live-drag.ts` 319 行，`layout-drag.ts` 里 `freeze`、`collapseSource`、`expandSource`、`held`、`stickyDrop` 几段）。第三方要实时布局得照抄这一套，而它的时序（先判定再写卡片、`pointermove` 监听的先后）只靠调用顺序成立。
- 已定：
  - 第二个宿主是 nb-story 的拖详情换边：t45 定“拖动先做落点指示，实时让位等 t49”（t45 README“决定”）。
  - 0.x 期间全部 `@experimental`（开发者 2026-11-23）；新名字照此标，并写明 1.0 前签名会变。
  - 引擎不进插件 SDK（SDK 转出名的快照不变，不动 `PLUGIN_API_SINCE`）。
- 工作方式：autonomous-delivery。计划审查阻塞：涉及发布包的公开接口，按 reviewing 另派一位从整体看的审查者；细节与事实核对交 Claude Sonnet（nb-layout 是前端包）。实现审查一次、不阻塞。

## 关键设计

### 编排的分工

引擎管“什么时候”：什么时候换预览、什么时候收起与展开来源、什么时候换判定的几何、什么时候拿起与收回卡片、一帧里各步的先后。宿主管“是什么”：落点长什么样、按落点摆出的预览、判定的几何怎么量、收起之后的几何怎么算。

### `packages/nb-layout/src/live-drag.ts`（新，核心入口）

纯 TS，不依赖 Vue 与 DOM（`boundary.test.ts` 的扫描守着）。复用 `live-drop.ts`（`initialLiveDrop`、`stepLiveDrop`、`insideShownSlot`）、`drag-card.ts`（`createDragCard`）、`frame-loop.ts`（`createFrameLoop`）。

```ts
/** 宿主对一个落点的描述：引擎只读这几样，落点本身原样传回宿主。 */
export interface LiveDropFacts {
    /** 摆出来一样的落点同一个键（`stepLiveDrop` 的候选键）。 */
    readonly key: string;
    /** 放下去是原样。 */
    readonly inPlace: boolean;
    /** 落在哪个排序容器里（标签条、入口条）；不是为 null。 */
    readonly strip: string | null;
    /** 落在这里算不算还没离开来源（自己的标签条、来源唯一的入口条）；缺省按 `strip` 是不是来源自己的。 */
    readonly home: boolean;
    /** 长出新块时的空位（视口坐标），指针在里面候选不变；并入没有空位。 */
    readonly slot: GridDropRect | null;
}

export interface LiveDragHost<S, D, P, G> {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    facts(source: S, drop: D): LiveDropFacts;
    /** 预览：按落点摆的、摘掉来源的；null 是摆不出来。 */
    preview(source: S, drop: D): P | null;
    sourceRemoved(source: S): P | null;
    show(preview: P | null): void;
    /** 判定的几何：拿起后渲染做完时量一次；来源收起时由宿主按收起前的算收起后的。 */
    measure(source: S): G;
    collapsed(source: S, before: G): G | null;
    /** 来源那块面板摘掉它还在（撕下标签）。 */
    staysWithoutSource(source: S): boolean;
    /** 卡片：从哪块矩形开始缩（视口坐标）、缩到多大、什么时候缩、多久写一次尺寸、写到哪。 */
    card: {
        readonly from: (source: S, strip: string | null) => GridDropRect | null;
        readonly size: (source: S) => {readonly width: number; readonly height: number};
        readonly shrinkInsideHome: () => boolean;
        readonly refreshMs: () => number;
        readonly place: (rect: GridRect) => void;
    };
    /** 网格根的左上角（视口坐标）：卡片与空位相对它；拿起时读一次。 */
    origin(): GridDropPoint;
    /** 排序容器里跟手（可选）：先读后写，同 `live-drag.ts` 今天的 `placeSorted`。 */
    sort?: {
        readonly read: (at: {readonly point: GridDropPoint; readonly strip: string} | null) => () => void;
        readonly afterRender: (at: {readonly point: GridDropPoint; readonly strip: string} | null) => void;
    };
}

export interface LiveDrag<S, D, G> {
    /** 订阅可见状态的变化（拿起、换预览、卡片拿起收回、空位）；Vue 层把它变成 ref。 */
    readonly state: () => LiveDragState<D>;
    subscribe(listener: () => void): () => void;
    begin(source: S, point: GridDropPoint | null): void;
    /** 宿主的判定读的几何：拿起后量到之前是 null（宿主现量）。 */
    geometry(): G | null;
    /** 收起、展开那一刻屏幕上的落点：指针没动之前判定直接用它；动了返回 undefined。 */
    held(point: GridDropPoint): D | null | undefined;
    /** 指针在已显示的空位里：候选不变。 */
    sticky(point: GridDropPoint): D | null;
    end(): void;
    /** 会话接上：会话每次指针移动先调 `wake`、帧里调 `judge`（判定，读 DOM）与 `pointer`。 */
    connect(driver: {readonly judge: () => void; readonly pointer: () => GridDropPoint | null}): {readonly offer: (drop: D | null) => void; readonly wake: () => void};
}

export interface LiveDragState<D> {
    readonly active: boolean;
    /** `none`、`source-removed` 或候选的键：e2e 等它。 */
    readonly previewKey: string;
    readonly shown: D | null;
    readonly lifted: boolean;
    readonly slot: GridRect | null;
}
```

- 状态全部在 `createLiveDrag` 的一个闭包里，每场一份，`end` 换成空闲的一份（t37 的写法）。
- 一帧的顺序写死在引擎里：排序读 → `judge` → 排序写 → 取指针 → 换预览 → 写卡片；状态变了再 `sort.afterRender`。今天 `live-drag.ts` 的 `tick` 照搬。
- 几何的换法归引擎：`begin` 之后第一次 `geometry()` 前由宿主触发 `measure`（见下一节的时机）；收起时 `collapsed(before)`，展开时换回收起前那份；`held` 在收起、展开时记下，指针一动作废。宿主的预览缓存按 `geometry()` 的身份作废，不另开回调。
- `facts.home` 取代今天的 `isHomeStrip`、`homeStripOf` 两条：哪条容器算来源自己的是工作台的规则，留在宿主算好交来。

### `packages/nb-layout/src/vue/drag-session.ts`：会话接上引擎

- `DragSessionOptions` 加 `live?: LiveDrag<S, D, unknown>`（给了就是这一场可能走实时布局；`activate` 里由宿主决定 `begin` 与否，同今天）。
- 会话建好时调 `live.connect({judge: flush, pointer})`；自己的 `pointermove` 监听里先 `wake` 再排发布的帧：wake 先于发布由会话保证，不再靠宿主先挂监听（今天 `layout-drag.ts` 构造时挂的 `wakeLive` 删掉）。
- `resolve` 的结果由会话交给 `offer`，宿主不再自己调。
- 收场：会话的收场顺序里 `live.end()` 排在 `onActiveChange(false)` 之前、提交之前（今天在 `onActiveChange(false)` 里由宿主调，撤预览与提交在同一个同步段，不闪），写进 `ui/layout-drag`“状态与转换”的收场顺序。

### `packages/nb-layout/src/vue/useLiveDrag.ts`（新）

- `useLiveDrag(host)`：建引擎，把 `state` 订阅成只读的 `shallowRef`，卸载时 `end`；返回 `{live, state, lifted, slot}`。`lifted` 直接是 `NestedGrid` 的 `lifted` 属性要的形状，`card.place` 由宿主接到 `NestedGrid` 的 `placeLifted`（宿主持有网格实例，库不替它找）。
- 不新增组件。

### `packages/neuro-book/src/plugins/workbench/web/`：工作台改用引擎

- `live-drag.ts` 删到只剩工作台的 `LiveDragHost` 适配（`facts` 里放今天的 `keyOf`、`candidateOf`、`dropStripOf`、`homeStripOf`、`isHomeStrip`，卡片尺寸 380×260 与两个设置），或并进 `layout-drag.ts`；以 diff 读起来哪个短为准。
- `layout-drag.ts`：`DragRun` 去掉 `frozen`、`beforeCollapse`、`held`，`freeze` 变成 `measure` 回调，`collapseSource` 的几何换算变成 `collapsed` 回调；`dropAt` 里的 `held` 与 `stickyDrop` 改读引擎；`wakeLive` 的监听删掉。被拒绝与编辑器的拒绝跟着落点走：`D` 用工作台的 `Judgement`（落点加 `rejected`、`refusal`），收起那一刻的整份判定就由引擎留着。
- `WorkbenchSurface` 与外壳读 `previewKey`、`card`、`slot`、`shownAction` 的地方改读 `useLiveDrag` 的状态；`data-live-preview` 这类给 e2e 的标记不变。

### `packages/nb-story/src/web/shell/BookFrame.vue`：拖详情换边改成实时布局

- 两张详情都在、宽屏时，拖一张的头：卡片拿起跟手（`NestedGrid` 的 `lifted` 与 `lifted-head` 插槽，头写标题），在另一张上停稳 150ms 后预览就是对调后的样子（两张换叶，另一张滑过去），松手提交对调；回到自己那一半是原位，预览回原样；别处没有落点，预览回原样，松手不动；Escape 取消。
- 预览是一份两张换了叶的 `contents`（nb-story 的 `detailContents` 换顺序），不写会话、不改地址栏；放下才 `swapDetails`。
- 只有两块，不撕下（摘掉来源那块就没了）、不收起来源；`collapsed` 返回 null、`staysWithoutSource` 恒假。这本身是对“引擎在没有标签条、没有收起的宿主上也成立”的检验。
- 减少动效、键盘拖动照旧是落点指示（同工作台的规则，Spec 写明）。

## Spec 与文档改动

- `ui/layout-drag`：加“实时布局的编排”几条输出（候选稳定、撕下、收起展开与判定几何、留到指针再动、空位粘住、卡片拿起与收回、一帧的顺序、会话负责唤醒），标“（planned）”，做完去掉；“公开接口”与“实现合同”补新名字。
- `ui/workbench-layout` 输出 38：只留工作台的规则（哪条算自己的标签条、卡片尺寸、设置），编排的通用语义改成链接 `ui/layout-drag`。
- `story/viewer` 输出 68：落点指示换成实时让位，减少动效与键盘照旧。
- nb-layout：README“我要做 X 用哪个导出”加一行；`CHANGELOG.md` 的 `[Unreleased]` 加新增；`api/*.api.txt` 重生成；新源码声明标 `@experimental`。

## 切片

1. 引擎（`live-drag.ts`）与单元测试：用注入的帧调度（测试里自己推进的 `requestFrame`）跑完整场景，不碰 DOM。提交。
2. 会话接引擎、`useLiveDrag`、dom 测试（wake 先于发布、收场里 `end` 的位置、`offer` 由会话交）。提交。
3. 工作台改用引擎：diff 以删为主。跑基线三份 e2e 对照。提交。
4. nb-story 换边改实时布局：e2e `side-by-side.e2e.ts` 改与补。提交。
5. Spec、README、CHANGELOG、API 报告。提交。

每片自跑：`packages/nb-layout` 的 `bun run typecheck`、`bun run test`、`bun run api:check`；动到应用的片加 `packages/neuro-book` 的 `bun run typecheck`；动到 nb-story 的片加它的 typecheck 与 e2e。

## 验收映射

- `ui/layout-drag` 新增各条 → 引擎单元测试（切片 1）与会话 dom 测试（切片 2）。
- `ui/workbench-layout` 输出 38 不变 → `workbench-live-drag.e2e.ts`、`workbench-dnd.e2e.ts`、`workbench-drag-cost.e2e.ts` 与改前的基线（2026-11-23 在本分支起点上跑）对照，条数与通过的一样；开销用例的每帧样式重算上限不变。
- `story/viewer` 输出 68 → `nb-story/e2e/side-by-side.e2e.ts`：停稳后预览是对调的样子、松手对调、原位与别处松手不动、Escape 取消、减少动效下是落点指示。

## 验证

上面三份工作台 e2e 与 nb-story 的 `side-by-side.e2e.ts` 整份跑；`editor-area.e2e.ts`、`files-explorer.e2e.ts` 也用拖动会话，跑一次确认没被会话的改动碰到（共 6 个文件）。未验证边界：真机手感（e2e 只看状态与几何）。

## 不做与风险

- 不进插件 SDK。不改落点指示那一路。不动整窗拖动（它不走实时布局）。
- 风险：编排的时序原样搬过去最容易丢一步（例如收起那一刻留下的落点要带被拒绝）。切片 3 先跑基线对照，再删旧代码。
- 发布顺序：nb-layout 0.1.0 还没发。t49 合入在发布之前时，0.1.0 会带上这些名字，变更记录要并进 0.1.0 而不是 `[Unreleased]`；合入前先看发布了没有，再定写在哪一节，并告诉开发者。
