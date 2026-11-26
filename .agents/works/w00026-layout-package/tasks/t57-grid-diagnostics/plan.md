# t57 实施计划：网格诊断有出口（工作台接 issues、摩擦第 4 组）

## Context

- **要解决的问题**：
  - 产品里网格的诊断与被拒的提交全部静默丢掉。`WorkbenchSurface` 经 `useGridHost` 的 `onIssues` 发 `issues` 事件，可唯一的产品使用方 `WorkbenchShell` 不接（t55 调研 app 的顺便发现 1）。开发者 2026-11-23 定：接到应用的诊断出口。
  - [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 10 与验收 6 本来就要求“每种降级给诊断”。现在只有外壳根上的 `data-layout-diagnostics` 写了“收走、压编辑组”两种，网格自己算出的 `over-constrained` 没有任何出口。
- **摩擦第 4 组**（[t50 摩擦记录](../t50-example-app/friction.md) 条目 26、29、30、34、36、37、54、57）：拖动会话与网格之间的约定没有诊断。开发者同意的候选有三个：开发时检查（漏调、漏标记时报一次）；`onIssues` 缺省打到控制台；说明补“时序与先后”。
- **工作方式**（开发者 2026-11-25 定）：编码派 coder 子代理，主会话审 diff、自己跑验证并合入，不做逐 Task 的审查；t56 到 t59 做完后整段交 omp 一次。t57 排在 t56（只补说明）之后、t58 之前，串行做。在 t56 合入之后的 master 上开 worktree：t56 也改 `drag-session.md`、`useGridHost.md`、`NestedGrid.md`、README 的文字，两边条目不重叠。
- **依据**：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 139、140、145、151；[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 5、6、9、23 与“时序与寿命”；[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md)（浏览器出口写 console，另有本实例的有界内存记录）。
- **规划时的探针**（2026-11-25，探针在仓库之外，没有改仓库）：
  1. 用真实的工作台布局 store 与投影（`BUSY_LAYOUT_CATALOG`、缝宽 6）扫了 212 个窗口尺寸，从 1920×860 缩到 200 再放回来。经“只发新增”的闸门后一共发出 15 条，全是 `over-constrained`：
     - 宽 1000 及以下、高 860 时出现 `fixed-overflow`（分支 `body`，宽度轴），持续时不重发；
     - 高 340 时出现 `fixed-overflow`（分支 `center`，高度轴）；
     - 宽 200 时一次出 6 条 `cross-min`、`min-total`、`leaf-min`。

     结论有两条。一是窗口缩放不会逐帧刷屏；二是普通的半屏窗口（宽 960）就有一条持续的 `over-constrained`，它是输出 10 设计好的降级，不是故障。所以这一类不能记成 warn，否则开发者工具里常驻一条黄色警告。另外，commands、settings、plugins 几个打开 `/workbench` 的 e2e 收集 `warning` 并断言为空，记成 warn 还会让它们挂掉。
  2. 本机 Chrome 的 `document.elementsFromPoint` 不返回 `pointer-events: none` 的元素，也不返回它的子元素。所以第 34 条（漏标 `data-drag-feedback`）只在反馈元素能接指针时才有后果。库自带的反馈组件（`DropFeedbackOverlay`、`DropIndicator`、`DropSectorsOverlay`）与工作台的拖影都已经是 `pointer-events: none`。
  3. 从代码确认：`NestedGrid` 的布局过渡在 `layers` 的 pre 侦听里开始（`NestedGrid.vue` 第 323 行起），`settleMotion()` 同步把 `moving` 置假（`useGridMotion.ts` 的 `stop`）。所以用 sync 侦听 `dragging` 属性，读到的是这次更新开始之前的过渡状态（推断，第 1 片的 dom 用例会锁住它）。
  4. 漏接 `onIssues` 的现状：Lab 的 `StarterScene`、`GridPanelsScene`、`LivePanelsScene`、`GridStructureScene`、`GridLeavingScene` 五个场景与示例 `desktop`、`tabbed-panels` 都没接。`lab-scenes.e2e` 对着开发服务跑，开发检查是开着的，它在 `vp=phone` 下逐个场景收集 warning 与 error，并断言为空（`expect(problems).toEqual([])`）。
  5. `createLiveDragSession` 只在“实时布局真的开始”时调 `settleMotion`，键盘拿起、`live` 返回 null（落点指示、拖容器入口、拖整窗）都不调。工作台把这一点写成了已知限制（`WorkbenchSurface.md` 的“注意事项”最后一段）。没有找到记录下来的理由。

## 技术选型

无。诊断出口用应用现有的 `diagnosticsKey` 服务（[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md)），开发检查沿用 `nb-layout/src/dev-checks.ts` 的 `layoutDevWarning`，不新造通道。

## 关键设计

### 摩擦第 4 组逐条怎么处理

| # | 处理 | 落在哪 |
|---|---|---|
| 29 漏调 `settleMotion` | 开发检查，加上库的实时布局会话自己补齐 | `NestedGrid.vue`、`live-drag-session.ts`、说明 |
| 57 不接 `onIssues` 完全无声 | 开发检查（只报“没有出口”，不打印诊断本身），起步例子补上 `onIssues` | `useGridHost.ts`、README 起步、Lab 场景 |
| 34 漏标 `data-drag-feedback` | 只改说明，不加检查（见待确认 3） | `drag-session.md`、Spec layout-drag 输出 5 |
| 36 `commit` 在 `onEnd` 之后、`actionKey` 为 null 的后果 | 只改说明 | `drag-session.md` 的“时序与先后” |
| 37 起拖门槛的缺省值 | 只改说明 | 同上 |
| 54 click 落到根上、两层保护 | 只改说明 | 同上 |
| 26 根不接焦点，快捷键挂在根上收不到 | 只改说明 | `NestedGrid.md` |
| 30 哪些操作不用 `invalidate()` | 只改说明 | `useGridHost.md` |

### packages/nb-layout/src/vue/useGridHost.ts：诊断没有出口

- 在 `useGridHost` 里、建 `devOwner` 之后同步判一次：`options.onIssues === undefined` 时调 `layoutDevWarning(devOwner, "no-issues-outlet", message)`。开关关着时 `layoutDevWarning` 自己不报。
- 文案（英文，和现有警告同一种写法）：``[nb-layout/useGridHost] ${grid} has no onIssues, so layout diagnostics and rejected resizes are dropped silently. Pass onIssues; to ignore them on purpose, pass a function that does nothing.``。`grid` 的写法照 `onGestureStart` 里那段：没给 `contextKey` 时写 `the grid without a contextKey`，给了写 `grid "<key>"`。
- 只判建立时那一次：`onIssues` 是选项里的普通函数，不是 ref，建好之后不会变。
- 改模块头的最后一条，以及 `dev-checks.ts` 模块头的“只 `console.warn`，不走 `onIssues`”。新的意思是：库不把诊断本身打到控制台，诊断照旧只走 `onIssues`；“没给 `onIssues`”本身算接线错误，在开发检查里报一次。理由写进注释：
  - 缺省打印会绕过宿主自己的诊断出口；
  - 库判断不了宿主接没接别的出口；
  - 生产构建的宿主不该收到库的控制台输出。
- 只放在 `useGridHost`。`bindings` 总带着 `onIssues`，`NestedGrid` 那一侧看不出宿主接没接。直接用 `NestedGrid`、不经 `useGridHost` 的宿主不在检查范围内，说明里写明。

### packages/nb-layout/src/vue/NestedGrid.vue：起拖时过渡还在走

- 在 `warnDev` 之后加一个侦听：`watch(() => props.dragging, (now, before) => { … }, {flush: "sync"})`。
  - 条件：`now && !before && layoutDevChecksEnabled() && motion.moving.value` 同时成立时调 `warnDev("drag-during-motion", …)`。
  - 文案：``got dragging=true while a layout transition was still running, so the drag measured mid-transition rects. Call settleMotion() when the drag activates (createLiveDragSession does this itself).``。
- 必须是 `flush: "sync"`：
  - 属性一赋值就跑，早于同一次更新里 `layers` 的 pre 侦听开始的新过渡。宿主在起拖的同一次更新里改了布局、因此开始的过渡，不算漏调。
  - 写成 pre 时，排在第 323 行那个侦听之后，会误报。第 1 片的用例 4 守着这一点。
- 已知覆盖面：只有把 `dragging` 交给 `NestedGrid` 的宿主才查得到，说明里写明。三个示例与工作台都交了。

### packages/nb-layout/src/vue/live-drag-session.ts：任何起拖都把过渡送到终点

先后改成下面这样（行为变化，见待确认 2）：

1. 宿主的 `activate` 先调；返回假就结束。
2. 返回真时：网格在、`motionMs() > 0`，就调 `box.settleMotion()`。键盘拖动也调，`live` 返回 null 的也调。
3. 键盘拖动到此返回真。
4. 不是键盘拖动时再问 `live(source)`；给出来源才 `begin`。

- 宿主的 `activate` 仍先于 `settleMotion`，现有的“宿主在 `activate` 里量到的矩形可能是过渡中间的”照旧成立。`live-drag-session.dom.test.ts` 第 139 行守着的先后不变。
- 减少动效（`motionMs()` 为 0）与没有网格时不调，第 167 行的用例不变。
- 改模块头第一条与 `live-drag-session.md` 第 50 行的说法。

### packages/nb-layout 的说明（随包发布，不引 Spec 编号）

- **`drag-session.md`**：加一节“时序与先后”，内容：
  - 起拖门槛的缺省值（鼠标与笔 6px；触摸按住 200ms、移动不超过 6px；`DRAG_GESTURE_DEFAULTS`，经 `config` 改）；e2e 要先移过门槛（37）。
  - 起拖时网格若还在过渡，宿主在 `activate` 里调 `settleMotion()`；`createLiveDragSession` 自己调；开发检查只在把 `dragging` 交给网格时查得到（29）。
  - 收场顺序：拆监听、释放捕获、`state` 置空、`onActiveChange(false)`、`onEnd`、`commit`、键盘拖动还焦点。`commit` 在 `onEnd` 之后（36）。
  - `actionKey` 为 null 时放下结束为 `no-action`，不调 `commit`。宿主在拖动中做的跟手副作用（例如用 `placeFloat` 挪窗）要在 `onActiveChange(false)` 或 `onEnd` 里自己撤，否则窗停在拖到的地方；要在这种落点上照样提交，就交回非 null 的键，或用 `commitsUnderPointer`（36）。
  - click：指针拖动时根持有指针捕获，松手后浏览器把这次 click 发给根，不发给按下时的按钮；会话另外在根的捕获阶段吞掉这次手势末尾的 click（`detail` 不为 0，键盘触发的不吞）。两层各自都能让按钮收不到 click，所以测试只能断言“按钮的动作没发生”；只去掉其中一层，按钮照样收不到，这是预期（54）。
  - 反馈元素：设了 `pointer-events: none` 的元素本来就不在浏览器的命中里，挡不住落点；`data-drag-feedback` 给要接指针、或设不了 `pointer-events: none` 的反馈（34）。
- **`useGridHost.md`**：
  - 选项表里 `onIssues` 的注释从“可省”改成“不给时开发检查警告一次”；“诊断一个出口”一节补一句：没给 `onIssues` 时库不打印诊断本身，只在开发检查打开时警告一次“没有出口”。
  - 加一小节“什么时候调 `invalidate()`”：原地改了树（结构操作、`grid.setSize`、`restore`、改节点约束）之后调；内容项、活动标签这些经 `NestedGrid` 属性给的宿主状态不用调。调一次版本就递增：进行中的手势被取消，拿版本作结构键的拖动会话整场取消（30）。
- **`NestedGrid.md`**：
  - `dragging` 那段补一句：开发检查打开时，`dragging` 变真那一刻还有过渡在走，会警告一次（29）。
  - 焦点处加一句：根、外框与内容都不接焦点，点在空白处焦点会落到 `body`；挂在网格根上的快捷键这时收不到，宿主把键挂在 `window` 上，或给承载盒加 `tabindex="-1"` 并在按下时聚焦它（工作台外壳就是这样做的）（26）。
- **`live-drag-session.md`**：第 50 行改成新的先后。
- **README**：起步例子加 `onIssues: (issues) => console.warn("nb-layout issues", issues)`，前面加一行注释“诊断的唯一出口”。`StarterScene.vue` 同步改：`readme.test.ts` 逐字核对这两处。
- **`CHANGELOG.md`** 的 `[Unreleased]`：
  - “新增”：两条开发检查。
  - “改动”：`createLiveDragSession` 在键盘拖动、不走实时布局时也把网格的过渡送到终点。

### 应用的 Lab 场景与 nb-layout 示例：补上 `onIssues`

- **`StarterScene.vue`**：同 README，用 `console.warn`。
- **`GridPanelsScene.vue`、`LivePanelsScene.vue`、`GridStructureScene.vue`、`GridLeavingScene.vue`**：写 `onIssues: (issues) => console.debug("[lab] nb-layout issues", issues)`，旁边注释为什么用 debug：这些场景在 `lab-scenes` 里按手机宽度跑，放不下是正常结果，不是接线错误。
- **`examples/desktop`、`examples/tabbed-panels` 的 `App.vue`**：照 `examples/ide` 的写法，写 `console.warn("nb-layout reported issues", issues)` 加同一行注释。示例的 e2e 只收集 error，不受影响。

### packages/neuro-book/src/plugins/workbench/web/grid-diagnostics.ts（新文件）

把网格的诊断记进窗口的诊断服务。只从 `@notnotype/nb-layout` 根入口取类型（`GridIssue`、`GridIssueCode`、`GridHostIssueCode`、`GridFailure`），不从 `./vue` 取：`web/plugin.ts` 在后端 tsc 的范围里，`./vue` 会把 DOM 类型拖进来。

```ts
/** 与 `GridHostIssue`（nb-layout `./vue`）同形：布局重算与手势的诊断，或被拒的提交（带 `ok`）。 */
export type WorkbenchGridIssue = GridIssue<GridIssueCode | GridHostIssueCode> | GridFailure;

/** 这条诊断记成什么级别。 */
export function gridIssueLevel(issue: WorkbenchGridIssue): "debug" | "warn" | "error";

/** 逐条记进诊断：事件 `workbench.grid`。 */
export function recordGridIssues(diagnostics: Pick<DiagnosticsService, "record">, issues: readonly WorkbenchGridIssue[], plugin: string): void;
```

- **级别**（待确认 1）：
  - `"ok" in issue`（被拒的提交，已经回滚）→ `warn`；
  - `over-constrained`、`unabsorbed-space`、`no-room-to-collapse`、`no-room-to-restore`、`swap-skipped` → `debug`：这些是窗口尺寸或用户操作的结果，是设计好的降级；
  - `notify-failed` → `error`：工作台的 `commitGesture` 在落账之后抛出，文档可能没写上；
  - 其余（`conflicting-bounds`、`no-collapse-policy`、`not-published` 与以后的新码）→ `warn`：出现就是接线或时序的 bug。
- **记录**：`{level, event: "workbench.grid", message, data: {code, rejected, params?}, source: {plugin}}`。
  - `message` 是 `` `${rejected ? "rejected " : ""}${issue.code}: ${issue.message}` ``：码写进消息文字里，控制台与 e2e 读得到（浏览器出口把 `data` 作为第二个参数，Playwright 的 `text()` 里只是一个对象占位）。
  - `params` 原样放进 `data`：值只有字符串与数字，诊断的脱敏照常兜底。
- **不另做去重或限流**：`useGridHost` 已经“只发新增”（nested-grid 输出 140）。探针 1 显示窗口缩放 212 个尺寸只发 15 条。实时布局拖动时，预览每换一次候选，诊断重新出现会再发，但候选要连续 150ms 不变才换，而且这一类是 `debug`（从代码推断，没有实测拖动中的条数）。

### packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue 与 plugin.ts

- **`WorkbenchShell.vue`** 的属性加一个必填的 `reportGridIssues: (issues: readonly WorkbenchGridIssue[]) => void`，注释写“网格的诊断与被拒的提交（`grid-diagnostics.ts`）”。模板里 `<WorkbenchSurface … @issues="(issues) => reportGridIssues(issues)">`，和别的事件写在一起。
  - 做成必填：外壳只有 `plugin.ts` 一个挂载点，这次的问题就出在“可以不接”。注意类型检查拦不住漏传：`plugin.ts` 交出去的 `props` 是 `() => Record<string, unknown>`（`home-page.ts` 第 26 行），后端 tsc 对 `.vue` 只看通配声明。漏传时只有开发构建里 Vue 的“缺必填属性”警告；真正的守门是第 3 片的 workbench-shell e2e，它在真实运行时里看得到 `workbench.grid`。
  - `WorkbenchSurface` 发出的是 `GridHostIssue`，与 `WorkbenchGridIssue` 同形：外壳模板里那一处由前端的 vue-tsc 核对两者对得上。
- **`plugin.ts`**：外壳的 `props` 里加 `reportGridIssues: (issues) => recordGridIssues(diagnostics, issues, descriptor.id)`。`diagnostics` 是 `activate` 里已经取到的那个。
- **`WorkbenchShell.md`**：属性表加这一行。**`WorkbenchSurface.md`**：
  - `issues` 事件处写明外壳把它交给 `reportGridIssues`；
  - 删掉“注意事项”最后一段的已知限制（落点指示与键盘拿起量到半路几何）：改完 `createLiveDragSession` 之后，工作台这几种起拖也会把过渡送到终点；
  - `WorkbenchSurface.vue` 第 65 行 `issues` 事件的注释同步。
- **Lab 夹具**：`WorkbenchSurfaceFixture`、`EditorAreaFixture` 直接挂 `WorkbenchSurface`，不经外壳，不改：`WorkbenchSurface` 自己总给 `useGridHost` 传 `onIssues`，“没有出口”的检查不会在它们身上报。

## Spec 与文档改动

Spec 由主会话在主工作区的 master 上先写，并作为一次提交（标 planned）；coder 不在 worktree 里改 Spec。编号以写的那一刻 master 上的最大号为准：今天 nested-grid 输出到 157，layout-drag 输出到 23，workbench-layout 验收到 33。

- **`docs/specs/ui/nested-grid.md`**，在输出末尾追加：

  > 158. **开发模式：诊断没有出口**（planned）：开关同输出 151。`useGridHost` 没给 `onIssues` 的宿主在建立时警告一次：布局重算的诊断与被拒的提交会被丢掉。有意不收诊断的宿主给一个什么都不做的 `onIssues`。只看 `useGridHost` 的选项：直接用 `NestedGrid` 的宿主不在这一条里。库不把诊断本身打到控制台，开关开与关时 `onIssues` 收到的都一样。
  >
  > 159. **开发模式：起拖时过渡还在走**（planned）：开关同输出 151。`NestedGrid` 的 `dragging` 从假变真的那一刻，布局过渡还在走（`moving` 为真）时，警告一次：宿主的拖动会话起拖时没有调 `settleMotion()`，判定量到的是过渡中间的矩形。同一个 `NestedGrid` 只报一次。下面几种不算：宿主在 `dragging` 变真的同一次更新里改了布局、过渡是这次才开始的；系统减少动态效果（没有过渡）。实时布局的会话自己调 `settleMotion()`（[layout-drag](layout-drag.md) 输出 23）。

  “边界与兼容”的“开发模式”一句改成“打开配置检查（输出 151、158、159）”。

- **`docs/specs/ui/layout-drag.md`**：
  - 输出 23 的第一条改成：

    > 拿起全在 `activate` 里：宿主的 `activate` 先；返回真、网格在、网格的过渡时长不为 0 时，先把网格的过渡送到终点（键盘拖动、`live` 不给来源的这一场也是，planned）；又不是键盘拖动时才问 `live(source)`，它给出实时布局的来源才开始。别的照常是落点指示。
  - 输出 5 末尾补一句（现状事实，不标 planned）：

    > 设了 `pointer-events: none` 的元素本来就不在命中里；`data-drag-feedback` 给要接指针的反馈元素。

- **`docs/specs/ui/workbench-layout.md`**：
  - “失败与恢复”的“呈现降级”一条之后加：

    > 网格的诊断与被拒的提交（[ui/nested-grid](nested-grid.md) 输出 139）记进窗口的诊断，事件 `workbench.grid`，消息里带码。放不下、空间没人吸收、收起或恢复没有空间、交换不成立，这几种是可以预期的降级，记 `debug`；落账之后通知抛出（`notify-failed`）记 `error`；被拒的提交与别的码记 `warn`。同一个问题持续时不重复记（nested-grid 输出 140）（planned）。
  - 验收末尾追加：

    > 34. （planned）Given 窗口从 1440 缩到 590，When 读窗口的诊断（浏览器控制台），Then 有 `workbench.grid` 的 `over-constrained`，级别是 debug；整个过程没有 `workbench.grid` 的 warn 与 error。

- 包内说明、CHANGELOG、`WorkbenchShell.md`、`WorkbenchSurface.md` 见“关键设计”。
- Task README：“合同”一栏链接上面三份 Spec；完成时由主会话在实现合同、证据里补测试路径（nested-grid 的“合同测试”里 `dev-checks.dom.test.ts` 改写成“输出 151、158、159”）。

## 切片

### 第 1 片：nb-layout 的开发检查与实时布局会话（一个提交）

- **范围**：`useGridHost.ts`、`NestedGrid.vue`、`live-drag-session.ts`、`dev-checks.ts`（只改模块头）。
- **测试**（加在已有文件里）：
  - `dev-checks.dom.test.ts`，用例照现有的写法（开关开、桩住 `console.warn`）：
    1. `useGridHost` 没给 `onIssues`：警告一次，带 `contextKey`；有 `onIssues` 的 `mountHost` 不报；开关关着不报。
    2. 给了什么都不做的 `onIssues`：不报。
    3. `NestedGrid` 先由程序改布局、让过渡走起来（照 `NestedGrid.dom.test.ts` 第 1672 行起的做法，行内设 `--nb-layout-motion-layout`），再把 `dragging` 设真：警告一次；再落一次、再起一次，不再报。
    4. 同样在过渡中，先调 expose 的 `settleMotion()` 再设 `dragging`：不报。在同一次 `setProps` 里同时改树与 `dragging`（过渡是这次才开始的）：不报。变异：把侦听改成缺省的 pre，这一条应当失败。
    5. 减少动效（时长 0）时设 `dragging`：不报。
  - `live-drag-session.dom.test.ts` 第 157 行（`live` 返回 null）与第 215 行（键盘拖动）两条，各加一句断言 `log` 里有 `"settleMotion"`。第 139 行与第 167 行的用例不改，照样过。
- **自跑**：
  - `cd packages/nb-layout && bunx vitest run src/vue/dev-checks.dom.test.ts src/vue/live-drag-session.dom.test.ts src/vue/NestedGrid.dom.test.ts src/vue/useGridHost.dom.test.ts`
  - `bun run --cwd packages/nb-layout typecheck`
  - `bun run --cwd packages/nb-layout api:check`：没有新导出，应当不变。

### 第 2 片：说明、起步例子、Lab 场景与示例（一个提交）

- **范围**：包内说明（`drag-session.md`、`useGridHost.md`、`NestedGrid.md`、`live-drag-session.md`、README）、`CHANGELOG.md`、`StarterScene.vue` 与另外四个 Lab 场景、两个示例的 `App.vue`。
- **自跑**：
  - `cd packages/nb-layout && bun test src/readme.test.ts`：README 与 starter 一字不差，随包文档不引 Spec 编号；
  - `bun run --cwd packages/nb-layout typecheck`：含示例的类型检查；
  - `bun run --cwd packages/neuro-book typecheck`：Lab 场景；
  - `bun run docs:check`。

### 第 3 片：工作台接诊断（一个提交）

- **范围**：`grid-diagnostics.ts` 与测试、`WorkbenchShell.vue`、`plugin.ts`、`WorkbenchSurface.vue` 的注释、`WorkbenchShell.md`、`WorkbenchSurface.md`、e2e。
- **测试**：
  - 新文件 `grid-diagnostics.test.ts`（bun）：真实的 `createDiagnosticsStore({identity})`（照 `settings/web/choices.test.ts` 第 100 行），交进真实的诊断：
    - `createGrid(...).layout(很小的尺寸).issues` 算出的 `over-constrained`：记成 debug，消息以码开头，`data.code` 对；
    - 一个结构操作真实返回的失败（例如 `resizeBranches` 传不存在的分支，得到 `not-found`）：记成 warn，消息以 `rejected ` 开头；
    - `{code: "notify-failed", message}` 记成 error；不认识的码记成 warn。

    用 `store.query({})` 读回来断言。
  - `e2e/workbench-shell.e2e.ts` 的“放不下时只改呈现”（第 661 行）：
    - 开头挂 `page.on("console")`，收集文字里含 `workbench.grid:` 的消息与它的类型；
    - 590×900 那一步之后，`expect.poll` 等到至少一条类型为 `debug`、文字含 `over-constrained`。规划时的探针用的是测试的视图目录，产品目录没核过：基线上这一步若没有 `over-constrained`，就在这一步之后加一步 240×900（探针在宽 200 附近出过 `cross-min`、`min-total`），在那一步上等，再接着原来的 590×230，不另想别的办法；
    - 用例末尾断言这些消息里没有 `warning` 与 `error` 类型。
    - 变异：在没接线的起点上跑，这条应当失败（只看到断言超时，不是别的错）。
- **自跑**：
  - `cd packages/neuro-book && bun test src/plugins/workbench/web/grid-diagnostics.test.ts src/architecture.test.ts`：改了浏览器代码的导入，要跑依赖方向检查；
  - `bun run --cwd packages/neuro-book typecheck`；
  - e2e 只跑这一个文件：`bun run --cwd packages/neuro-book test:e2e -- e2e/workbench-shell.e2e.ts`（脚本先构建 server、web 与 e2e 外壳三份产物；直接跑 Playwright 时要自己先建这三份）。

### 收口

- `bun run test:affected --since master --typecheck`；
- `governance:check`、`docs:check`；
- 下面“验证”里的 e2e 清单跑一次。

## 验收映射

| 条目 | 覆盖 |
|---|---|
| nested-grid 输出 158 | `dev-checks.dom.test.ts` 用例 1、2；`lab-scenes.e2e.ts`（五个场景补上出口之后，开发检查开着也没有警告） |
| nested-grid 输出 159 | `dev-checks.dom.test.ts` 用例 3、4、5 |
| layout-drag 输出 23（第一条的新说法） | `live-drag-session.dom.test.ts` 第 157、215 行加的断言；先后不变由第 139、167 行守着 |
| layout-drag 输出 5 补的一句 | 只是浏览器事实，规划时用本机 Chrome 探针核过，不加测试 |
| workbench-layout “失败与恢复”新增的一条 | `grid-diagnostics.test.ts` |
| workbench-layout 验收 34 | `workbench-shell.e2e.ts` 的“放不下时只改呈现” |
| nested-grid 输出 139、145（工作台一侧真的接上） | `workbench-shell.e2e.ts` 同上（真实运行时里控制台出现 `workbench.grid`） |
| 第 26、30、34、36、37、54 条 | 只改说明，`readme.test.ts` 查随包文档的链接与编号 |

## 验证

- **端到端**：
  - 起开发服务（`nbdev dev start`，后台运行），窗口拉到宽 900 左右，开发者工具的控制台打开 Verbose，应看到 `[debug] workbench.grid: over-constrained: …`，没有黄色警告。
  - 在 Lab 打开 `starter` 场景，把 `onIssues` 临时去掉，应看到 `[nb-layout/useGridHost] … has no onIssues` 一次（这一步只在本地看，不提交）。
- **e2e：开工前在起点上各跑一遍作基线，合入前再跑一次。** 分两次跑，每次不超过 8 个文件：
  - **应用的产品 e2e**（正好 8 个）：
    - `workbench-shell`：新断言；
    - `commands`、`settings`、`plugins`：打开工作台、收集 warning；
    - `workbench-dnd`、`workbench-live-drag`：实时布局会话的起拖先后变了，键盘与落点指示的起拖现在会把过渡送到终点；
    - `workbench-float`：拖整窗也走这条路径。已知偶发的 `:316`（窗刚开就拖不跟手）正撞上这次改动，可能变好，也可能换一种失败方式；起点基线必须跑，归因照“偶发 e2e 归因要大样本”做，同条件交替各 15 遍以上；
    - `workbench-containers`：拖容器入口。
  - **应用的 Lab e2e**：`lab-scenes`（五个场景补出口；开发检查是开着的）、`lab-grid-structure`（起步例子）、`lab-live-panels`（实时布局会话）。
  - **nb-layout 示例**：`bun run --cwd packages/nb-layout test:e2e`，三个示例。
- debug 级的记录会写到控制台：诊断存储在写出口时不按级别筛（`nb-runtime/src/diagnostics/store.ts` 的 `minLevel` 只用于查询，内核自己的生命周期记录就有 debug 级），浏览器出口把 debug 写成 `console.debug`，Playwright 收到的类型是 `debug`。
- **实施中只重跑**：
  - 第 1 片：`lab-live-panels`、`workbench-live-drag`、`workbench-float`；
  - 第 2 片：`lab-scenes` 里改过的五个场景（用 `nbdev shot` 看 `measure` 代替整份重跑，见验证门禁）与 `lab-grid-structure`；
  - 第 3 片：`workbench-shell`。
- **不跑 `app-package`**：它看到的工作台与 `plugins` 的同一份，warn 级只给 bug 码。
- **已知原有失败**：`workbench-views:754`、`workbench-titlebar:146`、`editor-area` 的实时拆组怕负载，`lab-agent-ui` 角色模型选择器在 master 上就挂；lab-scenes 的 ThemeEditor 404 是原有失败。基线先跑就是为了把它们分出来。
- **明确留下的未验证边界**：
  - 实时布局拖动中 `workbench.grid` 的 debug 条数（推断不多，没有实测）；
  - 被拒的提交、`not-published` 在真实运行时里怎么触发（只在单元测试里用真实的失败对象验证级别）。

## 不做与风险

- **不做**：
  - 不把诊断本身缺省打到控制台；
  - 第 34 条不加运行期检查；
  - 不给直接用 `NestedGrid` 的宿主查“接没接 `issues`”；
  - 不改 `tabbed-panels` 示例里多余的 `invalidate()`（第 30 条只补说明）；
  - 不给 `WorkbenchSurface` 的 `issues` 做必填（它只有外壳一个产品使用方，外壳那一环已经必填）；
  - 不进状态栏或界面：用户看到诊断的地方是开发者工具的控制台（浏览器出口写 console），以及同一窗口诊断的内存查询。
- **风险**：
  - **控制台守卫的 e2e**：只有 bug 码是 warn。如果产品在这些 e2e 里真有被拒的提交或 `not-published`，它们会红：那是本来就有、一直被吞掉的真问题，要查，不改级别绕过。
  - **开发检查误报**：`drag-during-motion` 靠 sync 侦听排除“同一次更新里开始的过渡”；用例 4 加变异守着。宿主在 `activate` 里调 `settleMotion` 之后又同步改了布局，再起拖，会报。这种写法本身就会量到半路的矩形，报得对。
  - **工作台行为变化**：键盘拿起、落点指示、拖整窗、拖容器入口起拖时，进行中的过渡（容器切换的滚动）直接到终点。拖动开始前那几百毫秒的滚动会跳到终点，换来落点与真实几何一致。

## 待确认项

1. **网格诊断记成什么级别。** 推荐：
   - 放不下、空间没人吸收、收起或恢复没有空间、交换不成立 → `debug`；
   - 被拒的提交与别的码 → `warn`；
   - `notify-failed` → `error`。

   理由：探针显示，半屏宽（1000 及以下）就有一条持续的 `over-constrained`，这是设计好的降级（workbench-layout 输出 10）。记成 warn 会让开发者工具常驻一条黄色警告，还会让 commands、settings、plugins 这些收集 warning 的 e2e 挂掉。debug 照样进诊断的内存记录，控制台打开 Verbose 就看得到。备选是记成 info：控制台缺省显示，也不触发 e2e 的守卫，代价是每个窄窗口用户的控制台里都多一行。
2. **`createLiveDragSession` 在任何起拖时都把网格的过渡送到终点。** 推荐做，改在库里。
   - 理由一：不改的话，新加的“起拖时过渡还在走”检查会先报到库自己的组合函数与工作台身上（键盘拿起、落点指示）。
   - 理由二：工作台那条“落点指示量到半路几何”的已知限制，查不到记录下来的理由，改了就一起消掉。
   - 代价：这几种起拖会打断进行中的过渡（让它直接到终点）。
   - 备选是只在工作台的 `activate` 里调，库不动；那样别的用 `createLiveDragSession` 的宿主还留着同一个缺口。
3. **第 34 条（漏标 `data-drag-feedback`）不加开发检查，只改说明。** 推荐不加。
   - 理由一：浏览器的命中本来就跳过 `pointer-events: none`（探针 2），库自带的反馈组件与工作台的拖影都已经这样设了。
   - 理由二：运行期没有可靠的信号判断“这是反馈元素”。“指针下一直是同一个元素、而且跟着指针动”这种启发式会误报 `SortableList` 里被拖、跟手的那一行，它能接指针，也不该标反馈。
   - 开发者坚持要检查时，备选做法：拖动中连续 3 次判定的 `top` 是同一个元素、它跟着指针移动了 12px 以上、又不包含按下的那个元素时，报一次。
4. **“没有出口”只报接线错误，不打印诊断本身**（回应第 57 条“`onIssues` 缺省打到控制台”）。推荐：开发检查打开、宿主没给 `onIssues` 时，警告一次“诊断没有出口”。`dev-checks.ts` 模块头的取舍改成“库不打印诊断，只报没有出口”。
   - 理由一：缺省打印会绕过宿主自己的诊断出口，还会把放不下这类正常降级打成警告。
   - 理由二：生产构建里（开关关着）宿主收不到库的任何控制台输出，与“库不读 `import.meta.env`”一致。
   - 理由三：这样 Lab 的五个场景要同一片补上 `onIssues`，正好回应摩擦记录里“说明里放在起步”的建议。
