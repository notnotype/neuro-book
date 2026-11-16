# t36 实施计划：对话面板改版

## Context

[t29](../t29-ui-polish-after-t15/README.md) 的六轮评审板（[评审板](../t29-ui-polish-after-t15/artifacts/review/index.html)，决定 5 到 11）定下了对话面板的样子，2026-11-16 拆成本 Task。要做五件事：

1. **面板头写会话**：面板头不写“对话”，居中写会话：
   - 左边是新建；中间是 Profile 图标、会话标题与下拉（会话列表）；右边是子代理入口、“⋯”，再接框架按钮。
   - 没选会话时写“新对话”，左边不放新建，右边没有“⋯”（定稿 `r3/p-center-welcome.webp`）。
   - 子会话的左边换成返回（只有图标），中间是子代理的图标与子会话标题，面包屑去掉。
2. **第一屏**：照旧应用 `AgentChatEmptyState` 的稿做：
   - 欢迎；
   - 最近对话：3 张卡片，“查看全部（N）”打开会话列表；
   - 试试这些：Profile 声明的开场指令，点了填进输入框。

   状态栏不画数据项。
3. **两条横线去掉**：顶栏下与输入框上的横线去掉，消息在顶栏下淡出。
4. **子代理管理**：面板头右边是入口，图标加个数，有事等你处理或有没看过的出错时带红点。点开是浮层，列出当前会话派出的全部子代理与孙代理。点一行进子会话，运行中的行悬停可停止。没有子代理时不显示入口。
5. **模型不可用的提示卡**：提示卡在输入框上方，写明是哪个角色或哪家服务商，按钮直达设置里对应的位置；输入框的占位写原因。

开发者已定的决定见 [Task README](README.md) 的 1 到 7。设计审查（Opus，21 条）之后的修订记在 README 的决定 8，报告存为 [evidences/design-review.txt](evidences/design-review.txt)。

现状（2026-11-16 调研）：

- 工作台的面板头（`WorkbenchPanelHead.vue`）只写视图声明的静态标题。视图只能经声明的 `actions` 放按钮，没有标题区的接口。
- 面板只有一个视图时，标题按钮（`data-panel-tab`）就是拖动源，内容 `region` 的名称也指向它（`ui/workbench-layout.md` 输出 20、24、31）。
- 对话视图在内容里另画了一行顶栏（`acv-header`），所以现在面板上是两行。顶栏的“⋯”、上下文检查、会话树、视图模式都是 `AgentConversationView` 实例里的局部状态。
- 第一屏只有一句“还没有消息”。
- 模型不可用时，输入框上方是一行字加“打开设置”。快照里失败的 `model` 只有一个码，不带角色与服务商。
- 设置窗口只能开到分区。
- Profile 声明没有开场指令字段。

## 技术选型

- **视图的头画进面板头：用 Vue 的 `Teleport`**。工作台在面板头里留出几个容器，视图在自己的组件树里画头，再用 `Teleport` 送进去。仓库里已经有同样的做法：`MarkdownControl` 的工具栏送进宿主给的位置，没给位置时用 `disabled` 画回原处。
  - 否决“视图交一个头组件，由工作台渲染”：头组件会落在工作台的组件树里，拿不到视图的局部状态（“⋯”的三项）、注册表，也拿不到 `provide` 的数据。另外它还要单独的错误边界与加载时序（审查第 5、6、11、12、21 条）。
- **会话下拉锚在工作台的标题按钮上**：nb-ui 的 `Popover` 加 `anchor`，做法同 `AnchoredPopover`，用 Reka 的 `PopoverAnchor` 加 `reference`。
  - 否决把标题按钮当 `PopoverTrigger` 的子节点：Reka 会改写按钮的 `id`，叠加点击处理（第 5 条）。
- 不新增依赖。提示卡用浮层材质 `.nb-ui-popover-surface`，图标按钮用 `IconButton`。

## 关键设计

### 工作台：视图的标题区（`plugins/workbench/web/`）

**怎样申请**

