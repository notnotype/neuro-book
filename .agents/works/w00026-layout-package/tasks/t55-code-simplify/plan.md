# t55 计划：w00026 代码的深度理顺与简化

## Context

开发者要求 t49 做完后用 `/simplify` 把这个 Work 留下的无用逻辑理顺、简化，顺便审查。五份只读调研（Claude Sonnet，按模块）在 `evidences/survey-{core,vue,wbl,app,hosts}.txt`，下文用“core 3”“vue 14”这样的编号引用其中的候选。

调研的共同结论：真正没有调用方的代码不多，生产代码合计约 300 到 400 行可删或可合并；更大的收益是同一规则写了几份（矩形判点、分隔线键、“能否浮出”）、热路径上的重复量取（标签条、判定几何、每次判定的 `elementsFromPoint`）和 `NestedGrid.vue` 730 行脚本按层拆开。

约束（README 已定）：行为合同不变，Spec 不改；公开面（`packages/nb-layout/api/*.api.txt`、插件 SDK 转出的名字）冻结，候选单列在“公开面”一节交开发者；持久化格式不动。

分拣口径：
- 收：删没有调用方的代码；同一规则多份改成一份；有量级差的热路径重复；带副作用或靠“恰好只读一次”撑着的结构。
- 不收：没测量的求解器性能改写（core 5 约束记忆、core 15、vue 11 到 13）；为省十几行要改大量测试夹具的（wbl 11）；会改 1 像素边界行为的统一（hosts 4 宿主那两份）；视觉靠 e2e 才验得出、收益只有省行数的 CSS 合并（vue 8、hosts 8 的样式部分）；改英文提示文案的（core 14）；合并会改行为的（wbl 7、vue 15 的合并）。

## 关键设计

### `packages/nb-layout/src/`（非 Vue）—— 切片 S1

- 删没有引用的 `normConstraint`、`branchSashSizes`；`collapsePolicyProblem` 连同它的 4 处测试删掉；`sashCollapsePolicy` 与 `SASH_COLLAPSE_THRESHOLD` 挪成 `sash-drag.test.ts` 的本地辅助（core 1）。只在本模块内用的 `projectGridGesture`、`sashDistance`、`LIVE_SETTLE_MS`、`LIVE_STICKY_PX`、`GRID_EDGE_RATIO_DEFAULT` 去掉 `export`（先 `rg -w` 确认包外与测试里没有引用）。
- 树工具：`candidateFind` 换成 `find(id, candidate)`；`grid.ts` 的 `cloneNode` 与 `grid-gesture.ts` 的 `cloneTree` 合成一份，`findBranch` 改用同一个查找（core 2）。
- `moveLeaf` 直接在活树上改，删 `nextTree`、`originalTree` 与两处注释自认不可达的回滚（core 3）；同时补上 `addLeaf`、`splitLeaf` 已有的深度与节点数守卫（core 顺便发现 1），用例补在 `grid.test.ts` 的 moveLeaf 组里（移进空分支、树已到 `GRID_MAX_DEPTH` 时返回 `limit-exceeded`，树不变）。
- 九个结构方法的“找不到节点”前置检查收成一个局部 `need(id, {kind?, parent?})`，失败码、`params` 与三种英文 `message` 不变（core 4）。
- `sash-drag.ts` 把收起、展开的判据提成 `wantsCollapse(index)`、`wantsExpand(index)`，两条诊断各有一个构造函数，pass 与诊断阶段共用（core 6）；循环变量 `round` 改名，免得遮住导入（core 顺便发现 3）。
- 矩形：`grid-rects.ts` 提供包内的 `unionRects`、`rectsIntersect`、带类型谓词的 `hasSize`，替换 `grid-rects`、`grid-swap`、`grid-motion` 里的拷贝（core 7）。`grid-drop.ts` 的 `containsPoint(rect, point, margin = 0)` 供 `live-drop`、`sash-hit-area` 用；`live-drag.ts` 的 `inside` 是右、下不含边界的半开区间，保留（core 8）。`SashPoint`、`SashRect`、`DragEdgeRect` 改成 `GridDropPoint`、`GridDropRect` 的别名或直接引用；公开类型名不删（它们在 api 报告里时只改定义，不改名字）。
- `sashKey(branchId, index)` 是分隔条键的唯一出处，`grid-rects.ts` 的两处手写改调它（core 9；`src/vue/` 的四处在 S3 改）。
- 脚本：`api-components.ts` 直接导入 `byCodeUnit`；`pack.ts` 与 `api-report.ts` 的入口清单抽到 `scripts/entries.ts`，删掉运行期的对账（core 12）。
- 零碎（core 13）：`collapsedSizeOf`；`allocateSashPanels` 并进 `allocatePanels`；`grid-gesture.ts` 的重复 filter；`splitter-session.ts` 的 `delta` 改局部变量；`round` 与 `metric` 合一，放在 `grid-issue.ts`；`dev-checks.ts` 改调 `axisOf`；`live-drag.ts` 一帧里同一状态的两次 `followAt` 合成一次。
- `planBranchResize` 的注释改成与实现一致（core 顺便发现 2）。

