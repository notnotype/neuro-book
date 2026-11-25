---
标签: [state:local, env:portal, state:inject]
别名: ["Agent 面板", "对话视图", "Agent Conversation"]
---

# AgentConversationView

Agent 对话的纯视图：会话的头、消息流、待处理区、输入框与状态栏。数据全部由宿主通过 `ctx` 传入，用户意图全部以 `action` 事件交给宿主执行，视图自己不取数、不发请求、不持久化。它有两处别处没有的特点：消息流按注意力分层，运行中 Agent 说出的话与人机交互控件常显、思维链默认折叠，已结束的轮次整轮收起，只露出最终回复与改动文件；工具呈现、顶栏动作、面板等全部走注册表，新增一种工具只需登记一项。

行为合同见 [ui.agent-conversation-view](../../../../docs/specs/ui/agent-conversation-view.md)。本文只写 Lab 演示不出来的部分。

## 布局

自上而下：头、消息流、停靠区（有不阻塞的待处理事项时，见 [`AgentDock`](wizard/AgentDock.md)）、输入框。根节点是尺寸容器：停靠区的 40% 限高相对它。会话列表不在视图里：嵌入页面的左栏或下拉用单独导出的 [`AgentSessionList`](AgentSessionList.md)，由宿主摆放。头与输入框固定，消息流占据剩余高度并独立滚动；头与消息流、消息流与输入框之间没有横线，消息流离开顶部后顶端 16px 渐隐。

头由 [`AgentConversationHead`](head/AgentConversationHead.md) 画：三列，标题按整行居中，窄时标题先截断。给了 `headTargets` 时三列送到视图之外（工作台面板头的标题区），内容顶上不画头；位置来了又走时头不重建，开着的会话列表与菜单不丢。

消息流里每一轮由 `AgentConversationTurn` 呈现（一条用户消息加 Agent 一侧的内容，对话气泡版式），见其同名文档；原始视图由 `AgentRawView` 呈现。消息流滚动容器保留滚动条槽位，流式追加内容时不因滚动条出现而挤动。面板拉宽时每轮限宽 800px 居中，避免正文行过长。

还有更早的内容时，消息流顶部是一行历史行：平时是两侧带细线的“更早的内容”，可以点击加载；加载中换成转圈和说明（约 200ms 后才淡入，读得快时不闪）；失败时是危险色说明和“重试”。三种状态高度一致。离开底部后，消息流底部正中浮着“回到最新”按钮。

## 交互

