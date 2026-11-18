# t26 计划：深入审查的代码修复与性能基线

第 2 稿（2026-11-18）：按设计审查（[`evidences/plan-review.txt`](evidences/plan-review.txt)，14 条，处理在 Task README）改：帧循环按需排的条件与重启时的时钟（第 1 条）、过渡结束的判法加轮次令牌与收集时机、单元测试留定时器的路（第 2、3 条）、拷贝文档的写法与“结果与输入共享子对象”写进合同（第 4 条）、校验拦所有会和呈现里生成的 id 撞的节点（第 5 条）、perf-06 推迟到 t31（第 6 条）、基线脚本的口径重写（第 7 条）、`structure` 的缓存连编辑器那一半与测试（第 8、12 条）、`useSashGesture` 记下挂上时的根与窗口（第 9 条）、perf-05 不做（第 10 条）、分支 id 也查面板（第 11 条）、分隔线的两处细节（第 13 条）、e2e 移开指针的位置按文件定（第 14 条）。第 1 稿：t26 拆成三个之后本 Task 只留性能基线与审查里“准备直接修的”代码修复；Spec 的晋升与重写在 t30，通用库的提案在 t31。

## Context

开发者 2026-11-16 要求对布局工具做一次深入审查（设计与代码质量、文档、API 形状、性能：能省则省，不多排版、不多重绘，动画帧不空转）。四份审查报告在 `evidences/deep-review-*.txt`，固定在 `954ed9e94`。Task README 里“准备直接修的”一节是 2026-11-16 报给开发者、不用答的修复清单。之后 t19、t27、t29、t28、t38 改了其中不少地方，2026-11-18 逐条按 master（`f9be5b9ff`）重核，结果在下面“重核”一节，设计审查抽查过。

开发者 2026-11-16 定 nb-layout 是可以发到 npm 的通用布局库（丙）。所以下面几件不在本 Task 做，等 t31 的提案定了分界：`layout-drag.ts` 拆文件（design-09：拖动控制器可能进库）、删掉两个“没人用”的落点函数（docs-15：通用库里它们是公开接口）、入口收窄（api-07：那是没选的甲方案）、`LayoutPolicy` 的形状（api-02：见“不做与风险”）、perf-06（要给 `NestedGrid` 加公开的事件或属性）。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)（输出 20 读记录与回落、输出 38 实时布局与 `dragCardRefresh`）。本 Task 的修复不改可观察行为，只有 design-04 收紧了读记录时的校验。

工作方式：autonomous-delivery；修复在新分支 `fix/w00026-t26-layout-review`（worktree `.worktree/w00026-t26-layout-review`），从 t28 实现审查的修正合入之后的 master 开。

## 重核（按 master `f9be5b9ff`）