- `contracts.ts` 加一个不导出给 SDK 的符号 `VIEW_HEAD` 与类型 `ViewHeadOptIn = {readonly [VIEW_HEAD]: true}`。
- 内置视图写 `const view: ViewImplementation & ViewHeadOptIn = {load, [VIEW_HEAD]: true}`。
- `src/sdk/workbench.ts` 不导出它们，第三方拿不到这个符号（决定 6）。`ViewImplementation`、`ViewContext` 的公开形状不变，`pack.test.ts` 的导出清单也不变。

**接口**：新模块 `views/view-head.ts` 导出 `viewHeadOf(context: ViewContext): ViewHead | null`，以上下文为键存在 `WeakMap` 里。视图没申请时返回 `null`。

```ts
interface ViewHeadSlots {
    readonly start: HTMLElement;
    readonly title: HTMLElement;
    readonly end: HTMLElement;
    /** 标题按钮本身：浮层锚在它上面，关掉后焦点回到它。 */
    readonly handle: HTMLElement;
}
interface ViewHead {
    /** 面板头此刻给视图的容器；为 null 时视图在自己的内容里画头。 */
    readonly slots: Readonly<Ref<ViewHeadSlots | null>>;
    /** 面板展开时按标题按钮（点击、回车）调它；面板收起时工作台只展开、不调。返回取消订阅。 */
    onTitlePress(listener: () => void): () => void;
    /** 标题按钮弹出的列表开着没有；null 是不弹出东西。视图写，工作台画成 aria-haspopup 与 aria-expanded。 */
    readonly titlePopup: Ref<{expanded: boolean} | null>;
}
```

**`slots` 什么时候有**：四个条件都满足才不为 null，任一条不满足就回到现在的写法（面板头写声明标题）：

- 视图申请了；
- 实例是 `ready`；
- 面板只写标题（`titleOnlyPanels`，浮动窗同样）；
- 面板头画出来了。

头是视图树里的内容，在 `WorkbenchViewFrame` 的错误边界之内。头渲染出错时实例变成 `render-failed`，面板头退回原样。标题按钮始终由工作台渲染，所以拖动、空格拿起、右键菜单不依赖视图。

**`WorkbenchPanelHead.vue`**

- 新属性 `head`：活动视图申请了且就绪时为真。为真时整行改成 `grid-template-columns: 1fr auto 1fr` 的三列，标题按整行的宽度居中（第 7 条）：
  - 左列：`start` 容器，`data-no-drag`；
  - 中列：`<h2><button data-panel-tab …>`，里面是 `title` 容器；
  - 右列：`end` 容器（`data-no-drag`）、`#actions` 插槽（标题动作照旧，`views.md` 输出 10、11 不变）、框架按钮。
- 容器元素经事件交给外壳，外壳写进这个视图的 `ViewHead`。
- 有标题区时外壳不往标题后拼计数（输出 17），由视图自己决定画不画。
- 标题按钮的点击：外壳先记下面板此刻收没收起，再照旧 `activate`。原来没收起，才通知 `onTitlePress` 的监听者（第 5 条）。

**内容 `region` 的名称（第 13 条）**

- 只写标题的面板一律画一个带 `hidden` 的 `<span :id="panelTitleDomId(prefix, key)">`，内容是声明标题。
- `WorkbenchSurface.vue` 的 `region` 一律用 `aria-labelledby` 指向它；`tabpanel` 仍指向标签。
- 这样标题按钮写会话标题时，`region` 的名称仍是“对话”（决定 2）。判定只有一处，与有没有标题区、标题区加载完没有都无关。

**标签数变化等引起的切换（第 12 条）**：`slots` 变成 null 或换了容器时，`Teleport` 搬动 DOM，组件不重建，开着的菜单、浮层的状态都在。焦点正在头里时，浏览器搬动元素会丢焦点。这种情况少见，接受，写进“不做与风险”。

**改的文件**：`contracts.ts`、`views/view-head.ts`（新）、`views/view-instances.ts`（每一代上下文登记、作废它的 `ViewHead`）、`WorkbenchPanelHead.vue`、`WorkbenchShell.vue`、`WorkbenchSurface.vue`、`state/layout-present.ts`（`panelTitleDomId`）。

### nb-ui：`Popover` 锚在外部元素（`nb-ui/src/components/feedback/Popover.vue`）

