# t20 计划

## Context

开发者 2026-11-27 看 t19 合入后的页面提了 6 点，三处缺陷已在 t19 收尾修掉。本计划先写第 1 项“归位后再浮动记住尺寸”（开发者同意做）；第 2、3 项等评审板定了再补进来。

合同：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 39 的“记住矩形”（planned，本 Task 写）。

## 技术选型

无。

## 关键设计

### `packages/nb-workbench-layout/src/layout-doc.ts`

- `LayoutDoc` 加正式可选字段 `floatRects?: Readonly<Record<string, LayoutFloatRect>>`，键是工具视图的标签键 `view:<id>`。按视图记，不记在分节或锚上：视图在区域之间、容器之间搬来搬去时记录不丢，也不用在每种搬法里各搬一次。
- 结算放在结构操作的出口 `finish`，与 `settleRails` 并列的 `settleFloatRects(original, next)`：`original` 里的浮动窗在 `next` 里不再浮动，它的每个工具视图标签在 `next` 里落在树里（不是别的浮动窗）时，写 `floatRects[key] = 窗的记录矩形`（收着的矩形，不含侧轨展开的差值）；然后删掉 `next` 里已经没有这个标签的键；删空了整个字段不写。拖回、按钮归位、并进树里的面板都经 `finish`，不在各操作里各写一份。
- `sameLayoutShape` 的比较形加上 `floatRects`（键排序后比矩形）。

### `packages/nb-workbench-layout/src/layout-doc-validate.ts`

- 归一 `floatRects`：不是对象整个丢；键不是 `view:` 开头、是禁用 id、值不是合法矩形（`isFloatRect`）的项丢掉，记进 `repairs`；修完空了不写。标签不在文档里的项读入时不删（视图目录还没交进来时也会这样），等下一次提交的出口清。

### `packages/neuro-book/src/plugins/workbench/web/state/layout-doc-store.ts`