| 条 | 现在 | 位置 |
|---|---|---|
| api-06 外缘移动新建面板不查重 | 还在 | `nb-layout/src/layout-doc.ts` `moveTabToEdge`（`policy.newId("panel")` 之后直接写）；`placeLeaf` 的分支 id 同样不查 |
| api-08 文档放进 `ref` 抛 `DataCloneError` | 还在 | `layout-doc.ts` 的 `editable()` 用 `structuredClone`，头注释第 12 行 |
| design-03 `useSashGesture` 换根元素摘的是新元素 | 还在 | `vue/useSashGesture.ts` 的 `watch(options.root, …)`；同文件直接用全局 `window`、`document`、计时器与 `cancelAnimationFrame` |
| design-04 条的叶 id、节点 id 撞名不校验 | 还在；t28 又加了两类：呈现里生成的入口条叶 `strip:<区域>` 与区域内层分支 `<区域节点>:sections` | `layout-doc.ts` `validateLayoutDoc` 里条的叶只验 `ref` |
| perf-01 分隔线装饰 | 部分已修（t19：一帧里先量完全部再统一写）；还在的：`window` 上捕获阶段的 scroll 监听让任何元素滚动都重排全部分隔线；每次都先清空再写；每条线各读一次 `getComputedStyle` | `vue/useSashSnap.ts`、`vue/SashHandle.vue` 的 `writeDecorationGeometry`、`writeLineCore`、`readLineSize` |
| perf-09 编辑组头的尺寸观察 | 还在 | `WorkbenchSurface.vue` 的 `headObserver` 回调无条件换新对象 |
| perf-04 实时布局帧循环空转 | 还在 | `web/live-drag.ts` 的 `tick` 第一行无条件 `requestFrame` |
| perf-06 同一盒子两个尺寸观察 | 还在；推迟到 t31 | `WorkbenchSurface.vue` 的 `useLayoutExtent(rootEl)` 与 `NestedGrid.vue` 的 `measuredExtent` |
| perf-03 每帧重算结构键 | 还在 | `web/layout-drag.ts` 的 `structure`；编辑器那一半在 `plugins/editor/web/tab-drag.ts` |
| perf-05 整窗拖动没有合成层 | 还在；不做（见“不做与风险”） | `NestedGrid.vue` `[data-float-gesture="move"]` |
| perf-08 过渡结束靠定时器 | 还在 | `vue/useGridMotion.ts` 的 `MOTION_SLACK_MS` 与两处 `setTimeout(stop, …)` |
| docs-02、08、09、11 组件说明缺字段与写错 | 动手时逐条核：t28、t29 改过这几份 `.md` | |
| docs-18 写错的注释与历程注释 | 动手时逐条核 | `layout-drop.ts` 头注释等五个文件 |
| e2e 点完活动栏入口后移开指针（t25 合入后的偶发） | 还在 | `workbench-views.e2e.ts` 的 `showView` 等点入口的辅助函数 |

## 技术选型

无新依赖。性能量法沿用 `e2e/workbench-drag-cost.e2e.ts`：CDP `Performance.getMetrics` 的 `RecalcStyleCount`、`LayoutCount`，页面里包一层 `requestAnimationFrame` 数回调，按帧归一，数次数不计时。

## 关键设计

### 性能基线：`packages/neuro-book/scripts/perf/layout-frames.ts`（新）

- 照 `scripts/perf/browser-runner.ts` 的做法：Node 运行，`@playwright/test` 的 `chromium`。服务用产品服务器加种子项目（同 `workbench-drag-cost.e2e.ts`：编辑器开着一章长正文、资源管理器有足够多的文件能滚动），所以编辑组头（perf-09）与树的滚动（perf-01）都在。要量哪份构建由参数给出 checkout：脚本从那个 checkout 动态导入它的 `e2e/fixtures.ts`，用它自己的 `dist`。
- 页面设置：`emulateMedia({reducedMotion: "no-preference"})`（不然实时布局不起），轨迹、截图、录像关掉；场景开始前等 `[data-moving]` 没有、指针移开。
- 计数：样式重算、排版用 CDP 的差值；动画帧回调在 init script 里包 `requestAnimationFrame` 数，脚本自己用来等帧、数帧的回调打上标记不计入。拖动类场景每移动一步等一帧，结果按帧归一（每帧的重算、排版、回调）。
- 场景：
  1. 静止 2 秒：每秒的动画帧回调。
  2. 拖侧栏边界 60 步：每帧的样式重算、排版、回调。
  3. 资源管理器树滚动 30 次：重算、排版（perf-01 的 scroll 监听），另数分隔线装饰元素的 `style` 写入次数（`MutationObserver` 记属性变更）。
  4. 实时布局拿起视图、在一块面板上按住不动 1 秒：每秒的动画帧回调（perf-04）；断言这一场确实是实时布局（`[data-lifted]` 出现、根上有 `data-workbench-dragging`）。
  5. 实时布局拖过三块面板与活动栏、右栏入口条：每帧的重算、排版（含 t28 的入口条量取）。
  6. 窗口宽度改 20 次：每次的重算、排版与 DOM 写入（`MutationObserver` 的记录数，perf-09）。