- 新属性 `anchor?: HTMLElement | null`。给了就不渲染 `trigger` 插槽，改用 `PopoverAnchor :reference="anchor"`，开关只由 `open` 决定。
- 关闭时焦点回到 `anchor`：在 `close-auto-focus` 里阻止默认行为，改为 `anchor.focus()`。
- 同步 `Popover.md` 与测试。

### nb-agent-ui：新的顶栏（`src/vue/head/AgentConversationHead.vue`，内部组件）

**组件与属性**

- 由 `AgentConversationView` 渲染，不单独导出。“⋯”的三项、上下文检查、会话树、视图模式仍是视图实例的局部状态（第 11 条）。
- 视图新属性：
  - `headTargets?: {start: HTMLElement; title: HTMLElement; end: HTMLElement; anchor: HTMLElement} | null`：给了就把三列分别送进去，没给就画在内容顶上；
  - `sessionsOpen`：可选的 `v-model`，缺省用视图自己的状态；
  - `draftProfile?: {name: string; icon: string}`：没选会话时新会话会用的 Profile。
- 视图新插槽：`head-trailing`，宿主放子代理入口。

**三列**（`1fr auto 1fr`）

- **左列**：
  - 子会话：返回，只有图标，发 `session.select` 到 `ctx.session.path.at(-1)`（第 15 条：`path` 从根到父会话，不含本会话）；
  - 顶层会话，且 `newSession` 为真：新建；
  - 没选会话：空着。
- **中列**：Profile 图标（子会话用子代理的 Profile 图标；没选会话用 `draftProfile`）、标题与下拉箭头。
  - 画在内容里时，中列是一个按钮，点了开会话列表。
  - 送进面板头时，中列只放文字与图标；按下由工作台的标题按钮转来，宿主改 `sessionsOpen`。会话列表的 `Popover` 锚在 `anchor` 上。
- **右列**：`head-trailing`、常驻的顶栏动作、“⋯”。没选会话时没有“⋯”：它的几项都要有会话才有意义。

**样式**

- 去掉面包屑，以及 `.acv-header` 的底边线与 `.acv-composer` 的顶边线。
- 消息区顶端加 16px 的 `mask-image` 渐隐；滚到顶时不渐隐，免得盖住第一条。

### nb-agent-ui：第一屏（`src/vue/stream/AgentWelcome.vue`）

**数据与显示**

- 视图新属性 `welcome?: {recent: {id: string; title: string; at: number}[]; total: number; starters: {text: string; icon?: string}[]}`。消息区没有消息、也不在加载时画欢迎块。
- **欢迎**：品牌图标、标题、副标题，文字由宿主经 `labels` 给。
- **最近对话**：至多 3 张卡片，点了发 `session.select`。
  - 卡片写标题（为空写“未命名会话”）与相对时间。
  - “查看全部（N）”打开视图自己的会话列表，不用另加动作；N 为 0 时这一块不画。
- **试试这些**：只取前 3 条。
  - 每条单行截断，悬停用 `Tooltip` 显示全文；标题行右边写“点击填入输入框”。
  - 图标都用 `--accent-text`。主题里没有分类色，旧应用的琥珀、天蓝、翠绿是调色板 class，不能用。
  - 点了发新动作 `composer.fill {text}`，再聚焦输入框。
  - 没有指令时这一块不画。

**`composer.fill`**：登记在 `AgentViewAction` 与 `agent-conversation-view.md` 的动作表里（第 2 条）。宿主用 `setDraft(text)` 处理：替换现有草稿、版本加一、有会话时存草稿。`composer.draftChanged` 只是编辑器向宿主报告用户打的字，不能用它往输入框里填。

**状态栏**：没选会话时不画数据项（上下文用量、花费）。提醒项（断线、全部放行、模式标记）照常按条件显示，与 t29 决定 5“提醒类总显示”一致（第 19 条）。

### Profile 的开场指令（`plugins/agent/shared/points.ts`、`backend/builtin/profiles/main.ts`）

