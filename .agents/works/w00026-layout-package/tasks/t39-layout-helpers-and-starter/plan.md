# t39 宿主接线：useGridHost 与 useDragSession：实施计划（第 2 稿）

第 2 稿按第一轮设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，12 条，阻断 0、重要 6、建议 6）改，逐条处理见 Task README。最大的改动：`useGridHost` 是唯一的宿主组合式函数，`useGridLayout` 降为内部（第 4 条）；`useDragSession` 改成收根的建造函数并返回状态（第 2、8 条）；`NestedGrid` 卸载前显式发 `null`（第 1 条）。

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档第 5 项“库里补的小东西”的前两条；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 原 t39 拆成 t39 到 t42（[待确认清单](../../pending-confirmations.md)），本 Task 只做 `useGridHost` 与 `useDragSession`。
- 要解决的问题（盘点 [`evidences/inventory.txt`](evidences/inventory.txt)）：
  - 用 `NestedGrid` 的五个宿主（工作台 `WorkbenchSurface`、Lab 的 `NestedGridAcceptanceFixture`、`GridSwapScene`、`GridPanelsScene`、`GridStructureScene`）各写一遍同一段接线：容器 ref、`useLayoutExtent`、`useGridLayout`，再把 `:node`、`:layout`、`:revision`、`:on-gesture-commit` 一字不差地绑上去；`contextKey` 同一个值写两到三遍，忘了传就落到 `stale-context`。
  - 同一个盒量两遍：宿主量外层容器，`NestedGrid` 又量自己的根（`NestedGrid.vue:131`）；而手势与摆放用的本来就是 `NestedGrid` 自己的盒，宿主量的盒不同大时每次提交都会落 `stale-size`。
  - `createDragSession` 的三处调用方（`ExplorerTree.vue`、Lab 的 `DragSessionScene.vue`、`useSortable.ts`）各写挂载时建、卸载时销毁与 `computed(() => session.value?.state.value ?? null)`；只有 `useSortable` 处理换根。
- 和提案的出入：提案写“`@extent` 回灌”，但 `NestedGrid` 今天没有 `extent` 事件；`useGridLayout` 已经返回 `node`、`layout`、`revision`、`invalidate`、`onGestureCommit`。所以 `useGridHost` 在 `useGridLayout` 之上补“尺寸从 `NestedGrid` 来”与“一包绑上去”。提案点名的两样都交付。提案要 Spec 写明 `useGridHost` 与 `useGridLayout` 的关系：定为 `useGridHost` 取代，`useGridLayout` 降为内部（下文）。

## 技术选型

无通用问题：Vue 的 `v-bind` 对象展开、`watch` 与 `onScopeDispose` 是框架自带的。

## 关键设计

### `NestedGrid` 发出量到的尺寸：`packages/nb-layout/src/vue/NestedGrid.vue`

- 新事件 `extent`：载荷 `GridExtent | null`，就是它已经在量的根盒（`useLayoutExtent(rootEl)`，布局盒、不含边框与内边距）。挂载后第一次量到就发，之后两轴有变化才发。
- 卸载前显式 `emit("extent", null)`（`onBeforeUnmount`）。审查实测：卸载时 watcher 先停、模板 ref 后置空，`useLayoutExtent` 里“ref 变 null 就发 null”那一支来不及跑，`v-if` 摘掉与整体卸载都收不到 null（第 1 条）。
- 同步发（`watch(measuredExtent, …, {flush: "sync"})`）：工作台的 store 用尺寸算投影，晚一拍就会用旧树算新尺寸的布局。
- `NestedGrid` 的根是宽高 100%：承载盒要有确定的高度，否则量到 0 高、什么都不画、也没有诊断（今天就是这样，写进 Spec 与 `NestedGrid.md`）。尺寸只来自 `NestedGrid`，宿主不能把 `NestedGrid` 挂在“有了尺寸才渲染”的 `v-if` 后面，那样永远等不到尺寸（第 10 条）。

