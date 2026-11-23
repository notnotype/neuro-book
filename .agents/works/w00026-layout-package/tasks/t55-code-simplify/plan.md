# t55 计划：w00026 代码的深度理顺与简化

## Context

开发者要求 t49 做完后用 `/simplify` 把这个 Work 留下的无用逻辑理顺、简化，顺便审查。五份只读调研（Claude Sonnet，按模块）在 `evidences/survey-{core,vue,wbl,app,hosts}.txt`，下文用“core 3”“vue 14”这样的编号引用其中的候选。

调研的共同结论：真正没有调用方的代码不多，生产代码合计约 300 到 400 行可删或可合并；更大的收益是同一规则写了几份（矩形判点、分隔线键、“能否浮出”）、热路径上的重复量取（标签条、判定几何）和 `NestedGrid.vue` 730 行脚本按层拆开。

约束（README 已定）：行为合同不变，Spec 不改；公开面（`packages/nb-layout/api/*.api.txt`、插件 SDK 转出的名字）冻结，候选单列在“公开面”一节交开发者；持久化格式不动。

分拣口径：
- 收：删没有调用方的代码；同一规则多份改成一份；有量级差的热路径重复；带副作用或靠“恰好只读一次”撑着的结构。
- 不收：没测量的求解器性能改写（core 5 约束记忆、core 15、vue 11 到 13）；为省十几行要改大量测试夹具的（wbl 11）；会改 1 像素边界行为的统一（hosts 4 宿主那两份）；视觉靠 e2e 才验得出、收益只有省行数的 CSS 合并（vue 8、hosts 8 的样式部分）；改英文提示文案的（core 14）；合并会改行为的（wbl 7、vue 15 的合并）。

## 关键设计

### `packages/nb-layout/src/`（非 Vue）—— 切片 S1

- 删没有引用的 `normConstraint`、`branchSashSizes`；`collapsePolicyProblem` 连同它的 4 处测试删掉；`sashCollapsePolicy` 与 `SASH_COLLAPSE_THRESHOLD` 挪成 `sash-drag.test.ts` 的本地辅助（core 1）。只在本模块内用的 `projectGridGesture`、`sashDistance`、`LIVE_SETTLE_MS`、`LIVE_STICKY_PX`、`GRID_EDGE_RATIO_DEFAULT` 去掉 `export`（先 `rg -w` 确认包外与测试里没有引用）。
- 树工具：`candidateFind` 换成 `find(id, candidate)`；`grid.ts` 的 `cloneNode` 与 `grid-gesture.ts` 的 `cloneTree` 合成一份，`findBranch` 改用同一个查找、保留“只认分支”的判断（core 2）。
- `moveLeaf` 先单独一个提交补规模守卫：Spec `ui/nested-grid` 失败 5 的操作列表含“移动”，`addLeaf`、`splitLeaf` 有守卫而它没有（core 顺便发现 1）。守卫放在所有修改之前，公式照 `addLeaf`（节点数不加一，深度取 `max(scale.depth, depthOf(parentId) + 1)`）；用例按结构操作的计法建 17 层（移进第 16 层的空分支返回 `limit-exceeded`，树不变）。按移动前的深度判，会拒掉“来源塌陷后其实变浅”的移动，作为已知的保守写进 `grid.md`。
- 再一个提交让 `moveLeaf` 直接在活树上改：删 `nextTree`、`originalTree`、两处不可达的回滚，以及克隆后重新 `find` 的 `stagedHit`、`stagedTarget`、`destination`，直接用前面查到的来源与 `target.node`（core 3；回滚不可达已由计划审查按 `collapse()` 的三种情形推演过）。`grid.md` 里“跨分支操作先在候选树中完成再发布”同一提交改成实际做法。
- `sash-drag.ts` 把收起、展开的判据提成 `wantsCollapse(index)`、`wantsExpand(index)`，两条诊断各有一个构造函数，pass 与诊断阶段共用（core 6）；循环变量 `round` 改名，免得遮住导入（core 顺便发现 3）。
- 矩形：`grid-rects.ts` 提供包内的 `unionRects`、`rectsIntersect`、带类型谓词的 `hasSize`，替换 `grid-rects`、`grid-swap`、`grid-motion` 里的拷贝（core 7）。`grid-drop.ts` 的 `containsPoint(rect, point, margin = 0)` 不夹边距，供 `live-drop`（公开的 `insideShownSlot` 签名不变）、`sash-hit-area` 用，`hitTestSashBand` 调用前自己把负边距夹成 0；`live-drag.ts` 的 `inside` 是右、下不含边界的半开区间，保留（core 8）。`SashPoint`、`SashRect`、`DragEdgeRect` 改成 `GridDropPoint`、`GridDropRect` 的别名或直接引用；公开类型名不删（它们在 api 报告里时只改定义，不改名字）。
- `sashKey(branchId, index)` 是分隔条键的唯一出处：签名从收 `GridSashRef` 改成收两个参数，`grid-rects.ts:361` 与 `src/vue/` 下的全部调用方（`useSashGesture.ts`、`SashHandle.vue`、`sash-feedback.ts` 的 `sashHitKey`）同一提交改（core 9、vue 6）。S1 因此会碰这几个 Vue 文件，只改这一处。
- 脚本：`api-components.ts` 直接导入 `byCodeUnit`；`pack.ts` 与 `api-report.ts` 的入口清单抽到 `scripts/entries.ts`（字段取两边的并集：`name`、`subpath`、`source`、`vue`），删掉运行期的对账（core 12）。
- 零碎（core 13）：`collapsedSizeOf`；`grid-gesture.ts` 的重复 filter；`splitter-session.ts` 的 `delta` 改局部变量；`round` 与 `metric` 合一，放在 `grid-issue.ts`；`dev-checks.ts` 改调 `axisOf`；`live-drag.ts` 一帧里同一状态的两次 `followAt` 合成一次。
- `planBranchResize` 的注释改成与实现一致（core 顺便发现 2）。