### `packages/nb-layout/src/` 的两个手势会话 —— 切片 S2（S1 合入后）

- 抽出“单分支手势核心”（新文件 `branch-gesture.ts`，包内）：持有一支的面板配置、基线、尺寸、收起、主动与补偿、`snapState`，暴露 `drag`、`jump`、`collapseOn`、`reset`、`change`。`grid-gesture.ts` 每支持有一个，`splitter-session.ts` 持有一个（core 10）。
- 两边“折叠没有变化”时 `issues` 的处理现在不同（core 顺便发现 4）：统一成 Grid 会话的做法（没有真实变化时不写 `issues`，诊断由求解后统一写入）。先在 `splitter.dom.test.ts` 写出这条的现状断言，看清 Splitter 的可观察结果（`issues` 事件的内容）会不会变；会变就停下报告，不合并这一处。
- `resizeBranches` 规划通过后直接 `tree = candidate`，删 `applyBranchResize` 与逐项写回（core 11）。前提：`useGridHost`、`useGridLayout` 不跨调用持有 `root()` 的节点引用，也不靠引用相等判断变化；编码者先 grep 核对，写进交付报告。
- `projectGridGesture` 在 `children.length !== sizesPx.length` 时的静默 `continue` 保留（理论上不出现，没有诊断出口），不在本 Task 内加机制。

### `packages/nb-layout/src/vue/` —— 切片 S3（S1 合入后）

- 删多余的卸载收尾：`Splitter.vue` 的整条 `onBeforeUnmount`，`NestedGrid.vue` 的 `scope.dispose()`；`SashGestureScope.dispose` 只剩测试在用时从类型去掉，测试改用卸载（vue 1）。“先收尾手势再通知”的先后由 `useSashGesture` 的注册顺序保证，在那里写一句注释。
- `DropFeedbackOverlay.vue` 删 `announcedText`，模板用 `labelText`（vue 2）。
- 删 `useSashScope`、`sash-feedback.ts` 的类型转出、未用的导入，只在文件内用的去掉 `export`（vue 3）。试开 `tsconfig.vue.json` 的 `noUnusedLocals`：报错都在本目录且能直接删时开着，否则不开，交付报告写明。
- `useGridMotion.ts` 的三段重复提成 `armTimer`、`flushGrowingStart`、`motionDuration`（vue 4）。
- `hasSize` 用 S1 的那一份（vue 5）；四处手写的分隔条键改调 `sashKey`，`sash-feedback.ts` 的 `sashHitKey` 也调它（vue 6）。
- `useSashGesture.ts` 的小重复（`setKeys`、两次 `map`、两次 `keyboardStep`），`settle` 那条五个条件的三元改写成一个具名的小函数（vue 7、vue 顺便发现）。
- `NestedGrid.vue` 按层拆（vue 14、9、10）。每段一个提交，按这个顺序，只搬不改时序（`flush: "sync"`、computed 里同步算的那些原样保留）：
  1. 拿起项的留住（`previousContents`、`heldLifted`、`layerContents`）并进 `useContentLayer`：它本来就收 `lifted` 与 `liftedRect`。留住由 `useContentLayer` 在算 `placements` 时维护，组件里不再有读的时候写闭包变量的 computed。
  2. 分隔线的呈现搬进 `useSashPresentation`：`sashLookOf` 每条线每次渲染只算一次（宿主的 `sashKind`、`sashStyle`、`paneLabel` 各问一次），渲染函数里不再写 `sashLooks`；“离开的线沿用离开前最后一次的值”保留；`sashProps` 只为那一个孩子建面板配置。
  3. 开发模式检查（`warnDev`、`describe`、`isCommitResult`）搬进 `dev-checks.ts`。
  4. 交换（`swapSide` 到 `takeSwap`）搬成 `useGridSwap`。
  手势宿主那 165 行（`host.begin`、`onCommit`、预览的收放）不搬：它和组件的 props、emit、expose 交织最深，搬出去要传的参数比省下的阅读量多。
