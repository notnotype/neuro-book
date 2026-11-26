# t19 实施计划：侧栏的侧轨与消息视图的侧轨版式

第 2 稿（2026-11-25）：按两份计划审查修订（前端 Sonnet 17 条、布局 omp `@review` 7 条，处理见 [`evidences/plan-review-disposition.md`](evidences/plan-review-disposition.md)）。

## Context

- 起因与历程见 Task [README](README.md)：开发者 2026-11-25 看停靠窄版觉得头与两栏接得突兀，经五轮评审板、两位顾问、两轮 gpt 设计审查与一轮 UI 审查，定为“两个侧栏共用贴外缘的侧轨，消息视图把自己的一段借给侧轨，展开的侧轨就是完整列表”。
- 依据：已接受的提案 [侧栏的侧轨](../../../../../docs/proposals/workbench-side-rails.md)（第三稿）；Spec（planned）：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 50、51 及挂在 1、5、7、10、13、18–20、22、26、39、45–47 上的指引，验收 35–37；[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 输出 105 的指引；[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 21、22；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 44 的指引与输出 57。逐条状态与动作：[`rail-states.md`](rail-states.md)。
- 开发者已定（README“开发者的决定”1–13）：只停右栏与单独浮动；窄窗口先压编辑组、再压聊天区到 320、仍不够不展开；最大化时先退出；展开宽度能拖；右栏空了右轨收走；对调另开 Task；原型代码不搬，重写，浮动切换要流畅。
- 工作方式：代码在 Work worktree `.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`）；记录只改主工作区。主会话写业务代码与纯逻辑、dom 测试；e2e 按“测试分工”交子代理。

## 技术选型

无新依赖。网格、手势与过渡沿用 nb-layout；列表沿用 nb-agent-ui 的 `AgentMessagesList` 与宿主的会话面板；性能对比沿用 `packages/neuro-book/scripts/perf/layout-frames.ts`。

## 关键设计

### `packages/nb-workbench-layout/src/`（布局文档与投影，纯 TS）

- `layout-doc.ts`（类型的主人）：`LayoutAnchor` 加 `rail?: {[containerId]: {expanded?: true; width?: number}}`，`LayoutFloat` 加 `rail?: {expanded?: true; width?: number}`；`sameLayoutShape` 比较它们。**每个会新建或重建锚、浮动窗记录的函数逐个写明 `rail` 的去向**，并各有一条单测：
  - 原样保留：模板应用、`stripDynamicTabs` / `carryDynamicTabs`（放弃恢复）、`movePanelToEdge` 与其它重建面板记录的操作（只改归属的不动 `rail`）。
  - 转移：`floatTab` / `openFloatPanel` 浮出时把锚上该容器的项带到新窗；整窗停靠、`dockFloat` 归位时带回锚上；`moveContainerTo` 换区时跟着容器走，进了不支持侧轨的区域就丢掉。
  - 清掉：重置位置、容器没有成员被删时只清那个容器的项。
- `layout-doc-validate.ts`：解码结果从“成功或失败”扩成“成功（归一后的文档加非致命诊断）或失败”。`rail` 只认 `true` 与有限正数，坏值在那一项上缺省并记一条诊断，不让整份失效；store 的 `usableDoc` 用归一后的文档，诊断按现有的诊断出口记一次，不标成未读或损坏，下次写入时写回归一后的值。
- 保留 id：`presented-ids.ts` 的 `collidesWithPresentedIds` 加 `rail:auxiliarybar`（同时查树节点 id 与 `panels` 的键）。应用生成的 id 不会是这种写法；手写出撞名 id 的旧记录读入时按现有规则拒收、回落缺省布局、不覆盖原记录，记为已知限制。
- `layout-project.ts`：遍历规范 `body` 横向分支时，在右栏一列外侧插入右轨叶（右栏有成员容器才插），和其它孩子一起参加过滤、单子塌陷与缝计算；叶形同条叶（`fixed`、缝 0、厚度来自选项回调），但不是文档的条；底部面板旧的 `[入口条, 内层]` 包装按 id 前缀单独判。投影选项新增：每条侧轨此刻的有效厚度、右栏这一次的**呈现宽度覆盖**（预算的结果）。`presentationCollapse` 降级前先按收着算展开的侧轨。
- `intent-writeback.ts`：**预算覆盖不能写进意图**（审查 L3 用真实模块复现：覆盖把右栏分节压到 352 后，任何默认 `apply` 前的 `rebaseForOperation` 把 352 写成意图，容器移走再移回，编辑区从 652 变成 990）。投影结果标出被覆盖的节点（与 `fixedNodesOf` 同一处），`rebaseForOperation` 与 `applyGestureCommit` 跳过它们的派生尺寸，按覆盖前的意图回写；右轨叶不在文档里，自然不回写。

### `packages/neuro-book/src/plugins/workbench/web/state/`（工作台的状态与约束）

- `layout-constraints.ts`：侧轨厚度（卡片宽加缝，同活动栏的换算）；**展开预算**（提案第 3 节的算法）：输入基线（所有侧轨收着时的编辑组宽与最小、右栏宽）、请求宽、视图段声明的下限与聊天下限，输出有效轨宽、右栏的呈现宽度覆盖、结果（`done` / `too-narrow`）。纯函数。
- `layout-doc-store.ts`：
  - `setRailExpanded(container, expanded)`、`commitRailWidth(container, width)`：只写 `rail`，回到原状零写入。
  - **位置限制只有一个关卡**：一个纯函数 `placementViolations(doc, declarations)` 判一整份文档。store 的提交路径（`apply` 及不经 `apply` 的 `moveView`、`moveContainerTo`、`dockFloat` 组合）在发布前对**最终文档**调用它，违反的整次拒绝、返回原文档、零写入；落点候选与预览（`applyLayoutDrop`、`applyEntryDrop` 的模拟）对模拟出的最终文档调用同一个函数。组合操作在内存里累积完再判一次，不判中间态。
  - 读入归整：受限视图分离到右栏自己的容器或单独浮出，其余原样；声明目录还没就绪时不写回。
- `default-tree.ts`：默认建树与补位（`reconcileViews`）按位置限制放受限视图。

### `packages/neuro-book/src/plugins/workbench/web/shell/` 与 `components/`（外壳）

- **相连与角（片 3a）**：`shell/adjacency.ts` 与 `WorkbenchSurface.vue` 里围绕 `ACTIVITY_BAR` 单例写的 `BARS`、`separatedBarRight`、`freshlyJoined`、`capLeaves`、`cardOf`、`shapeOf`、`capOf`、`barSeamOf`、`--shell-sash-cap`、`joinedToBar`、`maximizedCardEdges` 改成按侧轨列表与左右两侧算：右栏卡片与右轨相连时相连的角不圆、接缝短线在内侧，右栏隐藏、显示时角镜像地接过去。右轨叶有自己的插槽，卡片 `data-shell-card="rail:auxiliarybar"`。这一片右轨内容是空壳。
- **侧轨组件（片 3b）**：`WorkbenchToolStrip.vue` 扩展，左轨照旧用它，右轨用同一组件。内部版式：
  - 一列 48 宽的竖排：入口带（`flex: 0 1 auto`，放不下进“更多”）、视图段的 `main`（`flex: 1 1 0; min-height: 0`，独立滚动）、`foot`、展开按钮。“更多”的可用高度 = 总高减底段减 `main` 的最小高度。整条侧轨在极矮时整列滚动。
  - 展开时侧轨变成两栏：左边 48 一列不动（入口、底段、展开按钮留在原位），`main` 向右长出，宽度 = 轨宽减 48。
  - 悬停提示与“更多”菜单的方向由侧轨所在一侧给（右轨朝左）；右轨不画书脊装饰，底色用同一组侧轨 token；右轨的底段不带 `data-activity-items`（全局项只在左轨）。
  - **键盘**：两条侧轨同一个模型，组件统一管 roving tabindex：按 DOM 顺序收集带 `data-rail-item` 的元素（入口、视图段各项、底段、展开按钮；视图段的项由视图画、带这个标记），在 `focusin`、上下方向键、Home、End 上写 `tabindex`。左轨由每个入口一个 Tab 停靠改成一个停靠（Spec 输出 50 的“焦点与读屏”）；受影响的 e2e 由子代理在片 3b 后迁移。
- `WorkbenchRegionStrip.vue` 与 `WorkbenchShell.vue`：右栏不再有顶上一行的入口条与并进来的头（底部面板照旧）；`icons` 变体成了死分支，删掉。消息视图停靠时**照旧接管面板头的标题区**（Spec conversation 输出 44 的指引）：右栏去掉入口条后 `panelViewHead` 的 `stripWidthOf` 不再适用，改按面板头自己的宽量 `VIEW_HEAD_MIN_PX`。`ownHeadBands` 对声明了视图段的视图：自绘头右端不再为框架按钮留位，“回到停靠”画在窗右上角的顶格。
- **轨宽手柄**：侧轨组件内部的元素，叠在 `main` 的内侧边上，不复用网格分隔线。拿起冻结基线与布局版本，指针每帧至多一次预览求解（预览走投影选项的厚度，不写文档），触界即停，Esc、失去捕获、版本变化整场取消；松手 `commitRailWidth`。键盘：方向键 10 像素、Home、双击回缺省。和网格分隔线互斥：区域拖到零或隐藏过渡中，右栏那条分隔线与手柄挨在一起时，手柄的命中区只在轨的一侧、不向外扩；两种手势进行中互相拒绝（复用 `data-workbench-dragging` 与布局版本）；可访问名称分开（“调整右侧栏宽度”与“调整消息列表宽度”）。实现前用真实投影确认隐藏时那条分隔线在不在，再定命中区的规则适用面。
- **揭示通道**：shell 的一个方法：显示右栏、退出别的最大化、聚焦目标视图；给消息视图的打开与新建用。
- **拖放**：把按“左边是纵向带、其余是横向入口条”写的分支改成按带的轴与 id 区分，不再按区域名：`layout-drag.ts` 的 `bandElement`、`measureBands`、`stripRegion`，`entry-drop.ts` 的 `entryStripOf`、`regionOfEntryStrip`，`drag-geometry.ts` 的 `band.region === "sidebar"` 两处，`drag-keyboard` 的候选；取元素一律限定在 `[data-rail=<区域>]` 之内（含 `WorkbenchShell.vue` 取带的那处）。右轨入口带沿纵轴量落点。视图段与底段标 `data-drop-refuse`，在 `layoutDropOverPanel` 同一处判：松手取消、不开新窗；键盘候选只停入口带。拖动期间冻结侧轨的有效几何。
- F6 与读屏顺序：右轨在右栏之后（按树序，投影插入位置自然满足），侧轨整条 `navigation`。

### `packages/neuro-book/src/plugins/workbench/shared/contracts.ts` 与 `web/views/`

- `contracts.ts`：`VIEW_RAIL`（展开宽度缺省、下限、上限、聊天下限）、`ViewRail`（`placement`：`rail{main, foot}` | `window{width}` | `none`；`expanded`；`request`）、位置限制的声明形状（只给内置视图）。`VIEW_HEAD` 与 `VIEW_OWN_HEAD` 不变：自绘头仍只和 `VIEW_HEAD` 一起读。
- `registry.ts`：`railOf(viewId)` 像 `badge()` 一样从 `handle.implementation()` 同步读 `VIEW_RAIL`，不等组件加载；预算、夹取、骨架都按它。
- `view-instances.ts`：借用按已提交的位置、容器、代际发放与收回；旧代际的请求拒绝；冷开隐藏不提前加载。`request(expanded)` 同步判定：先提交记录再 resolve，代际不符 resolve `revoked`，连续请求按调用顺序各自 resolve。借用的发放与撤回沿用 `WorkbenchShell.vue` 里面板头 `watchEffect` 的做法（按面板汇总、在同一次 flush 里分发），右轨离场时先撤回再拆目标元素，dom 测试用真实 `Teleport`。焦点交接（宿主一侧）。
- **加载中**：视图已借到位置但组件还在加载时，工作台在 `main` 里画骨架（宽度按 `railOf` 的展开宽度，稳定尺寸、无动画），标 `data-rail-loading`；出错或撤回时收回 48。

### `packages/nb-layout/src/`（网格）

- `grid-motion.ts`、`vue/NestedGrid.vue`：同一个浮动窗由程序只改宽度时开布局过渡（Spec nested-grid 输出 105 的指引；手势照旧不过渡）。**没有内容的合成叶的离场**：现有 `leavingPlacements` 只留挂着内容的叶，右轨叶没有内容会直接消失；加一个由宿主给的“离场保留”名单，名单里的空叶保留外框、厚度缩到零再摘，再次出现时打断，减少动效或容器尺寸变化时直接收口。
- 浮动窗的轨宽手势事务（基线冻结、预览、取消、一次提交），与 `FloatWindowHandles.vue` 共用坐标换算与夹取；窗的手柄只结算动的边。新类型与函数进 `.`（核心）或 `./vue` 的公开入口，更新入口测试与 `api:report`。
- 浮动窗的呈现矩形 = 记录矩形加展开差值；夹取保证展开后的视图段与“回到停靠”可达。

### `packages/nb-agent-ui/src/vue/messages/`（消息视图的组件）

- `AgentMessages.vue` 重写：去掉宽窄两版、`Splitter`、列表栏、头像列、抽屉；改成聊天区插槽加一个**视图段组件**（新，同名 `.md`）：收着画 bot、短线、新对话与最近会话、底段；展开画 `AgentMessagesList`。画法按传入的 `expanded`，不看宽度；名字延迟淡入。视觉：当前 bot 竖条、当前会话描边、未读数字徽标、等你处理 warning 且形状不同、“+N”、汇总徽标、隐藏时弱描边。视图段的每一项带 `data-rail-item`，roving 由侧轨统一管。
- `AgentMessagesList.vue`：Bot 页搜索词提成 `v-model:bot-query`（会话页的已在宿主），收起再展开两页都不丢；expose `focusSearch(page)`；搜索框 `Esc` 先清空，已空时 emit `escape-search`，由宿主把焦点交给聊天输入框。
- Lab：视图段的收着、展开（200 与 420 宽）、高度不够、英文 390；聊天加视图段的组合场景。Lab 里挂视图段用一个承载 `main`、`foot` 的替身轨夹具（固定 48 或 260 宽，放 Lab 的 `fixtures/`）。

### `packages/neuro-book/src/plugins/agent/web/`（宿主）

- `MessagesHost.vue`：声明 `VIEW_RAIL` 与位置限制；按 `ViewRail.placement` 把视图段 `Teleport` 到侧轨或画在自己内容的右边缘（浮动，顶格留空）；`request` 的结果驱动切页与聚焦。保留 `VIEW_HEAD` 与 `VIEW_OWN_HEAD`：停靠时 `claim` 恒为真，聊天头进面板头三列，左列去掉“新建”（挪进视图段），按标题不再开抽屉；浮动时自绘头。
- 去掉：`plugin.ts` 的 `messagesMemory`（宽窄版式的记忆）、`messages-head.ts` 里只为宽窄两版服务的部分、Lab 的 `messages.scenes.ts` 里旧版式的场景。
- `session-list.ts`：最近会话的独立查询（顶层、未归档、本作品范围，按最近活动），不受历史筛选影响。刷新：视图段挂上时、会话新建、选中、改名、归档与恢复之后、窗口重新获得焦点、沿用 15 秒轮询。
- 打开与新建走揭示通道；命令“搜索会话”。

### `packages/neuro-book/src/web/testing/`（e2e 的测试视图）

- `sample-views.ts` 与 `shared/testing/sample-views-contract.ts`：加一个右栏测试视图，声明 `VIEW_RAIL`（宽度、下限、上限、聊天下限可由用例经测试事件改）与位置限制，画一个简单视图段（几项带 `data-rail-item` 的按钮）。片 4 的落点用例与片 5 的展开、预算、手柄用例用它，不必等片 7 的消息视图。

## Spec 与文档改动

- Spec（planned）已提交：dabe9cb6a；第 2 稿随本计划改：conversation 输出 44 的指引与输出 57 的开头（停靠照旧接管标题区）、views 输出 21 的 `window` 带 `width` 与顶格、nested-grid 输出 105 的指引。实现后逐句核对、补实现合同与证据，晋升另请开发者批准。
- 组件同名 `.md`：`AgentMessages.md` 改写、视图段组件新写、`AgentMessagesList.md`（新 props、expose、事件）、`WorkbenchToolStrip.md`（内部版式、键盘、手柄）、`WorkbenchSurface.md`（右轨插槽、双侧相连与角接过去）、`WorkbenchPanelHead.md`（顶格、自绘头右端不留位）、`WorkbenchRegionStrip.md`（右栏不再用）、`WorkbenchShell.md`、`NestedGrid.md`（离场保留、程序宽度过渡、手势事务）。
- Lab 场景：`WorkbenchToolStrip` 加右轨、展开、`main` 里长内容、放不下收进更多、英文 390；`WorkbenchRegionStrip` 删右栏的 `icons`、`hidden` 两个场景；`WorkbenchSurface` 的 `view-head` 场景与 `WorkbenchSurfaceFixture.vue` 按新的接管方式改；视图段的见上。

## 切片

每片单独提交，片内只跑受影响的单测与 dom 测试；e2e 由子代理按“测试分工”在片后跑。片 3a、3b、5、7 的自跑验证另加一项：开发服务的真实页面上不减弱动效把这一片带过渡的路径点一遍，记一句话进 Task README。

| 片 | 内容（关键设计的节） | 自跑验证 |
|---|---|---|
| 0 | 把 master 并进分支，`bun install`，类型检查（已做） | `bun run --cwd packages/neuro-book typecheck` |
| 0b | 性能基线：在 master 2f8e6f696 的 detached 检出上构建并保留 dist，作为 `layout-frames.ts` 的 base | 跑一次现有场景，记录进证据 |
| 1 | 文档字段与读入：`rail` 字段、归一与诊断、形状比较、逐个重建路径、保留 id | 包内单测：每个重建函数一条往返；坏值局部修复且有诊断、不标损坏；真实 store 与 SQLite 往返 |
| 2 | 投影与预算：右轨叶插入、厚度、预算纯函数、放不下次序、预算覆盖不进意图 | 单测：三档预算、1100 宽例子、只缺高度不收轨、隐藏活动栏加收走区域时右轨仍在；经真实 store 的“覆盖中把容器移走再移回，意图与几何回到覆盖前” |
| 3a | 外壳的相连与角：双侧相连、角接过去的镜像、最大化避让；右轨是空壳 | `adjacency.test`、Lab 的 `WorkbenchSurface` dom 与 `lab-workbench-surface` e2e（主会话跑，只这一个文件） |
| 3b | 侧轨组件（内部版式、roving、右轨用它）、右栏横入口条去掉、接管标题区改按面板头宽、拖放按轴、F6 | dom 测试；类型检查覆盖 e2e |
| 4 | 位置限制：声明、关卡函数与所有提交路径、默认建树与补位、读入归整、落点拒绝区、测试视图的声明 | 单测：对真实 store 的普通拖放、入口相邻并入、入口跨区搬移、`moveView` 两种目标、`moveContainerTo`、多视图浮窗逐项归位、单标签浮出、重置，逐个断言拒绝零写入；含审查用 Bun 复现的相邻入口并入 |
| 5 | 视图段接口与借用、`railOf`、加载骨架、展开按钮、轨宽手柄、揭示通道、焦点交接、测试视图的视图段 | 单测与 dom（真实 `Teleport` 的借用与撤回、`request` 的三种结果与先后） |
| 6 | 浮动：顶格归位、矩形与夹取、浮动窗轨宽手势、程序宽度过渡、空叶离场保留、公开入口 | nb-layout 单测与 `NestedGrid.dom.test.ts`；`bun run --cwd packages/nb-layout api:check` |
| 7 | 消息视图：组件重写、列表的搜索词与 Esc、Lab、宿主接线、最近会话查询与刷新、去掉旧物、命令 | nb-agent-ui dom；宿主的 dom 或集成用例（新建后最近会话立即出现、归档后消失、筛选不影响） |
| 8 | 过渡与性能：`layout-frames.ts` 加场景、与 0b 的基线对比；真实页面逐帧看首中末帧 | 见“验证” |

片 3b 到片 7 之间，`agent-conversation` 里按旧宽窄版式写的用例会失败（旧 `AgentMessages` 还在、入口条已去），归为预期，片 7 后由子代理改写。

实现审查：第 1、2、4 片合起来碰布局记录与数据格式，按快速审查：Opus 先审、omp `@review` 后台；第 3a–3b、5–7 片前端，Sonnet 审；Task 收口一次总审。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| layout 50 几何与在不在 | 投影单测（片 2）；e2e `workbench-side-rail` 在不在一组（段 A） |
| layout 50 三段与落点 | dom（侧轨组件）；e2e 入口带落点、拒绝区松手取消（段 A）、键盘候选（段 B） |
| layout 50 相连与外观 | `adjacency.test`、dom；e2e 量相连的角（段 A） |
| layout 50 展开、读入、字段往返 | 单测（片 1）；e2e 展开后刷新还在、模板与重置（段 B） |
| layout 50 预算 | 单测（片 2）；验收 36 的 e2e（段 B，用测试视图） |
| layout 50 轨宽手柄 | e2e 指针与键盘、Esc 零写入、与分隔线互斥（段 B） |
| layout 50 切换容器 | e2e 两端轨宽不同时的布局过渡（段 B，开动效取样） |
| layout 50 焦点与读屏 | e2e F6 顺序（段 A）、roving 与交接落点（段 B）；dom 跨所有者的方向键（片 3b、5） |
| layout 51 浮动窗 | nb-layout 单测；e2e 顶格、矩形不漂移、靠右夹取、浮动窗轨宽（段 C） |
| layout 验收 35、37 | e2e（段 B、C）；37 另加真实页面逐帧（片 8） |
| nested-grid 105 的指引 | `NestedGrid.dom.test.ts`：程序宽度变化有过渡、手势没有（片 6） |
| views 21 视图段 | 单测与 dom：借用、旧代际拒绝、冷开不加载、`request` 三种结果、加载骨架（片 5） |
| views 22 位置限制 | 单测：关卡函数与所有提交路径、读入归整（片 4）；e2e 落点与命令直传（段 A） |
| conversation 44 的指引、57 | nb-agent-ui dom、Lab e2e、对话 e2e：停靠时头在面板头、收着与展开、徽标、Esc、打开后焦点、最近会话不受筛选（片 7、段 C） |

## 验证

- 合入前跑一次的 e2e 清单（预计超过 8 个文件，`NB_E2E_WIDE="侧轨改动工作台骨架呈现、右栏入口与浮动，要消除改动对布局与拖放各文件的影响"`）：段 A 盘点列出的文件（`workbench-containers`、`workbench-shell`、`workbench-views`、`agent-conversation`、`bots-chat`、`lab-agent-ui`、`lab-workbench-surface`、`themes`、`workbench-titlebar`、`workbench-dnd`、`workbench-live-drag`、`workbench-float`）加新文件 `workbench-side-rail`。由主会话在 Task 收口时跑。
- 实施中改动后只重跑覆盖改动的文件与失败项。
- 动效相关的 e2e（切换容器的布局过渡、验收 37）在用例里 `page.emulateMedia({reducedMotion: "no-preference"})`，按 `workbench-containers` 的 `framesAfter` 取样；默认减弱动效时这类断言会空过。
- 性能（片 8）：`layout-frames.ts` 加“展开、收起”“拖轨宽”“浮出、归位”“切换容器”场景，新旧两套标记分开写（base 用旧的），长会话列表的数据由场景自己造；`--checkout base=<0b 的检出> --checkout branch=<Work 检出> --rounds 5`。判据：已有场景（侧轨收着）各计数不高于基线的 110%；新场景只出报告。没有浏览器采样前不下帧率结论。
- 真实页面：`nbdev dev start`（后台）上走一遍浮动、归位、展开、拖宽、切容器，逐帧记录首中末帧，用 `nbdev shot` 取图。
- 未验证边界：Windows 桌面壳里的动效与读屏、触屏。

## 测试分工

大型任务，按用户级规则“测试与业务并行”分。

- **所有权**：主会话写业务代码、纯逻辑单测与 dom 测试，不改 e2e 文件（片 3a 只跑一个 Lab e2e 文件，不改它）。子代理在 worktree `.worktree/w00043-t19-e2e`（分支 `w00043-t19/e2e`）改 e2e 与辅助函数、登记 Lab 场景，跑用例并归类失败。主会话审子代理的 diff，合入时把它的分支并回 Work 分支。
- **排先后**：同一时刻只有一边构建或跑 e2e；派段 B、C 前主会话停下自己的构建与测试，子代理跑完交回后主会话再继续。
- 段 A 已交（`e268a97fb`）：新文件 `workbench-side-rail.e2e.ts` 与 `support/side-rail.ts`、受影响用例的盘点（`/tmp/review-t19-e2e/segment-a-report.txt`，转录进 `evidences/`）。

| 段 | 派的时机 | 内容 |
|---|---|---|
| A | 已交 | 盘点；停靠右轨的用例：在不在、入口带与按下、拒绝区松手取消、F6 顺序、位置限制的落点与命令直传 |
| B | 第 3a–5 片提交后 | 按第 2 稿的标记改 A 的辅助函数（入口带改 `data-tool-band`）；按盘点迁移现有用例与辅助函数（含左轨 roving 带来的 Tab 用例）；跑 A 与迁移过的用例并修；写展开、预算（验收 36）、轨宽手柄、切换容器、键盘、焦点交接、加载骨架、意图不漂移（验收 35）的用例，用测试视图 |
| C | 第 6–7 片提交后 | 跑并修；改写 `agent-conversation`、`lab-agent-ui`、`bots-chat` 的旧版式用例；写浮动（顶格、矩形不漂移、靠右夹取、浮动窗轨宽、验收 37）与消息视图（停靠时头在面板头、收着与展开、徽标、Esc、打开后焦点、最近会话不受筛选）的用例；登记 Lab 场景 |

**元素标记约定**（主会话照它实现，子代理照它写用例）。最小结构：

```text
[data-shell-card="rail:auxiliarybar"]                        右轨的卡片（左轨是 activitybar）
  nav[data-rail="auxiliarybar"][data-rail-state][data-rail-joined?]
    [data-tool-band]                                         入口带
      [data-tool-entry="<容器>"][aria-pressed][data-rail-item] ...
      [data-tool-indicator]                                  按下的底块
      [data-tool-more]                                       放不下时
    [data-rail-segment="main"][data-drop-refuse]             视图段（视图 Teleport 进来）
      [data-rail-loading]                                    加载中的骨架（工作台画）
      [data-messages-segment] ...                            视图画的内容，各项带 data-rail-item
    [data-rail-segment="foot"][data-drop-refuse]
    [data-rail-expand][aria-expanded][data-rail-item]
    [data-rail-handle][role=separator]                       只在展开时
```

| 标记 | 在哪 | 含义 |
|---|---|---|
| `data-shell-card="rail:auxiliarybar"` | 右轨的卡片 | 量宽、圆角；左轨仍是 `activitybar` |
| `data-rail="sidebar"` / `"auxiliarybar"` | 侧轨的根（`nav`），左轨也带 | 哪个区域的侧轨；右轨不在时没有这个元素。所有 `data-tool-*` 都在它之内取，不写裸选择器 |
| `data-rail-state="collapsed"` / `"expanded"` | 侧轨的根 | 此刻**生效**的状态（被预算拒绝时是 `collapsed`）；用户意图读保存的文档 |
| `data-rail-joined` | 侧轨的根 | 和区域卡片相连时有、不相连时没有（不写 `"false"`） |
| `data-tool-band`、`data-tool-entry="<容器 id>"` + `aria-pressed`、`data-tool-indicator`、`data-tool-more`、`data-tool-merge` | 入口带（两条侧轨同名） | 入口、按下、底块、更多、并入高亮。右栏旧条的 `data-region-entry` 不再用于右栏 |
| `data-rail-item` | 工具条里每个可聚焦项 | roving 的成员 |
| `data-rail-segment="main"` / `"foot"` + `data-drop-refuse` | 视图段的两个位置 | 工作台给视图的元素；松手是取消 |
| `data-rail-loading` | `main` 里 | 视图加载中的骨架 |
| `data-rail-expand` + `aria-expanded` | 展开按钮 | 窗口太窄时另有 `data-rail-too-narrow` |
| `data-rail-handle` + `role=separator`、`aria-valuenow/min/max` | 轨宽手柄 | 只在展开时存在；`aria-valuenow` 是生效宽度 |
| `data-float-rail` | 浮动窗里视图画的视图段根 | 窗右上角顶格里有 `[data-panel-action="nbook.view.dock"]`（宿主画，不在 `data-float-rail` 之内） |
| `data-messages-segment` + `data-messages-segment-state="collapsed"` / `"expanded"` | 消息视图的视图段根 | 收着或展开的画法 |
| `data-strip-contact="<key>"` + `aria-current`、`data-strip-waiting`、`data-strip-more` | bot 头像、等你处理、“+N” | 当前 bot 用 `aria-current` |
| `data-strip-session="<id>"` + `aria-current` | 会话方块 | 当前会话 |
| `data-rail-weak` | 视图段根 | 区域隐藏或拖到零时“当前”退成弱描边 |
| `data-messages-new-session` | 新对话 | |
| `data-messages-open="bot"` / `"sessions"` + `aria-pressed` | 底段两个按钮 | 展开且在对应页时按下 |
| `data-messages-summary` | “全部 bot”的汇总徽标 | 有等你处理时另有 `data-messages-summary-waiting` |
| `data-messages-list-panel`、`data-messages-switch` | 展开后的列表与切换行（沿用现名） | |

去掉的旧标记：右栏的 `[data-region-strip=auxiliarybar]` 横入口条与条里的 `data-region-entry`、`data-region-indicator`（底部面板的 `panel` 保留）、段 A 用过的 `data-rail-entries`（改用 `data-tool-band`）、消息视图的 `data-messages-toggle`、`data-messages-strip`、`data-messages-collapse`、`data-messages-tab`、`data-messages-layout` 的 `wide`/`narrow`。

## 不做与风险

- 不做：左右对调（另开 Task）、左轨展开的入口、底部面板、插件 SDK、按消息内容搜索、普通会话的未读、拖会话出去浮动、悬停预览展开、新的快捷命令（只加“搜索会话”）。
- 已知限制：手写出 `rail:auxiliarybar` 这种 id 的旧记录读入时被拒收、回落缺省布局，原记录不被覆盖。
- 风险：
  - 投影插入右轨叶后，网格过渡与冻结几何的既有用例大面积变化（段 A 盘点：`auxiliaryWidth` 一类按 `g0` 右沿量的辅助会把右轨算进右栏）：段 B 先跑基线再改断言。
  - 位置限制的提交路径漏网：关卡只有一个函数，单测按片 4 列的路径逐条对真实 store 写。
  - 预算覆盖写进意图：片 2 的真实 store 往返用例守住；之后改投影或回写的片都重跑它。
  - 性能：展开时编辑组与长列表同时变宽，靠片 8 的采样兜底。
  - 旧布局回滚：新字段可选、旧版本读得进；读入归整只动受限视图，单测守住“其余原样”。