### `packages/nb-layout/src/` 的两个手势会话 —— 切片 S2（S1 合入后）

- 两个会话的差别不止调研说的 `issues` 一处（计划审查第 2 条）：折叠失败后 Grid 回退重跑一次拖动求解并合并诊断，Splitter 直接返回 null、不动状态；取消后的尺寸一边是基线、一边是 null；`jump` 的位移覆盖一边持续到下一次 update、一边一次性；`changed` 在 Grid 里跨支聚合。这些都是可观察行为，本 Task 不统一。
- 做法：编码者先写一张两边的行为表（进交付报告），只把两边逐字相同的部分抽成包内的 `branch-gesture.ts`：一支的状态（面板配置、基线、尺寸、收起、主动与补偿、`snapState`）与拖动、跳转的求解；折叠失败后的处理、取消、`changed` 的聚合留在各自的会话里（core 10）。抽出前先给 Splitter 补用例，断言 `gesture-update`、`gesture-end` 的载荷与折叠被拒时的 `issues`，改后不变。抽完省不到 50 行就停下，交付报告说明，不合入。
- `resizeBranches` 规划通过后直接 `tree = candidate`，不再调 `applyBranchResize` 与逐项写回；`applyBranchResize` 留给 `resizeBranch`，S7 删 `resizeBranch` 时一起删（core 11）。前提：`useGridHost`、`useGridLayout` 不跨调用持有 `root()` 的节点引用，也不靠引用相等判断变化，`NestedGrid.vue` 监听 `props.node` 的 watch 与开发检查在根引用每次都换时只是多跑一次（`revision` 本来就会触发同样的作废）；编码者先 grep 核对，写进交付报告。补一条对照用例：同一次提交里收起一个保留像素的面板并拖另一个。
- `projectGridGesture` 在 `children.length !== sizesPx.length` 时的静默 `continue` 保留（理论上不出现，没有诊断出口），不在本 Task 内加机制。