### `useGridHost`：`packages/nb-layout/src/vue/useGridHost.ts`（新增）

```ts
export type GridHostBindings<T> = {
    readonly node: GridNode<T> | null;
    readonly layout: GridLayoutResult;
    readonly revision: number;
    readonly contextKey: string;
    readonly disabled: boolean;
    readonly onGestureCommit: (commit: GridGestureCommit) => GridLayoutCommitResult;
    readonly onExtent: (extent: GridExtent | null) => void;
};

export type GridHost<T> = {
    /** 当前树；结构变更后调用 `invalidate()` 重新读取。 */
    readonly node: ComputedRef<GridNode<T> | null>;
    /** 当前发布的布局；没量到可用尺寸时是空布局。 */
    readonly layout: Readonly<Ref<GridLayoutResult>>;
    readonly revision: Readonly<Ref<number>>;
    /** `NestedGrid` 量到的承载盒；挂载前与卸载后是 null。 */
    readonly extent: Readonly<Ref<GridExtent | null>>;
    /** 宿主改了树的结构后调用。 */
    invalidate(): void;
    /** 整包绑到 `NestedGrid` 上：`<NestedGrid v-bind="host.bindings.value" …>`。`disabled`、`contextKey` 只经选项给，模板里不要再写。 */
    readonly bindings: ComputedRef<GridHostBindings<T>>;
};

export function useGridHost<T>(options: {
    grid: Readonly<Ref<Grid<T> | null>>;
    contextKey: () => string;
    /** 宿主自己的停用条件；没量到可用尺寸时总是停用。 */
    disabled?: () => boolean;
    /** 提交已经落账之后的通知；它抛错只报诊断，不反悔已提交的几何。 */
    onApplied?: (commit: GridGestureCommit, result: Extract<GridBranchesResizeResult, {ok: true}>) => void;
    /** 布局重算的诊断与 `notify-failed`（Spec `ui/nested-grid` 输出 139、140）。 */
    onIssues?: (issues: readonly GridIssue<GridIssueCode | "notify-failed">[]) => void;
}): GridHost<T>;
```

- 实现：持一个 `shallowRef<GridExtent | null>` 当尺寸，`onExtent` 写它；内部调 `useGridLayout`（降为内部模块，相对路径导入），提交校验、只发新增、落账后通知的规则一处不变。
- “可用尺寸”的判据只有一个：`useGridLayout` 已有的“非 null、两轴有限且大于 0”抽成一个函数，`useGridLayout` 发布空布局与 `bindings.disabled` 都用它。审查指出只判 null 时，承载盒 `display: none` 量到 `{0, 0}`，布局是空的手势却没停用（第 5 条）。
- `bindings` 与模板里同名属性的合并：Vue 编成 `mergeProps`，后写的赢，覆盖是静默的（审查实测）。Spec 与组件文档写明 `disabled`、`contextKey` 只经 `useGridHost` 的选项给，模板里不再写；t41（拖不动时报错）可以在开发模式下查出两处不一致。
- 不再有两层：`useGridLayout` 从 `./vue` 入口拿掉（连同 `GridLayoutHost` 类型），`useGridHost` 是唯一的宿主组合式函数。迁移后仓库里不会再有直接用 `useGridLayout` 的宿主，留两层只会让使用者分不清该用哪个（第 4 条）；尺寸来自 `NestedGrid` 之外的宿主今天没有，要时再加一个可选的尺寸来源。`useLayoutExtent` 照旧公开（Explorer 拿它量自己的树，与网格无关）。

### 迁移五个宿主