- 头的左边：子会话是返回，发 `session.select`，带父会话（`ctx.session.path` 的最后一项）；顶层会话且 `newSession` 为真是新建，发 `session.create`；没选会话时空着。
- 有 `sessions` 插槽时点标题开会话列表（`sessionsOpen`）；送到视图之外时，按下由宿主经 `sessionsOpen` 转来。
- `closable` 时头的右列最后是“关闭”，点了发 `close`。输入框里按 Esc 发 `escape`（补全菜单开着、输入法组字时不发）。
- 头的溢出菜单（有会话时才有）在“分轮视图”和“原始视图”之间切换，发出 `update:viewMode`。
- 登记的顶栏动作（注册表的 `headerActions`）：`when` 为假的不显示；允许常驻（`pinnable`）的按 `order` 取前两个，以图标按钮放在溢出菜单按钮左边，其余收进溢出菜单，排在内置项之后、“原始视图”之前；角标数写在名字后（`名字 (N)`）。点了发出它的 `target.action`。
- 第一屏：点最近对话的卡片发 `session.select`；点“查看全部”打开会话列表（同点标题）；点一条开场指令发 `composer.fill`（带指令全文，宿主换掉输入框里的字），随后聚焦输入框。
- 分轮视图里轮与轮之间可以有两种线（`AgentStreamDivider`），按 `ctx.dividers` 给：`day` 为真时每一轮之前与上一轮不在同一个日历日时一条日子（今天、昨天、月日），`unreadFrom` 指向的消息所在那一轮之前一条“以下是新消息”（不在已加载的消息里时不画）；不给时两种都没有。原始视图不画。线不让视图滚动。
- 点击整轮摘要行或思维链摘要行展开或收起；已结束的轮次默认收起，思维链默认折叠，手动操作过的轮次不再跟随自动收起。含 `ctx.activeCalls` 里调用的轮次（后台子代理、后台命令还在跑）不自动收起，手动收起照常。
- 等用户的事项分两组：带 `source`（后代会话的）或 `async`（异步提问）的进停靠区，输入框照常可用；其余是阻塞的，由同步向导替换输入框。同步向导在时停靠区收成一条、排在它下面。`ctx.interaction.placement` 为 `dock` 时（bot 的主对话），阻塞的事项也进停靠区，没有同步向导：答完一个时焦点在停靠区里的，放到停靠区的容器上，都答完回输入框（换了会话不算答完）；“本会话都批准”或“一直批准”一并提交同一会话里同一记住范围的其余审批（向导里这一步是顺带选上，停靠区一次一个，所以在这里补）。停靠区的读屏播报在视图层常驻的 `role="status"` 区里（文字带来源），不随停靠区挂卸。切换会话（`ctx.session.id` 变化）时每一轮重新挂载，展开记录随之清空。
- 每条消息角色行右端有消息操作（复制、编辑、重试、从此处分支及插件登记的操作），点击发出对应 action。常显，颜色弱；有多个分支时分支切换在操作条最前。
- 输入框由 [`AgentConversationComposer`](composer/AgentConversationComposer.md) 呈现：回车发送，运行中回车为 steer、Ctrl/⌘+回车为 followup，运行中且输入为空时按钮变为停止；`/` 命令、附件、模式与模型见其同名文档。发送后不自行清空，等宿主给出新版本草稿。
- 点击用户消息里的图片（文字里的图片标签、附件条的图片卡片、旧消息的图片缩略图）打开原图预览对话框（nb-ui `ImagePreviewDialog`），地址取 `services.resolveAttachmentUrl(locator, "original")`，取不到时不打开。回复里 Markdown 的图片同样打开预览，地址经 `services.resolveMarkdownAsset` 换算（异步；又点了别的图片时取消上一次，关掉或换图时归还地址），没有这项服务或换算失败时不打开。预览是纯界面行为，不发 action；对话框渲染到 `teleportTarget`。引用、技能、文件的点击按 `AgentUserContent` 发出对应 action，回复里的引用与外链按 `AgentMarkdown` 发出 `reference.open`、`link.open`。

文字选择：消息流里的消息、工具输出与提示可选可复制，宿主在根上默认不可选时也成立；欢迎页、空态与加载说明、按钮与折叠标题不可选（见 nb-ui 开发规范的“文字能否选中”）。

## 滚动

由 nb-ui 的 `useStreamScroll` 负责，要点：

- 停在底部（距底不超过 24px）时跟随新内容；用户往上滚就不再跟随，出现“回到最新”，点击回到底部并恢复跟随。切换会话后回到最新。
- 离开底部后，内容高度变化不移动视口里正在读的内容：锚点是视口顶部第一个露出来的元素（取最深的那个）；它被移除时依次改用它的下一个兄弟、父元素……所以运行结束、过程收起时，正在读过程的人看到的是最终回复停在原处。宿主数据变化时，在视图更新之前记下锚点。
- 用户点开或收起某一项引起的变化以被点的那一项为锚点，即使原本停在底部也不把它推走。
- 滚动容器声明 `overflow-anchor: none`，不用浏览器自带的滚动锚定（Tauri 的 WebKit 没有它，且会和跟随底部各修一次）。历史行也声明 `overflow-anchor: none`，不当锚点。
- 滚到距顶 160px 以内、或内容不足一屏时发出 `history.loadPrevious`；宿主把 `history.loading` 置为 true 或补上内容之前不重复发出；失败后不自动重试。一页加载完而高度没变（补上的内容都收在已收起的轮次里）时，再检查一次是否仍在顶部。
- 开头不完整的一轮补上更早的消息后沿用原来的组件 key（`assignTurnKeys`），展开状态和阅读位置都不丢。

