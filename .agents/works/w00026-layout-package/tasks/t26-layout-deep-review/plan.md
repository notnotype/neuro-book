# t26 计划：深入审查的代码修复与性能基线

第 1 稿（2026-11-18）。t26 拆成三个之后（Task README、待确认清单 2026-11-18）本 Task 只留性能基线与审查里“准备直接修的”代码修复；Spec 的晋升与重写在 t30，通用库的提案在 t31。

## Context

开发者 2026-11-16 要求对布局工具做一次深入审查（设计与代码质量、文档、API 形状、性能：能省则省，不多排版、不多重绘，动画帧不空转）。四份审查报告在 `evidences/deep-review-*.txt`，固定在 `954ed9e94`。Task README 里“准备直接修的”一节是 2026-11-16 报给开发者、不用答的修复清单。之后 t19、t27、t29、t28、t38 改了其中不少地方，2026-11-18 逐条按 master（`f9be5b9ff`）重核，结果在下面“重核”一节。

开发者 2026-11-16 定 nb-layout 是可以发到 npm 的通用布局库（丙）。所以下面几件不在本 Task 做，等 t31 的提案定了分界：`layout-drag.ts` 拆文件与补单元测试（design-09、10：拖动控制器可能进库）、删掉两个“没人用”的落点函数（docs-15：通用库里它们是公开接口）、入口收窄（api-07：那是没选的甲方案）、`LayoutPolicy` 的形状（api-02：拆出“只管落点”的规则还是写入时也守，是公开接口的取舍，见“不做与风险”）。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)（输出 38 实时布局、`dragCardRefresh`）。本 Task 的修复不改可观察行为，只有 design-04 收紧了读记录时的校验（见那一节）。

工作方式：autonomous-delivery；修复在新分支 `fix/w00026-t26-layout-review`（worktree `.worktree/w00026-t26-layout-review`），从 master 开。t28 的实现审查还在后台，它的修正会落在 `layout-drag.ts`、`entry-drop.ts`、外壳、表面与入口条，所以先做只在 nb-layout 里的修复与 e2e 辅助函数，t28 的审查处理并合入之后再量基线、动工作台的几个文件。

## 重核（按 master `f9be5b9ff`）

| 条 | 现在 | 位置 |
|---|---|---|
| api-06 外缘移动新建面板不查重 | 还在 | `nb-layout/src/layout-doc.ts` `moveTabToEdge`（`policy.newId("panel")` 之后直接写）；`placeLeaf` 的分支 id 同样不查 |
| api-08 文档放进 `ref` 抛 `DataCloneError` | 还在 | `layout-doc.ts` 的 `editable()` 用 `structuredClone`，头注释第 12 行 |
| design-03 `useSashGesture` 换根元素摘的是新元素 | 还在 | `vue/useSashGesture.ts` 的 `watch(options.root, …)`；同文件直接用全局 `window`、`document` |
| design-04 条的叶 id、面板 id 撞条名不校验 | 还在；t28 又加了一类：入口条叶的 id `strip:<区域>` 只在呈现里，面板 id 取这个前缀会和它撞 | `layout-doc.ts` `validateLayoutDoc` 里条的叶只验 `ref` |
| perf-01 分隔线装饰 | 部分已修（t19：一帧里先量完全部再统一写，不再逐条强制重算）；还在的：`window` 上捕获阶段的 scroll 监听让任何元素滚动都重排全部分隔线；每次都先清空四个方向再写；每条线各读一次 `getComputedStyle` | `vue/useSashSnap.ts`、`vue/SashHandle.vue` 的 `writeDecorationGeometry`、`readLineSize` |
| perf-09 编辑组头的尺寸观察 | 还在 | `WorkbenchSurface.vue` 的 `headObserver` 回调无条件换新对象 |
| perf-04 实时布局帧循环空转 | 还在 | `web/live-drag.ts` 的 `tick` 第一行无条件 `requestFrame` |
| perf-06 同一盒子两个尺寸观察 | 还在 | `WorkbenchSurface.vue` 的 `useLayoutExtent(rootEl)` 与 `NestedGrid.vue` 的 `measuredExtent` |
| perf-03 每帧重算结构键 | 还在 | `web/layout-drag.ts` 的 `structure`（`JSON.stringify` 整份结构） |
| perf-05 整窗拖动没有合成层 | 还在 | `NestedGrid.vue` `[data-float-gesture="move"]` 的规则只有 `pointer-events` |
| perf-08 过渡结束靠定时器 | 还在 | `vue/useGridMotion.ts` 的 `MOTION_SLACK_MS` 与两处 `setTimeout(stop, …)` |
| docs-02、08、09、11 组件说明缺字段与写错 | 动手时逐条核：t28、t29 改过 `NestedGrid.md`、`WorkbenchSurface.md`、`WorkbenchShell.md` | |
| docs-18 写错的注释（`data-no-drop`）与历程注释 | 动手时逐条核 | `layout-drop.ts` 头注释等五个文件 |
| e2e 点完活动栏入口后移开指针（t25 合入后的偶发） | 还在 | `workbench-views.e2e.ts` 的 `showView` 等点入口的辅助函数 |

