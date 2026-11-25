# t19 实施计划：侧栏的侧轨与消息视图的侧轨版式

## Context

- 起因与历程见 Task [README](README.md)：开发者 2026-11-25 看停靠窄版觉得头与两栏接得突兀，经五轮评审板、两位顾问、两轮 gpt 设计审查与一轮 UI 审查，定为“两个侧栏共用贴外缘的侧轨，消息视图把自己的一段借给侧轨，展开的侧轨就是完整列表”。
- 依据：已接受的提案 [侧栏的侧轨](../../../../../docs/proposals/workbench-side-rails.md)（第三稿）；Spec（planned）：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 50、51 及挂在 1、5、7、10、13、18–20、22、26、39、45–47 上的指引，验收 35–37；[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 21、22；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 57。逐条状态与动作：[`rail-states.md`](rail-states.md)。
- 开发者已定（README“开发者的决定”1–13）：只停右栏与单独浮动；窄窗口先压编辑组、再压聊天区到 320、仍不够不展开；最大化时先退出；展开宽度能拖；右栏空了右轨收走；对调另开 Task；原型代码不搬，重写，浮动切换要流畅。
- 工作方式：代码在 Work worktree `.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`），先把 master 并进分支；记录只改主工作区。主会话写核心；机械的大段改动（Lab 场景登记、e2e 辅助函数迁移）可派 Sonnet。

## 技术选型

无新依赖。网格、手势与过渡沿用 nb-layout；列表沿用 nb-agent-ui 的 `AgentMessagesList` 与宿主的会话面板。

## 关键设计

### `packages/nb-workbench-layout/src/`（布局文档与投影，纯 TS）

- `layout-doc.ts`：锚记录与浮动窗记录加正式可选字段 `rail`（锚上按容器 `{[containerId]: {expanded?: true; width?: number}}`，浮动窗上 `{expanded?: true; width?: number}`）；`sameLayoutShape` 比较它；重建记录的路径逐条保留或清掉：模板应用、放弃恢复（`stripDynamicTabs`、`carryDynamicTabs`）、浮出（`floatTab` 从锚上该容器的项带过去）、归位（带回锚上）、重置位置（清掉该容器的项）。
- `layout-doc-validate.ts`：`rail` 的读入归一（只认 `true` 与有限正数，坏值局部缺省并给诊断，不让整份失效）；保留名单 `collidesWithPresentedIds`（`presented-ids.ts`）加 `rail:auxiliarybar`，覆盖树节点 id 与 `panels` 的键。
- `layout-project.ts`：遍历规范 `body` 横向分支时，在右栏一列外侧插入右轨叶（右栏有成员容器才插），和其它孩子一起参加过滤、单子塌陷与缝计算；不在结果上补。叶的形状同条叶（`fixed`、缝 0、厚度来自选项回调），但不是文档的条；横向侧轨与底部面板旧的 `[入口条, 内层]` 包装按 id 前缀分开判定。投影选项新增：每条侧轨此刻的有效厚度、右栏这一次的呈现宽度覆盖（预算的结果）。`presentationCollapse` 降级前先按收着算展开的侧轨。
- `intent-writeback.ts`：不改；右轨叶不在文档里，自然不回写。加测试守住“展开、拖轨宽不改区域意图”。

### `packages/neuro-book/src/plugins/workbench/web/state/`（工作台的状态与约束）

- `layout-constraints.ts`：侧轨厚度（卡片宽加缝，同活动栏的换算）；**展开预算**（提案第 3 节的算法）：输入基线（所有侧轨收着时的编辑组宽与最小、右栏宽）、请求宽、视图段声明的下限与聊天下限，输出有效轨宽、右栏的呈现宽度覆盖、结果（`done` / `too-narrow`）。纯函数，单测覆盖三档与边界。
- `layout-doc-store.ts`：`setRailExpanded(container, expanded)`、`commitRailWidth(container, width)`（只写 `rail`，回到原状零写入）；**位置限制**在所有改归属的提交出口统一校验（标签拖放、相邻入口并入 `movePanelToEdge` 等只改归属的捷径、`move-view`、整容器移动、整窗停靠、归位），候选与预览共用；读入归整（受限视图分离到右栏自己的容器或单独浮出）。
- `default-tree.ts`：默认建树与补位（`reconcileViews`）按位置限制放受限视图；`fitsSkeleton` 不变。

### `packages/neuro-book/src/plugins/workbench/web/shell/` 与 `components/`（外壳）

- `shell/adjacency.ts`、`components/WorkbenchSurface.vue`：相连、圆角、接缝、角接过去、最大化避让（`BARS`、`maximizedCardEdges`）从“左边一条活动栏”改成按侧轨列表与左右两侧算；右栏卡片与右轨相连时相连的角不圆、接缝短线在内侧。
- **侧轨组件**：由 `WorkbenchToolStrip.vue` 扩展（入口带竖排、指示块、“更多”、底段已有），加：视图段的两个位置元素（`main`、`foot`，给 `ViewRail` 借用）、展开按钮、轨宽手柄（专用，见下）、整条侧轨在极矮时的滚动后备。左轨照旧用它，右轨用同一组件。
- `WorkbenchRegionStrip.vue` 与 `WorkbenchShell.vue`：右栏不再有顶上一行的入口条与并进来的头（底部面板照旧）；右栏的入口交给右轨。`ownHeadBands` 对声明了视图段的视图：“回到停靠”改画在视图段顶格，自绘头右端不再为框架按钮留位。
- **轨宽手柄**：一个专用的手势，不复用网格分隔线：拿起冻结基线与布局版本，指针每帧至多一次预览求解（预览走投影选项的厚度，不写文档），触界即停，Esc、失去捕获、版本变化整场取消；松手 `commitRailWidth`。键盘：方向键 10 像素、Home、双击回缺省。
- **揭示通道**：`nbook.view.open` 的一个变体或 shell 的方法：显示右栏、退出别的最大化、聚焦目标视图；给消息视图的打开与新建用。
- `entry-drop.ts`、`layout-drag.ts`：右轨的入口带沿纵轴量落点（同活动栏上段）；视图段与底段是拒绝区（松手取消，不开新窗）；拖动期间冻结侧轨的有效几何。
- F6 与读屏顺序：右轨在右栏之后（按树序，投影插入位置自然满足），侧轨整条 `navigation`。

### `packages/neuro-book/src/plugins/workbench/shared/contracts.ts` 与 `web/views/`

- `contracts.ts`：`VIEW_RAIL`（展开宽度缺省、下限、上限、聊天下限）、`ViewRail`（`placement`、`expanded`、`request`）、位置限制的声明形状（只给内置视图）。
- `web/views/view-instances.ts`、`web/views/registry.ts`：借用按已提交的位置、容器、代际发放与收回；旧代际的请求拒绝；冷开隐藏不提前加载；焦点交接（宿主一侧）。

### `packages/nb-layout/src/`（网格）

- `grid-motion.ts`、`vue/NestedGrid.vue`：同一个浮动窗只改宽度（程序变化）开布局过渡；离场的右轨叶保留没有内容的外框、厚度缩到零再摘。浮动窗的轨宽手势事务（新的公开接口：基线冻结、预览、取消、一次提交），与 `FloatWindowHandles.vue` 共用坐标换算与夹取；窗的手柄只结算动的边。
- 浮动窗的呈现矩形 = 记录矩形加展开差值；夹取保证展开后的视图段与“回到停靠”可达。

### `packages/nb-agent-ui/src/vue/messages/`（消息视图的组件）

- `AgentMessages.vue` 重写：去掉宽窄两版、`Splitter`、列表栏、头像列、抽屉；改成聊天区插槽加一个**视图段组件**（新，同名 `.md`）：收着画 bot、短线、新对话与最近会话、底段；展开画 `AgentMessagesList`。画法按传入的 `expanded`，不看宽度；名字延迟淡入。视觉：当前 bot 竖条、当前会话描边、未读数字徽标、等你处理 warning 且形状不同、汇总徽标、隐藏时弱描边。键盘：收着是纵向工具条，展开的列表是自己的区域；`Esc` 规则。
- Lab：视图段的收着、展开、高度不够、英文 390 场景；聊天加视图段的组合场景。

### `packages/neuro-book/src/plugins/agent/web/`（宿主）

- `MessagesHost.vue`：声明 `VIEW_RAIL` 与位置限制；按 `ViewRail.placement` 把视图段 `Teleport` 到侧轨或画在自己内容的右边缘（浮动）；`request` 的结果驱动切页与聚焦；不再接管标题区（`VIEW_HEAD` 的标题接管去掉，`VIEW_OWN_HEAD` 保留）。
- `session-list.ts`：最近会话的独立查询（顶层、未归档、本作品范围，按最近活动），不受历史筛选影响。
- 打开与新建走揭示通道；命令“搜索会话”。

## Spec 与文档改动

- Spec（planned）已提交：dabe9cb6a。实现后逐句核对、补实现合同与证据，晋升另请开发者批准。
- 组件同名 `.md`：`AgentMessages.md` 改写、视图段组件新写、`WorkbenchToolStrip.md`、`WorkbenchRegionStrip.md`、`WorkbenchShell.md`、`NestedGrid.md`（新手势接口与过渡）。

## 切片

每片单独提交，片内只跑受影响的单测与 dom 测试；带 e2e 的片只跑覆盖它的文件。

| 片 | 内容（关键设计的节） | 自跑验证 |
|---|---|---|
| 0 | 把 master 并进分支，`bun install`，类型检查 | `bun run typecheck` |
| 1 | 文档字段与读入：`rail` 字段、归一、形状比较、重建路径、保留 id（nb-workbench-layout） | 包内单测（新加：坏值读入、模板与放弃恢复保留、浮出归位带过去、撞名拒绝） |
| 2 | 投影与预算：右轨叶插入、厚度、预算纯函数、放不下次序（nb-workbench-layout、`layout-constraints.ts`） | 单测：三档预算、1100 宽例子、意图不漂移、只缺高度不收轨、隐藏活动栏加收走区域时右轨仍在 |
| 3 | 外壳：相连圆角接缝最大化、侧轨组件（右轨用它）、右栏横入口条去掉、F6；还没有视图段 | dom 测试；e2e：工作台布局与入口条相关文件 |
| 4 | 位置限制：声明、所有提交出口、默认建树与补位、读入归整、落点拒绝区 | 单测（含审查用 Bun 复现的相邻入口并入）；e2e：拖放相关文件 |
| 5 | 视图段接口与借用、展开按钮、轨宽手柄、揭示通道、焦点交接 | 单测与 dom；e2e：新加的停靠侧轨用例 |
| 6 | 浮动：顶格归位、矩形与夹取、浮动窗轨宽手势、网格过渡名单 | nb-layout 单测；e2e：浮动窗文件 |
| 7 | 消息视图：组件重写、Lab、宿主接线、最近会话查询、命令 | nb-agent-ui dom；Lab e2e；e2e：对话与 bot 聊天文件 |
| 8 | 过渡与性能：真实页面逐帧看首中末帧、性能采样与现版比较、减少动效 | 开发服务真实页面；采样记录进 Task 证据 |

实现审查：第 1、2、4 片合起来碰布局记录与数据格式，按快速审查：Opus 先审、omp `@review` 后台；第 3、5–7 片前端，Sonnet 审；Task 收口一次总审。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| layout 50 几何与在不在 | 投影单测（片 2）；e2e 停靠右轨、右栏隐藏与拖到零、唯一视图浮出时右轨收走、显式打开的空右栏（片 3、6） |
| layout 50 三段与落点 | dom（侧轨组件）；e2e 入口带落点、拒绝区松手取消、键盘候选（片 3、4） |
| layout 50 相连与外观 | dom 与 e2e 量相连的角、接缝（片 3） |
| layout 50 展开、读入、字段往返 | 单测（片 1）；e2e 展开后刷新还在、模板与重置（片 5） |
| layout 50 预算 | 单测（片 2）；验收 36 的 e2e（片 5） |
| layout 50 轨宽手柄 | e2e 指针与键盘、Esc 零写入（片 5） |
| layout 50 切换容器 | e2e 两端轨宽不同时的布局过渡（片 5） |
| layout 50 焦点与读屏 | e2e F6 顺序与交接落点（片 5） |
| layout 51 浮动窗 | nb-layout 单测；e2e 顶格、矩形不漂移、靠右夹取、浮动窗轨宽（片 6） |
| layout 验收 35、37 | e2e（片 5、6）；37 另加真实页面逐帧（片 8） |
| views 21 视图段 | 单测与 dom：借用、旧代际拒绝、冷开不加载、`request` 三种结果（片 5） |
| views 22 位置限制 | 单测：所有提交出口、读入归整（片 4） |
| conversation 57 | nb-agent-ui dom、Lab e2e、对话 e2e：收着与展开、徽标、Esc、打开后焦点、最近会话不受筛选（片 7） |

## 验证

- 合入前跑一次的 e2e 清单（预计超过 8 个文件，`NB_E2E_WIDE="侧轨改动工作台骨架呈现、右栏入口与浮动，要消除改动对布局与拖放各文件的影响"`）：工作台布局、入口条、拖放、浮动窗、视图、标题栏、编辑区（只跑碰到右栏与入口条的）、对话、bot 聊天、Lab agent-ui。具体文件在片 3 前按 grep 定。
- 实施中改动后只重跑覆盖改动的文件与失败项。
- 真实页面：开发服务上不减弱动效走一遍浮动、归位、展开、拖宽、切容器，逐帧记录首中末帧；性能采样（长章、多编辑组、长会话列表），和现版比较；没有浏览器采样前不下帧率结论。
- 未验证边界：Windows 桌面壳里的动效与读屏、触屏。

## 不做与风险

- 不做：左右对调（另开 Task）、左轨展开的入口、底部面板、插件 SDK、按消息内容搜索、普通会话的未读、拖会话出去浮动、悬停预览展开、新的快捷命令（只加“搜索会话”）。
- 风险：
  - 投影插入右轨叶后，网格的过渡与冻结几何的既有用例大面积变化：片 3 先跑工作台 e2e 定基线，再改断言；改定位点前先改 e2e 辅助函数（记忆：拿掉标题按钮这类定位点要先改辅助函数）。
  - 位置限制的提交出口漏网：单测按审查给的路径表逐条写，用真实 store 操作，不用替身。
  - 性能：展开时编辑组与长列表同时变宽，靠片 8 的采样兜底；采样要用真实页面与真实规模的数据。
  - 旧布局回滚：新字段可选、旧版本读得进；读入归整只动受限视图，单测守住“其余原样”。
