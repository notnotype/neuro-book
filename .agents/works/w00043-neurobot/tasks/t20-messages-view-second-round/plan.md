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

评审板五轮定下（Task README 决定 2 到 7）：收着时窄列照旧；展开后没有窄列，整块给列表；列表照 t03 第 5 轮的稿（bot 的 IM 行、会话面板的行，按最近活动排、不分组），顶上不再有页签，底部是横的导航 Bot｜会话；展开收起按钮收着时在窄列最上面、展开后在列表搜索行右端；右栏有别的容器时展开的列表顶上一行入口；列表缺省宽 300。

合同（planned，`974b1108d`）：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 50 的“三段”“展开时的版式”、输出 51 的“顶格”；[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 21 的 `placement`；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 57 的“收着”“展开”“浮动”。

工作方式：主会话写业务代码与 dom 测试；e2e 交 Sonnet 子代理在 e2e worktree 里写（按下面“测试分工”）。

## 技术选型

无新依赖。导航按钮的移动用 FLIP（量起点、换 DOM、按差值做 `transform` 过渡，WAAPI），时长与曲线取 `--motion-layout`、`--ease-layout`；减少动态效果时不做。

## 关键设计

### 展开收起按钮归视图段：`packages/nb-agent-ui/src/vue/messages/AgentMessagesSegment.vue`、`placement.ts`

- 按钮由视图段画，两种位置一样：收着时是 `main` 的第一项（浮动窗里在顶格下面，顶格由 `--acv-segment-inset-top` 让出），展开后叠在列表右上角（绝对定位在列表区的右上，列表第一行按 CSS 变量 `--acv-list-inset-end` 让出位置；会话面板的搜索行、bot 页的搜索行都读这个变量，不用往两个组件里各塞一个按钮）。
- 标记沿用 `data-messages-segment-toggle`、`aria-expanded`、`data-rail-too-narrow`；`placement.rail` 加 `tooNarrow`（宿主从侧轨状态给，同 `window`）。点了发 `toggle-expanded`，宿主在两种位置都调 `ViewRail.request`。
- 底段只剩“全部 bot”“会话历史”；展开时底段的元素还在（`Teleport` 的目标不能拆），藏起来。

### 列表：`AgentMessagesList.vue`、`AgentSessionPanel.vue`

- 页签从顶上挪到底部，成横的导航 `data-messages-nav`：两项 Bot、会话，各是 `role="tab"`、沿用 `data-messages-tab`，图标在上、字在下，当前页强调色；Bot 的未读合计是中性色的数字，有等你处理时 warning 色（同收着时底段的汇总）。方向键、Home、End 照旧。
- 导航的两项按列表最终宽度靠右排（同浮动窗视图段的做法：外层裁切、里层定宽），宽度过渡中不跟着挪，FLIP 的终点在过渡开始时就是对的。
- 两个搜索行读 `--acv-list-inset-end` 作右内边距；会话面板的搜索框占满剩下的宽（现在只有一截）；bot 页搜索框提示改成“搜索”。行的样子不改（就是 t03 定的那套）。

### 过渡：`AgentMessagesSegment.vue`

- 展开：收着时 `main` 里的头像、会话方块与按钮先淡出；底段两个按钮的矩形作起点，导航两项从那里移到自己的位置（FLIP），列表正文随后淡入（沿用现有 `acv-segment-list-in`）。收起：导航两项的矩形作起点，底段两个按钮从那里移回；时长比展开短（`--motion-base`）。
- 量起点在 `expanded` 变化的同一次更新之前（`flush: "pre"` 的 watch 里读），换完 DOM（`nextTick`）再起动画；连点时取消上一次动画、从当前位置量。减少动态效果（`matchMedia('(prefers-reduced-motion: reduce)')`）或量不到时直接到位。

### 侧轨：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchToolStrip.vue`、`WorkbenchShell.vue`、`views/view-rail.ts`、`layout-drag.ts`

- 拿掉侧轨自己的展开按钮（`data-rail-expand`）；`segment` 里的 `tooNarrow` 交给视图段的 `placement`（`view-rail.ts` 的 rail 位置加字段，比较相等时也比它）。
- 展开时网格改成一列：入口带横排在顶上一行（`data-tool-band-axis="x"`），只在有不止一个入口时画；`main` 占满剩下的；底段藏起来。收着时照旧竖排。
- 拖放：入口带的轴读 `data-tool-band-axis`（缺省 `y`），`layout-drag.ts` 里写死 `axis: "y"` 的那处改读它；排序的位移已经按 `vertical` 分支。
- 轨宽手柄不变。

### 消息视图宿主：`packages/neuro-book/src/plugins/agent/web/MessagesHost.vue`、`messages-head.ts`

- `MESSAGES_RAIL_BOUNDS.width` 改 300；`rail` 位置带上 `tooNarrow`；侧轨位置下的 `toggle-expanded` 也调 `request`。

## 测试分工

e2e 子代理按下面的标记写，不读实现：

| 东西 | 标记 |
|---|---|
| 展开收起按钮（停靠、浮动都是它） | `[data-messages-segment-toggle]`，`aria-expanded`，被拒时 `data-rail-too-narrow` |
| 底部导航 | `[data-messages-nav]` 里的 `[data-messages-tab="bot"|"sessions"]`（`role=tab`、`aria-selected`） |
| 收着时底段 | `[data-rail-segment="foot"] [data-messages-open]`（展开时看不见） |
| 展开时的入口带 | `[data-rail] [data-tool-band]`，`data-tool-band-axis="x"`；只有一个容器时没有 |
| 侧轨状态 | `[data-rail]` 的 `data-rail-state`（不变） |

要迁移：用 `[data-rail-expand]`、`[data-messages-tab]` 在顶上、`GROWTH = 260 − 48` 的现有用例（`agent-messages-rail`、`agent-messages-float`、`workbench-side-rail*`、`support/side-rail.ts`）。

## 切片

1. 视图段：按钮位置、`placement.rail.tooNarrow`、底段只剩两项；列表底部导航、搜索行让位；dom 测试（按钮两种位置、导航的键盘与未读颜色的分档、`--acv-list-inset-end`）。
2. 侧轨：拿掉自己的按钮、展开时一列与横排入口带、拖放轴；宿主接线与 300；工作台 dom 测试与 store 不受影响的确认。
3. 过渡：FLIP 与淡入淡出；开发服务真实页面上放慢看（design-language 坑 84 的做法）。
4. e2e（子代理）：第 A 段迁移现有用例与辅助函数，第 B 段新行为（导航、按钮两种位置、横排入口带的点击与拖放、减少动态效果下直接到位）。

## 验收映射

- 输出 50“三段”“展开时的版式”：工作台 dom（展开时一列、入口带横排只在多容器时）、e2e B 段（横排入口点击与拖放、按钮位置）。
- 输出 51“顶格”：e2e（浮动收着时按钮在“回到停靠”下面、中线对齐，沿用对齐用例）。
- views 输出 21 `placement.tooNarrow`：view-rail 单测、e2e 的“窗口太窄”迁移。
- conversation 输出 57“收着”“展开”“浮动”：nb-agent-ui dom、e2e。

## 验证

- dom：`nb-agent-ui` 的 messages 目录、工作台组件目录；`bun test` 工作台；类型检查。
- e2e 合入前清单：`agent-messages-rail`、`agent-messages-float`、`workbench-side-rail`、`workbench-side-rail-segment`、`workbench-containers`、`agent-conversation`（6 个文件）。
- 开发服务真实页面点一遍展开收起（不减弱动效），截慢放帧。
- 前端实现审查：Sonnet。

## 不做与风险

- 浮动窗展开时聊天区不变宽（t19 的做法照旧），顾问提的“浮动窗优先保聊天区”已经是现状。
- 顾问提的别处不协调（消息气泡上方的 YOU、ASSISTANT，浮动窗投影）不在本 Task。
- 风险：FLIP 的终点依赖导航按最终宽度排；轨宽过渡被别的布局变化打断时，终点会变，动画按收口规则直接到位。
