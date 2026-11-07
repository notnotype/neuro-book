# t22 计划：拖动重整

## Context

开发者 2026-11-07 试用 t20 后提的四条，加一句“现在逻辑那种修修补补的垃圾代码感觉”：

1. 拖到别的面板上，它让出的位置不要马上画出卡片。现在是卡片加一圈蓝色浅边框。
2. 快速拖动时 Trellis 布局 0、样式重算 144（等于刷新率），NeuroBook 样式重算 1000 多。
3. 一拖动视图就应该缩成卡片，现在要拖出面板才缩。这个要用户可配置。
4. 标签条排序受手感设置控制；实时布局下活动栏图标、面板标签组也要实时布局。

依据：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 25、30、37、38、39，验收 22；[layout-drag](../../../../../docs/specs/ui/layout-drag.md)；[nested-grid](../../../../../docs/specs/ui/nested-grid.md)。测量见 [`evidences/frame-cost.txt`](evidences/frame-cost.txt)。

工作方式：开发者 2026-11-07 看过要点：让出的位置与卡片时机按推荐，标签条改成规则三。接着设计审查（前端，一个 Sonnet），再实施。执行位置：新 worktree，分支 `feat/w00026-t22-drag-frame`。

### 为什么觉得是补丁

测量（每帧 5.2 次样式重算，换算到 144Hz 约 750 次每秒，和开发者量到的同一量级）指向一件事：跟手的数据走了 Vue。

卡片矩形每帧换一次 `card` → `lifted` 属性穿过 Shell、Surface 到 NestedGrid → NestedGrid 重渲染 → 每块叶的插槽重跑 → 所有面板头拿到新数组 → `TabStrip` 重渲染 → `TransitionGroup` 每次量位置（`getPosition`）、克隆元素量过渡（`hasCSSTransform`）。这条链贡献每帧 3 次强制重算，还有约 0.7 次布局。`elementsFromPoint` 每帧也强制 1 次，加上帧自己那次，一共约 5 次；`elementsFromPoint` 这次是因为前面留下了脏样式，这一点是推断，切片 1 的数字会验证。

代码里已经有四处在绕这个问题：`CARD_STILL_PX`（“不换对象，渲染链才不跟着每帧重跑”）、`liftedKey`（“卡片的矩形每帧变，内容项不该跟着重算”）、`viewActionsOf`（“不读画出来的那份，拖窗时它每帧变”）、`mergeRect`（“解一次网格不便宜，不跟着指针算”）。还有三处同类的分叉：

- 几何两个来源：`frozen ?? panelGeometry(doc)` 五处。
- 标签条三套：自己的（真预览）、别人的（盖层加插入线）、活动栏（自己判定，`noPreview`）。
- 画什么散在三处：Shell 十二个 computed、`wantsCard`、`candidateDoc`。

这个计划不再绕，改掉这四件事。

## 技术选型

无。不引入库。

## 关键设计

### 规则一：跟手的东西不走渲染

一次拖动里只有两类数据：**慢的**（来源、落点、预览文档，一场几次到几十次）走响应式；**快的**（指针位置、卡片矩形、拖影位置、拖动中的窗位置）直接写元素的 `style`，不进任何 ref。

每帧顺序固定：`pointermove` 里只读（`elementsFromPoint`、纯函数判定），写放到它的末尾或 `requestAnimationFrame`。这样读的时候样式总是干净的，不强制重算。目标：**移动中每帧 1 次样式重算（帧自己那次），指针不动 0 次，卡片尺寸稳定后布局 0 次**。

`packages/nb-layout/src/vue/drag-session.ts`、`drag-gesture.ts`：

- `state` 只在来源或要显示的东西变了时发布。新选项 `displayKey(drop): string`，缺省用 `actionKey`。`point` 从 `state` 拿掉。
- 新选项 `onPointer(point)`：每次移动调一次；新方法 `pointer()`：取最新位置，不响应。
- 手势内部仍按最新一次 `resolve` 的结果提交，提交不受发布去重影响。
- 使用方改：`ExplorerTree` 的拖影用 `onPointer` 写自己的 ref，它的 `onEnd` 用 `pointer()`；Lab 的 `DragSessionScene` 同样。