- `drag-session.ts` 给宿主的 `DragQuery.top` 改成按需取的 getter，第一次读时才 `topElementAt`，同一次判定里缓存（hosts 1）。不读 `top` 的宿主（nb-story 换边、Lab 卡片互拖）每次判定省一次整页命中测试。`useDragSession.dom.test.ts` 或 `drag-session.dom.test.ts` 补一条：`resolve` 不读 `top` 时页面没有被命中测试（用真实的 `document.elementsFromPoint` 包一层计数，测试结束还原；这是在测外部可观察的开销，不是替身）。
- `useLiveDragSession.ts` 的 `IDLE` 改用 `live-drag.ts` 导出的 `IDLE_STATE`（hosts 6）。
- `live-drag-session.ts` 头注释与 `live-drag-session.md` 补一句：宿主的 `activate` 先于 `settleMotion`，那时量到的矩形可能是过渡中间的（hosts 顺便发现 1）。
- `Splitter.vue` 的 `sashSizes` 里的 `console.warn` 改用 `layoutDevWarning`，每种只报一次。

### `packages/nb-workbench-layout/` —— 切片 S4

- 标签条只量一次：`measureTabStrip` 只走一遍 `rowsOf`，`all` 由各行原始成员拼出（wbl 5）；新增 `tabStripStopInsertions(strip)`，一次快照算出全部停靠点与对应的插入位置（wbl 1）。`resolveTabStripInsertion` 留给 Lab。`tab-strip-geometry.dom.test.ts` 补一条“停靠点的插入位置与逐点 `resolveTabStripInsertion` 相同”。
- `previewEdgeDrop` 的后半段改调 `previewPanelRects`（wbl 4 前半）；“收已算好的结果文档”那半不做（要改应用两处调用，候选有缓存，收益小）。
- 四向边的可用性抽成 `edgeTargetsOf`，`nearestEdge`、`layoutDropSectors`、`enumerateDropCandidates` 共用（wbl 6）。
- 小重复（wbl 8）：`axisOf` 只留 `layout-doc.ts` 一份；`intent-writeback.ts` 改调 `holdsEditor`；`isBarInput` 并进 `isBarLeaf`；`normalizeDoc`；去重键改用 `layoutDropKey`；夹具的 `sizeOf` 改调 `findTreeNode`。新增导出 `rectContains`（半开区间）给应用用，`layout-drop.ts` 自己的 `contains` 换成它。
- `presentationCollapse` 把上一轮的投影带到下一轮（wbl 9）；`layoutDropPanelAt` 只在需要时算 `sourceTabs`，`findTab` 改 `for…in`（wbl 10）。
- `index.ts` 从 `export *` 改成显式清单（wbl 12）：外部用到的名字照旧导出，调研列出的外部为零的那批不导出；`entry.test.ts` 改成对清单断言。本包是私有包，不在冻结面内，这一条记进待确认清单。`layout-doc.ts` 的校验段拆成 `layout-doc-validate.ts`。
- 删 `showPanelAndInsert`、`rebaseOriginal`、`splitIntoSections`（开发者定，见“公开面与待定”第 6 条）。

### `packages/neuro-book/src/plugins/workbench/web/` —— 切片 S5（S4 合入后）

