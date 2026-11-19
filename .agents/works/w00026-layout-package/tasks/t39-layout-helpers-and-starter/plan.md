# t39 宿主接线：useGridHost 与 useDragSession：实施计划（第 1 稿）

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档第 5 项“库里补的小东西”的前两条；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 原 t39 拆成 t39 到 t42（[待确认清单](../../pending-confirmations.md)），本 Task 只做 `useGridHost` 与 `useDragSession`。
- 要解决的问题（盘点 [`evidences/inventory.txt`](evidences/inventory.txt)）：
  - 用 `NestedGrid` 的五个宿主（工作台 `WorkbenchSurface`、Lab 的 `NestedGridAcceptanceFixture`、`GridSwapScene`、`GridPanelsScene`、`GridStructureScene`）各写一遍同一段接线：一个容器 ref、`useLayoutExtent`、`useGridLayout`，再把 `:node`、`:layout`、`:revision`、`:on-gesture-commit` 一字不差地绑上去；`contextKey` 同一个值写两到三遍，忘了传就落到 `stale-context`（`NestedGrid` 的缺省是空串）。
  - 同一个盒量两遍：宿主量外层容器，`NestedGrid` 又用 `useLayoutExtent` 量自己的根（`NestedGrid.vue:131`）。t26 审查 api-11 要求 `NestedGrid` 量一次交给宿主。
  - `createDragSession` 的三处调用方（`ExplorerTree.vue`、Lab 的 `DragSessionScene.vue`、`useSortable.ts`）各写挂载时建、卸载时销毁；只有 `useSortable` 处理换根。
- 和提案的出入：提案写“`@extent` 回灌”，但 `NestedGrid` 今天没有 `extent` 事件（工作台的 `extent` 是 `WorkbenchSurface` 自己发的）；`useGridLayout` 已经返回 `node`、`layout`、`revision`、`invalidate`、`onGestureCommit`。所以 `useGridHost` 不是从零做，而是在 `useGridLayout` 之上补“尺寸从 `NestedGrid` 来”和“一包绑上去”。提案点名的两样都交付，没有放弃的项。

## 技术选型

无通用问题：Vue 的 `v-bind` 对象展开、`watch` 与 `onScopeDispose` 是框架自带的。

## 关键设计

### `NestedGrid` 发出量到的尺寸：`packages/nb-layout/src/vue/NestedGrid.vue`

- 新事件 `extent`：载荷 `GridExtent | null`，就是它已经在量的根盒（`useLayoutExtent(rootEl)`，布局盒、不含边框与内边距，未挂载为 `null`）。挂载后第一次量到就发，之后两轴有变化才发，卸载时发 `null`。
- 同步发（`watch(measuredExtent, …, {flush: "sync"})`）：工作台的 store 用尺寸算投影，晚一拍就会用旧树算新尺寸的布局（`WorkbenchSurface.vue` 今天对自己量的尺寸就是同步发的）。
- 宿主仍可以不听这个事件、自己量（`useGridLayout` 加 `useLayoutExtent` 的写法照旧有效）。

### `useGridHost`：`packages/nb-layout/src/vue/useGridHost.ts`（新增，从 `./vue` 导出）

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

export type GridHost<T> = GridLayoutHost<T> & {
    /** `NestedGrid` 量到的承载盒；没挂载或没听到 `extent` 时是 null。 */
    readonly extent: Readonly<Ref<GridExtent | null>>;
    /** 整包绑到 `NestedGrid` 上：`<NestedGrid v-bind="host.bindings.value" …>`。 */
    readonly bindings: ComputedRef<GridHostBindings<T>>;
};

