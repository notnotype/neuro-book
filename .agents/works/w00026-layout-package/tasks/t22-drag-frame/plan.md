# t22 计划：拖动重整

## Context

开发者 2026-11-07 试用 t20 后提的四条，加一句“现在逻辑那种修修补补的垃圾代码感觉”：

1. 拖到别的面板上，它让出的位置不要马上画出卡片。现在是卡片加一圈蓝色浅边框。
2. 快速拖动时 Trellis 布局 0、样式重算 144（等于刷新率），NeuroBook 样式重算 1000 多。
3. 一拖动视图就应该缩成卡片，现在要拖出面板才缩。这个要用户可配置。
4. 标签条排序受手感设置控制；实时布局下活动栏图标、面板标签组也要实时布局。

依据：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 22、30、37、38、39，验收 22；[layout-drag](../../../../../docs/specs/ui/layout-drag.md)；[nested-grid](../../../../../docs/specs/ui/nested-grid.md)。测量见 [`evidences/frame-cost.txt`](evidences/frame-cost.txt)，设计审查见 [`evidences/plan-review.txt`](evidences/plan-review.txt)。

工作方式：开发者 2026-11-07 看过要点：让出的位置与卡片时机按推荐，标签条改成规则三。设计审查处理完就实施。执行位置：`.worktree/w00026-t22-drag-frame`，分支 `feat/w00026-t22-drag-frame`。

### 为什么觉得是补丁

测量（每帧 5.2 次样式重算，换算到 144Hz 约 750 次每秒，和开发者量到的同一量级）指向一件事：跟手的数据走了 Vue。

卡片矩形每帧换一次 `card` → `lifted` 属性穿过 Shell、Surface 到 NestedGrid → NestedGrid 重渲染 → 每块叶的插槽重跑 → 所有面板头拿到新数组 → `TabStrip` 重渲染 → `TransitionGroup` 每次量位置（`getPosition`）、克隆元素量过渡（`hasCSSTransform`）。这条链贡献每帧 3 次强制重算，还有约 0.7 次布局。

另一次强制重算来自顺序：`LiveDrag` 的 `tick` 在上一帧排好 rAF，手势的 `publish` 在本帧 `pointermove` 才排，所以每帧都是 `tick` 先写、`publish` 里的 `elementsFromPoint` 后读。

代码里已经有几处在绕这个问题：`liftedKey`、`liftedHome`（“卡片的矩形每帧变，内容项不该跟着重算”）、`viewActionsOf` 的注释（“拖窗时它每帧变”）、`mergeRect` 的注释（“不跟着指针算”）。还有两处同类的分叉：

- 几何两个来源：`frozen ?? panelGeometry(doc)` 散在五处。
- 标签条三套：自己的（真预览）、别人的（盖层加插入线）、活动栏（自己判定，`noPreview`）。

## 技术选型

无。不引入库。

## 关键设计

### 规则一：跟手的东西不走渲染

只有两类数据：**慢的**（来源、落点、预览文档，一场几次到几十次）走响应式；**快的**（卡片矩形、拖影位置、拖动中的窗位置）直接写元素的 `style`。

**一帧只有一个入口，先读后写。** 目标：候选不变、预览过渡与卡片缩放结束之后，移动中每帧 1 次样式重算（帧自己那次），指针不动 0 次，布局 0 次。预览过渡（`--motion-layout`）和卡片缩放期间本来就每帧重算，不算在内。

`packages/nb-layout/src/drag-gesture.ts`、`vue/drag-session.ts`：

- 发布不改：`state` 还是每帧发布，还带 `point`，资源树、Lab 不用动。使用方自己只取需要的字段。
- 新方法 `flush()`：有排着的发布就马上做。`LiveDrag` 的 `tick` 第一步调它，这一帧的判定（读）一定先于写。
- `activate(source, keyboard, at)` 加第三个参数 `{pressed, point} | null`（键盘是 null）。工作台的两个常驻窗口监听 `onPointerSeen` 就可以删掉。

`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue`：`dragState` 换成两个 computed，`dragSource`、`dragDrop`，模板与其它 computed 只读它们。Vue 的 computed 值没变就不触发下游。