- 一次判定只量一次几何（app 1）：`stripDrop`、`previewOf`、`floatDrop` 收调用方已经量到的 `DragGeometry`，不再各自 `geometry()`。`fileDrop` 同样传下去。
- 键盘的 `stripStopsOf` 改用 `tabStripStopInsertions`（app 6）。
- “能否浮出、是否已独占一个窗”提成 `state/layout-present.ts` 的一个谓词，`layout-drag.ts`、`WorkbenchShell.vue` 两处、`panel-commands.ts` 共用；不可用原因的文案仍由调用方给（app 2）。
- `emptyRegionContainer` 改调导出的 `soleContainerOf`（app 3）；Shell 的入口映射提成 `entryOf`（app 4）；落点键 `dropKeyOf(action, part)` 放进 `entry-drop.ts`，三处共用（app 5）。
- 删没有读者的：`state.renderedFloats`；`BAR_STRIP` 去掉 `export`；`layoutEdgeTarget`、`layoutSeamAccepts` 的 `_tabs` 参数（库的回调签名不变，应用的函数少声明一个参数即可）；`#lifted-head` 里没用的解构与 Surface 的透传（app 7）。`issues` 事件不删，见“公开面与待定”。
- `keepVisible`、`wholeInTree` 挪到 `state/layout-constraints.ts`，store 与 `drag-geometry.ts` 都引它（app 8）。
- 视图标签键只经 `viewKey`、`viewIdOf`（app 9 内部部分）；`drag-geometry.ts` 的 `contains` 改用 `rectContains`。
- 零碎（app 10、11）与四处错位的注释（app 顺便发现 2）。
- `idleRun(judged)` 不动（app 12）。

### 宿主 —— 切片 S6

- `NestedGridAcceptanceFixture.vue`：`syncRawRecordIntent` 收成 `copySizes`；手势记录与恢复记录各放进一个 `shallowRef` 对象，由常量重置，模板上的 `data-lab-*` 名字不变；`JSON.parse(JSON.stringify(x))` 换 `structuredClone`；两处字面量版本 `2` 改用 `GRID_SNAPSHOT_VERSION`（hosts 2、hosts 顺便发现 2）。
- `GridStructureScene`、`GridPanelsScene` 的 F6 处理与实例计数器各提一份小函数（hosts 8 的脚本部分；样式不合并）。
- `LivePanelsScene.vue`：删 `extentNow` 与 e2e 不读的 `data-live-body`（先 grep 全部 e2e 与测试）；`widen`、`reset` 合成 `setColumns`（hosts 7）。它是给 npm 用户看的完整例子，只用公开入口这一点不变。
- nb-story：换边拖动搬成同目录的 `detail-swap-drag.ts`（`useDetailSwapDrag`），BookFrame 只接线（hosts 3）；`focusRemaining` 改调 `shellOf`；DOMRect 直接当 `GridDropRect` 用；`NAV_WIDTH`、`NAV_COLLAPSED_WIDTH` 去掉 `export`（hosts 9，两个 watcher 不合并）。

## 公开面与待定（交开发者，不进 S1 到 S6）

nb-layout 0.1.0 还没发到 npm，现在删名字没有使用方受影响；发出去以后再删就是不兼容的改动。候选：

1. `Grid.resize`、`Grid.resizeBranch`：没有生产调用方，docstring 已写“优先用 `resizeBranches`”（core P1）。
2. `GridGestureSession.setCollapsed`：只有测试在用（core P2）。
3. `LiveDragSessionOptions.live(source, keyboard)` 的 `keyboard` 恒为 `false`（hosts 5）。
4. `useLiveDragSession` 返回的 `session`、`live` 没有调用方（vue 四、hosts 5）。
5. 根入口里只被包内用的低层积木（`initialLiveDrop`、`stepLiveDrop`、`createDragCard`、`createFrameLoop`、`solveSashCollapse`、`createGridGestureSession`、`resolveGridInsertion` 等，core P3）。
6. nb-workbench-layout 的 `showPanelAndInsert`、`splitIntoSections`：没有调用方；前者 t24 记录过“留着，作为库操作”（wbl 2、3）。
7. 工作台不接 `WorkbenchSurface` 的 `issues`，产品里网格的诊断与被拒的提交都静默丢掉（app 顺便发现 1）：接到诊断出口，还是确认丢掉。

开发者 2026-11-23 定：
- 1 到 5 在发布前删掉，另开切片 S7（S1、S2、S3 合入之后做）：删 `resize`、`resizeBranch`（连带 `shiftNode`、`shiftSiblings`、`shareAxis` 与两个结果类型）与 `setCollapsed`；`live(source)` 去掉 `keyboard`；`useLiveDragSession` 不再返回 `session`、`live`；5 那批不再从根入口导出（包内照用，测试改从源文件导入）。改 api 报告、README 与 CHANGELOG 的 0.1.0 条目；Lab 的 `GridStructureScene` 与 `nb-workbench-layout` 测试里对 `resize`、`resizeBranch` 的使用改成 `resizeBranches`；SDK 快照受影响时按 `PLUGIN_API_SINCE` 的规则判。0.1.0 等 t55 合入后再发。
- 6 两个都删，并进 S4（连同 `rebaseOriginal` 与它们的测试；`splitIntoSections` 那两条独有的断言里，“平分原份额”补到 `movePanelToEdge` 的用例里，另一条随函数删）。
- 7 接到诊断出口，另开 Task，不放进 t55（记在 Work README 的“后续”）。

