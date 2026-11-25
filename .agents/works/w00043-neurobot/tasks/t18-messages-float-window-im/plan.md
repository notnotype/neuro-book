# t18 第 3 条：浮动窗里内置视图自绘头

草稿 1 经开发者确认（[决定 3](README.md#开发者的决定)）后做了设计审查（Sonnet，13 条，[报告](evidences/design-review-1.txt)，[处理](evidences/design-review-1-disposition.md)）。两条阻断属实：面板头在外框层、内容层压在它上面，自绘头里的按钮会被内容盖住；内容的上边距是外壳按常量给的，草稿 1 只改了头。草稿 2 改了按钮画在哪一层、内容怎么上移、拖动区怎么认，其中三处取舍经评审板第 2 轮定了（[决定 4](README.md#开发者的决定)）。

## Context

开发者 2026-11-25 把“消息”视图浮成窗口来看：工作台的面板头（“消息”一行）加对话头（“星璃”一行），列表栏到不了顶，不像 IM。[t18 决定 1–3](README.md#开发者的决定)：浮动窗里内置视图可以自绘整个头，停靠不变；样子按评审板第 1 轮的 B（列表栏通到顶，对话头那一行就是窗口头，“回到停靠”在右上角、排在“⋯”后面，两栏第一行等高）；框架按钮悬停才显示；键盘用的标题按钮聚焦才显示、在左上角；窄版也自绘。

现状（读代码核对过，审查也核过）：

- nb-layout 的 `NestedGrid` 把每个浮动窗分三层：外框（`data-leaf`，里面是工作台画的面板头与卡片，层级 +0）、内容（`data-content-leaf`，层级 +1）、窗口零件（`float-chrome` 插槽，层级 +2，工作台在这里放 `FloatWindowHandles` 的缩放带与键盘移动把手）。内容的矩形由外壳经 `layoutContents`（`state/layout-present.ts`）给的 `insetTop` 定：工具面板是常量 32，并进入口条的分节（`headless`）是 0。
- 已有“视图接管标题区”（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19，`shared/contracts.ts` 的 `ViewHead`）：面板头那一行给视图三格。消息视图只在窄版接管（`claim`）。
- 整窗拖动的来源按元素判（`layout-drag.ts` 的 `fromElement`，会话只给按下的元素、不给坐标）：浮动的叶里按在面板头空白处或它唯一的标签上；`[data-no-drag]` 里不接收。浮动窗的落点几何从面板头量（`geometryOf` 的 `strip`），“拖到头上是添加到最后”靠它。
- 框架按钮与视图动作随鼠标悬停或焦点在这块面板才显示：范围是外框层的卡片，指针在内容上时靠 `WorkbenchSurface` 写的 `data-hover-actions-active`（`actionsShownOn`）。

工作方式：照本计划实施（不再做第二轮设计审查，实现审查照常）。工作台是 w00026 的地盘：开工前已把 master 并进分支（`bed74d514`），合入前再并一次。

## 技术选型

无新的通用问题。做法照桌面端无边框窗口的成熟约定（Electron 的 `titleBarOverlay` 与 `-webkit-app-region`、浏览器的 Window Controls Overlay）：

- 应用声明标题带的高度，系统把窗口按钮盖在标题带的一端，按钮占的宽度用 CSS 变量告诉应用（WCO 的 `env(titlebar-area-*)`）。
- 可拖的区域由应用声明（`-webkit-app-region: drag`），里面的可交互元素不拖；没声明的地方不拖。草稿 1 的“除了可交互元素都能拖”靠一份会漏的清单，改掉。

## 关键设计

### 什么时候自绘：`packages/neuro-book/src/plugins/workbench/shared/contracts.ts`

视图在实现上静态声明，和 `VIEW_HEAD` 一样只给内置视图、不经插件 SDK 导出：

```ts
/** 浮动窗里自绘整个头（workbench/views.md 输出 19 的“自绘头”）：`band` 是视图画的头那一条的高度（CSS px）。 */
export const VIEW_OWN_HEAD: unique symbol = Symbol("nbook.workbench/view-own-head");
export interface ViewOwnHeadOptIn {
    readonly [VIEW_OWN_HEAD]: {readonly band: number};
}

interface ViewHead {
    // ……现有字段
    /** 此刻自绘着没有（工作台写）：视图声明了自绘头、在只有它一个标签的浮动窗里时为 true。为 true 时 `slots` 是 null。 */
    readonly ownHead: Readonly<Ref<boolean>>;
}
```

- **判据**：外壳按已提交的文档算“自绘头的面板”：在 `doc.floats` 里、只写标题（`titleOnlyPanels`，拖动中不跟着变）、活动视图声明了 `VIEW_OWN_HEAD`，并且活动视图的实例已就绪（`instances.headOf` 拿得到这一代的标题区）。加载中、渲染出错、交付撤回时照常画面板头（[决定 4](README.md#开发者的决定)）：就绪那一刻面板头收起、内容上移 32px，出错时反过来，直接换、不过渡。
- **与接管标题区互斥由外壳保证**：`headOfPanel` 在自绘头的面板上返回 null，`slots` 不给、`press()` 不调；视图写的 `claim` 照旧，不用为自绘改它（审查 12）。
- **标题按钮的 Enter**：自绘时它和普通浮动窗的标题一样只是激活，不通知视图。窄版的抽屉由头像列顶上的按钮开，关后焦点回那个按钮（`drawerAnchor` 为 null 时的现有行为）。

### 内容上移：`state/layout-present.ts`、`web/components/WorkbenchSurface.vue`

- `layoutContents` 多收一个“自绘头的面板”集合，给 `insetTop: 0`，同 `headless`。外壳把集合交给表面（新属性 `ownHeadPanels`）。
- 外框里不画这块面板的头（同 `headless` 的 `!headless.has(...)` 分支），头改画在窗口零件层（下一节）。
- 自绘头的浮动窗的内容裁切框四个角都圆（`.workbench-surface__content-clip` 现在只圆下面两个），列表栏的底色不从窗口圆角外露出来。
- 浮出、停靠回去：头的有无在提交时换，这时外框与内容本来就在飞（矩形变了），内容飞向的终点已经是 `insetTop: 0` 的矩形，不跳。停靠回去时停靠位的面板头在提交那一帧画出来。窗里加第二个标签（或拿走）时窗口矩形不变，内容的上边距 0 与 32 之间直接换、不过渡：这一刻标签条同时出现或消失，接受，写进 Spec。现有 `expectHeadKept` 守的是普通视图的飞行，不受影响。
- 不动 `hasRoom`、浮动窗的最小高度（都按 32 的头算，自绘头的窗只会更宽松）。nb-layout 不改。

### 盖在头上的按钮：`web/components/WorkbenchPanelHead.vue`（及 `.md`）、`WorkbenchShell.vue`

- `WorkbenchPanelHead` 加属性 `ownHead?: {band: number} | null`。给了时它画成一条盖层：高 `band`、铺满窗口宽，本身 `pointer-events: none`，只有里面的按钮接指针。
  - 右端：视图动作与框架按钮，竖直居中在 `band` 里，悬停才显示的规则不变。
  - 左上角：标题按钮（id、`data-panel-tab`、拖动描述、点击与右键都不变），平时 `opacity: 0` 且不接指针，聚焦时淡入、接指针。不用 `display:none` 或 `visibility:hidden`：F6、“焦点落到标题”、拖动后还焦点都要能落到它上面。
  - 隐藏的标题元素照旧在，内容区 `region` 的名称不变。不画标签带与展开标记。
- 外壳在 `float-chrome` 插槽里、`FloatWindowHandles` 之前画它（窗口零件层，压在内容之上；缩放带与移动把手排在它后面，仍在最上）。外框里那份不画。
- 悬停范围：盖层自己带 `data-hover-actions-scope`，`data-hover-actions-active` 用表面现有的 `actionsShownOn`（指针在这块窗上或焦点在里面）。表面把 `actionsShownOn` 经 `float-chrome` 插槽的参数给出来。
- **右端按钮占的宽度**：面板头量右端那组的宽度（`useLayoutExtent`，同它现有的两侧量法），经事件交给外壳；外壳在这块窗的内容外层写 CSS 变量 `--workbench-own-head-inset-end`。按钮一组的宽度只在动作增减时变，缩放窗口不变。视图与 nb-agent-ui 只读 CSS 变量，不经 ref（审查 9）。

### 拖动区：`web/layout-drag.ts`

- 视图在自绘的头里给可拖的元素写 `data-window-drag`（对应 `-webkit-app-region: drag`）。`fromElement` 多一种来源：按下的元素在自绘头的浮动窗的内容里（`closest("[data-content-leaf][data-float]")`，叶在自绘头的集合里），往上找得到 `[data-window-drag]`，并且从按下的元素到这个拖动区之间没有可交互的元素，就是整窗拖动。可交互元素收成一个函数，只在拖动区里面往上查：`button`、`a[href]`、`input`、`textarea`、`select`、`label`、`summary`、`[contenteditable]`、`[role=button|tab|link|menuitem|checkbox|switch|option]`、`tabindex` 不为 -1 的元素。漏判的后果只是拖这个元素会移动窗口（起拖有门槛，单击照常）。起拖门槛、Esc 取消、停靠规则都走原来的整窗拖动。
- 落点几何：自绘头的浮动窗，`strip` 取窗口顶上 `band` 高的那一条（拖别的视图到这一条上是添加到最后，同普通浮动窗的头）。键盘的落点候选同样。
- 右键“移动到”：只在按下的元素就是拖动区本身（空白处，不是里面的文字、头像、按钮）且视图没有 `preventDefault` 时开，监听在表面根上、冒泡阶段。文字上右键留给浏览器（复制）。
- 不做双击头（浮动窗没有最大化），拖动区不改光标（桌面应用的拖动区也不改）。

### `packages/nb-agent-ui`

- `AgentConversationHead.vue`：高度读 `--acv-head-height`（缺省 32px），右内边距加 `--acv-head-inset-end`（缺省 0）。新属性 `windowDrag?: boolean`：为 true 时头的根写 `data-window-drag`。头总是 `user-select: none`；拖动区加 `touch-action: none`；头像 `draggable="false"`（原生的图片拖动会取消指针手势）。标题居中会随右内边距左移半个按钮组的宽，接受（“⋯”与“回到停靠”在一起时标题仍在两组之间居中）。
- `AgentMessages.vue`、`AgentMessagesList.vue`：同一个 `windowDrag` 属性给列表的切换行（`tablist` 那一行）与头像列顶上那一行写 `data-window-drag`；头像列顶上那一行高对齐到 `--acv-head-height`。切换行已是 40px。
- 窄版抽屉在自绘头时顶边让出头的高度（`top: var(--acv-head-height)` 只在 `windowDrag` 时），不压对话头与“回到停靠”。
- 各组件的 `.md` 与 `AgentConversationView.md` 的“顶栏”写上这几项。nb-agent-ui 不出现 workbench 的名字：变量与属性都是它自己的。

### `packages/neuro-book/src/plugins/agent/web/MessagesHost.vue`、消息视图的实现

- 消息视图的实现声明 `[VIEW_OWN_HEAD]: {band: 40}`。
- `head.ownHead` 为 true 时：给 `AgentMessages` 与对话头 `window-drag`，对话头画在内容里（宽窄都是），根上写 `--acv-head-height: 40px` 与 `--acv-head-inset-end: var(--workbench-own-head-inset-end, 0px)`。`claim` 的现有逻辑不动（外壳自绘时不看它）。
- 版式阈值（宽不小于 600、高不小于 360）照旧量内容；自绘时内容高出 32px，窗口高 360 到 391 之间加第二个标签时会从宽版换成窄版。这一刻头本来就在换，接受。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/views.md` 输出 19 | 加“自绘头”一段（planned）：声明与判据（就绪才自绘，加载与出错照常画面板头）、工作台盖按钮并经 CSS 变量给宽度、视图标拖动区、标题按钮聚焦才显示、与接管标题区互斥 |
| `docs/specs/ui/workbench-layout.md` 输出 20、39 | 浮动窗只写标题的头可以交给视图自绘；整窗移动的来源加“拖动区”；自绘头时头区落点是顶上那一条；加第二个标签时内容上边距直接换 |
| `docs/specs/agent/conversation.md` 消息视图一段、输出 44 | 浮动窗里宽窄两版都自绘头，列表栏通到顶 |
| 组件 `.md` | `WorkbenchPanelHead`、`WorkbenchSurface`、`WorkbenchShell`、`AgentConversationHead`、`AgentConversationView`、`AgentMessages`、`AgentMessagesList` 各自的部分 |

## 切片

1. Spec（planned）三处，master 上提交。
2. 工作台：合同与判据（`VIEW_OWN_HEAD`、`ownHead`、`headOfPanel` 互斥）、`layoutContents` 与表面（内容上移、外框不画头、四角圆）、面板头的盖层画法与悬停范围、宽度变量、拖动区与落点、右键。面板头的 dom 测试、`layout-present` 的单测、Lab 里 `WorkbenchSurface` 加一个自绘头浮动窗的场景（借一个测试视图）、`workbench-float` 的 e2e。提交。
3. nb-agent-ui 的变量与 `windowDrag`，消息视图声明与宿主接上。Lab 场景（英文、390 宽）、`agent-conversation` 的 e2e。提交。
4. 收口：真实页面走一遍、变异检查、前端实现审查（Sonnet），处理后合入。

每片自跑：所在包的 `typecheck`、组件测试，改到的 e2e 文件。

## 验收映射

判断“看得见、点得到、没被盖住”一律用 `elementFromPoint` 取元素中心，不靠 `click()` 成功。

| 判据 | 覆盖 |
|---|---|
| 浮动窗里只有消息视图一个标签：没有“消息”一行，内容的上边与窗口外框的上边对齐，列表切换行与对话头同高、都顶到窗口顶；上面两个角不露出列表底色 | `agent-conversation.e2e.ts`：量外框与内容的 top、两行的 top 与 height；角上一点的 `elementFromPoint` 不是列表 |
| 悬停到窗上，“回到停靠”在右上角、`elementFromPoint` 取到它，点了回到停靠；“⋯”中心取到的是“⋯” | `workbench-float.e2e.ts` |
| 指针离开窗口后按钮淡出；Tab 到“回到停靠”时显示 | `workbench-float.e2e.ts` |
| 按住切换行空白、对话头空白、对话头头像拖，窗口跟着走；按住“会话”标签、收起按钮、“⋯”拖，窗口不动 | `workbench-float.e2e.ts`（用消息视图真实的头） |
| 对话头空白处右键出“移动到”；标题文字上右键不出 | `workbench-float.e2e.ts` |
| F6 到这个窗：标题按钮聚焦后在左上角、`elementFromPoint` 取到它；空格拿起、菜单键开“移动到”；焦点移走后它不接指针 | `workbench-float.e2e.ts`；`WorkbenchPanelHead.dom.test.ts` |
| 把别的视图拖到这个窗顶上那一条：成了标签条，面板头回来、对话头回到普通画法；拿走后又自绘 | `workbench-float.e2e.ts` |
| 浮出与停靠回去的飞行里内容不跳（逐帧 top 单调） | `workbench-float.e2e.ts`（`film`，同现有飞行用例） |
| 视图加载中、渲染出错：面板头照常写标题；就绪后自绘 | 外壳判据的单测；`WorkbenchShell` 的 dom 测试 |
| 窄版：抽屉顶边在对话头下面、不盖住“回到停靠” | `agent-conversation.e2e.ts` |
| 停靠在右栏、侧栏：画法不变 | 现有 `agent-conversation.e2e.ts`、`workbench-views.e2e.ts` 不改就过 |

## 验证

- 合入前 e2e 跑一次：`workbench-float`、`agent-conversation`、`bots-chat`、`lab-scenes`、`lab-agent-ui`、`workbench-views`（6 个文件）。实施中只重跑改到的文件。
- 开发服务的真实页面上不减弱动效走一遍：浮出来、拖、缩放、回到停靠、再放一个视图进去、窄版开抽屉。Lab 截图：英文、390 宽、明暗两态。
- 变异检查：去掉“拖动区里可交互元素不起拖”、宽度变量不写、判据不看“单标签”、内容裁切框上面两个角不圆，各自对应的用例要失败。
- 未验证边界：触摸拖动只跑现有用例，不另测（`touch-action` 照写）。

## 不做与风险

- 不做：停靠时的自绘头；第三方视图的自绘头；浮动窗的最小化、最大化与双击头。
- 风险：w00026 在工作台的改动冲突。合入前再并一次 master，冲突当场解并重跑受影响的 e2e。
- 风险：外壳表面多了一种“头不在外框里”的面板，落点几何、F6、焦点回到标题几处按 `data-panel-head` 找头。实施时先搜这些用法（`[data-panel-head`、`[data-panel-tab`）逐处核对，e2e 辅助函数一起改。

## 已定的取舍

评审板第 2 轮（[决定 4](README.md#开发者的决定)）：

1. 加载中、出错时照常画面板头，就绪才自绘（开发者没按推荐的“一直不画”）。
2. 窄版自绘时标题按钮的 Enter 不开抽屉，抽屉只由头像列顶上的按钮开。
3. 窗里加第二个标签（或拿走）时，内容的上边距 0 与 32 之间直接换、不过渡。