- `ProfileDeclarationSchema` 加 `starters?: {text: string; icon?: string}[]`：`text` 非空，对象形状严格，与声明的其余字段一致。不设条数上限：多写的不显示，不拒绝整个 Profile（第 20 条）。`ProfileEntry` 把它带出来。
- 主创带三条，沿用旧应用的润色、细纲、一致性体检。
- 宿主取哪个 Profile 的指令：有会话时取会话的 Profile；没选会话时取 `profileKey()`，即 `create()` 的缺省。
- 已知限制：用户级 Profile（`defineProfile`）没有声明，所以没有指令；指令文字和 `name` 一样不翻译。

### 模型不可用的提示卡

**后端：失败结果带上选中了什么（第 3 条）**

- nb-harness：`ModelResolution` 的失败分支与 `host.ts` 快照里的 `model` 失败分支，各加可选的 `role?: string`、`provider?: string`；`session.ts` 组快照时原样带上。
- nb-models `core.ts`：
  - `resolveRole` 的失败（没绑定，或绑定了但解析失败）带 `role`；
  - `resolveReference` 在 `no-credentials` 时带 `provider`。
- 浏览器只做查表：角色名从 `deps.roles()` 取，服务商名从模型服务的快照取，不在浏览器里再写一遍选择顺序。

**宿主（`session-host.ts`）出哪张卡**：按顺序取第一个符合的。

1. 服务商快照已读到、而且一家都没有：“还没有可用的模型”，按钮“添加服务商”，打开服务商页并打开添加窗口。没选会话时只判这一条（第 10 条）；别的情况要有会话才知道选中了什么，建会话后再出卡。
2. `role-unbound`，带 `role`：标题“‘写作’角色还没绑定模型”，说明“主创用‘写作’角色的模型对话。”，按钮“去绑定”，打开角色页并定位到这个角色。
3. `no-credentials`，带 `provider`：标题“DeepSeek 还没有设置密钥”。说明里有角色时写角色，没有时写模型。按钮“设置密钥”，打开服务商页、选中这家并聚焦密钥框。
4. 其余（`unknown-model`、`no-model`，或没带字段）：卡上写现在的原因与“打开设置”，打开模型服务分区。

**nb-agent-ui**

- `availability` 加可选的 `title` 与 `icon`。
- 只有 `profile-unavailable` 画 `AgentNoticeCard`。`ready` 时的模型能力提示、`archived`、`load-error` 保留现在的一行（第 10 条）。
- 位置：卡片放在原来那行字的位置，即停靠区之下、输入框之上，`conversation.md` 输出 37 的顺序不变。
  - 外观是浮层卡片（浮层材质、阴影），占位，不叠在消息上。消息区随之变矮，贴底滚动不受影响。
  - 定稿图里卡片压在消息末尾上；照现在的做法，看起来一样，只是消息不从卡片底下透过去。
- 占位按这个优先级：不可用的原因 > 中断后继续（输出 9）> 运行中 > 普通。`message` 为空时用普通占位。

**设置窗口打开到指定位置（第 8 条）**：照 `fileLocation` 的做法。

- `nbook.settings.open` 加 `focus?: string`。`SettingsLeaveTarget` 的 `open` 分支带上它，`perform` 时存成“等着的定位”`{section, focus}`。
- 窗口已开、分区没变时直接写入，不过离开确认。之后的任何别的动作（去别处、关窗口）都作废它。
- `SettingsPageContext` 加 `focus: Readonly<Ref<string | null>>`（这一页等着的定位）与 `takeFocus(): string | null`。这是公开接口，`settings-window.md` 与 SDK 文档同步。
- 页面在定位与数据都到了时取走并执行。取走即清空，所以同一个 `focus` 再点一次照样生效。
- 两页怎样解释 `focus`：
  - 角色页：滚到这个角色，聚焦它的模型选择框。
  - 服务商页：服务商 id 是选中这家并聚焦密钥框；`"add"` 是打开添加窗口。
  - 认不出的忽略。

### 子代理管理（`plugins/agent/web/`）

**每行的数据从哪来**（第 4 条），纯函数在 `subagents-panel.ts`，按 `tree` 的父子关系排成缩进：

