# t36 实施计划：对话面板改版

## Context

[t29](../t29-ui-polish-after-t15/README.md) 的六轮评审板（[评审板](../t29-ui-polish-after-t15/artifacts/review/index.html)，决定 5 到 11）把对话面板的样子全部定了，2026-11-16 拆成本 Task。要做的五件事：

1. **面板头写会话**：不写“对话”，居中写会话。左边新建，中间 Profile 图标、会话标题与下拉（会话列表），右边子代理入口、“⋯”，再接框架按钮。没选会话时写“新对话”。子会话的左边换成返回（只有图标），中间是子代理的图标与子会话标题，面包屑去掉。
2. **第一屏**：没选会话时，照旧应用 `AgentChatEmptyState` 的稿：欢迎、最近对话（3 张卡片，“查看全部（N）”打开会话列表）、“试试这些”（Profile 声明的开场指令，点了填进输入框）。状态栏整行空着。
3. **两条横线去掉**：顶栏下与输入框上的线去掉，消息在顶栏下淡出。
4. **子代理管理**：面板头右边的入口（图标加个数；等你批准或回答、出错未看时有红点），点开浮层列出当前会话派出的全部子代理与孙代理（名字与任务、最近进度或结果、状态）。点一行进子会话，运行中的悬停可停止；没有子代理时入口不显示。
5. **模型不可用的提示卡**：浮层提示卡压在输入框上沿，写明哪个角色或服务商，按钮直达设置里对应的位置；输入框占位写原因。不用 `Banner`。

现状（2026-11-16 调研）：

- 工作台的面板头（`WorkbenchPanelHead.vue`）只写视图声明的静态标题。视图只能经声明的 `actions` 放按钮，没有标题区的接口。
- 单视图时，标题按钮（`data-panel-tab`）就是拖动源，内容 `region` 的名称也指向它（`ui/workbench-layout.md` 输出 20、24、31）。
- 对话视图在内容里另画了一行顶栏（`AgentConversationView.vue` 的 `acv-header`），所以现在是两行。
- 第一屏只有一句“还没有消息”。模型不可用是输入框上方一行字加“打开设置”（`acv-composer__notice`），设置窗口只能开到分区，不能定位到角色或服务商。
- Profile 声明没有开场指令字段，也没有“已读”记录。

## 技术选型

无新依赖。浮层用 nb-ui 的 `Popover`，提示卡用现有的浮层材质（`.nb-ui-popover-surface` 一类，跟 ui-development-spec 的浮层合同），图标按钮用 `IconButton`。

## 关键设计

### 工作台：视图的标题区（`plugins/workbench/web/`）

- `contracts.ts`：`ViewImplementation` 加 `head?(): Promise<Component>`，形状同 `badge()`，由实现方交出。
  - 组件收两个属性：`handle`（工作台的把手组件）与 `context`（`ViewContext`）。
  - 把手组件渲染现在那个 `<button data-panel-tab>`：id、拖动的可访问描述、右键菜单都由工作台给，里面的内容由视图经默认插槽放，点击由视图监听。
- `ViewContext` 加 `headShown: Readonly<Ref<boolean>>`：工作台此刻是不是用视图的标题区画面板头。
  - 为真的条件：面板只写标题（工具面板且标签不超过 1 个，`titleOnlyPanels`），并且视图交了 `head`。浮动窗同样。
  - 成了标签条时为假，视图在自己的内容里画同一个头。
- `WorkbenchPanelHead.vue`：`activeTab` 有标题区组件时，在标题带里画 `<component :is="head" :handle :context>`，代替 `<h2><button>`。
  - 标题区里除了把手，其余可点的元素都在 `data-no-drag` 里，空白处不起拖（输出 24 不变）。
  - 内容 `region` 的名称：改指向一个视觉隐藏、写视图声明标题（“对话”）的元素。把手按钮的名称是视图放进去的会话标题，拖动提示仍是它的描述。
