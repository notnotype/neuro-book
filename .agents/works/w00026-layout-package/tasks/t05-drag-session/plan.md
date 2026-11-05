# t05 计划：手势会话与落点登记

## Context

三份手势（`workbench/web/views/drag-session.ts` 451 行、`editor/web/tab-drag.ts` 349 行、`explorer/web/tree-drag.ts` 310 行）用同样的门槛和收场，但已开始走样，见下表。[布局提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 3、10 节定了：手势会话只有一份，纯逻辑进 `@notnotype/nb-layout`，DOM 适配进 `./vue`，落点改登记。

这一片只换手势，落点规则和外观不变；t06、t07、t08 在它上面接渲染层、一棵树和实时布局。合同是新的 [`ui/layout-drag.md`](../../../../../docs/specs/ui/layout-drag.md)。

代码在 `.worktree/w00026-t05-drag-session`，分支 `feat/w00026-t05-drag-session`。Spec 与记录在主工作区 master 上改。

## 技术选型

无新依赖。手势不经拖动库，t67 已定（[计划](../../../w00017-application-runtime-architecture/tasks/t67-workbench-shell-dnd/plan.md)），提案“备选与取舍”也选了自写。

## 现有行为逐项对照

| 行为 | 工作台 | 编辑器标签 | 资源树 | 统一后 |
|---|---|---|---|---|
| 门槛（6 px、200 毫秒、6 px） | 有 | 有 | 有 | 不变，默认值进 `DRAG_GESTURE_DEFAULTS` |
| 按下的接收阶段 | 捕获 | 冒泡 | 冒泡 | **冒泡** |
| 指针捕获持有者 | 来源元素 | 根 | 根 | **根** |
| 失去捕获取消 | 无 | 有 | 有 | **有** |
| Escape、`pointercancel`、失焦、页面隐藏 | 有 | 有 | 有 | 不变 |
| 焦点移出根取消 | 有 | 无 | 无 | **有** |
| 拖动中方向键等归会话 | 有 | 只拦 Escape | 只拦 Escape | **有** |
| 触摸拖动阻止 `touchmove` 默认动作 | 无 | 有 | 有 | **有** |
| 清选区、吞 click | 有 | 有 | 有 | 不变 |
| 放下：与最后显示的相同才提交 | 会话 | 会话 | 控制器 | 会话（控制器等令牌后的复核留着） |
| 结构键 | 布局代次 | `structure()` | 无，控制器 `abort` | 不变，`structure` 是选项 |
| 滚动 | 重判 | 重判 | 撤下 | 不变，`scroll` 选项，树的合同（验收 15）要求撤下 |
| 窗口尺寸变化 | 重判 | 重判 | 无 | 树跟着撤下；其余不变 |
| 边缘滚动 | 无 | 无 | 有 | 不变，`autoScroll` 选项 |
| 键盘拖动 | 有 | 无 | 无 | 不变，只有工作台配 `keyboard` |
| 窗口监听 | 常驻 | 常驻 | 常驻 | **按下才装，结束就拆** |
| 光标与禁选标记 | `:root[data-workbench-dragging]` | `[data-editor-tab-dragging]` | `[data-explorer-dragging]` | 名字和样式不变，经 `onActiveChange` 由宿主写 |
| 拖影与落点反馈 | 各画一套 | 各画一套 | 各画一套 | 不动（见“不做”） |

粗体是这一片改变的行为。外壳按下改冒泡的依据：`useSashGesture` 的注释写明靠 `stopPropagation` 让传感器收不到命中带里的按下；外壳这边的捕获阶段查不到记录的理由。外壳的拖动源里也没有停止传播的按下处理。

## 关键设计

### `packages/nb-layout/src/drag-gesture.ts`（新，纯 TS）

状态机 `createDragGesture<S, D, A, R>(host)`，事件与时钟注入，不碰 DOM。放这里的是所有判断：门槛、帧合并、放下比较、取消、结构键、吞 click 的标记、撤下、边缘滚动的步进与循环、键盘的区域与位置。

```ts
export interface DragClock {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    requestFrame(run: () => void): unknown;
    cancelFrame(handle: unknown): void;
}

export interface DragGesture<S, R> {
    press(input: DragPress<S>): void;
    move(pointerId: number, point: GridDropPoint): void;
    release(pointerId: number, point: GridDropPoint): void;
    pointerCancel(pointerId: number): void;
    cancel(reason: DragCancelReason): void;
    /** 滚动或窗口尺寸变化；自己滚的不算。 */
    geometryChanged(): void;
    invalidate(): void;
    abort(): void;
    startKeyboard(source: S): boolean;
    /** 返回这个键是否归会话（适配层据此拦下）。 */
    key(input: {readonly key: string; readonly shift: boolean; readonly repeat: boolean}): boolean;
    /** 这次 click 要不要吞。 */
    takeClick(detail: number): boolean;
}
```

`host` 里除了 Spec 列的回调，多四个给适配层的：`clock`、`top(point)`（读遮挡）、`grabbed(mode)`（门槛过后装监听、取捕获）、`released(mode)`（拆监听、放捕获、还焦点）；边缘滚动是 `step(point)` 与 `scrollBy(step)`。收场顺序写死在这里（Spec 的“时序与寿命”）。

复用：`GridDropPoint`（`grid-drop.ts`）。不改 `useSashGesture`，分隔线手势的状态与这份不同。

### `packages/nb-layout/src/vue/drag-session.ts`（新，DOM 适配）

`createDragSession(options)`：把 `options` 接到状态机，`state` 是 `shallowRef`。这一层只做：

- 根上常驻 `pointerdown`（冒泡）、`click` 与 `keydown`（捕获，键盘拿起要先于标签带自己的键处理）；
- 按下之后才装窗口的 `pointermove`、`pointerup`、`pointercancel`（捕获），拿起之后再装按键、`blur`、`visibilitychange`、`focusin`、滚动、`resize`、根上的 `lostpointercapture`、`touchmove`；都由收场拆掉；
- `topElementAt(document, point)`：`elementsFromPoint` 跳过 `data-drag-feedback`，视口外为 `null`；
- 用 `root.ownerDocument` 取文档，时钟绑到它的 `defaultView`；
- 键盘拖动的焦点：记下拿起时的元素，放下或取消后按 Spec 还。

### `packages/nb-layout/src/vue/drop-targets.ts`（新）

`WeakMap<Element, 登记>` 存登记，`dropTargetAt` 沿 `parentElement` 往上走。不需要 provide、不需要工作台在场，Lab 里单独挂编辑器区也能用。`DropKind<T>` 带类型参数，免得查询方做类型断言。

### `packages/neuro-book/src/plugins/explorer/web/`

- `tree-drag.ts` 留 `pointAt`，改名 `resolveTreeTarget(root, top, point)`，手势全部删掉。编辑组那一支改成 `dropTargetAt(top, EDITOR_GROUP_FILE)`，不再读 `data-editor-group`。
- `ExplorerTree.vue` 用 `createDragSession`：`scroll: "withdraw"`、`autoScroll: {element: root}`。`resolve` 返回 `{over, action}`，`action` 由新的 prop `previewDrop(over)` 给（控制器的 `dropAction`），`hover` 的副作用（`hoverDrag`、停留展开计时）移到 `watch(session.state)`。`commit` 发 `drag-drop`；`onEnd` 的 `no-action` 与 `cancelled` 飞回并发 `drag-cancel`。
- 控制器 `dropDrag` 不变：它在等令牌后还要复核一次。

### `packages/neuro-book/src/plugins/editor/`

- `shared/contracts.ts` 加 `EDITOR_GROUP_FILE`（`DropKind<{group: string}>`，给资源管理器）；`web/tab-drag.ts` 加内部的 `EDITOR_GROUP_TAB`。
- `EditorGroup.vue` 用 `useDropTarget` 登记这两种。`data-editor-group` 留作样式与测试钩子。
- `tab-drag.ts` 留 `resolveTabDrop` 与 `stripDrop`、`contentDrop`，入参改成 `top`，组由 `dropTargetAt` 给；`createTabDrag` 变成 `createDragSession` 的一层绑定。`EditorArea.vue` 的 `show`、`follow` 换成读 `state`。

### `packages/neuro-book/src/plugins/workbench/web/views/`

- `drag-session.ts` 留 `freezeSource`、`evaluate`、键盘的区域与起点，变成绑定，对外的 `createDragSession` 改名 `createShellDrag`，`state` 形状不变（`WorkbenchShell.vue`、`ShellViewsScene.vue` 只改一处调用）。
- `activate` 把 `newContainerId`、`zones` 冻结进来源；键盘区域 `R` 就是现有的 `KeyboardRegion`。
- `drop-dom.ts` 的 `dropHitAt`、`revealAt` 入参改成 `top`，重复的 `elementsFromPoint` 循环删掉。外壳自己的落点标记不登记：它们随 t07 退役。

### 要守住的

- `.` 不依赖 Vue、`window`、`document`，`boundary.test.ts` 兜底。
- `resolve` 只读：放下那次判定不能改掉“最后显示过的动作”，树原来在 `hover` 里写状态的部分要挪走。
- 键盘拖动拿起时的那次空格 keyup 也要拦，否则按钮在抬起时激活，标签被选中。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/layout-drag.md` | 新建 |
| `docs/specs/README.md` | 待实现规范加一行 |
| `docs/specs/ui/workbench-shell.md` | 输出 23 后补“取消与按键按 ui.layout-drag”（planned）；实现合同“拖放只有一个会话”随实现改 |
| `docs/specs/workbench/editor.md` | 输出 35 的公开标记改成登记（planned）；输出 55 的取消链接 ui.layout-drag（planned） |
| `docs/specs/workbench/files-explorer.md` | “拖动”的取消、“拖到编辑区”的落点改成登记（planned） |
| `docs/specs/ui/nested-grid.md`、`ui/workbench-shell.md`、`workbench/editor.md` | t04 遗留的“nb-ui 的 grid”“nb-ui 的边缘落点”改成 nb-layout |
| `packages/neuro-book/src/plugins/workbench/web/components/WorkbenchDragFeedback.md` | 指针捕获的说明跟着改 |

## 切片

每片一个提交，每片自跑对应验证。

1. **nb-layout**：`drag-gesture.ts`、`vue/drag-session.ts`、`vue/drop-targets.ts` 与测试，入口导出。`bun run --cwd packages/nb-layout test`、`typecheck`。
2. **资源树**：登记 `EDITOR_GROUP_FILE`，`tree-drag.ts`、`ExplorerTree.vue` 换上。`files-explorer.e2e.ts`、`lab-explorer.e2e.ts`。
3. **编辑器标签**：`tab-drag.ts`、`EditorArea.vue` 换上。`editor-area.e2e.ts`、`lab-editor.e2e.ts`。
4. **工作台**：`drag-session.ts`、`drop-dom.ts` 换上。`workbench-dnd.e2e.ts`、`workbench-views.e2e.ts`、`lab-scenes.e2e.ts`。
5. **收口**：补验收的 e2e，Spec 去 planned、写证据（实现合同），`bun run test:affected`、`typecheck`、`docs:check`。实现审查派前端（`reviewer`、Sonnet）。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| `ui.layout-drag` 输出 1、3、4、6、8、9、12、13、14、15 | `drag-gesture.test.ts`（手动时钟，不等真实时间） |
| 输出 2、5、7、10、11 | `drag-session.dom.test.ts` 查监听与拦截，真实浏览器由下面的验收覆盖 |
| 输出 16 | `drop-targets.dom.test.ts` |
| 输出 17 | 三个宿主都只读 `state`，由切片 2 到 4 证明 |
| 验收 1 | `workbench-dnd.e2e.ts`、`editor-area.e2e.ts`、`files-explorer.e2e.ts` 各加一条 |
| 验收 2 | `files-explorer.e2e.ts` 的“拖到编辑组”加一条：去掉标记后再拖 |
| 验收 3 | `workbench-dnd.e2e.ts` 加一条 |
| 验收 4 | 验收 1 那三条里顺带断言 |
| `workbench.files-explorer` 验收 15、25、26、28，`ui.workbench-shell` 外壳三验收，`workbench.editor` 输出 55 | 现有 e2e 不改断言，继续通过 |

## 验证

- 现有 e2e 不改断言是这一片最强的证据：`workbench-dnd.e2e.ts` 27 条，加上编辑器与资源树的拖动用例。
- 直接跑 Playwright 前先 `build:server`、`build:web`、`build:e2e`，Lab 用例用 `startDevSession`。跑之前停掉多余的开发服务。
- 开发者在真实产品上试手感，是 t06 之后的确认点。这一片结束时我用开发服务亲手走一遍三种拖动并截图。

未验证的边界：触摸只由 Playwright 的触摸模拟与纯逻辑测试覆盖，没有真机；窗口外松手只测 Chromium。

## 不做与风险

**不做：**

- **外壳的落点不登记**：Switcher、容器内容这些标记随 t07 退役，现在改等于写一遍就扔。外壳只经会话的遮挡层。
- **打开文件的提交不搬到编辑器**：提案写的是编辑器登记“接受与提交”。这一片只换接受，提交仍由资源管理器执行 `nbook.editor.open`，因为打开失败的提示在资源管理器里，Spec 不变。t10 改语义（拖到编辑区增加四边拆分）时一起搬。
- **拖影不合并**：三套拖影的外观 Spec 写得不一样（资源树两行、偏移 12 和 4）。t08 统一设计，这里动了要先改 Spec。
- **标签和资源树不加键盘拖动**：Spec 没要求，标签的键盘拖动随 t07。
- `data-no-drop` 不加：t07 才有用它的人。

**风险：**

- **外壳的捕获从来源换到根**：拖动中 `:active` 与光标的表现可能变。`WorkbenchDragFeedback.vue` 的那段样式留着；真实浏览器看一遍。
- **外壳按下改冒泡**：如果某个拖动源里有内层停止传播，那里就起不了拖。现有 27 条 e2e 覆盖了四种来源。
- **资源树的 `resolve` 要拿到控制器的 `dropAction`**：控制器多一个只读方法。`hoverDrag` 仍写状态，顺序变成 `state` 变化之后，停留展开的计时要核对（验收 25）。