| 字段 | 来源 |
|---|---|
| 图标、名字 | `profileIcon`；Profile 名从 `deps.profiles()` 按 `profile` 查，查不到写“子代理” |
| 任务 | `TreeItem.name`，即子会话的标题 |
| 状态 | `running` 运行中；`waiting` 等你处理；`question` 在问；`idle` 看最近一次收口：`completed`、`finished` 完成，`error` 出错，`aborted` 已停止，`interrupted` 已中断。文字与子代理卡片（`conversation.md` 输出 33）共用 |
| 第二行 | 等你处理：审批写动作与目标（`toolActionOf`、`shortTarget`），提问写问题。运行中：“N 次 · 用时”加当前一步；被 `DETAILED_LIMIT` 截掉动态字段的只写状态。已收口：取 `runResult({sessionId, runId})`，完成写回复的第一行，出错写按错误类别映射的那句话 |

- `runResult` 只在浮层开着时取。按 `sessionId:runId` 缓存在插件作用域里：收口了的结果不会变，取一次即可。
- 浮层标题行写汇总：“N 个 · M 个在跑 · K 个等你处理”。底部写提示：“点一行进入子会话；运行中的悬停可停止。”
- 入口的个数是全部行数，含 fork 出来的，与浮层的行数一致。红点是“有等你处理的行，或有没看过的出错”（第 19 条）。

**出错未看**（第 16 条）

- 已看过的出错按 `sessionId:runId` 记在插件作用域，右栏与编辑区页面两个宿主共用。
- 基线：`endedAt` 早于插件激活时刻的出错算看过，与当时订阅的是哪个会话无关。
- 打开浮层，当前列出的出错都算看过；进入某个子会话，那个会话的出错算看过。
- 出错只认 `reason === "error"`。

**`SubagentsEntry.vue`**

- 入口是 `i-lucide-bot` 加个数，带红点；配一个 `Popover` 列表；没有后代时不渲染。
- 点一行发 `session.select` 并关掉浮层。
- 运行中的行悬停出停止按钮，调宿主的 `stopRun(sessionId)`：发 `remote.abort({sessionId, keepQueue: true})`，与在那个子会话里按停止是同一条路（决定 7：只停这次运行，子会话保留）。孙代理同样能停，不需要 `jobId`。失败走宿主现有的失败提示。
- 它放在视图的 `head-trailing` 插槽里，属于视图的组件树，`subagentStoreKey`、`toolActionKey` 照常注入。

### 宿主接线（`plugins/agent/web/plugin.ts`、`ConversationHost.vue`、`session-list.ts`）

- **`plugin.ts`**：对话视图的实现加 `[VIEW_HEAD]: true`。`AgentConversationPosition` 收工作台给的 `context`，用 `viewHeadOf(context)` 取到头，交给 `ConversationHost`。编辑区页面没有 `context`，头照旧画在内容里。
- **`ConversationHost.vue`**：
  - `headTargets` 取 `head.slots`；
  - `sessionsOpen` 是本地的 ref，`head.onTitlePress` 切换它，`head.titlePopup` 跟着它写；
  - `welcome`、`draftProfile` 由宿主算好交给视图；
  - `head-trailing` 放 `SubagentsEntry`。
- **`session-list.ts` 加 `recentSessions`**：第一屏的数据（第 9 条），与会话面板的搜索、Profile 过滤、显示归档无关。
  - 自己取一次 `remote.list({project})`，只留顶层、未归档的。
  - 第一屏出现时刷新；新建、改名、归档之后也刷新。
  - N 是这份列表的条数。有会话、没消息时，卡片里排除当前会话。

## Spec 与文档改动

新条目标“（planned）”，晋升由开发者批准。改写已有条目时在原处改，不在末尾另加一条与旧的打架（第 18 条）。