## 数据

```ts
import type {AgentConversationContext, AgentConversationServices, AgentLocale, AgentViewAction, AgentViewMode, AgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";

type AgentConversationViewProps = {
    /** 只读领域数据，必填；可完整 JSON 化。形状见核心的 types.ts。 */
    ctx: AgentConversationContext;
    /** 纯函数能力，必填。 */
    services: AgentConversationServices;
    /** 扩展点注册表，必填；用 createAgentViewRegistry 构造，内置登记也在其中。 */
    registry: AgentViewRegistry;
    /** 消息流视图模式；可选受控。不传时由视图自持，初始为 "turns"。 */
    viewMode?: AgentViewMode;
    /** 浮层渲染目标；false 表示就地渲染。默认 false。 */
    teleportTarget?: string | false;
    /** 界面语言，只在上面没有注入翻译端口时起作用；缺省 zh-CN。宿主注入了端口时语言以端口为准。 */
    locale?: AgentLocale;
    /** 宿主注入的 Markdown 显示、Markdown 折叠预览、提示词编辑器与已发送文字的显示；缺哪个用包内的缺省实现。默认 {}。 */
    renderers?: AgentViewRenderers;
    /** 是否显示顶栏；宿主页面自有标题时传 false，原始视图的切换入口随之没有，用 viewMode 控制。默认 true。 */
    header?: boolean;
    /** 运行中过程的展开方式："collapsed" 折叠；"live" 时运行中的思维链与工具组逐步展开，结束后照常收起。默认 "collapsed"。 */
    processDisclosure?: "collapsed" | "live";
    /** 输入框版式："stacked" 正文在上、工具栏在下；"inline" 正文与控件同一行（见 AgentConversationComposer 的“单行版式”）。默认 "stacked"。 */
    composerLayout?: "stacked" | "inline";
    /** 输入框下面的状态栏。默认 false。 */
    statusBar?: boolean;
    /** 用户的状态栏设置（显隐与次序，见 AgentStatusBar）；给了才有右键菜单，菜单发 `statusLine.toggle {id}`、`statusLine.openSettings` 两个 action。 */
    statusLine?: StatusLineSetting;
    /** 顶层会话时头的左边放新建按钮。默认 false。 */
    newSession?: boolean;
    /** 把头的三列送到这几个元素里；`anchor` 是会话列表锚着的按钮。默认 null，画在内容顶上。 */
    headTargets?: {start: HTMLElement; title: HTMLElement; end: HTMLElement; anchor: HTMLElement} | null;
    /** 头是宿主窗口的拖动区（宿主自绘窗口头时，交给 `AgentConversationHead` 的 `windowDrag`）；高度与右端让位经 `--acv-head-height`、`--acv-head-inset-end` 给。默认 false。 */
    headWindowDrag?: boolean;
    /** 会话列表开着没有；可选受控，不传时视图自持。 */
    sessionsOpen?: boolean;
    /** 没选会话时头上的图标：新会话会用的 Profile。默认 null，不画图标。 */
    draftProfile?: {name: string; icon: string} | null;
    /** 第一屏的数据（欢迎、最近对话、开场指令，形状见 `stream/AgentWelcome.md`）；默认 null，没有消息时只写“还没有消息”。 */
    welcome?: AgentWelcomeView | null;
    /** 头的右列最后画“关闭”（`data-header-close`），点了发 `close`：宿主把对话放在可关的面板里时用。默认 false。 */
    closable?: boolean;
};

type AgentConversationViewEmits = {
    /** 用户意图。视图不去重，也不关心宿主如何执行。 */
    (e: "action", action: AgentViewAction): void;
    /** 从溢出菜单切换视图模式时发出；受控时父组件回写 viewMode 才生效。 */
    (e: "update:viewMode", mode: AgentViewMode): void;
    /** 会话列表开或关时发出；受控时父组件回写 sessionsOpen 才生效。 */
    (e: "update:sessionsOpen", open: boolean): void;
    /** 点了头上的“关闭”（`closable` 时才有）。 */
    (e: "close"): void;
    /** 输入框里按了 Esc；补全菜单开着、输入法正在组字时编辑器自己处理，不发。宿主可以拿它关掉放对话的面板。 */
    (e: "escape"): void;
};

type AgentConversationViewSlots = {
    /** 会话列表的内容；`close` 关掉它（切了会话之后不该还开着）。不给时标题不是按钮。 */
    sessions?: (scope: {close: () => void}) => unknown;
    /** 头的右列最前面，宿主放的入口（子代理入口）。 */
    "head-trailing"?: () => unknown;
};

type AgentConversationViewExpose = {
    /** 聚焦输入框。 */
    /** 聚焦输入框；输入框还是只读时（会话在加载）先记下，变成可写之后再聚焦，等的期间用户按了键或点了鼠标就作罢。 */
    focusComposer(): void;
    /** 滚动消息流到最新内容。 */
    scrollToLatest(): void;
};
```