## 技术选型

无新依赖。性能量法沿用 `e2e/workbench-drag-cost.e2e.ts`：CDP `Performance.getMetrics` 的 `RecalcStyleCount`、`LayoutCount`，页面里包一层 `requestAnimationFrame` 数回调，数次数不计时。

## 关键设计

### 性能基线：`packages/neuro-book/scripts/perf/layout-frames.ts`（新）

- 照 `scripts/perf/browser-runner.ts` 的做法：Node 运行，`@playwright/test` 的 `chromium` 加 e2e 的探针服务（`startProbeServer`，测试插件 `test.sample-views`，排除编辑器插件，同 `workbench-containers`），参数给出要量的构建所在的 checkout；结果写 JSON，打一张表。
- 场景（每个场景前后各读一次计数，差值就是这一段的开销；场景开始前等过渡结束、指针移开）：
  1. 静止 2 秒：动画帧回调数、样式重算、排版。
  2. 拖侧栏边界 60 步：每步的样式重算、排版、动画帧回调。
  3. 资源管理器树滚动 30 次：样式重算、排版（perf-01 的 scroll 监听）。
  4. 实时布局拿起视图、在一块面板上按住不动 1 秒：动画帧回调（perf-04）。
  5. 实时布局拖过三块面板与活动栏、右栏入口条：每次移动的样式重算、排版（含 t28 的 `measureBands`）。
  6. 整窗拖动一个浮动窗 60 步：样式重算、排版（perf-05 看的是重绘，这里只能看到排版不增加，重绘的面积写为未量）。
  7. 侧栏显隐、右栏切换容器各一次：过渡期间的动画帧回调与 `moving` 为假之后的回调（perf-08）。
  8. 窗口宽度改 20 次：每次的样式重算、排版（perf-06、perf-09）。
- 对照的做法（advisor 建议，同 t28 对照 `workbench-titlebar` 的做法）：基线提交单独建一个 detached worktree 装依赖、构建一次留着；修完的分支另一份构建；两份交替各跑 3 轮，同一负载下比，按每个指标的中位数报。证据写进 `evidences/perf-baseline.txt`，命令原样写进去。
- 这个脚本不是测试，不进 `bun run test`；回归由下面每片补的 e2e 计数断言守。

### nb-layout 的修复：`packages/nb-layout/src/layout-doc.ts`、`vue/useSashGesture.ts`

- api-06：`freshId(next, policy, kind)` 取新 id 并查重（面板查 `panels` 与树，分支查树），重了返回 `failure("rejected", …)`；`moveTabToEdge`、`openPanelAtEdge`、`floatTab`、`splitPanelInPlace`、`placeLeaf` 的分支都用它，四处现有的查重收进来。补 `layout-doc.test.ts`：`newId` 返回已有 id 时外缘移动被拒、文档不变（原报告的实验）。
- api-08：`editable()` 改成对 JSON 形状的深拷贝（文档只有对象、数组、字符串、数字、布尔、null；手写递归，不用 `JSON.parse(JSON.stringify())`，免得把 `undefined` 字段的行为换掉）；删掉头注释里“放在 `shallowRef` 里”的告诫。补测试：`reactive`、`ref` 包着的文档做结构操作照常返回结果。性能：256 个节点的文档拷一次，在 `layout-doc.test.ts` 的规模用例里顺手量，不比 `structuredClone` 慢一个数量级（写进测试的注释，不设断言）。
- design-03：`watch(options.root, (element, previous) => …)`，`detach(previous)`；`dispose` 与卸载时摘当前元素。窗口、文档改取 `root.ownerDocument`（同 `drag-session.ts`），根元素换文档时跟着换。补 `useSashGesture` 的 DOM 测试：根从 A 换成 B 后，A 上按下不起手势，B 上照常。
- design-04：`validateLayoutDoc` 对条的叶加 `leaf.id === 条名`；面板 id 不许是条名，也不许以入口条叶的前缀（`regionStripLeafId` 用的那个）开头。读记录时这样的文档按“不合法”回落默认树（已有路径：输出 20 的诊断与回落）。补测试：这三种文档都被拒。