`packages/nb-layout/src/vue/NestedGrid.vue`、`useContentLayer.ts`：

- `lifted` 只有 `{key}`，变化只在拿起与放下。新暴露 `moveLifted(rect)`：写拿起元素的 `transform`、`width`、`height`，同时记在一个普通变量里；`frameStyle` 读这个变量，所以别的原因重渲染时不会跳回去。
- 新暴露 `moveFloat(id, rect)`，同样的写法，写外框、内容、手柄三个元素；`null` 写回记录里的矩形。`floats` 属性不再每帧变。
- `lifted` 的内容体尺寸逻辑不变。

`packages/neuro-book/src/plugins/workbench/web/live-drag.ts`：帧循环只写 `host.writeCard(rect)`，`card` 改成只有 `{key}` 的 ref；删 `CARD_STILL_PX`（矩形没变就不写，比较留在写的一侧）。

`WorkbenchDragFeedback.vue`：拖影改 `transform`，暴露 `moveGhost(point)`，拖影的身份（图标、标题）还是属性。

`state/layout-doc-store.ts`：`previewFloat` 只留给缩放；整窗移动拆成 `beginFloatMove(panel)`（打 `data-float-gesture="move"`，一场一次）。

### 规则二：几何拿起时量一次

`web/layout-drag.ts` 新增 `DragGeometry`（面板、浮动窗、标签条快照、活动栏快照、条与标题栏的矩形、网格根原点），不分手感，拿起时量一次。失效条件只有：文档变了、容器尺寸变了（实时布局下整场取消）、标签条自己滚动了。删掉所有 `frozen ?? …` 与每次移动读 `toolBand()`、`excludedRects()`、`surface()` 的地方。

文件拖动是资源树自己的会话，没有拿起钩子：第一次判定时量，同样的失效条件。

键盘拖动的停靠点（`barStops`、`stopsOf`）读同一份。

### 规则三：标签条只有一种

开发者 2026-11-07：活动栏“本质上还是一个标签条”，只是指示的样子不同；拖到别的面板的标签条上“直接当做被当前面板吸收处理”，这个行为优先级最低，难实现可以禁用。

所以只有一条规则：**指针落在任何标签条上（自己的、别人的、活动栏），来源就被这条标签条吸收**。预览是放下的真实结果，卡片收回，只有标签（拖影）跟手，别的标签或图标滑开，留出它的位置。离开标签条重新拿起卡片。自己的标签条只是“本来就在这里”的特例，不另写。

`candidateDoc` 变成一张表：

| 落点 | 预览文档 |
|---|---|
| 放回原处 | null，用已提交的 |
| 标签条（含活动栏） | 真实结果：来源是占位；该成为活动标签的照样成为活动标签，内容是同一个实例，走现有的落地过渡进面板 |
| 四周、缝 | 真实结果 |
| 中央 | 摘掉来源，目标盖一层（开发者 t20 定的并入样子） |
| 无落点（浮动） | 摘掉来源 |

标签条和四周一样都是真实结果，比第一稿少一个 `activate: false` 的分支；工具面板的头放不下时活动标签总在外面，所以被吸收的标签不会进“更多”。

`LiveDrag` 的三条判断：

- **要不要卡片**：已显示的落点是标签条（`inPlace`，或预览摆得出来）就不要，别的情况都要。编辑器 `previewable` 为假时摆不出来，所以卡片留着，卡片头写落点文字。替换 `wantsCard` 的三个分支。
- **立即换**（`candidateOf.immediate`）：落点是自己的标签条，或已经吸收它的那条。第一次进别的标签条和别的落点一样等 150ms：路过不闪，也不会路过活动栏就把隐藏的侧栏弹出来。
- **卡片从哪拿起**：此刻显示着它的那块面板，只在拿起那一刻量一次。不再固定按已提交的来源面板。