### `packages/nb-layout/src/vue/` —— 切片 S3（S1 合入后）

- 删多余的卸载收尾：`Splitter.vue` 的整条 `onBeforeUnmount`，`NestedGrid.vue` 的 `scope.dispose()`；`SashGestureScope.dispose` 只剩测试在用时从类型去掉，测试改用卸载（vue 1）。“先收尾手势再通知”的先后由 `useSashGesture` 的注册顺序保证，在那里写一句注释。
- `DropFeedbackOverlay.vue` 删 `announcedText`，模板用 `labelText`（vue 2）。
- 删 `useSashScope`、`sash-feedback.ts` 的类型转出、未用的导入，只在文件内用的去掉 `export`（vue 3）。试开 `tsconfig.vue.json` 的 `noUnusedLocals`：报错都在本目录且能直接删时开着，否则不开，交付报告写明。
- `useGridMotion.ts` 的三段重复提成 `armTimer`、`flushGrowingStart`、`motionDuration`（vue 4）。
- `hasSize` 用 S1 的那一份（vue 5）；四处手写的分隔条键改调 `sashKey`，`sash-feedback.ts` 的 `sashHitKey` 也调它（vue 6）。
- `useSashGesture.ts` 的小重复（`setKeys`、两次 `map`、两次 `keyboardStep`），`settle` 那条五个条件的三元改写成一个具名的小函数（vue 7、vue 顺便发现）。
- `NestedGrid.vue` 按层拆（vue 14、9、10）。每段一个提交，按这个顺序，只搬不改时序（`flush: "sync"`、computed 里同步算的那些原样保留）：
  1. 拿起项的留住（`previousContents`、`heldLifted`、`layerContents`）原样搬进一个只依赖 `contents` 与 `lifted` 的小函数（`useHeldLifted`，放在 `useContentLayer.ts` 旁），仍是那个独立的 computed，不并进 `placements`（`placements` 还依赖几何与离开项，“上一轮”的含义会变）。文件头写明它在读取时更新上一轮记录、只能有一个读者。
  2. 分隔线的呈现搬进 `useSashPresentation`：`sashLookOf` 每条线每次渲染只算一次，用一个 computed 出整张表（不用挂在 `layers` 上的 watcher：单独换 `paneLabel` 时名字也要跟着变），渲染函数里不再写 `sashLooks`；“离开的线沿用离开前最后一次的值”保留；`sashProps` 只为那一个孩子建面板配置。`NestedGrid.md` 写明宿主回调每次重算问一次。
  3. 开发模式检查（`warnDev`、`describe`、`isCommitResult`）搬进 `dev-checks.ts`。
  4. 交换（`swapSide` 到 `takeSwap`）搬成 `useGridSwap`。
  手势宿主那 165 行（`host.begin`、`onCommit`、预览的收放）不搬：它和组件的 props、emit、expose 交织最深，搬出去要传的参数比省下的阅读量多。所有 watcher 仍在 `NestedGrid.vue` 里创建，搬出去的只是函数与 computed，免得 `motion.update`、`contentLayer.update` 的先后变化；`useSashGesture` 仍在组件里第一个调用，保住“卸载时先收尾手势再发 null”。
- `useLiveDragSession.ts` 的 `IDLE` 改用 `live-drag.ts` 导出的 `IDLE_STATE`（hosts 6）。
- `live-drag-session.ts` 头注释与 `live-drag-session.md` 补一句：宿主的 `activate` 先于 `settleMotion`，那时量到的矩形可能是过渡中间的（hosts 顺便发现 1）。

### `packages/nb-workbench-layout/` —— 切片 S4