### 工作台的修复（t28 的实现审查处理并合入之后）：`WorkbenchSurface.vue`、`web/live-drag.ts`、`web/layout-drag.ts`

- perf-09：`headObserver` 回调先比较，高度都没变就不赋值。
- perf-06：表面不再自己 `useLayoutExtent`，用 `NestedGrid` 量到的那份（`NestedGrid` 加 `extent` 事件，`flush: "sync"`，同表面现在交给 store 的时机）；`useGridMotion.decideMotion` 里“两个尺寸都要比”的分支随之去掉。`NestedGrid.md`、Spec `ui/nested-grid` 的事件表（t30 统一改）记一笔。
- perf-04：`tick` 只在有事要做时排下一帧：稳定计时还没到、卡片尺寸或追赶位移没到终点、排序的标签还要放；`offer()` 里发现没在跑就起。补 `live-drag.test.ts`：候选稳定、卡片到位之后不再请求帧；新的落点来了重新请求。
- perf-03：`structure` 按 `options.doc()` 的对象身份与编辑器结构的值记住上一次的串。
- 写进 `workbench-drag-cost.e2e.ts` 的断言：实时布局按住不动 1 秒，动画帧回调为 0（容许开始那一两帧）。

### nb-layout 的性能修复：`vue/useSashSnap.ts`、`vue/SashHandle.vue`、`vue/NestedGrid.vue`、`vue/useGridMotion.ts`

- perf-01：scroll 监听只认包着网格根的滚动（`event.target` 是文档或包含根）；`writeDecorationGeometry` 记下每个装饰元素上一次写的几何，值一样不写，只清掉换方向时另一方向留下的键；线芯宽度一轮读一次。补断言（`lab-*` 或 `workbench-drag-cost`）：树滚动时分隔线不重写（数样式重算，或数装饰元素的 `style` 写入次数，选能稳定量到的）。
- perf-05：`[data-float-gesture="move"]` 的外框、内容、窗的把手加 `will-change: translate`，只在手势期间有。
- perf-08：过渡结束看过渡本身：渲染之后收集网格根直接子元素的过渡动画，全部完成时 `stop`；没有过渡就马上 `stop`；定时器只作兜底（时长的两倍）。`moving` 跟着过渡走。`MOTION_SLACK_MS` 删掉。现有 `useGridMotion.dom.test.ts` 与 `NestedGrid.dom.test.ts` 的 `moving` 用例照跑；补“主线程忙、定时器先到时不提前送到终点”（假的忙可以用同步循环占住主线程一段，再看过渡还在走）。

### 文档与注释

- 组件说明逐条核 docs-02（`NestedGrid.md` 的属性、插槽、公开标记）、docs-08（`WorkbenchSurface.md`）、docs-09 与 docs-11（`WorkbenchShell.md` 的 Props、编辑器槽、“浮动窗不在这里”那句），还缺的补上、写错的改掉。
- docs-18：`layout-drop.ts` 头注释的 `data-no-drop` 改成 `data-no-drag`；五个文件里带 Task 编号、“现在还是”“原型试过”这类历程的注释改成说现在的约束，或删掉。
- Spec 的 Smoke 行（docs-13）归 t30。

### e2e 辅助函数