每帧先换预览、再写卡片：从标签拿起时第一帧就判到自己的标签条，不会先冒出一帧卡片。

**活动栏**：拿起时量一份 `{band, members}`，判定走 `resolveListInsertion`（`orientation: "vertical"`），下标按 `sidebar.tabs` 换算，复用 `stripIndex`。`barDrop` 与 `sidebarEntries` 里的量取删掉。动作不变：来源本来就在侧栏是 `strip` 且 `activate: false`；从别处放进来是 `strip`；侧栏隐藏时是 `reveal`，预览同样是真实结果，等够 150ms 侧栏展开。编辑器标签、有面板最大化时还是放不进。

`LayoutDragDrop` 去掉 `noPreview` 与 `preview.indicatorFrame`，不加新字段。

`WorkbenchShell.vue` 的 `toolEntries` 改读预览文档。`WorkbenchToolStrip.vue` 新增 `placeholder`、`animateMoves`，条目包一层 `TransitionGroup`，写法同 `TabStrip`。`WorkbenchPanelHead.vue` 的 `animateMoves` 同编辑组。

删掉：盖层的插入线（`mergeLine`、`.workbench-shell__merge-line`）；并入盖层只留给中央。

落点指示手感不变：插入线加拖影，别的标签不动。活动栏的线还是竖向条目之间的那条。

**退路**（开发者说这个行为优先级最低）：实施时别的面板的标签条做不稳（编辑组内容换叶的副作用、头的高度跳），就禁用：别的面板的头算中央，走并入盖层；自己的标签条不受影响，活动栏退回插入线。这条写进 Task 记录，交付时告诉开发者。

### 规则四：画什么只在一处决定

新文件 `web/drag-presentation.ts`：纯函数 `presentDrag(input): DragPresentation`，输入是手感、来源、落点、已显示的落点、预览文档；输出是 Shell 要的全部东西（占位的标签、拿起的键、空位面板、并入目标、分区、拖影身份、反馈、读屏文字）。Shell 的十二个 computed 换成一个；有单元测试，不用 DOM。

### 四条的具体行为

**让出的位置（第 1 条）**：空位什么都不画，露出窗体底。`WorkbenchSurface` 的 `headlessPanel` 改名 `slotPanel`，那块卡片写 `data-shell-slot`：背景透明、无投影。`--layout-slot-border`、`--layout-slot-fill` 缺省都是透明，主题想要可以给；`.workbench-shell__slot` 这个元素留着。放下时内容从卡片飞过去，头和底这时才有。

**缩成卡片（第 3 条）**：新设置 `nbook.workbench/dragCardShrink`：

- `strip`（缺省）：离开标签条就缩到 380×260。头只写标题的面板没有标签条，一拖动就缩。
- `panel`：今天的行为，离开来源面板才缩。

只影响实时布局。放在外观分组，排在手感后面（order 42）。

**标签条（第 4 条）**：见规则三。落点指示手感：只有插入线，这条已经成立，补一条用例盯住。

### 整窗移动