- 标签条只量一次：`measureTabStrip` 只读一遍 DOM（wbl 5）。`all` 仍是整条按 DOM 顺序的原始成员（原始矩形，`excludedRect` 取自它）；`rowsOf` 在分组、按 top 排序与补位之前先拿到这份原始 `Member[]`，不从补位后的 `lines` 拼回 `all`。先在改前的代码上给 `tab-strip-geometry.dom.test.ts` 补一条标签高度不同、多行的用例，断言 `members` 顺序、`excludedRect` 与各行，改后照过。新增 `tabStripStopInsertions(strip)`，一次快照算出全部停靠点与对应的插入位置（wbl 1），另补一条与逐点 `resolveTabStripInsertion` 相同的用例。`resolveTabStripInsertion` 留给 Lab。
- `previewEdgeDrop` 的后半段改调 `previewPanelRects`（wbl 4 前半）；“收已算好的结果文档”那半不做（要改应用两处调用，候选有缓存，收益小）。
- 四向边的可用性抽成 `edgeTargetsOf`，只给 `layoutDropSectors` 与 `enumerateDropCandidates` 共用；`nearestEdge` 保持只对窄带内的边按需求值（指针在面板中央时一次 `policy.edgeTarget` 都不调），不改（wbl 6）。
- 小重复（wbl 8）：`axisOf` 只留 `layout-doc.ts` 一份；`intent-writeback.ts` 改调 `holdsEditor`；`isBarInput` 并进 `isBarLeaf`；`normalizeDoc`；去重键改用 `layoutDropKey`；夹具的 `sizeOf` 改调 `findTreeNode`。新增导出 `rectContains`（半开区间）给应用用，`layout-drop.ts` 自己的 `contains` 换成它。
- `presentationCollapse` 把上一轮的投影带到下一轮（wbl 9）；`layoutDropPanelAt` 只在需要时算 `sourceTabs`，`findTab` 改 `for…in`（wbl 10）。
- `index.ts` 从 `export *` 改成显式清单（wbl 12）：外部用到的名字照旧导出，外部为零的不导出（以应用 `typecheck` 为准，计划审查数到 29 个）；`entry.test.ts` 改成对清单断言；`neuro-book/src/sdk/sdk.test.ts` 按文本解析这个 `index.ts` 取类型名，跟着改。本包是私有包，不在冻结面内，这一条记进待确认清单。`layout-doc.ts` 的校验段拆成 `layout-doc-validate.ts`。
- 删 `showPanelAndInsert`、`rebaseOriginal`、`splitIntoSections`（开发者定，见“公开面与待定”第 6 条）。

### `packages/neuro-book/src/plugins/workbench/web/` —— 切片 S5（S4 合入后）

- 一次判定只量一次几何（app 1）：`stripDrop`、`previewOf`、`floatDrop` 收调用方已经量到的 `DragGeometry`，不再各自 `geometry()`。`fileDrop` 同样传下去。
- 键盘的 `stripStopsOf` 改用 `tabStripStopInsertions`（app 6）。
- 只收“已经独占一个浮动窗”这一句：提成 `isSoleWindow(doc, home)`，四处共用（app 2 的一部分）。“能否浮出”四处判据真的不同（编辑器标签有没有浮出入口、查不查窗数上限，计划审查第 1 条），不统一。
- `soleContainerOf` 加 `export`，`emptyRegionContainer` 改调它（app 3）；Shell 的入口映射提成 `entryOf`（app 4）；落点键 `dropKeyOf(action, part)` 放进 `entry-drop.ts`，三处共用（app 5）。
- 删没有读者的：`state.renderedFloats`；`BAR_STRIP` 去掉 `export`；`layoutEdgeTarget`、`layoutSeamAccepts` 的 `_tabs` 参数（库的回调签名不变，应用的函数少声明一个参数即可）；`#lifted-head` 里没用的解构与 Surface 的透传（app 7）。`issues` 事件不删，见“公开面与待定”。
- `keepVisible`、`wholeInTree` 挪到 `state/layout-constraints.ts`，store、`drag-geometry.ts`、`layout-drag.ts` 与 `drag-geometry.test.ts` 改从那里导入（app 8）。
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