- `WorkbenchShell.vue`：经 `instances` 取视图实现的 `head`。加载与 `load()` 同时进行，没加载完时照旧写标题。
- 不变量：拖动、键盘拿起（Space）、Alt 加方向键、右键菜单都还挂在工作台给的把手上。所以一个视图交不交 `head`，拖动行为完全相同。

### nb-agent-ui：新的顶栏（`src/vue/head/`）

- 新组件 `AgentConversationHead.vue`，从 `@notnotype/nb-agent-ui/vue` 导出。
  - 属性：`ctx`、`newSession`、`handle?: Component`（缺省是普通按钮）、`sessionsOpen`（`v-model`）；插槽 `sessions`（会话列表）、`trailing`（宿主放子代理入口）。
  - 事件：`action`（`session.create`、`session.select`）。
- 版式是三列网格，标题按整个头的宽度居中：左列新建，或子会话时的返回；中列把手里放 Profile 图标、标题与下拉箭头；右列是 `trailing`、登记的顶栏动作与“⋯”。
  - 返回发 `session.select` 到直接的父会话（`ctx.session.path` 的倒数第二项）。
  - 没选会话时标题写“新对话”，原来的 `header.noSession` 改文案。
- `AgentConversationView.vue`：`header` 为真时，在内容顶上画 `AgentConversationHead`，面包屑与旧顶栏删掉；为假时不画（宿主放进了面板头）。
  - `.acv-header` 的底边线与 `.acv-composer` 的顶边线删掉。
  - 消息区顶端加 16px 的 `mask-image` 渐隐。滚到顶时不渐隐，免得盖住第一条。
- 新动作 `sessions.open`：第一屏的“查看全部”发它，宿主把 `sessionsOpen` 置真。

### nb-agent-ui：第一屏（`src/vue/stream/AgentWelcome.vue`）

- 视图新属性 `welcome?: {recent: {id, title, at}[], total: number, starters: {text, icon?}[]}`。消息区没有消息、也不在加载时，画欢迎块。
  - 欢迎块：品牌图标、标题、副标题，文字由宿主经 `labels` 给。
  - 最近对话：至多 3 张卡片，点了发 `session.select`；“查看全部（N）”发 `sessions.open`。没有会话时这一块不画。
  - 试试这些：点了发 `composer.draftChanged` 填进输入框，再聚焦输入框。没有指令时这一块不画。
- 状态栏在没选会话时整行空着：上下文用量没有数据时不写 0%（`AgentStatusBar` 只看 `contextLimit` 的那处改成同时看有没有会话）。

### Profile 的开场指令（`plugins/agent/shared/points.ts`、`backend/builtin/profiles/main.ts`）

- `ProfileDeclarationSchema` 加 `starters?: {text: string; icon?: string}[]`，至多 3 条。`ProfileEntry` 带出来。
- 主创带三条，沿用旧应用的润色、细纲、一致性体检。
- 宿主取哪个 Profile 的指令：有会话时取会话的 Profile；没选会话时取新会话会用的那个 Profile（`create()` 的缺省）。

### 模型不可用的提示卡

- nb-agent-ui：`availability` 加可选的 `title` 与 `icon`。
  - 输入框不再画上方那行字，改画 `AgentNoticeCard`：浮在输入框上沿、压住消息区底部，图标、标题、说明、按钮（`availability.actions`）。
  - `availability` 不是 `ready` 时，输入框的占位写 `message`。
- 宿主（`session-host.ts`）按 `meta.model` 的码，加上模型服务的角色与服务商快照，组出三种卡：
  - `role-unbound`：“‘写作’角色还没绑定模型”，按钮“去绑定”，打开设置的角色页并定位到这个角色。
  - `no-credentials`：“DeepSeek 还没有设置密钥”，说明写哪个角色绑定的哪个模型，按钮“设置密钥”，打开服务商页、选中这家并聚焦密钥框。
  - 没有服务商（还没有可用的模型）：按钮“添加服务商”，打开服务商页并打开添加窗口。
  - 别的码保留现在的写法与“打开设置”。