`layout-drag.ts` 的 `resolve`：这一次的落点和上一次序列化相同就返回上一次的对象，身份稳定。提交用的是 `drop()` 里新判的结果，序列化相同所以内容相同。

`vue/NestedGrid.vue`、`useContentLayer.ts`：

- `lifted` 只有 `{key}`，变化只在拿起与放下。
- 暴露 `placeLifted(rect)`：记在普通变量里，并写拿起元素（`:scope > [data-lifted]`）的 `transform`、`width`、`height`。`frameStyle` 读这个变量：Vue 的 `patchStyle` 无条件写 next 的每个键，所以别的原因重渲染时写回的就是最新值，不跳；刚拿起时元素还没 `data-lifted`，写不到，渲染时从变量取。
- 暴露 `placeFloat(id, offset | null)`：给这块窗的外框、全部内容元素、手柄（都是 `:scope >` 的子元素）写 CSS `translate` 属性。Vue 不碰这个属性，不用抢；`transform` 还是记录里的矩形。放下时 Vue 写新矩形、同一拍清 `translate`。

`web/live-drag.ts`：`tick` 变成 `session.flush()` → 换预览 → 写卡片。`card` 改成 `lifted`，只有 `{key}`。指针从 `state` 取，删 `trackPointer`。`CARD_STILL_PX` 留着，意思变成“差这么多就到目标”，缩放才会结束。

`components/WorkbenchDragFeedback.vue`：拖影用 `transform`，暴露 `moveGhost(point)`；Shell 用 `flush: "sync"` 的 `watch` 接 `state.point`。元素 `v-if` 出来时 `:ref` 回调写最新位置。

**整窗移动**：`state/layout-doc-store.ts` 不改。`previewFloat(panel, rect, "move")` 只在拿起时调一次（打 `data-float-gesture`），之后每帧 `placeFloat`。`floats` 属性整场不变。

### 规则二：几何只有一个入口

`layout-drag.ts` 新增 `geometry(doc)`，返回面板、浮动窗、条与标题栏的矩形、活动栏矩形、网格根原点：实时布局拿起时量一次，落点指示每次量。五处 `frozen ?? …` 与 `toolBand()`、`excludedRects()`、`surface()` 的现读都走它。

落点指示的行为不变（输出 25、32）：它这一帧没有写在读之前，读是干净的，不多算样式。拿起时“先判一次、渲染后重量”的两步保留：`settleMotion` 要等渲染才落到 DOM。文件拖动也是每次量，不用新的失效规则。

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

工具面板的头放不下时活动标签总在外面，所以被吸收的标签不会进“更多”。

`LiveDrag` 的三条判断：

- **要不要卡片**：已显示的落点动作是标签条，并且放回原处或预览摆得出来，就不要；别的情况都要。编辑器 `previewable` 为假时摆不出来，所以卡片留着，卡片头写落点文字。替换 `wantsCard` 的三个分支。
- **立即换**（`candidateOf.immediate`）：落点是自己的标签条，或已经吸收它的那条。第一次进别的标签条和别的落点一样等 150ms：路过不闪，也不会路过活动栏就把隐藏的侧栏弹出来。
- **卡片从哪拿起**：显示着它的那块面板在拿起时的矩形（`geometry`），不读 DOM，所以过渡中间重新拿起也不会读到中间值。那块面板拿起时是隐藏的（量不到）就从紧凑尺寸开始。

**活动栏**：实时布局拿起时量一份 `{band, members}`，判定走 `resolveListInsertion`（`orientation: "vertical"`），下标按 `sidebar.tabs` 换算，复用 `stripIndex`；落点指示每次量。`barDrop` 删掉。动作不变：来源本来就在侧栏是 `strip` 且 `activate: false`；从别处放进来是 `strip`；侧栏隐藏时是 `reveal`，预览同样是真实结果，等够 150ms 侧栏展开。编辑器标签、有面板最大化时还是放不进。

`LayoutDragDrop` 去掉 `noPreview` 与 `preview.indicatorFrame`，不加新字段。