## 计划审查

一轮（Claude Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)）：阻断 0、重要 6、建议 9，全部成立，已改进本稿。删掉的项：`DragQuery.top` 改 getter（工作台每次判定都读 `top`，省不到热路径，happy-dom 里写不出不靠替身的用例）、Splitter 的警告改走开发开关（是行为变化）、九个结构方法的 `need()`（英文提示有九种以上，保持措辞就省不下行）、`allocateSashPanels` 合并（它是导出的，Vue 层在用）。收窄的项：“能否浮出”只收“已独占一个窗”那一句；S2 只抽两边逐字相同的部分。

## Spec 与文档改动

Spec 不改。随代码改的文档：`live-drag-session.md`（activate 的先后一句）、`NestedGrid.md`（宿主回调每次渲染只问一次，原文“可能问几次”仍兼容，按实际改）、`NestedGrid.md`（留住拿起项那段的出处）、`WorkbenchSurface.md`（`#lifted-head` 的槽属性）、`TabStrip.md` 或 `tab-strip-geometry` 的说明（新入口）。

## 切片

| 片 | 范围 | 依赖 | 编码 | 自跑验证 |
|---|---|---|---|---|
| S1 | nb-layout 非 Vue 与 scripts（加 `sashKey` 的 Vue 调用方） | 无 | Sonnet | `bun run --cwd packages/nb-layout test`、`typecheck`、`api:check`；下游 nb-workbench-layout `test` 与应用 `typecheck` |
| S4 | nb-workbench-layout | 无 | Sonnet | 本包 `test`、`typecheck`；应用 `typecheck`，应用 `bun test` 跑 `workbench/web`、`workbench/shared`、`workbench/web/state` 与 `src/sdk/sdk.test.ts` |
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

- 单元与 dom：各包现有测试全过；新增的用例：moveLeaf 守卫、标签条高度不同时的成员顺序与停靠点一致、Splitter 的手势载荷、`resizeBranches` 收起加拖动的对照。
- e2e 基线：改前在 master 上跑一份（应用 20 个文件：`workbench-{dnd,float,live-drag,drag-cost,containers,views}`、`editor-area`、`lab-{tab-strip,nested-grid,grid-structure,grid-panels,grid-leaving,grid-swap,live-panels,drag-session,workbench-surface,drop-sectors,explorer,sortable-list,agent-ui}`；nb-story `side-by-side`）。
- 每片：S1、S2、S3 跑 `lab-grid-*`、`lab-nested-grid`、`lab-live-panels`、`lab-drag-session`、`workbench-live-drag`、`workbench-drag-cost` 与 nb-story `side-by-side`，S3 另加 `lab-explorer`、`lab-sortable-list`、`lab-agent-ui`（拖动会话的公共适配）；`moveLeaf` 的跨分支移动没有 e2e，靠 `grid.test.ts`；S4、S5 跑 `lab-drop-sectors`、 `lab-tab-strip`、`lab-workbench-surface` 与六个 `workbench-*`、`editor-area`；S6 跑 `lab-nested-grid`、`lab-grid-structure`、`lab-grid-panels`、`lab-live-panels` 与 `side-by-side`。
- 收口：全部合入后把基线那份清单整份跑一次，与基线逐条对照；只在基线上也失败的归为原有失败。

## 验证

上面的命令与 e2e。未验证边界：性能改动只按代码推断省下的读写次数，不做基准；视觉等价只靠 e2e 的断言与现有截图类用例。

## 不做与风险

- 不做：分拣口径里“不收”的那几类；`NestedGrid` 手势宿主的搬出；`idleRun` 的特例；持久化与 Spec。
- 风险：S3 的 `NestedGrid` 拆分动到时序敏感的 computed，靠 `NestedGrid.dom.test.ts`（2457 行）与 e2e 守着，一段一提交，坏了只退那一段；S2 的合并动到两个会话的诊断口径，先写现状断言再改。