除上面两个插槽外，扩展一律通过注册表。渲染组件与翻译端口经 `provideAgentView` 交给子组件（`state:inject`）；单独挂载零件时调用方自己调用它。未声明的 attribute、`class` 与 `style` 落到根节点。

`ctx.messages` 的语义约束：按时间顺序排列；同一 `id` 只出现一次；运行中尚未落盘的内容也在其中。`ctx.now` 是宿主提供的当前时间，运行中的用时与线上的今天、昨天按它计算，视图不自己计时，所以 Lab 可以确定性回放。

## 状态

- 未选择会话（`ctx.session` 为 null）：头写“新对话”，图标是 `draftProfile` 的，左边空、没有溢出菜单；消息流为空态。
- 没有消息：不在加载、给了 `welcome` 时显示第一屏（[`AgentWelcome`](stream/AgentWelcome.md)，竖直居中在消息区里），否则写“还没有消息”。
- `ctx.availability.status` 不是 `ready`：输入框只读，并在输入框上方显示说明。

## 不支持

- 不订阅 SSE、不调用接口、不读写浏览器存储与剪贴板；复制、上传、草稿持久化都通过 action 交给宿主。
- 不提供插槽替换任何区域；两个插槽只往头的固定位置里放东西。
- 不画面包屑：子会话只经返回一级一级回到祖先。

## 隐藏通道理由

- `state:local`：未受控时的视图模式、输入框中尚未发送的文字、是否跟随底部与阅读锚点、正在预览的图片。这些是纯界面状态，不影响会话数据。每一轮里的展开状态由 `AgentConversationTurn` 自持。
- `env:portal`：溢出菜单使用 nb-ui `Dropdown`，其菜单浮层渲染到 `body`。原图预览对话框和后续切片的面板与弹窗渲染到 `teleportTarget`，目标不存在时就地渲染。
- `state:inject`：读宿主注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`）取界面文字；宿主要登记本包的目录（`@notnotype/nb-agent-ui/locales`），语言以端口为准。上面没有注入时按 `locale`（缺省 zh-CN）建缺省端口并提供给子组件，见 [README](../../README.md#没有宿主时)。渲染组件经 `provideAgentView` 交给子组件。

## 已知偏差

当前完成了切片 S1 到 S3（S5 的工具详情也已提前做了），以下 Spec 行为尚未实现：

- 渲染器（S5）：提问留痕、模式切换、Workflow、系统条目与错误条目的专用渲染器。
- 输入框（S6 后半）：历史消息的就地编辑、不可用时的横幅与提问向导尚未实现；只读时输入框不说明原因。排队中的消息暂时由输入框显示在外框上方，待处理区（S7）做好后收进去。
- 登记的面板（注册表的 `panels`）与目标是面板的顶栏动作（构造注册表时拒绝）。状态栏、上下文详情与分支树的弹窗已有。
- 常驻顶栏的登记动作在 390 宽时不收进溢出菜单（布局一节说 390 宽时右侧只留溢出菜单按钮）。