- perf-08 的症状是过渡被提前掐断，不是次数：不在基线里，由下面的 Lab e2e 守。
- 对照：基线是 t28 实现审查的修正合入之后的 master（本分支的起点），单独建一个 detached worktree 装依赖、构建一次留着；修完的分支另一份构建；两份交替各跑 3 轮。次数和机器快慢无关，帧回调数受负载影响，负载高时多跑几轮。证据写进 `evidences/perf-baseline.txt`，命令原样写进去，并写当时的负载。
- 这个脚本不是测试，不进 `bun run test`；回归由下面每片补的计数断言守。

### nb-layout 的修复：`packages/nb-layout/src/layout-doc.ts`、`vue/useSashGesture.ts`

- api-06：`freshId(next, policy, kind)` 取新 id 并查重：面板与分支都查 `panels`、树与浮动窗（分支 id 撞浮动窗的面板 id 时校验也会拒），重了返回 `failure("rejected", …)`。`moveTabToEdge`、`openPanelAtEdge`、`floatTab`、`splitPanelInPlace` 与 `placeLeaf` 的分支都用它，现有的几处查重收进来。补 `layout-doc.test.ts`：`newId` 返回已有面板 id、已有浮动窗 id 时外缘移动被拒、文档不变。
- api-08：`editable()` 不用 `structuredClone`，改成按 JSON 形状深拷贝（对象用 `Object.keys` 加 `Object.fromEntries` 重建，键是 `__proto__` 也是自有键；数组逐项；其余原样）。操作的结果与输入共享没改过的子对象（结构共享）：输入是 Vue 的响应式代理时，结果里没改到的那部分仍是代理。这一点写进 `layout-doc.ts` 的头注释与 `grid.md`：要深拷贝结果用 JSON 拷贝，不要对它 `structuredClone`；删掉“放在 `shallowRef` 里”的告诫。补测试：`reactive` 包着的文档做结构操作照常返回、输入没被改；规模用例（2000 个标签）量一次拷贝的耗时写进注释，不设断言。“结果里不带代理”不是本 Task 的合同，归 t31 定（入口转成原对象，还是要求传原对象）。
- design-03：`attach()` 记下根元素和它的 `ownerDocument`、`defaultView`，`detach()` 摘记下的那个，不读 `options.root.value`；`watch(options.root)` 换元素时先摘旧的再挂新的；悬停计时器、`requestAnimationFrame`、`cancelAnimationFrame` 都用记下的窗口。补 `useSashGesture` 的 DOM 测试：根从 A 换成 B 后，A 上按下不起手势，B 上照常；根置空之后 `dispose()` 照样摘掉。
- design-04：把入口条叶的前缀与内层分支的后缀挪到 `layout-doc.ts`（`layout-project.ts` 从它取，免得循环导入）。`validateLayoutDoc`：条的叶要 `leaf.id === 条名`；所有节点 id（含分支）与浮动窗的面板 id 不许是条名、不许以入口条叶的前缀开头、不许以内层分支的后缀结尾（只拦这两个生成规则，前缀按字面拦，不只拦三个区域名：以后加区域不用改）。读记录时这样的文档按“不合法”回落默认树（已有路径）。补测试：这几种文档都被拒，现有夹具（默认树、Lab 场景、测试的 `docOf`）照常通过。

### nb-layout 的性能：`vue/useSashSnap.ts`、`vue/SashHandle.vue`、`vue/useGridMotion.ts`