`WorkbenchShell.vue` 的 `toolEntries` 改读预览文档。`WorkbenchToolStrip.vue` 新增 `placeholder`、`animateMoves`：条目外面包一层普通 `div`（`Tooltip` 的根是 Fragment，`TransitionGroup` 记不到它，审查已实测），`TransitionGroup` 用 `display: contents` 的容器，“更多”按钮留在外面，`data-tool-entry` 还在 `IconButton` 上。`WorkbenchPanelHead.vue` 的 `animateMoves` 同编辑组。

落点指示手感不变：插入线加拖影，别的标签不动。活动栏的线还是竖向条目之间的那条。

**退路**（开发者说这个行为优先级最低）：实施时别的面板的标签条做不稳（编辑组内容换叶的副作用、头的高度跳），就禁用：别的面板的头算中央，走并入盖层；自己的标签条不受影响，活动栏退回插入线。这条写进 Task 记录，交付时告诉开发者。

### 规则四：画什么收在一处

新文件 `web/drag-presentation.ts`：纯函数 `presentDrag(input)`，输入是手感、来源、落点、`LiveDrag` 的状态（已吸收、拿起的键、已显示的动作）、预览文档；输出占位的标签、拖影要不要、空位面板、并入目标、分区归谁画、反馈种类。Shell 的 `stripDragging`、`slotPanel`、`mergeTarget`、`dropFeedback` 等换成一个 computed，文字和坐标样式留在 Shell。单元测试不用 DOM。

要不要卡片、什么时候换预览还是 `LiveDrag` 的状态机决定，`presentDrag` 只把状态翻译成画什么。

### 四条的具体行为

**让出的位置（第 1 条）**：空位什么都不画，露出窗体底。`WorkbenchSurface` 的 `headlessPanel` 改名 `slotPanel`，那块卡片写 `data-shell-slot`：背景透明、无投影。`--layout-slot-border`、`--layout-slot-fill` 缺省都是透明，主题想要可以给；`.workbench-shell__slot` 这个元素留着。放下时内容从卡片飞过去，头和底这时才有。

**缩成卡片（第 3 条）**：新设置 `nbook.workbench/dragCardShrink`，只影响实时布局，放在外观分组，排在手感后面（order 42）：

| 设置值 | 指针在来源面板里 | 别的地方 |
|---|---|---|
| `strip`（缺省） | 紧凑 | 紧凑 |
| `panel` | 面板原大小 | 紧凑 |

紧凑是 380×260（不大于原大小）。“来源面板”是这一场拿起时它所在的面板，吸收之后不变。还在标签条上时没有卡片，是排序；头只写标题的面板没有标签条，所以一拖就是卡片。

**标签条（第 4 条）**：见规则三。落点指示手感只有插入线，这条已经成立，补一条用例盯住。

## 删除清单