## Spec 与文档改动

Spec 不改。随代码改的文档：`live-drag-session.md`（activate 的先后一句）、`NestedGrid.md`（宿主回调每次渲染只问一次，原文“可能问几次”仍兼容，按实际改）、`useContentLayer` 的同名文档（留住拿起项）、`WorkbenchSurface.md`（`#lifted-head` 的槽属性）、`TabStrip.md` 或 `tab-strip-geometry` 的说明（新入口）。

## 切片

| 片 | 范围 | 依赖 | 编码 | 自跑验证 |
|---|---|---|---|---|
| S1 | nb-layout 非 Vue 与 scripts | 无 | Sonnet | `bun run --cwd packages/nb-layout test`、`typecheck`、`api:check` |
| S4 | nb-workbench-layout | 无 | Sonnet | 本包 `test`、`typecheck`；应用 `typecheck` |
| S6 | Lab 夹具、nb-story BookFrame | 无 | Sonnet | 应用 `typecheck`、nb-story `typecheck` 与 `bun test` |
| S2 | 两个手势会话 | S1 | Sonnet | 同 S1 |
| S3 | nb-layout Vue 层 | S1 | Sonnet | 同 S1 |
| S5 | 工作台布局与拖动 | S4 | Sonnet | 应用 `typecheck`、`bun test` 覆盖 `workbench/web` 与 `state` |
| S7 | nb-layout 公开面收窄 | S1、S2、S3 | Sonnet | 同 S1，另加应用 `typecheck` 与 SDK 快照检查 |

- 每片在自己的 worktree（`.worktree/w00026-t55-sN`，分支 `w00026/t55-sN`），一项候选一个提交，提交信息写候选编号；编码者不跑 e2e。
- 主会话审 diff、自己重跑上面的验证与本片的 e2e，处理完合入 master，下一片从新的 master 开。
- S2、S3（nb-layout 的内核与 Vue 层）各派一次 Sonnet 实现审查，后台、不阻塞下一片的编码。

## 验收映射

行为不变，判据是现有测试与 e2e 在改前改后一致：

- 单元与 dom：各包现有测试全过；新增的三条（moveLeaf 守卫、标签条停靠点一致、不读 `top` 不做命中测试）。
- e2e 基线：改前在 master 上跑一份（应用 16 个文件：`workbench-{dnd,float,live-drag,drag-cost,containers,views}`、`editor-area`、`lab-{tab-strip,nested-grid,grid-structure,grid-panels,grid-leaving,grid-swap,live-panels,drag-session,workbench-surface}`；nb-story `side-by-side`）。
- 每片：S1、S2、S3 跑 `lab-grid-*`、`lab-nested-grid`、`lab-live-panels`、`lab-drag-session`、`workbench-live-drag`、`workbench-drag-cost` 与 nb-story `side-by-side`；S4、S5 跑 `lab-tab-strip`、`lab-workbench-surface` 与六个 `workbench-*`、`editor-area`；S6 跑 `lab-nested-grid`、`lab-grid-structure`、`lab-grid-panels`、`lab-live-panels` 与 `side-by-side`。
- 收口：全部合入后把基线那份清单整份跑一次，与基线逐条对照；只在基线上也失败的归为原有失败。

## 验证

上面的命令与 e2e。未验证边界：性能改动只按代码推断省下的读写次数，不做基准；视觉等价只靠 e2e 的断言与现有截图类用例。

## 不做与风险

- 不做：分拣口径里“不收”的那几类；`NestedGrid` 手势宿主的搬出；`idleRun` 的特例；持久化与 Spec。
- 风险：S3 的 `NestedGrid` 拆分动到时序敏感的 computed，靠 `NestedGrid.dom.test.ts`（2457 行）与 e2e 守着，一段一提交，坏了只退那一段；S2 的合并动到两个会话的诊断口径，先写现状断言再改。