点活动栏入口的辅助函数（`workbench-views` 的 `showView`，以及 `workbench-containers`、`workbench-dnd`、`lab-workbench-surface` 里点完入口就去点侧栏的地方）点完把指针移到不触发提示的位置（标题栏的空白），免得入口的提示框挡住侧栏顶上的标签。

## Spec 与文档改动

- 本 Task 不改 Spec 正文；design-04 收紧的校验是 `ui/workbench-layout` 输出 20 “合法但不合骨架的记录回落默认树”的范围之内，t30 重写时写进条目。
- 组件说明：`NestedGrid.md`（`extent` 事件、`will-change`、过渡结束的判法）、`WorkbenchSurface.md`、`WorkbenchShell.md`、nb-layout 的 `grid.md`（`editable` 的告诫删掉）。

## 切片

1. **nb-layout 的正确性**：api-06、api-08、design-03、design-04。验证：nb-layout `bun test`、`vitest`、类型检查；neuro-book 类型检查与工作台单元测试（读记录的校验）；e2e `lab-grid-swap`、`lab-workbench-surface`、`workbench-shell`（读坏记录回落的用例）。
2. **e2e 辅助函数与文档注释**：只改测试与 `.md`、注释。验证：改到的 e2e 文件。
3. **性能基线**（t28 的审查处理并合入之后）：脚本、基线构建、第一次测量写进证据。
4. **nb-layout 的性能**：perf-01、perf-05、perf-08。验证：nb-layout 全部测试；e2e `lab-*` 里量网格的几个、`workbench-containers`（过渡与交换逐帧）、`workbench-float`、`workbench-drag-cost`。
5. **工作台的性能**：perf-09、perf-06、perf-04、perf-03。验证：工作台单元测试、`live-drag.test.ts`；e2e `workbench-drag-cost`、`workbench-live-drag`、`workbench-shell`、`workbench-containers`。
6. **复测与收口**：同一脚本交替量基线与修后，写进证据；实现审查（Sonnet）。

## 验收映射

- `ui/workbench-layout` 输出 38（实时布局：跟手的东西不走渲染、`dragCardRefresh`）→ `workbench-drag-cost.e2e.ts`（加“按住不动不请求帧”）。
- `ui/nested-grid` 的“过渡”（`moving`、过渡结束）→ `useGridMotion.dom.test.ts`、`NestedGrid.dom.test.ts`、e2e `workbench-containers` 的逐帧用例。
- `ui/workbench-layout` 输出 20 的读记录回落 → `layout-doc.test.ts`（校验）、e2e `workbench-shell`。
- 不改行为的修复（api-06、api-08、design-03）→ 各自补的单元测试。

## 验证

- 每片跑上面列的命令；e2e 只跑覆盖改动的文件，超过 8 个写 `NB_E2E_WIDE`。
- 性能：基线与修后同一脚本、同一负载交替量，报中位数；量前看 `cat /proc/loadavg`，负载高时多跑几轮、按低的一端判，并在证据里写负载。
- 未验证：无头浏览器固定 60Hz，“不超过 120、144Hz 屏的刷新率”只能从代码确认帧都挂在 `requestAnimationFrame` 上；重绘面积（perf-05）只能在真机的 Performance 录制里看，写为未量。

## 不做与风险

- 不做（等 t31）：`layout-drag.ts` 拆分与单元测试、删两个落点函数、入口收窄、`LayoutPolicy` 的形状（api-02）。api-02 的现状是宿主在写入出口兜底（工作台的 `fitsSkeleton`），t28 的跨区域搬容器、“移动到”都写落点判定不会给出的目标，写入时强制 `edgeTarget` 会把它们拒掉，所以不在这里改。
- 风险：design-04 收紧校验，用户磁盘上若有条的叶 id 写错的记录，会回落默认树（今天会画出没有活动栏的工作台）。没有路径能产生这种记录，接受。
- 风险：perf-06 去掉表面自己的尺寸观察，store 拿到容器尺寸的时机改成 NestedGrid 量到之后；首帧前 store 还没有尺寸的那一段（现在两边一起到）要在 e2e 里看首屏没有跳动。
- 风险：perf-08 用过渡本身判结束，过渡被浏览器取消（元素被摘、样式被改）时 `finished` 会 reject，要按“结束”处理，不能挂着；兜底定时器保证不会永远 `moving`。