- `drag-session` 不动的前提下，`layout-drag.ts`：`lastPointer`、`pressedAt`、`onPointerSeen` 与两个常驻窗口监听；`barDrop`、`barStops` 的现读；`frozen` 与 `frozen ?? …`；`noPreview`；`indicatorFrame`。
- `live-drag.ts`：`trackPointer`；`wantsCard` 的分支；`candidateDoc` 里 `merges` 的特判。
- `WorkbenchSurface.vue`：`liftedKey`、`liftedHome`。
- `WorkbenchShell.vue`：`mergeLine`、`.workbench-shell__merge-line`、`liveSectors` 里现读 DOM 的原点、`dragState` 的直接读取。
- 注释：`viewActionsOf`、`mergeRect` 里已经不成立的说明。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`：输出 38 的“预览”（活动栏跟预览）、“卡片”“自己的标签条里”（改成“标签条上”，含活动栏与别的面板）、“空位”“并入”（只留中央）、“活动栏”几条；输出 22、30；验收 22 第三句（并入只说中央，别人的标签条是吸收：目标显示来源）；新设置；新增帧开销的行为：候选不变、预览过渡与卡片缩放结束之后，移动中每帧至多 1 次样式重算，指针不动 0 次。
- `docs/specs/ui/layout-drag.md`：`flush()`、`activate` 的第三个参数。
- `docs/specs/ui/nested-grid.md`：`lifted`、`placeLifted`、`placeFloat`。
- 同名 `.md`：`NestedGrid`、`WorkbenchToolStrip`、`WorkbenchDragFeedback`。
- 令牌说明：`--layout-slot-*` 缺省透明。

## 切片

每片单独提交，只跑列出的文件。每片跑一次 `scripts/diag-drag-frame.mjs` 的同款测量（有性能预算的热路径）。

1. **每帧开销（第 2 条）**：先写 `workbench-drag-cost.e2e.ts`，看它按今天的代码失败；再做规则一的标签拖动部分。验证：`drag-gesture`、`drag-session`、`NestedGrid` 单元测试；`workbench-live-drag`、`workbench-dnd`、`files-explorer`、`workbench-drag-cost`。
2. **整窗移动**：规则一的窗部分。验证：`workbench-float`、`workbench-drag-cost`。
3. **几何一个入口**：规则二。验证：`workbench-dnd`、`workbench-live-drag`、`workbench-float`、`files-explorer`。
4. **呈现收口、空位、卡片设置（第 1、3 条）**：规则四。验证：`drag-presentation.test.ts`、`locales.test.ts`、`default-tree.test.ts`；`workbench-live-drag`、`editor-area`。
5. **标签条（第 4 条）**：规则三。验证：`workbench-live-drag`、`workbench-dnd`、`workbench-views`、`editor-area`、`lab-scenes`。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 第 2 条 | 新 `workbench-drag-cost.e2e.ts`，CDP `RecalcStyleCount`、`LayoutCount` 除以 rAF 次数，不计时。按阶段：候选稳定、`data-moving` 没了之后连续移动，每帧至多 1 次（容差 0.3），布局 0；指针不动 0 次。拖视图、拖编辑器标签、拖窗、落点指示各一条，开着长章节 |
| `flush()` 先于写 | `drag-gesture.test.ts`：有排着的发布时马上发布一次，那一帧不再发布第二次 |
| 重渲染不跳 | `NestedGrid.dom.test.ts`：`placeLifted` 之后无关的重渲染，`transform` 还是最新值；`placeFloat` 写全三类元素，`null` 清掉 |
| 第 1 条 | `workbench-live-drag`：读计算样式，透明；没有头 |
| 第 3 条 | `workbench-live-drag`：两个设置值在来源面板内外各量卡片尺寸，含吸收后离开 |
| 第 4 条 | `workbench-live-drag`：别人的标签条、活动栏上卡片收回、别的标签滑开（真实浏览器量位置变化）、结果是放下的样子、零写入；离开后卡片回来、目标恢复；路过不足 150ms 不变；隐藏的侧栏等够才展开；条目被预览移除时捕获不丢。`workbench-dnd`：落点指示只有插入线 |
| 呈现翻译 | `drag-presentation.test.ts` |
| 验收 22 其余 | 现有用例改写，不放宽 |

## 验证

端到端：上面列出的文件；`test:affected --since master --typecheck`。开发服务上开发者手试。

未验证边界：真实 144Hz 与 GPU 的数字（无头环境只有 60Hz）。判据用“每帧”，每秒次数等于每帧次数乘刷新率；最终以开发者在 DevTools 的实测为准。

## 待确认项

无。开发者已答的写在 Context；吸收时目标显示来源的内容，是“放下的样子”的直接结果，交付时点明。

## 不做与风险

- 不做：把 `TransitionGroup` 换掉。它只在标签真的变化时才量，那时量是应该的。
- 不做：去掉 `:root[data-workbench-dragging] *` 这条全局规则。它只在拿起、放下、进出被拒绝时触发，不是每帧。
- 不做：面板级判定改用预览文档的矩形（Trellis 的做法，审查第 14 条）。这是另一个行为取舍，交付时告诉开发者，要做再开。来源是那块面板唯一的标签时，吸收后邻居会动，这时画面和判定差一点。
- 风险：被吸收时内容换叶。`EditorGroup` 的 `ownGroup` 按模型取组，注释写明预览时 `groupId` 是预览的组，审查核对过；`editor-area` 盯，不稳就走规则三的退路。
- 风险：目标标签条横向溢出时，吸收会让它自己滚动（`TabStrip.reveal`），判定用拿起时的位置，差一点。不重量，不会来回换预览；开发者手试时留意。
- 风险：活动栏这一列有多个面板时，插到 `sidebar` 最后的占位会出现在别的面板的条目上面，和指针位置差几格。放下的结果是对的，罕见，不特殊处理。