- 设置窗口：`nbook.settings.open` 加 `focus?: string`，原样交给那一页，由页面解释。
  - 角色页：滚到这个角色、聚焦它的模型选择框。
  - 服务商页：`focus` 是服务商 id 时选中这家并聚焦密钥框；是 `"add"` 时打开添加窗口。
  - 认不出的 `focus` 忽略，不报错，照常打开那一页。

### 子代理管理（`plugins/agent/web/`）

- 纯函数 `subagents-panel.ts`：从 `SubagentData`（`tree` 含全部后代、`jobs`）推出列表行。
  - 每行：层级缩进、图标、名字、任务（调用的 `prompt` 首行）、最近一步或结果、状态（运行中、等你处理、完成、出错、已停止）、对应的 `jobId`。
  - 再推出入口的个数，以及要不要红点。
  - 动作名沿用 t29 的 `toolActionOf` 与 `shortTarget`。
- 出错未看：会话宿主在本窗口里记一份“已看过的出错运行”（`runId`）。
  - 打开浮层或进入那个子会话，算看过。
  - 窗口打开期间新出错、还没看过的才亮红点；刷新后从头记，旧的出错不再亮。
- `SubagentsEntry.vue`：入口按钮（`i-lucide-bot` 加个数，红点）加 `Popover` 列表，没有后代时不渲染。
  - 点一行发 `session.select`，并关掉浮层。
  - 运行中的行悬停出停止按钮，调 `store.kill(jobId)`：停的是这次运行，子会话保留（`jobs.md` 输出 4、11）。
- 放在 `AgentConversationHead` 的 `trailing` 插槽里。

### 宿主接线（`plugins/agent/web/plugin.ts`、`ConversationHost.vue`）

- 对话视图的实现交 `head`：一个包装组件，用插件作用域里同一个会话宿主（`hostAt("view")`）画 `AgentConversationHead`，`handle` 用工作台给的。
- `ConversationHost.vue` 按 `context.headShown` 决定视图的 `header`：面板头已画就不在内容里画。
  - `sessionsOpen` 的 ref 放在会话宿主上，两处共用，“查看全部”也开它。
- 编辑区页面（`page`）没有面板头，照旧在内容里画头。

## Spec 与文档改动

全部标“（planned）”，晋升由开发者批准。

- `workbench/views.md`：新输出“视图的标题区”（`head`、`handle`、`headShown`、名称与拖动不变）；输出 10 里“视图自己不再画工具栏”补一句例外。
- `ui/workbench-layout.md` 输出 20：只写标题时，视图可以交标题区。顺带改正框架按钮的列举，现在没有“隐藏”。
- `ui/agent-conversation-view.md`：顶栏小节重写（三列、返回、新对话、`sessionsOpen`、`trailing`）；空状态改为欢迎块；输入框小节的提示卡与占位；去掉两条线与顶端渐隐。
- `agent/conversation.md`：面板头写会话、第一屏的数据来源、子代理管理、模型提示卡的三种写法与去向（新输出接在末尾）。
- `agent/contributions.md`：`agent.profiles` 的 `starters` 字段。`agent/builtin-profiles.md`：主创的三条。
- `settings/settings-window.md` 输出 15：`focus` 参数。`models/settings-pages.md`：角色页、服务商页怎样解释 `focus`。
- 组件 `.md`：`WorkbenchPanelHead.md`、`AgentConversationHead.md`、`AgentWelcome.md`、`AgentNoticeCard.md`、`SubagentsEntry.md`，以及改动过的 `AgentConversationView.md`、`AgentConversationComposer.md`、`RolesPage.md`、`ProvidersPage.md`。

## 切片

每片单独提交，片内自跑受影响的测试与 Lab 截图。