同规则一：`windowRect` 用冻结的原点，`moveFloat` 直接写。放下 `setFloatRect` 写一次；取消写回记录里的矩形。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`：输出 38 的“预览”“卡片”“自己的标签条里”（改成“标签条上”，含活动栏与别的面板）、“空位”“并入”（只留中央）“活动栏”几条；输出 22、30；验收 22；新设置；新增一条帧开销的行为（移动中每帧至多 1 次样式重算，指针不动 0 次）。
- `docs/specs/ui/layout-drag.md`：`state` 的发布时机、`displayKey`、`onPointer`、`pointer()`。
- `docs/specs/ui/nested-grid.md`：`lifted`、`moveLifted`、`moveFloat`。
- 同名 `.md`：`NestedGrid`、`WorkbenchToolStrip`、`WorkbenchDragFeedback`。
- 令牌说明：`--layout-slot-*` 缺省透明。
- `docs/specs/workbench/files-explorer.md`：只有拖影实现变了，行为不变，不用改。

## 切片

每片单独提交，只跑列出的文件。

1. **每帧开销（第 2 条）**：先写 `workbench-drag-cost.e2e.ts`（见验收映射），看它按今天的代码失败；再做规则一的标签拖动部分。对比 `scripts/diag-drag-frame.mjs` 的前后数字。验证：`nb-layout` 的 `drag-gesture`、`drag-session`、`NestedGrid` 测试；`workbench-live-drag`、`workbench-dnd`、`files-explorer`、`workbench-drag-cost`。
2. **整窗移动**：规则一的窗部分。验证：`workbench-float`、`workbench-drag-cost`。
3. **几何只量一次**：规则二。验证：`layout-drop` 测试；`workbench-dnd`、`workbench-live-drag`、`workbench-float`、`files-explorer`。
4. **呈现收口、空位、卡片设置（第 1、3 条）**：规则四。验证：`drag-presentation.test.ts`；`workbench-live-drag`、`editor-area`、`locales.test.ts`、`default-tree.test.ts`。
5. **标签条（第 4 条）**：规则三。验证：`TabStrip` 测试；`workbench-live-drag`、`workbench-dnd`、`workbench-views`、`editor-area`、`lab-scenes`。

每片跑完 `scripts/diag-drag-frame.mjs` 一次（有性能预算的热路径）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 第 2 条：移动中每帧至多 1 次样式重算，不动 0 次 | 新 `workbench-drag-cost.e2e.ts`，CDP `RecalcStyleCount`、`LayoutCount` 除以 rAF 次数，不计时：拖视图、拖编辑器标签、拖窗、落点指示各一条，开着长章节，容差写在用例里 |
| 第 1 条：空位不画卡片 | `workbench-live-drag`：读计算样式，透明；没有头 |
| 第 3 条：缩放时机与设置 | `workbench-live-drag`：两个设置值各量卡片尺寸 |
| 第 4 条：标签条实时 | `workbench-live-drag`：别人的标签条、活动栏上卡片收回、别的标签滑开、结果是放下的样子、零写入；离开后卡片回来、目标恢复；路过不足 150ms 不变；隐藏的侧栏等够才展开。`workbench-dnd`：落点指示手感只有插入线 |
| 验收 22 其余 | 现有用例改写，不放宽 |

## 验证

端到端：`workbench-*`、`editor-area`、`files-explorer`、`lab-scenes` 里上面列出的文件；`test:affected --since master --typecheck`。开发服务上开发者手试。

未验证边界：真实 144Hz 与 GPU 的数字（无头环境只有 60Hz），以开发者在 DevTools 的实测为准。

## 不做与风险

- 不做：把 `TransitionGroup` 换掉。它只在标签真的变化时才量，那时量是应该的。
- 不做：去掉 `:root[data-workbench-dragging] *` 这条全局规则。它只在拿起、放下、进出被拒绝时触发，不是每帧。
- 风险：被吸收时内容换叶，编辑组的内容组件拿到新的 `panelId`。预览不写组模型，但内容组件有没有副作用要看，`editor-area` 盯；不稳就走规则三的退路。
- 风险：判定用拿起时的矩形（输出 38 已有的约定）。来源是那块面板唯一的标签时，吸收后邻居会动，这时画面和判定差一点。这次不改，开发者手试时留意。
- 风险：活动栏跟预览之后，判定靠快照。`measureBand` 与“更多”的分档会跟着预览变，快照不变，判定稳；视觉上可能多出或少一个“更多”按钮。用 `workbench-live-drag` 的用例看。
- 风险：`state` 不再带 `point` 是 `nb-layout` 的公开接口变化。使用方只有仓库内三处（工作台、资源树、Lab），一起改。
- 风险：直接写 `style` 和 Vue 的 `:style` 抢同一个元素。靠 `frameStyle` 读同一个变量；`useGridMotion` 落地时要从直接写的值开始过渡，切片 1 用现有落地用例盯。