export function useGridHost<T>(options: {
    grid: Readonly<Ref<Grid<T> | null>>;
    contextKey: () => string;
    /** 宿主自己的停用条件；没量到尺寸时总是停用。 */
    disabled?: () => boolean;
    onApplied?: …;   // 同 useGridLayout
    onIssues?: …;    // 同 useGridLayout
}): GridHost<T>;
```

- 实现：持一个 `shallowRef<GridExtent | null>` 当尺寸，`onExtent` 写它；内部调 `useGridLayout({grid, extent, contextKey, onApplied, onIssues})`，所以提交的校验、只发新增、落账后通知的规则一处不变。
- `contextKey` 只写一次：`bindings` 里的 `contextKey` 与 `useGridLayout` 核对用的是同一个函数的值。
- `disabled` 是 `options.disabled?.() === true || extent === null`（今天工作台手写的 `disabled || extent === null`）。
- 和 `useGridLayout` 并存：`useGridHost` 是常用的那一层；尺寸要从别处来的宿主（例如要先把尺寸交给自己的 store 的工作台，见下）照旧可以直接用 `useGridLayout`。Spec 写明两者的关系与回灌顺序：`NestedGrid` 挂载、量到根盒、同步发 `extent` → 宿主据此算布局 → `NestedGrid` 拿到布局渲染；尺寸到之前布局是空的、手势停用（与今天宿主自己量时同一时刻，不多一帧）。

### 迁移五个宿主

- Lab 的四个夹具改用 `useGridHost` 与 `v-bind="host.bindings.value"`，删掉各自的容器 ref、`useLayoutExtent` 与重复写的 `contextKey`。
- 工作台 `WorkbenchSurface.vue`：改用 `useGridHost`；它今天还把尺寸同步交给 store（`emit("extent")`），改成同步转发 `host.extent`，不再自己量 `rootEl`。`rootEl` 只剩事件处理与读主题缝宽用。
- 验收就是盘点里列的重复接线消失：五个宿主里不再出现 `useLayoutExtent`、`:node`、`:layout`、`:revision`、`:on-gesture-commit` 这几行（工作台以外）。

### `useDragSession`：`packages/nb-layout/src/vue/useDragSession.ts`（新增，从 `./vue` 导出）

```ts
export function useDragSession<S, D, R = never>(
    root: Readonly<Ref<HTMLElement | null>>,
    options: () => Omit<DragSessionOptions<S, D, R>, "root">,
): Readonly<ShallowRef<DragSession<S, D, R> | null>>;
```

- 根出现时建会话，根换了先销毁旧的再建新的，根没了或作用域结束时销毁；返回的引用在没有根时是 `null`。
- `options` 写成函数：每次建会话时读一次（`createDragSession` 的选项本来就是建时一次性读的），宿主在里面引用自己的响应式状态时拿到的是建会话那一刻的值，这条写进注释与组件文档。
- 迁移：`ExplorerTree.vue`、Lab 的 `DragSessionScene.vue`、`useSortable.ts`（它自己的 `watch(root)` 换成 `useDragSession`，`pointerdown` 的挂卸照旧跟着根）。工作台的 `createLayoutDrag`（`layout-drag.ts`）在函数里建会话、外层再包一层，属于 t37 整理拖动控制器的范围，本 Task 不动。

## Spec 与文档改动

- `docs/specs/ui/nested-grid.md`（master，实施前，planned）：输出新增 `extent` 事件（何时发、同步、卸载发 `null`）；“输入与前置条件”或实现合同写 `useGridHost` 与 `useGridLayout` 的关系与回灌顺序。
- `docs/specs/ui/layout-drag.md`（planned）：`useDragSession` 的寿命（根出现建、换根重建、根没了与作用域结束销毁）与选项按建会话时读一次。
- 包内（随代码）：`NestedGrid.md` 的事件表与“接入”例子改用 `useGridHost`；`useGridHost`、`useDragSession` 写模块头注释（短 `.md` 留给 t42）。

## 切片

1. **`NestedGrid` 的 `extent` 事件与 `useGridHost`**：组件与组合式函数、dom 测试、入口登记；迁移 Lab 四个夹具。验证：nb-layout 测试与类型检查，应用类型检查，Lab 网格的 e2e（`lab-nested-grid`、`lab-grid-structure`、`lab-grid-panels`、`lab-grid-swap`）。
2. **工作台改用 `useGridHost`**：`WorkbenchSurface.vue`。验证：工作台的 e2e（`workbench-dnd`、`workbench-containers`、`editor-area`、`workbench-views`）里涉及布局与尺寸的文件。
3. **`useDragSession`** 与三处迁移。验证：nb-layout 测试，`lab-sortable-list`、`lab-drag-session`（若有）、Explorer 拖动的 e2e。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| `NestedGrid` 同步发出量到的尺寸，卸载发 null | `NestedGrid.dom.test.ts` 新用例（用行内设宽高的根、改尺寸、卸载） |
| `useGridHost` 一包绑上去就能拖：提交照旧校验、只发新增 | `useGridLayout.dom.test.ts` 的同类用例改用 `useGridHost` 再跑一组；Lab 网格 e2e |
| 只量一次 | 迁移后五个宿主里没有 `useLayoutExtent`（工作台以外）；代码审查 |
| 尺寸到之前停用、到了才开手势 | dom 测试 |
| `useDragSession` 的建、换根、销毁 | 新 `useDragSession.dom.test.ts` |

## 验证

- 每片：nb-layout、应用的类型检查与受影响的测试；e2e 只跑上面列的文件，开跑前看负载。
- 基线：worktree 开好后先构建并跑探针、`lab-grid-structure`、`lab-sortable-list`（也是 t36 的补验）。

## 不做与风险

- 不做：工作台 `createLayoutDrag` 改用 `useDragSession`（t37）；`useGridHost` 的短 `.md` 与 README 起步（t42）；收起展开入口、意图回写（t40）；拖不动时报错（t41）。
- 风险：`NestedGrid` 的根与宿主今天量的外层容器不一定同大（外层有边框、内边距或别的子元素时）。迁移前逐个核对五个宿主的容器与 `NestedGrid` 根的关系；不同大的那个宿主保留自己量，并在计划里记下。