| 文件 | 改什么 |
|---|---|
| `workbench/views.md` | 新输出“视图的标题区”：申请方式只对内置开放；`slots` 的条件与退回；按下、弹出状态；名称与拖动不变；与标题动作共存；有标题区时不拼计数。输出 10 补一句例外。“边界与兼容”写明不进 SDK |
| `ui/workbench-layout.md` | 输出 20：只写标题时视图可以接管标题区，`region` 一律由隐藏的声明标题命名；改正框架按钮的列举（现在没有“隐藏”）；有标题区时按标题，收起状态只展开，展开状态开视图的列表，回车开、空格拿起 |
| `ui/agent-conversation-view.md` | 顶栏小节重写（三列、返回、没选会话、送进面板头、`sessionsOpen`、`head-trailing`）；空状态改为欢迎块；动作表加 `composer.fill`；输入框小节写提示卡、保留一行的几种、占位优先级；去两条线与顶端渐隐 |
| `agent/conversation.md` | 输出 35 改写为“返回与子会话标题”；“失败与恢复”表的模型一行改成提示卡的四种与去向；新输出：面板头写会话、第一屏的数据、子代理管理（行、个数、红点、出错未看、停止） |
| `agent/sessions.md`、`models/service.md` | 快照 `model` 与端口失败结果的 `role`、`provider` |
| `agent/contributions.md`、`agent/builtin-profiles.md` | `starters` 字段（只显示前 3 条、不翻译、用户级没有）；主创的三条 |
| `settings/settings-window.md` | 输出 15 加 `focus`：已开时也送达，作废规则同设置文件的定位；页面上下文的 `focus`、`takeFocus` |
| `models/settings-pages.md` | 角色页、服务商页怎样解释 `focus` |

组件 `.md`：

- 新增：`AgentConversationHead.md`、`AgentWelcome.md`、`AgentNoticeCard.md`、`SubagentsEntry.md`。
- 改：`WorkbenchPanelHead.md`、`Popover.md`、`AgentConversationView.md`、`AgentConversationComposer.md`、`AgentStatusBar.md`、`RolesPage.md`、`ProvidersPage.md`。

## 切片

每片单独提交，片内跑受影响的单元与 DOM 测试，再跑下面写明的 e2e 文件。改了选择器的测试，在同一片里一起改（第 17 条）。

1. **工作台的标题区与 `Popover` 的锚点**：
   - 内容：工作台一节、nb-ui 一节。
   - 验证：`WorkbenchPanelHead` 的 DOM 测试，覆盖这几种：
     - 申请了且就绪时画三列，标题按钮带 `data-panel-tab` 与拖动描述；
     - `region` 的名称是声明标题；
     - 收起时按标题只展开；
     - 实例出错时退回原样。

     另有 `Popover` 的锚点测试；Lab 加一个带标题区的场景。
   - e2e：`workbench-views.e2e.ts`、`lab-workbench-surface.e2e.ts`、`workbench-float.e2e.ts`。
2. **新顶栏与去线**：
   - 内容：顶栏一节，此时只画在内容里。
   - 同步改：`AgentConversationView.dom.test.ts`；`agent-conversation.e2e.ts` 的面包屑用例改为返回；`agent-subagents.e2e.ts` 验收 2 的回父会话改为点返回。
   - 验证：DOM 测试，覆盖三层 `path` 时孙会话返回到子会话、新建、标题开会话列表、没选会话时左右为空、`head-trailing`。nb-agent-ui 的 Lab 场景更新，390 宽与英文各截一张。
   - e2e：上面两个文件与 `lab-agent-ui.e2e.ts`。
3. **第一屏与开场指令**：
   - 内容：第一屏、`composer.fill`、状态栏、Profile 的 `starters`、`recentSessions`。
   - 同步改：`agent-conversation.e2e.ts`、`agent-subagents.e2e.ts` 里对 `.acv-stream__empty` 的等待，改为等欢迎块。
   - 验证：DOM 测试，覆盖三块的显隐、点卡片、点指令后编辑器里是这段文字（断言编辑器的内容，不断言发出的动作）；`profiles.test.ts` 加“4 条时 Profile 仍可用”。`AgentWelcome` 的 Lab 场景：有和没有最近对话、有和没有指令、390 宽。
   - e2e：`agent-conversation.e2e.ts`、`agent-subagents.e2e.ts`；加了 Lab 场景，另跑 `lab-agent-ui.e2e.ts`、`lab-scenes.e2e.ts`。
   - 实施时改动：宿主给 `welcome`、`draftProfile` 与 `recentSessions` 的接线从第 6 片提前到这一片，第一屏的 e2e（没选会话时点一条指令）才能在这一片端到端跑通；第 6 片只剩标题区与子代理入口。