- Lab 的四个夹具改用 `useGridHost` 与 `v-bind="host.bindings.value"`，删掉各自的容器尺寸测量与重复写的 `contextKey`。保留各自容器 div 与 e2e 依赖的标记（`#nb-lab-target`、`data-structure-host`、`data-panels-host`）。
- 工作台 `WorkbenchSurface.vue`：改用 `useGridHost`，不再自己量 `rootEl`；把尺寸交给 store 的那一处改成 `watch(host.extent, (next) => emit("extent", next), {immediate: true, flush: "sync"})`，`immediate` 照旧（挂载前先发 null，重挂载时重置 store；第 6 条）。同步链：`NestedGrid` 的同步 watch → `onExtent` 写尺寸 → 这个同步 watch → `WorkbenchShell` 的 `onExtent` → `store.acceptExtent`，每一跳都同步，审查实测首次挂载与今天落在同一个刷新链里。
- 被量的盒：审查核过五个宿主的容器都没有边框与内边距，`NestedGrid` 的根与它同大；即使不同大，也以 `NestedGrid` 的盒为准（它本来就是手势与摆放用的盒）。

### `useDragSession`：`packages/nb-layout/src/vue/useDragSession.ts`（新增，从 `./vue` 导出）

```ts
export function useDragSession<S, D, R = never>(
    root: Readonly<Ref<HTMLElement | null>>,
    /** 每次在一个根上建会话时调用一次，交回这个会话的选项；会话建好后选项不再读。 */
    createOptions: (root: HTMLElement) => Omit<DragSessionOptions<S, D, R>, "root">,
): {
    readonly session: Readonly<ShallowRef<DragSession<S, D> | null>>;
    readonly state: ComputedRef<DragState<S, D> | null>;
};
```

- 根出现时建会话，根换了先销毁旧的再建新的，根没了或作用域结束时销毁。换根时进行中的拖动照会话自己的规则收尾（审查实测：先 `onActiveChange(false)`，再以 `cancelled: disposed` 结束）。
- 选项按“建会话时读一次”：函数收到根（`useSortable` 的 `sourceAt`、`measure`、`itemOf`、键盘回调一共 8 处要用根），名字写明是建造（`createOptions`），注释写清它不被追踪；要随状态变的东西写成回调里现读的 ref（第 2 条）。建会话那一刻同一个组件里别的模板 ref 已经就位（它们和根在同一次挂载里设上），读得到。
- 时序：会话在组件挂载后的那次刷新里才建，`onMounted` 里还是 null（审查实测；第 3 条）。用它的地方不能在 `onMounted` 里直接读会话。
- 迁移：
  - `ExplorerTree.vue`：会话改用 `useDragSession`；它今天在 `onMounted` 里 `watch(gesture.value.state, …, {flush: "sync"})`，改成 `watch(() => drag.state.value, …, {flush: "sync"})`，并核对注释里“边缘滚动中松手，发布与放下在同一调用栈”的先后。
  - Lab `DragSessionScene.vue`：同上。
  - `useSortable.ts`：会话改用 `useDragSession`；它自己的 `pointerdown` 捕获监听与 `finishLanding` 的收尾照旧跟着根，留一个 `watch(root)` 管它们（捕获与会话的冒泡监听按阶段先后，与注册顺序无关；第 11 条）。
  - 工作台的 `createLayoutDrag` 在函数里建会话、外层再包一层，属于 t37 整理拖动控制器的范围，本 Task 不动。

### 插件 SDK

- 两个都不进 SDK：SDK 今天只导出 `NestedGrid` 组件，不导出 `createGrid`，插件建不出网格，宿主工具给了也用不上。给插件开放网格宿主（`createGrid`、`useGridHost` 一起）是另一件事，记进 Work 的后续清单（第 9 条）。

## Spec 与文档改动

master 上、实施前写（planned）：

- `docs/specs/ui/nested-grid.md`：
  - 输出 144 `extent` 事件：挂载后量到就同步发、两轴变了才发、卸载前发 null；
  - 输出 145 `useGridHost`：一包绑上去，`disabled` 在没量到可用尺寸时为真（判据同空布局），`disabled`、`contextKey` 只经选项给；
  - 输出 146 承载盒：`NestedGrid` 的根铺满承载盒，承载盒没有确定高度时量到 0、什么都不画；尺寸只来自 `NestedGrid`，宿主不能等尺寸再挂它；
  - 实现合同：公开入口里 `useGridLayout` 换成 `useGridHost`。
