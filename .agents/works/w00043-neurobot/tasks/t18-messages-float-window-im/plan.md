# t18 第 3 条：浮动窗里内置视图自绘头（草稿 1）

## Context

开发者 2026-11-25 把“消息”视图浮成窗口来看：工作台的面板头（“消息”一行）加对话头（“星璃”一行），列表栏到不了顶，不像 IM。[t18 决定 1、2](README.md#开发者的决定)：浮动窗里内置视图可以自绘整个头，停靠不变；样子按评审板第 1 轮的 B（列表栏通到顶，对话头那一行就是窗口头，“回到停靠”在右上角、排在“⋯”后面，两栏第一行等高）。

第 1、2 条（列表栏可拖宽、切换改标题式）已在分支上实现，不在本计划里。

现状（读代码核对过）：

- 浮动窗的外框来自 nb-layout 的 `NestedGrid`（矩形、叠放），缩放手柄是 `FloatWindowHandles`；头是工作台的 `WorkbenchPanelHead`，只有一个标签的工具视图浮动窗按“只写标题”画（[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 20）。nb-layout 不用改。
- 已有“视图接管标题区”（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19，`shared/contracts.ts` 的 `ViewHead`）：面板头那一行给视图三格，标题按钮、框架按钮仍由工作台画。消息视图只在窄版接管（`claim`），宽版交还（t15 决定 6：接管后 bot 名字居中在整窗上方、不在聊天区上方）。
- 整窗拖动的来源按元素判：浮动的叶里，按在 `[data-panel-strip]`、`[data-panel-head]` 的空白处，或它唯一的标签上（`layout-drag.ts` 的 `fromElement`）；`[data-no-drag]` 里不接收。
- 框架按钮与视图动作随鼠标悬停这块面板才显示（输出 20）。

工作方式：计划经开发者确认后做一次前端设计审查（Sonnet），再实施。工作台是 w00026 的地盘、有别的会话在动 nb-layout 与工作台的示例：开工前先把 master 并进分支，改动集中在面板头、外壳与拖动来源三处，合入前再并一次。

## 技术选型

无新的通用问题。做法参照桌面端无边框窗口的成熟约定（Electron 的 `titleBarOverlay` 与 Window Controls Overlay）：应用声明标题带的高度，系统把窗口按钮盖在标题带的一端、告诉应用按钮占多宽，标题带的空白处可拖。不用“视图给一个元素、工作台把按钮传送进去”：视图的头重渲染或出错时按钮会跟着消失。

## 关键设计

### `packages/neuro-book/src/plugins/workbench/shared/contracts.ts`

`ViewHead` 加一组（只给内置视图，同 `VIEW_HEAD`，不经插件 SDK 导出）：

```ts
/** 浮动窗里自绘头（workbench/views.md 输出 19 的“自绘头”）。 */
readonly ownHead: {
    /** 工作台写：此刻能不能自绘。视图在只有它一个标签的浮动窗里、实例已就绪时为 true。 */
    readonly available: Readonly<Ref<boolean>>;
    /** 视图写：自绘的头有多高（内容顶上这一条，CSS px）；null 是不自绘。`available` 为 false 时工作台不读。要在 setup 里同步写初值，首帧不翻。 */
    readonly band: Ref<number | null>;
    /** 工作台写：盖在这一条右端的按钮（视图动作与框架按钮）占多宽（CSS px，含间距）；视图在这一条的右端留出来。不自绘时为 0。 */
    readonly insetEnd: Readonly<Ref<number>>;
};
```

不变量：`available` 为 false（停靠、窗里有几个标签、加载中、渲染出错、交付撤回）时一律按现在的画法，视图写的 `band` 不起作用；`available` 变回 false 的同一帧面板头回来。自绘与接管标题区互斥：自绘时 `slots` 为 null。

### `web/components/WorkbenchPanelHead.vue`（及同名 `.md`）

新属性 `ownHead?: {band: number} | null`（只在 `titleOnly` 且有活动标签时起作用）。给了时：

- 这一行不占高度：头不再是 32px 的一行，内容从窗口顶上开始。
- 标题按钮照旧由它画：id、`data-panel-tab`、拖动描述、点击与右键都不变；平时看不见，聚焦时显示在这一条的左上角（做法同 `FloatWindowHandles` 的移动把手）。F6、“焦点落到标题”、键盘拿起、菜单键都落在它上面。
- 隐藏的标题元素照旧在，内容区的 `region` 名称不变。
- 视图动作与框架按钮盖在这一条的右端，竖直居中在 `band` 的高度里；悬停才显示的规则不变。量它们的宽度，经新事件 `own-head-inset` 交给外壳。
- 标签带、展开标记不画（浮动窗没有收起）。

### `web/components/WorkbenchShell.vue`、`web/views/view-head.ts`

- `createViewHead` 建 `ownHead` 的三个 ref；`ViewHeadControl` 加 `setOwnHeadAvailable`、`setOwnHeadInset`。
- 外壳按已提交的文档算 `available`：面板在 `doc.floats` 里、只写标题、活动视图申请了 `VIEW_HEAD`、实例已就绪。拖动中标签数变了不跟着变（同“只写标题”）。
- `toolHeadProps` 在 `available` 且 `band !== null` 时给 `ownHead`、不给 `viewHead`。
- 内容区根上写 `data-own-head` 与 CSS 变量 `--workbench-own-head-band`，给拖动来源用。

### `web/layout-drag.ts`

`fromElement` 里浮动的叶多一种“头”：叶带 `data-own-head` 时，按下点在内容顶上 `band` 高度以内、目标不在 `[data-no-drag]` 里、也不在可交互的元素上（`button`、`a`、`input`、`textarea`、`select`、`[role="tab"]`、`[contenteditable]`、`[tabindex]` 不为 -1 的元素），就是整窗拖动。可交互元素的判断收成一个函数，起拖门槛、Esc 取消、停靠规则都走原来的整窗拖动，不新写。这一条的空白处右键开视图的“移动到”（同标题右键）。

`FloatWindowHandles` 上边 3px 的缩放带不变，压在这一条之上（现在压在标签条之上，同样）。

### `packages/nb-agent-ui`

- `AgentConversationHead.vue`：高度读 `--acv-head-height`（缺省 32px），右内边距加 `--acv-head-inset-end`（缺省 0）；写进同名 `.md` 与 `AgentConversationView.md` 的“顶栏”。
- `AgentMessages.vue`：头像列顶上的按钮那一行对齐到 `--acv-head-height`（收起时与对话头同一行）。列表的切换行已是 40px。

### `packages/neuro-book/src/plugins/agent/web/MessagesHost.vue`

- `head.ownHead.available` 为 true 时：`band` 写 40，`claim` 写 false，对话的头画在内容里（宽窄两种版式都是），根上写 `--acv-head-height: 40px` 与 `--acv-head-inset-end: <insetEnd>px`。
- 为 false 时回到现在的逻辑（窄版接管标题区、宽版交还）。
- 初值在 setup 里同步写（首帧不翻）；`memory` 不用加字段。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/views.md` 输出 19 | 加“自绘头”一段（planned）：何时可用、视图给高度、工作台盖按钮并给宽度、标题按钮聚焦才显示、不可用时回到面板头 |
| `docs/specs/ui/workbench-layout.md` 输出 20、39 | 浮动窗只写标题的头可以交给视图自绘；整窗移动的来源加“自绘头那一条的空白处” |
| `docs/specs/agent/conversation.md` 消息视图一段、输出 44 | 浮动窗里宽窄两版都自绘头，列表栏通到顶 |
| `WorkbenchPanelHead.md`、`AgentConversationHead.md`、`AgentConversationView.md`、`AgentMessages.md` | 同上各自的部分 |

## 切片

1. Spec（planned）四处，master 上提交。
2. 工作台：合同、`createViewHead`、面板头的自绘画法、外壳的 `available` 与内容区标记、拖动来源。面板头的 dom 测试、Lab 场景（`WorkbenchPanelHead` 加自绘的场景）、`workbench-float` 的 e2e。提交。
3. nb-agent-ui 的两个 CSS 变量与消息视图宿主接上。Lab 场景、`agent-conversation` 的 e2e。提交。
4. 前端实现审查（Sonnet），处理后合入。

每片自跑：所在包的 `typecheck`、组件测试，改到的 e2e 文件。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 浮动窗里只有消息视图一个标签时没有“消息”一行，列表栏顶到窗口顶，对话头与切换行同高 | `agent-conversation.e2e.ts`：量面板头高度为 0、两行的 top 与 height |
| 按住这一条的空白处拖，窗口跟着走；按在标签、按钮、输入框上不起拖 | `workbench-float.e2e.ts`：拖前后窗口矩形；在“会话”标签上按下拖动后矩形不变 |
| “回到停靠”在右上角、悬停才显示，点了回到停靠；对话头的“⋯”不被它盖住 | `workbench-float.e2e.ts`：`elementFromPoint` 取“⋯”中心；点“回到停靠” |
| 键盘：F6 到这个窗，标题按钮聚焦时看得见，空格拿起、菜单键开“移动到” | `workbench-float.e2e.ts`；`WorkbenchPanelHead.dom.test.ts` |
| 往这个窗里再放一个视图（成了标签条）：面板头回来，对话头回到内容里；拿走后又自绘 | `workbench-float.e2e.ts` |
| 停靠在右栏、侧栏：画法不变 | 现有 `agent-conversation.e2e.ts`、`workbench-views.e2e.ts` 不改就过 |
| 视图加载中、渲染出错：面板头照常写标题 | `WorkbenchPanelHead.dom.test.ts`、`view-head` 的单测 |

## 验证

- 合入前 e2e 跑一次：`workbench-float`、`agent-conversation`、`bots-chat`、`lab-scenes`、`lab-agent-ui`、`workbench-views`（6 个文件）。实施中只重跑改到的文件。
- 开发服务的真实页面上不减弱动效走一遍：浮出来、拖、缩放、回到停靠、再放一个视图进去。
- 变异检查：去掉“可交互元素不起拖”、去掉 `insetEnd`、`available` 恒为 true，各自对应的用例要失败。
- 未验证边界：触摸拖动只跑现有用例，不另测。

## 不做与风险

- 不做：停靠时的自绘头（分节的标题行要管收起与入口条）；第三方视图的自绘头（合同不经 SDK 导出）；浮动窗的最小化、最大化。
- 风险：这一条里视图的元素很多，“可交互元素不起拖”漏判会让按钮点不了或拖不动。用例用消息视图真实的头（切换标签、收起按钮、头像列按钮、对话头的“⋯”）逐个点一遍兜底。
- 风险：与 w00026 在工作台的改动冲突。开工前与合入前各并一次 master，冲突当场解并重跑受影响的 e2e。
- 风险：`insetEnd` 是量出来的，按钮悬停才显示时也要占位（现在动作透明时也占位，沿用）。

## 待确认

1. 框架按钮沿用“悬停这块窗才显示”（与别的面板一致），评审板的图里是常驻的。推荐沿用悬停：平时对话头右端只有“⋯”，更干净。
2. 键盘用的标题按钮平时看不见、聚焦时显示在左上角。推荐这样做：不占版面，读屏与键盘都还在。
3. 浮动窗窄于 600px（窄版）时也自绘头：头像列通到顶，对话头在内容里。推荐也自绘：否则同一个窗拖窄一点头就换样子。