1. **工作台的标题区**：`contracts.ts`、`WorkbenchPanelHead.vue`、`WorkbenchShell.vue`、Spec。验证：`WorkbenchPanelHead` 的 DOM 测试（有 `head` 时画它，把手带 `data-panel-tab` 与拖动描述，内容 `region` 的名称是声明标题）；Lab 加一个带标题区的场景。
2. **nb-agent-ui 的新顶栏与去线**：`AgentConversationHead`、视图接上、两条线与渐隐、`sessions.open`。验证：nb-agent-ui 的 DOM 测试（返回到父会话、新建、标题开会话列表、`trailing` 插槽、没选会话写“新对话”）；nb-agent-ui 的 Lab 场景更新，390 宽与英文各截一张。
3. **第一屏与开场指令**：`AgentWelcome`、视图属性、状态栏空着、Profile 的 `starters` 与主创三条。验证：DOM 测试（三块的显隐、点卡片、点指令填输入框）；`profiles.test.ts` 里声明的校验。
4. **模型提示卡与设置定位**：`AgentNoticeCard`、`availability` 的字段、宿主的三种卡、`nbook.settings.open` 的 `focus`、角色页与服务商页。验证：`session-host.test.ts` 的三种卡；`RolesPage`、`ProvidersPage` 的 DOM 测试（按 `focus` 定位与聚焦，认不出时照常）。
5. **子代理管理**：`subagents-panel.ts`、`SubagentsEntry.vue`、出错未看。验证：纯函数测试（多层、个数、红点、看过之后不亮）；DOM 测试（点行进子会话、悬停停止调 `kill`）；Lab 场景。
6. **宿主接线**：`plugin.ts` 交 `head`，`ConversationHost` 按 `headShown` 切换，`sessionsOpen` 共用。验证见下面的 e2e。

收口：`bun run typecheck`、`test:affected --since master`；e2e 跑对话、工作台拖动、设置、`lab-scenes` 这几个文件（文件名开工时按覆盖关系定）；前端实现审查一次（Sonnet）。

## 验收映射

新增的 Spec 编号在写 Spec 时定。这里按要守住的行为列：

| 行为 | 覆盖 |
|---|---|
| 视图交了标题区：面板头画它，拖动、键盘拿起、读屏名称不变 | `WorkbenchPanelHead` DOM 测试；e2e：按对话面板头的标题拖到别的区域 |
| 成了标签条时视图在内容里画头 | e2e：右栏再放一个视图后，对话的头出现在内容里 |
| 子会话返回父会话、没选会话写“新对话” | nb-agent-ui DOM 测试；e2e：从子代理卡进子会话，再点返回 |
| 第一屏的最近对话、查看全部、试试这些 | DOM 测试；e2e：没选会话时点一条指令，输入框里是它 |
| 三种模型提示卡与设置定位 | `session-host.test.ts`；设置页的 DOM 测试；e2e：角色没绑定时点“去绑定”，设置窗口开在角色页、焦点在那个角色上 |
| 子代理管理的列表、红点、停止 | 纯函数测试与 DOM 测试；e2e：一次派发两个子代理，入口个数为 2，点一行进子会话 |

## 验证

- 真实浏览器：上面列的 e2e；Lab 截图看新顶栏（宽、390、英文、子会话）、第一屏、三种提示卡、子代理浮层。
- 未验证边界：浮动窗的面板头只做 DOM 测试，不另写 e2e；触屏没有悬停，停止按钮在触屏上看不到，和别处的悬停按钮一样。

## 不做与风险

- 状态栏自定义在 [t37](../t37-status-line-customization/README.md)；编辑组的横幅以后另改。
- 提示卡上的“这是什么？”不做：现在没有可链接的说明页。
- 风险：工作台的标题区是新的对外接口，插件 SDK 会导出它。先只给内置插件用、SDK 不导出，等第二个用户出现再导出（写进 Spec 的“边界与兼容”）。