- `floatTab(key)`：`key` 是工具视图、`doc.floatRects?.[key]` 在时用它，不调 `defaultFloatRect`；编辑器标签照旧。呈现的夹取与侧轨差值照旧在 `renderedFloats`。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md` 输出 39 加“记住矩形”（planned），“副作用与数据”加一句不改版本。
- `nb-workbench-layout` 的 README 或文档模型说明里有字段清单的话同步。

## 切片

1. 库：字段、结算、形状比较、校验归一，单测（`layout-doc.test.ts`、`layout-doc-validate` 的用例）。
2. store：`floatTab` 用记下的矩形；store 的真实存储往返用例（浮出、调大小、归位、再浮出，刷新后再浮出）。
3. e2e：`agent-messages-float` 加一条：调宽、归位、再浮出是调过的宽，展开状态照旧带着。

## 验收映射

- 输出 39“记住矩形”：库单测（归位、拖回、并进树里的面板记；并进别的浮动窗不记；视图没了清掉；编辑器不记）、校验单测（坏项丢掉给诊断）、store 用例（再浮出用记下的、刷新后还在）、e2e 一条。

## 验证

- `bun test` 跑 `nb-workbench-layout` 与工作台 store；`agent-messages-float.e2e.ts`、`workbench-float` 相关 e2e 文件。
- 数据格式改动：实现审查按快速审查（Opus 先审，omp `@review` 后台）。

## 不做与风险

- 编辑器标签不记：编辑器的浮出与归位走编辑器区，标签是动态的。
- 多标签的窗每个视图记同一个矩形，之后单独浮出其中一个时用整窗的大小。

---

# 第二部分：侧轨展开后的版式与消息列表（第 2、3 项）

## Context

评审板六轮定下（Task README 决定 2 到 8）：收着时窄列照旧；展开后没有窄列，整块给列表；列表照 t03 第 5 轮的稿（bot 的 IM 行、会话面板的行，按最近活动排、不分组），顶上不再有页签，底部是横的导航 Bot｜会话；展开收起按钮收着时在窄列最上面、展开后在列表搜索行右端；右栏有别的容器时展开的列表顶上一行入口；列表缺省宽 300。

合同（planned，`974b1108d`）：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 50 的“三段”“展开时的版式”、输出 51 的“顶格”；[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 21 的 `placement`；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 57 的“收着”“展开”“浮动”。

工作方式：主会话写业务代码与 dom 测试；e2e 交 Sonnet 子代理在 e2e worktree 里写（按下面“测试分工”）。

## 技术选型

无新依赖。导航按钮的移动用 FLIP（量起点、换 DOM、按差值做 `transform` 过渡，WAAPI），时长与曲线取 `--motion-layout`、`--ease-layout`；减少动态效果时不做。

## 关键设计

计划审查（前端 Sonnet，12 条，处理见 [`evidences/plan2-review-sonnet.txt`](evidences/plan2-review-sonnet.txt)）之后的第 2 稿。

### 展开收起按钮归视图段：`packages/nb-agent-ui/src/vue/messages/AgentMessagesSegment.vue`、`placement.ts`

- 按钮由视图段画，标 `data-messages-segment-toggle` 与通用的 `data-rail-toggle`（宿主交接焦点只认后者），`aria-expanded`、被拒时 `data-rail-too-narrow`。**收着与展开是同一个元素**：`main` 的第一个子元素一直挂着，收着时在流里排在头像上面（浮动窗里在顶格下面），展开时改成绝对定位在列表区右上角；焦点跟着元素走，不经 body。
- 收着时它带 `data-rail-item`（进侧轨的纵向工具条）；展开时不带，它是视图段列表区域里的普通按钮，Tab 可达。
- `fitSegment` 的容量扣掉按钮那一格（`messages-segment-fit.ts` 加一个保留高度的参数），不会多放一项把按钮滚走。
- 底段只剩“全部 bot”“会话历史”；展开时底段的容器加 `hidden`（`Teleport` 的目标不拆，项不进 Tab，侧轨的 roving 也跳过不可见的项）。
- `placement.rail` 加 `width` 与 `tooNarrow`（`shared/contracts.ts` 的 `ViewRailPlacement` 与注释、`views/view-rail.ts` 的发放与相等比较一起改）。点按钮发 `toggle-expanded`，宿主在两种位置都调 `ViewRail.request`。
- 测试视图 `src/web/testing/sample-views.ts` 的 `SampleRailView` 也画同样标记的按钮（`data-rail-toggle`），侧轨的用例照旧能展开。

### 列表：`AgentMessagesList.vue`、`AgentSessionPanel.vue`

- 页签挪到底部成横的导航 `data-messages-nav`：两项沿用 `data-messages-tab`、`role="tab"`，图标在上、字在下，当前页强调色；Bot 项的未读合计沿用 `data-messages-summary`（中性色数字，有等你处理时 warning 色，`data-messages-summary-waiting`）。方向键、Home、End 照旧。
- 列表区第一行读 `--acv-list-inset-end`（`var(--acv-list-inset-end, 0px)`，登记进 `style-tokens.dom.test.ts` 的 `hostVars`）作右内边距，给按钮让位；浮动窗里“回到停靠”在视图段顶格（edge-body 的 `padding-top`），不和搜索行同一行，不用另算。
- 会话面板的搜索行按第 6 轮 A（决定 8，conversation 输出 3 的 planned 部分）：一行是 `Input`（`icon-class` 放大镜，提示“搜索”）加新建 `IconButton`（`i-lucide-square-pen`）；过滤按钮（`i-lucide-sliders-horizontal`，带条数）放进 `Input` 的 `suffix` 插槽，菜单最上面一组单选是作品范围，下面是 Profile 与显示已归档；“全部作品”计入条数，清除时回到当前作品。组件事件不变（`update:scope` 照旧），只是从菜单发出。搜索框占满剩下的宽；草稿里 220 宽不挤，不再做窄时换行。bot 页搜索框提示改成“搜索”。行的样子不改。

### 过渡：`AgentMessagesSegment.vue`

- **起点在发请求之前量**：视图段自己的入口（按钮、底段两项、导航两项）在点击处理里先记下要移动的那几个元素的矩形，再发事件；不在 `expanded` 变化的 watch 里量（同一次 flush 里外壳已经翻了状态、底段已经藏了，见 `AgentMessages.vue` 固定聊天区那段的同一个教训）。经命令或别处发起的展开收起没有起点，直接换（Spec 已写）。
- **终点稳定**：列表区按最终宽度排（`placement.rail.width` / `edge` 的宽），停靠时贴右（右轨朝左长、右缘不动），浮动窗贴左（窗朝右长、视图段左缘不动），外层裁切；导航的终点在换完 DOM 时就是最终位置。
- 展开：收着的项淡出（`--motion-fast`）；导航两项从记下的底段矩形 FLIP 到自己的位置（`--motion-layout`）；列表正文沿用现有的延后淡入。收起：列表包一层 `Transition`，离场淡出（`--motion-base`）；底段两项从记下的导航矩形 FLIP 回去。连点时取消上一次动画，从当前画出来的位置量。减少动态效果时不做，直接到位。
- 动画进行中视图段根上写 `data-messages-moving`（e2e 的可观察信号），结束清掉。

### 侧轨：`WorkbenchToolStrip.vue`、`WorkbenchShell.vue`、`layout-drag.ts`

- 拿掉侧轨自己的展开按钮（`data-rail-expand`）；焦点交接的 watch 改找 `[data-rail-toggle]`，收着到展开的方向也交接（焦点在被藏起来的底段或收着的项里时给按钮）。
- 展开时网格改成一列：入口带横排在顶上一行（`data-tool-band-axis="x"`），只在有不止一个入口时显示（用 `v-show`，不 `v-if`：`ResizeObserver` 与 `useEntryIndicator` 挂在同一个元素上）；`measureBand` 按轴量（横排时按宽）；悬停提示朝下；roving 的方向键横排时用左右。`main` 占满剩下的；底段藏起来。竖排与横排之间不过渡，直接换。
- 拖放：`layout-drag.ts` 入口带的轴读 `data-tool-band-axis`（缺省 `y`），`groupEnd` 按轴取；排序位移已有 `vertical` 分支。
- 轨宽手柄不变。

### 消息视图宿主：`MessagesHost.vue`、`messages-head.ts`

- `MESSAGES_RAIL_BOUNDS.width` 改 300；rail 位置带上 `width`、`tooNarrow`；`toggle-expanded` 在两种位置都调 `request`。

### 同名说明与 Lab

- 同步 `AgentMessagesSegment.md`、`AgentMessagesList.md`、`AgentSessionPanel.md`、`WorkbenchToolStrip.md`；Lab 里写了 260 的夹具改成 300（agent-ui 夹具、`rail-cards` 场景），登记的场景照旧能点开。

## 测试分工

e2e 子代理按下面的标记写，不读实现：

| 东西 | 标记 |
|---|---|
| 展开收起按钮（停靠、浮动都是它；测试视图也有） | `[data-rail-toggle]`（消息视图上另有 `data-messages-segment-toggle`），`aria-expanded`，被拒时 `data-rail-too-narrow` |
| 底部导航 | `[data-messages-nav]` 里的 `[data-messages-tab="bot"]`、`[data-messages-tab="sessions"]`（`role=tab`、`aria-selected`）；Bot 项的未读 `[data-messages-summary]`、等你处理 `data-messages-summary-waiting` |
| 收着时底段 | `[data-rail-segment="foot"] [data-messages-open]`（展开时不可见、不可 Tab） |
| 展开时的入口带 | `[data-rail] [data-tool-band]` 带 `data-tool-band-axis="x"`；只有一个容器时不可见 |
| 过渡中 | 视图段根 `[data-messages-segment]` 上的 `data-messages-moving`；减少动态效果时从不出现 |
| 搜索行不被按钮盖住 | 判据：按钮中心 `elementFromPoint` 是按钮，搜索框右缘不超过按钮左缘 |
| 侧轨状态 | `[data-rail]` 的 `data-rail-state`（不变） |

要迁移：用 `[data-rail-expand]` 的、页签在顶上（`[data-messages-switch]`）的、按 260 算的（`GROWTH = 260 − 48`、`ENTRY_COLUMN`、宽版视口按 260 选的）用例与辅助函数：`agent-messages-rail`、`agent-messages-float`、`workbench-side-rail`、`workbench-side-rail-segment`、`lab-agent-ui`、`support/side-rail.ts`；主会话另改 `scripts/perf/layout-frames.ts` 里的 `[data-rail-expand]`。

## 切片

1. 视图段与列表：同一个按钮的两种位置、`fitSegment` 扣格、底段只剩两项并在展开时 `hidden`；`placement.rail.width/tooNarrow` 与合同；底部导航、搜索行让位、会话面板的搜索行按 A（范围进过滤菜单）；测试视图的按钮；dom 测试（按钮两种位置是同一个元素、导航的键盘与未读分档、`--acv-list-inset-end` 登记）。
2. 侧轨：拿掉自己的按钮、焦点交接改认 `data-rail-toggle`、展开时一列与横排入口带（`v-show`、按轴量、提示朝下、左右方向键）、拖放轴；宿主接线与 300；同名说明与 Lab 夹具；工作台 dom 测试。
3. 过渡：FLIP 与淡入淡出；开发服务真实页面上放慢看（design-language 坑 84 的做法）。
4. e2e（子代理）：第 A 段迁移现有用例与辅助函数，第 B 段新行为（导航、按钮两种位置、横排入口带的点击与拖放、减少动态效果下直接到位）。

## 验收映射

- 输出 50“三段”“展开时的版式”：工作台 dom（展开时一列、入口带横排只在多容器时）、e2e B 段（横排入口点击与拖放、按钮位置）。
- 输出 51“顶格”：e2e（浮动收着时按钮在“回到停靠”下面、中线对齐，沿用对齐用例）。
- views 输出 21 `placement.tooNarrow`：view-rail 单测、e2e 的“窗口太窄”迁移。
- conversation 输出 57“收着”“展开”“浮动”：nb-agent-ui dom、e2e。

## 验证

- dom：`nb-agent-ui` 的 messages 目录、工作台组件目录；`bun test` 工作台；类型检查。
- e2e 合入前清单：`agent-messages-rail`、`agent-messages-float`、`workbench-side-rail`、`workbench-side-rail-segment`、`workbench-containers`、`agent-conversation`、`lab-agent-ui`（7 个文件）。
- 性能：`scripts/perf/layout-frames.ts` 重跑一次（展开收起换了版式）。
- 开发服务真实页面点一遍展开收起（不减弱动效），截慢放帧。
- 前端实现审查：Sonnet。

## 不做与风险

- 浮动窗展开时聊天区不变宽（t19 的做法照旧），顾问提的“浮动窗优先保聊天区”已经是现状。
- 顾问提的别处不协调（消息气泡上方的 YOU、ASSISTANT，浮动窗投影）不在本 Task。
- 风险：FLIP 的终点依赖导航按最终宽度排；轨宽过渡被别的布局变化打断时，终点会变，动画按收口规则直接到位。