- `docs/specs/ui/layout-drag.md`：输出 18 `useDragSession` 的寿命（根出现建、换根重建、根没了与作用域结束销毁，挂载后那次刷新才有）；输出 19 选项在建会话时读一次、函数收到根。
- 包内（随代码）：`NestedGrid.md` 的事件表、“接入”例子改用 `useGridHost`、承载盒的前提；`useGridHost`、`useDragSession` 写模块头注释（短 `.md` 留给 t42）。

## 切片

1. **`NestedGrid` 的 `extent` 事件与 `useGridHost`**：组件、组合式函数、可用尺寸判据抽出、入口改（`useGridHost` 进、`useGridLayout` 出）、dom 测试；迁移 Lab 四个夹具。验证：nb-layout 测试与类型检查，应用类型检查，`exports.test.ts`，Lab 网格 e2e（`lab-nested-grid`、`lab-grid-structure`、`lab-grid-panels`、`lab-grid-swap`）。
2. **工作台改用 `useGridHost`**：`WorkbenchSurface.vue`。验证：应用类型检查与 `WorkbenchSurface` 相关的 dom 测试；e2e `workbench-dnd`、`workbench-containers`、`editor-area`、`workbench-views`。
3. **`useDragSession`** 与三处迁移。验证：nb-layout 测试，`ExplorerTree.dom.test.ts`，e2e `lab-sortable-list`、`lab-drag-session`、Explorer 拖动所在的文件（实施时按 `ExplorerTree` 的选择器搜）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| `ui/nested-grid` 输出 144 | `NestedGrid.dom.test.ts` 新用例：行内设根的宽高，量到就发、改尺寸再发、不变不发、`v-if` 摘掉与卸载都收到 null |
| 输出 145 | `useGridHost.dom.test.ts`：一包绑上去能提交（提交的校验与只发新增沿用 `useGridLayout.dom.test.ts` 的同类断言跑一组）；尺寸是 null、`{0, 0}` 时停用、有尺寸时启用 |
| 输出 146 | `NestedGrid.dom.test.ts`：承载盒高 0 时布局为空；Lab e2e 照常渲染 |
| 工作台同步链 | `WorkbenchSurface` 的 dom 测试：改根盒尺寸并触发量取，同一调用栈里 store（或 `extent` 事件的监听）已拿到新尺寸 |
| `ui/layout-drag` 输出 18、19 | `useDragSession.dom.test.ts`：建、换根重建（进行中的拖动以 `cancelled: disposed` 收尾）、根没了销毁、作用域结束销毁、`onMounted` 时为 null、换根前选项只读一次 |
| 只量一次 | 五个宿主与 `NestedGrid` 之外没有为网格调 `useLayoutExtent`；代码审查（这是实现上的性质，不写成测试） |

## 验证

- 每片：nb-layout、应用的类型检查与受影响的测试；e2e 只跑上面列的文件，开跑前看负载。
- 基线已跑（2026-11-19，worktree 开好后）：构建通过，探针、`lab-grid-structure`、`lab-sortable-list` 28 条通过（一条负载下冷启动超时，单独重跑通过）。

## 不做与风险

- 不做：工作台 `createLayoutDrag` 改用 `useDragSession`（t37）；短 `.md` 与 README 起步（t42）；收起展开入口、意图回写（t40）；拖不动时报错（t41）；插件 SDK 开放网格宿主（另记）。
- 风险：
  - `useGridLayout` 降为内部是公开面的收窄：仓库里迁移完没有别的使用者，SDK 不导出它，包不发布，所以不影响谁；变更记录不用写（不在 SDK 里）。
  - `ExplorerTree` 的拖动在会话晚一次刷新才建：挂载后立刻按下（同一个同步段里）拖不起来。真实操作里挂载与按下之间隔着至少一帧，不受影响；依赖“挂载后同步派发 pointerdown”的 dom 测试要补一次 `await nextTick()`。