- perf-01：`useSashSnap` 收网格的根元素，scroll 监听只认包着这个根的滚动（`event.target` 是文档或包含根）；嵌套的网格各判自己的根。`SashHandle` 按装饰元素（`WeakMap`）记下上一次写的几何与线芯变量（`--nb-sash-core-*`），值一样不写，换方向时只清掉另一方向留下的键；线芯宽度一轮读一次。回归：基线场景 3 的装饰写入次数，另在 `lab-*` 的分隔线用例里加“滚动不包着网格的元素时分隔线不重写”（数 `style` 写入）。
- perf-08：过渡结束看过渡本身。每次 `start` 领一个轮次令牌；第二次渲染（写终点矩形）之后、强制一次样式计算再收集网格根直接子元素的过渡动画；全部 `finished`（settle，不分完成与取消）且令牌还是这一轮时 `stop`；收集到空集时马上 `stop`；兜底定时器是时长的两倍加余量。环境里没有 `getAnimations`（happy-dom）时走现在的定时器路，单元测试守这条路，现有 `moving` 用例照跑。宿主读 `moving` 的地方（`WorkbenchSurface.vue` 在还原过渡里判头什么时候搬回入口条）写进 `NestedGrid.md`：`moving` 在过渡真正走完之前一直为真。回归放进 Lab 的 e2e（`lab-grid-swap` 或新的过渡场景）：渲染之后同步占住主线程超过时长，过渡照样走完、不跳到终点。

### 工作台的修复：`WorkbenchSurface.vue`、`web/live-drag.ts`、`web/layout-drag.ts`、`plugins/editor/web/tab-drag.ts`

- perf-09：`headObserver` 回调先比较，高度都没变就不赋值。
- perf-04：`tick` 结尾按“还有事”决定排不排下一帧：这一帧有新的指针样本、稳定计时还没到、卡片尺寸或追赶位移没到终点、排序的标签还要放，任一为真就排；都不是就停。`offer()` 与新的指针样本里发现没在跑就排一帧。重新开始时 `lastFrame` 对到这一帧的时间，第一帧照常缓动、不一步到位。补 `live-drag.test.ts`：静止下来后不再请求帧；新的落点或指针样本来了重新请求；停 2 秒后重启，第一次 `placeCard` 的尺寸还没到目标。`workbench-drag-cost.e2e.ts` 加：实时布局按住不动 1 秒，动画帧回调为 0（容许开始那一两帧）；之后再动一步，卡片在同一帧跟上。
- perf-03：结构键按 `options.doc()` 的对象身份记住文档那一半的串（抽成一个纯函数加单元测试）；编辑器那一半在 `tab-drag.ts` 里改成 computed（编辑组与固定标签变了才重算）。

### 文档与注释

- 组件说明逐条核 docs-02（`NestedGrid.md` 的属性、插槽、公开标记）、docs-08（`WorkbenchSurface.md`）、docs-09 与 docs-11（`WorkbenchShell.md` 的 Props、编辑器槽、“浮动窗不在这里”那句），还缺的补上、写错的改掉。
- docs-18：`layout-drop.ts` 头注释的 `data-no-drop` 改成 `data-no-drag`；五个文件里带 Task 编号、“现在还是”“原型试过”这类历程的注释改成说现在的约束，或删掉。
- Spec 的 Smoke 行（docs-13）归 t30。

### e2e 辅助函数

点活动栏入口的辅助函数点完把指针移到不触发悬停效果的地方，每个文件各选一个：产品页用状态栏的空白（标题栏有菜单悬停），Lab 的表面场景用画布外的空白。改的文件：`workbench-views`（`showView`）、`workbench-containers`、`workbench-dnd`、`lab-workbench-surface` 里点完入口接着点侧栏的地方。

## Spec 与文档改动

- 本 Task 不改 Spec 正文；design-04 收紧的校验是 `ui/workbench-layout` 输出 20“合法但不合骨架的记录回落默认树”的范围之内，perf-08 让 `moving` 跟着过渡本身，是 `ui/nested-grid` 已写的“过渡结束”的实现，t30 重写时写进条目。
- 组件说明：`NestedGrid.md`（`moving` 的判法与宿主可依赖的时机）、`WorkbenchSurface.md`、`WorkbenchShell.md`、nb-layout 的 `grid.md`（结果与输入共享子对象、删掉 `shallowRef` 的告诫）。

## 切片