4. **模型提示卡与设置定位**：
   - 内容：后端的 `role`、`provider`，宿主的四种卡，`AgentNoticeCard`，设置窗口的 `focus`，两页。
   - 同步改：对 `data-composer-availability` 的断言。
   - 验证：
     - nb-models 与 harness 的单元测试（失败带字段）；
     - `session-host.test.ts` 的四种卡与判定顺序；
     - `settings-window` 的测试，覆盖窗口已开在同一页、开在别的页且有未保存改动（确认、取消各一次）、数据晚到、同一个 `focus` 点两次；
     - 两页的 DOM 测试；
     - `AgentNoticeCard` 与两页带 `focus` 的 Lab 场景。
   - e2e：`agent-conversation.e2e.ts`、`models.e2e.ts`、`settings.e2e.ts`。
5. **子代理管理**：
   - 内容：`subagents-panel.ts`、`SubagentsEntry.vue`、出错未看、`stopRun`。
   - 验证：
     - 纯函数测试：多层、状态表、个数、红点、基线、看过之后不亮、截掉动态字段的行；
     - DOM 测试：点行进子会话、悬停停止调 `stopRun`；
     - Lab 场景。
   - e2e：`agent-subagents.e2e.ts`。
6. **宿主接线**：
   - 内容：`plugin.ts` 申请标题区，`ConversationHost` 接 `headTargets`、`sessionsOpen`（`welcome` 已在第 3 片接上）。
   - e2e：见验收映射。

收口：

- `bun run typecheck`、`bun run test:affected --since master`；
- e2e 跑上面列过的文件，去重后一次跑完；
- 前端实现审查一次（Sonnet）；nb-models 与 harness 的后端改动小，并进同一次审查，说明里单列。

## 验收映射

新增的 Spec 编号在写 Spec 时定。这里按要守住的行为列：

| 行为 | 覆盖 |
|---|---|
| 视图接管标题区：面板头画它，拖动、键盘拿起、右键菜单、`region` 名称不变；出错退回 | `WorkbenchPanelHead` DOM 测试；e2e：按对话面板头的标题拖到别的区域 |
| 成了标签条时头回到内容里，状态不丢 | e2e：右栏再放一个视图，对话的头出现在内容里；会话下拉开着时也一样 |
| 按标题开会话列表，Escape 后焦点回到标题 | e2e |
| 子会话返回父会话；没选会话写“新对话”、左右为空 | nb-agent-ui DOM 测试；e2e：从子代理卡进子会话再点返回 |
| 第一屏：最近对话、查看全部、试试这些 | DOM 测试；e2e：没选会话时点一条指令，输入框里是它 |
| 四种提示卡与设置定位 | `session-host.test.ts`；设置窗口与两页的测试；e2e：角色没绑定时点“去绑定”，设置窗口开在角色页，焦点在那个角色上 |
| 子代理管理：列表、个数、红点、停止 | 纯函数与 DOM 测试；e2e：一次派发两个子代理，入口个数为 2，点一行进子会话 |

## 验证

- 真实浏览器：跑上面列的 e2e。Lab 截图看：
  - 新顶栏：宽、390、英文、子会话、送进面板头；
  - 第一屏；
  - 四种提示卡；
  - 子代理浮层。
- 未验证边界：
  - 浮动窗的标题区只做 DOM 测试；
  - 触屏没有悬停，停止按钮在触屏上看不到，与别处的悬停按钮一样。

## 不做与风险

- 状态栏自定义在 [t37](../t37-status-line-customization/README.md)；编辑组的横幅以后另改。
- 提示卡上的“这是什么？”不做（决定 4）。
- 没选会话时只出“还没有可用的模型”这一张卡；角色没绑定、没有密钥，要建会话后才出卡。
- 开场指令：用户级 Profile 没有，文字不翻译。
- 标签数变化使头在面板头与内容之间切换时，焦点若正在头里会丢到页面根上。
- 标题区不进插件 SDK（决定 6），由内部符号限定只有内置视图能申请。