1. **nb-layout 的正确性**：api-06、api-08、design-03、design-04。验证：nb-layout `bun test`、`vitest`、类型检查；neuro-book 类型检查与工作台单元测试；e2e `lab-grid-swap`、`lab-workbench-surface`、`workbench-shell`（读坏记录回落的用例）。
2. **e2e 辅助函数与文档注释**：只改测试与 `.md`、注释。验证：改到的 e2e 文件。
3. **性能基线**：脚本、基线构建、第一次测量写进证据。
4. **nb-layout 的性能**：perf-01、perf-08。验证：nb-layout 全部测试；e2e `lab-grid-swap`、`lab-workbench-surface`、`workbench-containers`（过渡与交换逐帧）、`workbench-float`、`workbench-shell`。
5. **工作台的性能**：perf-09、perf-04、perf-03。验证：工作台与编辑器单元测试、`live-drag.test.ts`；e2e `workbench-drag-cost`、`workbench-live-drag`、`workbench-dnd`、`editor-area`（编辑器标签的拖动）。
6. **复测与收口**：同一脚本交替量基线与修后，写进证据；实现审查（Sonnet）。

## 验收映射

- `ui/workbench-layout` 输出 38（实时布局：跟手的东西不走渲染、`dragCardRefresh`）→ `workbench-drag-cost.e2e.ts`（加“按住不动不请求帧”“再动一步同一帧跟上”）、`live-drag.test.ts`。
- `ui/nested-grid` 的“过渡”（`moving`、过渡结束）→ `useGridMotion.dom.test.ts`、`NestedGrid.dom.test.ts`（定时器路）、Lab 的过渡 e2e（主线程忙）、`workbench-containers` 的逐帧用例。
- `ui/workbench-layout` 输出 20 的读记录回落 → `layout-doc.test.ts`（校验）、e2e `workbench-shell`。
- 不改行为的修复（api-06、api-08、design-03、perf-03）→ 各自补的单元测试。

## 验证

- 每片跑上面列的命令；e2e 只跑覆盖改动的文件，超过 8 个写 `NB_E2E_WIDE`。
- 性能：基线与修后同一脚本交替量，报中位数；量前看 `cat /proc/loadavg`，写进证据。
- 未验证：无头浏览器固定 60Hz，“不超过 120、144Hz 屏的刷新率”只能从代码确认帧都挂在 `requestAnimationFrame` 上；重绘面积只能在真机的 Performance 录制里看。

## 不做与风险

- 不做（等 t31）：`layout-drag.ts` 拆分、删两个落点函数、入口收窄、`LayoutPolicy` 的形状（api-02）、perf-06。api-02 的现状是宿主在写入出口兜底（工作台的 `fitsSkeleton`），t28 的跨区域搬容器、“移动到”都写落点判定不会给出的目标，写入时强制 `edgeTarget` 会把它们拒掉。perf-06 省的是窗口缩放时每帧一次 Vue 渲染，要给 `NestedGrid` 加公开的事件或属性，还要先确认去掉 `decideMotion` 里“两个尺寸都比”的分支之后改窗口高度不会滑一下，这些随 t31 的接口一起定。
- 不做：perf-05（整窗拖动加 `will-change`）。手势期间 `translate` 已经不是 `none`，加 `will-change` 和第一次写 `translate` 在同一次样式变更里，没有提前升层的窗口；收益没有量到，合成层还会让文字在小数位置上发虚。记为未验证项，真机上量到收益再说。
- 风险：design-04 收紧校验，用户磁盘上若有条的叶 id 写错、或节点 id 撞了呈现生成规则的记录，会回落默认树。没有路径能产生这种记录（审查核过所有夹具与生成 id 的地方），接受。
- 风险：perf-08 改了 `moving` 的结束时机，宿主依赖它的地方（表面在还原过渡里搬头）要跟着验：`workbench-containers` 的最大化与还原逐帧用例。
- 风险：perf-04 改了帧循环的排法，漏一种“还有事”就会少一帧或停住；单元测试逐类覆盖，e2e 守“再动一步同一帧跟上”。
