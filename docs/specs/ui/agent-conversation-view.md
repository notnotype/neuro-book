---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.agent-conversation-view
owners:
  - packages/nb-agent-ui
  - packages/nb-ui
---

# Agent 对话视图

## 目标与非目标

目标：提供一个纯受控的 Agent 对话视图 `AgentConversationView`，覆盖会话顶栏、消息流、输入框上方待处理区、输入框、状态栏、面板与弹窗。消息流按注意力分层：运行中 Agent 说出的话与人机交互控件常显、思维链默认折叠；已结束的轮次整轮收起，翻看历史时只看到最终回复与改动文件；长对话仍然易读；另提供逐条消息的原始视图用于调试。视图的数据全部由宿主传入，用户意图全部以 action 交给宿主执行；工具渲染、消息操作、顶栏动作、面板、待处理区、状态栏条目和输入框命令都通过注册表扩展。视图在 Component Lab 中以确定性 fixture 完成验证。

非目标：

- 不包含会话数据层：不订阅 SSE、不调用接口、不持久化任何数据，也不定义后端接口。
- 视图本身不包含会话栏、Inline AI 和 Trace Viewer。包另外提供会话列表组件（见“会话列表”），由宿主摆在左栏、下拉或弹窗里。
- 不包含“当前任务清单”面板：它独立于本视图，另行规划；消息流里只显示每一次任务清单调用。
- 不接入主页面；主页面切换与旧组件删除属于后续工作。
- 不实现插件加载；注册表的插件入口等插件运行时（`runtime.plugins`）定型后再接。

功能基线见[提案附录 A](../../../packages/neuro-book-legacy/docs/proposals/agent-conversation-view.md#附录-a功能基线)，本规范覆盖其中全部 61 项；交互方式以本规范为准。

## 术语与参与者

- **宿主**：向视图提供 ctx、服务与注册表，并执行视图发出的 action 的调用方。在 Lab 中是 fixture。
- **ctx**：视图渲染所需的只读领域数据，可以完整表示为 JSON。
- **服务**：视图需要调用的纯函数能力，例如 HTML 消毒、附件地址解析、输入框触发菜单解析。
- **action**：视图发出的用户意图，按 `type` 区分。视图不关心宿主如何执行。
- **纯界面状态**：只影响呈现、不需要持久化也不影响会话数据的状态，例如弹窗开关、面板展开、思维链折叠、输入框中尚未发送的文字。它由视图自己持有。
- **轮次（turn）**：从一条用户消息开始，到下一条非 steer 用户消息之前结束的一组消息。第一条用户消息之前的消息组成一个没有用户消息的开场轮次。
- **准则**：Message[] 对用户透明，开发者看分轮视图能反推出消息序列；同时注意力集中在主要信息上。
- **常显层**：始终可见的内容：用户消息、Agent 说出的 content（运行结束后只留最终回复）、人机交互控件、信息条目、分隔线、steer、错误。
- **思维链**：两个常显条目之间的思考、普通工具调用及其结果、系统提示词，以及运行结束后并入的中间 content。默认折叠成一行摘要。
- **人机交互控件**：需要用户关注或回应的工具调用，由工具渲染器声明为 `node` 呈现：提问、切换模式、任务清单、Workflow。
- **信息条目**：系统提醒与自定义系统消息，常显为淡色一行，可点开看全文。
- **附注**：宿主挂在一条助手消息上的补充信息（例如问答回复里没核实的出处），显示在这条消息的文字之后，由宿主登记的条目渲染器画；没有登记或渲染出错时显示为淡色一行。
- **最终回复**：轮次中最后一条正文非空、且其后再无工具调用的 assistant 消息。
- **步骤**：思维链中的一项，可以是一次工具调用、一段思考、一段并入的中间 content 或一条系统提示词。
- **工具组**：思维链中连续出现、同属“探查”类别的工具调用。
- **摘要行**：代表一条思维链或整轮过程的一行：开头一个种类图标，接一句像人说的概括（是否思考、读了和改了几个文件、其余操作次数），失败次数以危险色附在末尾，最后是折叠箭头。它是过程入口，宽度随内容、淡色，注意力低于正文；运行中图标换成转圈、概括换成正在执行的那一步。
- **轮末汇总**：每轮末尾的一行，左边是改动文件条（没改文件不显示），右边是用量（用时、tokens、输入、输出、缓存读取、费用；单价未知时不显示费用）。
- **结果节点**：工具渲染器声明为结果、以 `node` 呈现且调用成功的工具调用，例如问答里交答案的收尾工具。被退回（出错）的那几次属于过程，在思维链里显示为一行，不画 `node` 组件；全部被退回时这一轮没有结果区。
- **结果与过程**：结果是一轮末尾连续的最终回复、错误与结果节点；其余内容都是过程。
- **整轮收起**：已结束的轮次把过程收成一行整轮摘要，只露出结果与轮末汇总。
- **角色**：消息的说话者，现在是用户与 Agent；登记在注册表里，为第三种角色预留。
- **原始视图**：一条消息对应一个块、按时间顺序平铺的调试视图。
- **注册表**：各扩展点登记项的集合，内置功能与插件使用同一套登记方式。
- **渲染器**：注册表中负责把某类数据画出来的登记项。
- **宿主组件**：宿主或插件登记在注册表里的组件（工具的 `node` 组件与详细内容组件，以及后续的条目、面板、状态栏条目）。它们收到 ctx、服务、界面语言与各自的数据，只通过 action 表达用户意图。

## 输入与前置条件

### Props 与事件

```ts
type AgentConversationViewProps = {
    /** 只读领域数据；可完整 JSON 化。 */
    ctx: AgentConversationContext;
    /** 纯函数能力。 */
    services: AgentConversationServices;
    /** 扩展点注册表；内置功能也登记在这里。 */
    registry: AgentViewRegistry;
    /** 消息流视图模式；可选受控，缺省由视图自持，初始为 "turns"。 */
    viewMode?: "turns" | "raw";
    /** 弹窗与浮层的渲染目标；false 表示就地渲染（Lab 使用）。 */
    teleportTarget?: string | false;
    /** 界面语言，只在宿主没有注入翻译端口时起作用；缺省 "zh-CN"（见“边界与兼容”）。 */
    locale?: "zh-CN" | "en-US";
    /** 宿主注入的渲染组件；缺哪个用包内的缺省实现（见“失败与恢复”）。 */
    renderers?: {markdown?: Component; promptEditor?: Component; promptTextView?: Component; form?: Component};
    /** 输入框下面的状态栏；缺省 false。宿主有自己的用量显示时不要（见“状态栏”）。 */
    statusBar?: boolean;
    /** 顶栏的新建会话按钮；缺省 false。 */
    newSession?: boolean;
    /** 是否显示顶栏；缺省 true。宿主页面自有标题时传 false（见“顶栏”）。 */
    header?: boolean;
    /** 运行中过程的展开方式；缺省 "collapsed"（见“展开与折叠”）。 */
    processDisclosure?: "collapsed" | "live";
    /** 输入框版式；缺省 "stacked"（见“输入框与待处理区”的单行版式）。 */
    composerLayout?: "stacked" | "inline";
};

type AgentConversationViewEmits = {
    (e: "action", action: AgentViewAction): void;
    (e: "update:viewMode", mode: "turns" | "raw"): void;
};
```

视图对外暴露两个方法：`focusComposer()` 聚焦输入框，`scrollToLatest()` 滚动到最新内容。没有插槽；扩展一律通过注册表。包公开的组件是这个视图、会话列表（见“会话列表”）与模型目录对话框（见“模型目录”）；视图里的零件（轮次、输入框等）不是宿主接口。

### ctx 的组成

| 部分 | 内容 |
|---|---|
| `session` | 当前会话的标题、摘要、Profile 名称与图标、状态、后台摘要状态；未选择会话时为 `null` |
| `availability` | `ready`、`loading`、`empty`、`unselected`、`archived`、`profile-unavailable`、`load-error` 之一，附用户可读说明和可执行的恢复动作 |
| `interaction` | 当前允许的操作：发送、运行中补充说明（steer）、运行中排队（followup）、回答提问、修改历史、停止、登记附件、修改模型与模式、归档、恢复、宿主有没有管理模型的地方、宿主做了的输入框命令（`commands`）与触发字符（`triggers`，没列的不打开菜单）、能不能给上下文详情与分支树 |
| `run` | 运行状态 `idle`、`running`、`waiting`、`stopping`，当前运行阶段文案，正在运行的轮次 |
| `messages` | 已加载的全部消息，按时间顺序排列，包含运行中尚未落盘的内容（见下文“消息”） |
| `history` | 是否还有更早的消息、是否正在加载、加载错误 |
| `branches` | 按消息 id 索引的分支切换信息：当前第几个、共几个 |
| `editing` | 正在编辑的历史消息：消息 id、完整原文、原文是否仍在加载 |
| `pendingInputs` | 等待用户回答的提问与审批，含题目、选项、表单规格 |
| `workflows` | 按工具调用 id 索引的 Workflow 运行状态：阶段、当前动作、等待中的问题、结果 |
| `workspaceChanges` | 待审阅的文件变更分组、每组的 diff 状态、加载与错误 |
| `composer` | 可选模型（各带分组名与用不了的原因，可选）与当前模型、思考档位、Agent 模式、排队中的消息、已登记的会话附件、模型是否支持图片、输入框中附件（图片与文件）的上传状态（就绪的带附件目标）、已发送内容（供输入历史使用）、粘贴分档设置、草稿（文字加版本号；版本号变化时视图用它替换输入框内容） |
| `usage` | 上下文用量与上限、累计 tokens、缓存读写、缓存命中率、累计费用、费用显示币种。上下文用量取最近一次模型请求的输入（含缓存读写，同 OMP 的口径），运行中是上一次请求的值 |
| `connection` | 连接状态与是否需要用户操作 |
| `panels` | 附件列表页、关联 Agent、系统提示、会话列表页、分支树、上下文检查数据 |
| `now` | 宿主提供的当前时间，用于显示运行中的用时 |
| `extensions` | 按插件 id 分区的数据，供插件登记的渲染器读取 |

### 消息

```ts
type MessageView =
    | {kind: "user"; id: string; timestamp: number; intent: "normal" | "steer";
       blocks: ContentBlockView[]; contentOmitted: boolean;
       delivery?: "pending" | "unknown"}
    | {kind: "assistant"; id: string; timestamp: number;
       status: "streaming" | "done" | "stopped" | "interrupted" | "error";
       text: string; thinking: string; model: string; usage?: UsageView;
       toolCalls: ToolCallView[]; error?: string; contentOmitted: boolean;
       annotations?: MessageAnnotationView[]}
    | {kind: "system"; id: string; timestamp: number;
       source: "prompt" | "reminder" | "compaction" | "branch_summary" | "custom";
       label: string; text: string}
    | {kind: "error"; id: string; timestamp: number; message: string; retryable: boolean};

// 附注：宿主挂在助手消息上的补充信息。customType 匹配条目渲染器；text 是没有渲染器或渲染出错时显示的一句。
type MessageAnnotationView = {customType: string; text: string; details?: JsonValue};

type ToolCallView = {
    id: string; name: string;
    /** `denied`：没有执行（用户或规则拒绝、还没开始就停了）。`unknown`：开始了但不知道有没有执行完，要用户核对。说明在 `note`。 */
    status: "streaming" | "running" | "success" | "error" | "invalid" | "denied" | "unknown";
    note?: Text;
    args: JsonValue; result?: ToolResultView; error?: string;
};
```

字段名可以在实现时调整，语义以本节为准；调整后在晋升 `implemented` 时回写本规范。

### 服务

- `resolveMarkdownAsset(src, signal)`（可选）：把回复里 Markdown 图片的地址换成可显示的地址，返回地址与释放函数；不提供时图片只显示说明。Markdown 的渲染与净化由宿主注入的 Markdown 显示组件负责，视图不插入 HTML。
- `resolveAttachmentUrl(locator, variant)`（可选）：返回附件的缩略图或原图地址；返回空或不提供时附件不可用。
- `resolveTriggerMenu(context)`（可选；不提供时 `/` 之外的触发字符不打开菜单，`/` 命令照常，正文中间的 `/` 只提示命令要写在开头）：按输入框中的触发字符、已输入文字以及触发字符是否位于开头返回候选菜单。候选可以分组、可以禁用；逐级进入的候选确认后按新的查询继续。数据未到时返回加载中，到达后宿主换一个新函数。`/` 位于正文开头时菜单由视图按登记的输入框命令列出，不调用它。

### 注册表

每个登记项有 `id`（同一扩展点内唯一）、排序值，以及可选的显示条件（以 ctx 为输入）。各扩展点另有专属字段：

| 扩展点 | 专属字段 |
|---|---|
| 角色 | 图标与名称；色调（强调色或中性色） |
| 工具渲染器 | 匹配的工具名或名称前缀；类别（`explore`、`mutate`、`interact`、`other`）；图标与名称；单行摘要（调用出错时也会调用，可以写出失败原因）；探查组的合并摘要（`explore` 必有，收到这一组里它处理的各次调用，含出错与运行中的）；对文件的影响；diff 行（改文件的工具给出，没有专用详细内容组件时详情画成 diff）；展开后的详细内容组件；呈现层级（思维链中的一行 `line`、思维链中的卡片 `card`、常显的交互控件 `node`）；`node` 的专用组件；是否算本轮结果（只对 `node`） |
| 条目渲染器 | 匹配的消息类型与系统条目来源，或附注的 `customType`；内容组件。视图现在只按 `customType` 读取附注 |
| 消息操作 | 适用的消息类型，可再按单条消息判断（例如尚未确认送达的用户消息不能编辑、重试或分支）；图标与名称；点击后发出的 action |
| 顶栏动作 | 图标与名称；角标数；点击后发出 action 或打开某个面板；是否允许常驻顶栏 |
| 面板 | 面板组件；打开方式（顶部浮层或弹窗） |
| 待处理区条目 | 条目组件 |
| 状态栏条目 | 条目组件 |
| 输入框命令 | 命令名、说明、参数提示 |
| 输入框触发字符 | 触发字符；菜单通过服务解析 |
| 输入框工具栏按钮 | 图标与名称；放在正文前还是工具栏里；点击后发出的 action，或者往编辑器插入的触发字符（打开它的菜单，不发 action） |

工具名匹配：精确工具名优先于名称前缀；前缀互相包含时取最长的那个，与登记顺序无关。两个渲染器声明相同的工具名或相同的前缀、两个条目渲染器声明相同的 `customType` 时构造失败（见“失败与恢复”）。

宿主组件收到 `ctx`、`services`、`locale`（当前界面语言）与各自的数据（工具组件是这次调用，条目组件是这条附注与它所在的消息），只发出 `action`，由视图原样交给宿主。

宿主注入的渲染组件之外，还可以注入 `markdownPreview(text)`：Markdown 文字折叠时露出的那一行纯文字怎么取。不注入时用包内的缺省规则，只去掉常见的强调、代码、链接与块标记，强调按 CommonMark 的写法认（与展开后的显示一致）。注入的函数出错时这一行按缺省规则显示。

Markdown 扩展与空状态起手提示在本规范中只预留，不要求实现。

内置工具的类别：

| 类别 | 工具 |
|---|---|
| `explore` | `read`、`web_fetch`、`web_search`、`subject_rag_search`、`get_session`、`get_agent`、`get_agent_profile` 以及名称以 `list_` 开头的查询类工具 |
| `mutate` | `write`、`edit`、`apply_patch`、`subject_memory_update`、`subject_event_append` |
| `interact` | `request_user_input`、`switch_mode` |
| `other` | `task_create`、`task_set_status`、`run_workflow`、`bash`、`execute_sql`、Agent 协作类工具、`report_result`，以及所有未登记的工具 |

表中 `subject_rag_search`、`get_session`、`get_agent`、`get_agent_profile`、`subject_memory_update`、`subject_event_append` 是 NeuroBook 自己的工具，由 NeuroBook 宿主登记，类别与呈现同表；其余是通用的 harness 工具，由视图内置登记。

内置工具中以 `node` 呈现（常显的人机交互控件）的是 `request_user_input`、`switch_mode`、`task_create`、`task_set_status`、`run_workflow`；其余 `interact` 与 `other` 工具以 `card` 呈现在思维链里，`explore` 与 `mutate` 以 `line` 呈现。

### 前置条件

- ctx 与服务都由宿主提供，视图不自行取数。
- 注册表在传入前已构造完成；构造时同一扩展点出现重复 `id` 即报错（见“失败与恢复”）。
- 视图可用宽度不小于 360px；验收宽度为 390px 与 1200px。

## 输出与可观察行为

### 布局

自上而下依次为：顶栏、消息流、待处理区、输入框、状态栏。顶栏、待处理区、输入框和状态栏固定，消息流占据剩余高度并独立滚动。面板以顶栏下方的浮层打开，会话面板、模式菜单与输入框同宽，分支树和上下文检查器以弹窗打开。内容变多时，待处理区先折叠为一行，消息流高度最后让位。

顶栏、气泡右边、输入框、向导、弹层、状态栏用同一组左右边距（12px）；宽时内容列上限 800px 居中。

### 顶栏

- 显示会话标题、Profile 名称和后台摘要状态；悬停标题显示会话摘要。宿主给了 `sessions` 插槽时标题是按钮，点开弹出下拉，放插槽的内容（会话面板）。`newSession` 为真时有新建会话的按钮，发出 `session.create`。
- 常驻顶栏的动作不超过两个，其余动作收进溢出菜单。溢出菜单固定包含“原始视图”切换项。
- 390 宽时标题区域不小于 160px。
- `header` 为 false 时不显示顶栏；原始视图的切换入口随之没有，宿主要切换时用受控属性 `viewMode`。

### 分轮视图

- 版式沿用旧 `AgentSidebarView` 的对话气泡：每个说话者一行角色行（头像、角色名、模型、时间、状态，右端操作条），下面是缩进 24px 的内容。气泡版式不区分角色，头像与名称取自角色注册表；Agent 的头像优先用会话 Profile 的图标。
- 一轮依次显示：用户消息；Agent 一侧的过程（按时间顺序的常显条目与思维链）与结果；轮末汇总。最终回复之后的分隔线显示在轮末汇总下方；轮中的压缩分隔线在整轮收起时也显示，放在整轮摘要行与结果之间。
- **整轮收起**：轮次结束（完成、出错、被停止）且有过程时，过程收成一行整轮摘要，例如“过程 · 14 次操作 · 6 次请求 · 读了 7 个文件，改了 2 个 · 1 次失败”，下面只露出结果与轮末汇总；请求次数是这一轮模型回复的条数，provider 丢弃后重试的请求不算。点击摘要展开，过程挂在从摘要图标垂下的竖线上、缩进一级。运行中与等待回答的轮次不收起。结果节点不计入整轮摘要的操作次数；结果之后跟着压缩或分支摘要的分隔线时，结果仍露出，夹在分隔线之间或之后的信息条目留在结果区。
- **常显层**：
  - 最终回复用完整气泡（Markdown），它的附注画在气泡里、正文下方。中间 content 的附注随它所在的那一行展开显示；没有文字的消息的附注作为一行独立显示在这条消息之后。运行中的中间 content 用轻一级的气泡常显；运行结束后并入所在位置的思维链，常显层只留最终回复。
  - 人机交互控件以卡片常显，并把思维链切开。任务清单每次调用都显示：新建时完整列出；更新时列出变化的项和进度，可展开看这一刻的完整清单。Workflow 卡片运行中显示当前动作。
  - 系统提醒与自定义系统消息显示为淡色一行（标签加正文第一行），点击在下方展开全文（Markdown，淡色小字）；`compaction` 与 `branch_summary` 以分隔线显示，带摘要正文或压缩详情时点击标签在线下展开。压缩详情（`SystemMessageView.compaction`）只显示有的字段：方法与模型、压缩前后 token（标“估算”）、花费、用到的要求、放回了什么、保留最近几轮原文或省略了几条工具结果、摘要全文；没有调模型的写“没有调用模型”。
  - steer 以带“补充说明”标记的浅色条显示在发生的位置。
  - 错误以危险色气泡显示；被停止时末尾显示“已停止”。
- **思维链**：两个常显条目之间的内容合成一条，默认折叠为摘要行，例如“思考 · 读了 7 个文件，改了 2 个 · 另有 3 次操作 · 1 次失败”；没有 content 的连续 assistant 消息合在同一条里。运行中的思维链摘要行显示转圈，并换成正在执行的那一步。点击展开后逐项显示：
  - 连续的 `explore` 工具合成一个工具组，组头显示合并摘要（如“读了 5 个文件，搜索了 2 次”），点击展开逐项；思考与消息边界夹在其间时并入组内；
  - 每个 `mutate` 工具单独一行，显示目标和增删统计；
  - `card` 呈现的工具（命令、SQL、协作等）以可展开卡片显示；
  - 并入的中间 content 按 Markdown 渲染在浅底小气泡里，用正文色；
  - 思考折叠时露出第一行纯文字（去掉 Markdown 标记，去完是空的往下找，首尾相接的几段粗体小标题只露出第一段），点击展开全文（Markdown）；
  - 系统提示词显示为一行，点开看全文；
  - 两条 assistant 消息之间有一道细分隔，让人能数出消息边界。
  - 每一次工具调用（单行、组内一项、出错单独露出的一项、卡片）都能点开看详情：渲染器登记了详情组件时用它（内置：`read` 为带行号的文件内容，`edit`、`write`、`apply_patch` 为 diff，`bash`、`execute_sql` 为命令与输出）；没有登记的工具显示原始参数 JSON、结果正文与结构化结果 JSON，开发者据此对照底层调用。出错时错误信息在最上方；有详情组件但出错且没有结果时附上原始参数。代码块超过最大高度时内部滚动，长行在块内横向滚动。
- 工具组在运行中保持折叠，组头实时显示正在执行的那一项；组内有工具出错时，出错项单独露出。
- 卡片最多嵌套一层。
- **轮末汇总**：只占一行，放不下时换行。改动文件条注意力低于回复气泡：它按路径合并本轮改动过的文件，每个文件一枚按内容宽度的小标签（只有细分隔线描边，文字用次级色），写文件名与增删行数，同名文件带上级目录，完整路径在悬停提示里；点击发出 `file.openDiff`，超过 5 个时其余收成“+N”；没改文件时不显示。同一行靠右是用量，显示用时、tokens、输入、输出、缓存读取与费用，悬停显示明细。
- 消息操作图标常显在角色行右端，颜色弱；有多个分支时分支切换在操作条最前。Agent 一侧的操作作用于结果所在的消息；结果是结果节点时，复制发出 `tool.copy`（答案在工具参数里）。时间显示在角色行。
- 面板拉宽时每轮限宽 800px 居中，避免正文行过长。

### 展开与折叠

| 轮次状态 | 整轮默认 |
|---|---|
| 运行中、等待回答 | 不收起，过程全部显示 |
| 正常结束 | 自动收起 |
| 出错或被停止 | 最新一轮展开，较早的收起 |
| 从历史加载 | 收起 |

- 用户手动展开或收起过某轮后，该轮不再跟随自动规则。
- 思维链默认折叠，运行中也不自动展开。`processDisclosure` 为 `live` 时例外：运行中与等待回答的轮次里，思维链与工具组默认展开，逐步列出每一步，卡片与思考仍折叠；用户点过的以用户为准；轮次结束后回到默认折叠。
- 整轮收起后再展开时，其中各段回到默认的展开状态。
- 以上都是纯界面状态，切换会话时清空。
- 运行结束时整轮自动收起，Agent 一侧会变短。若用户不在底部，视口顶部正在读的内容保持在原位；正在读的内容就在被收起的过程里时，改以该轮最终回复为锚点保持其在视口中的位置。若键盘焦点位于将被收起的过程内，焦点移到整轮摘要行。

### 原始视图

`viewMode` 为 `raw` 时，消息按时间顺序逐条显示：每条消息一个块，工具调用依附于所属 assistant 消息，系统条目全部可见，不做轮次折叠和工具合并。切换视图模式不改变消息数据与滚动到最新的状态。

### 历史与滚动

- 停在底部时跟随新内容；用户向上滚动离开底部后不再跟随，消息流底部出现“回到最新”按钮，点击后回到底部并恢复跟随。
- 视口上方或正在阅读的内容高度变化时（整轮收起、插入更早一页），视口中的内容位置不动。用户点开或收起某一项引起的变化以这一项为锚点，即使原本停在底部也不把它推走。
- 滚动到接近顶部，或内容不足一屏时，发出 `history.loadPrevious`。还有更早内容时消息流顶部有一行“更早的内容”，也可以点击加载；加载中显示加载指示，失败时显示错误与重试。最早一个轮次的用户消息尚未加载时，这一行就是它的开头标记，更早一页加载后与之合并。
- 切换会话后直接定位到最新内容，恢复跟随。
- 发出消息或命令后（来自输入框，或宿主组件发出的 `composer.submit`、`command.run`）回到最新内容并恢复跟随，即使此前正在往上翻阅。
- 没有消息时：`availability` 为 `loading` 显示加载中，其余显示“还没有消息”；其余状态的说明与恢复动作在输入框上方的横幅里，不在消息流里重复。

### 消息

- 用户消息区分普通与 steer；显示图文内容块和附件；正文被省略时显示“仅显示预览”。文字按输入框的文字写法显示，引用、技能与选区是标签；图片、文件附件与粘贴块按输入框的方式显示：附件条加正文里的 `#N` 标签，粘贴块默认折叠。点击标签与卡片的结果与输入框相同（见“输入框与待处理区”）；文字之外的旧附件块照常显示，点击图片同样打开原图预览、点击文件发出 `attachment.open`。
- 投递状态为 `unknown` 的用户消息显示文字说明：“可能已发送，重新发送可能产生重复”，并提供“重新发送”和“移除”。
- 编辑历史消息时，消息就地变为编辑器（和输入框同一个注入的编辑器），支持 `@` 引用；插图随附件；原文仍在加载时只读。补充说明不能编辑、重试或分支：它插在一轮中间，没有对应的回退目标。
- assistant 消息流式生成时显示光标；被停止时显示“已停止”，不显示内部错误原文。
- 回复与思考里的 Markdown：点击引用发出 `reference.open`，点击外链发出 `link.open`，由宿主决定怎么打开；点击图片打开原图预览（纯界面行为）。

### 输入框与待处理区

- 回车发送。运行中（含等待回答与停止中）：回车在 `interaction` 允许补充说明时为 steer，否则在允许排队时为 followup，否则不发送；Ctrl/⌘+回车只在允许排队时为 followup。两者都不允许时运行中仍可输入，发送按钮禁用并提示运行结束后发送。`/` 命令不受这两项限制。运行中且输入为空时，发送按钮变为停止。Shift+Tab 切换 Agent 模式。发送后输入框不自行清空，宿主受理后给出新版本的空草稿。
- 输入框下方是工具栏：左边是“这一轮能做什么”，依次为 `+` 菜单（添加附件与可用的 `@`、`$`、`/` 触发符）、Agent 模式与审批模式两个控件（Agent 模式点一下切下一种，Shift+Tab 相同；审批模式是下拉；各自没给时不显示；模式不是第一种时审批模式控件变淡，全部放行保留红色，见 [`agent/modes.md`](../agent/modes.md) 输出 11）、登记的工具栏按钮；右边是“谁来答、发出去”，依次为模型与思考档位（同一个控件，一行文字，思考档位用强调色；没有可选的模型与思考档位时不显示）与发送/停止。展开按钮在外框右上角，发送上方；窄屏时两个模式只留图标。单行版式的控件仍在一行里，展开按钮在发送旁边。展开后输入框占视图高度的大部分，回车换行，Ctrl/⌘+回车发送（运行中允许排队时为 followup，否则按回车的规则），发送按钮仍按回车的规则发送。
- 单行版式（`composerLayout: "inline"`）：正文与控件同一行，依次是前置的登记按钮、编辑器、控件（模式、模型与思考档位、上下文大小、其余登记按钮、展开、发送）。正文长高时只有编辑器长高，控件留在右下、对着最后一行；输入框窄于 520px 时控件整排折到正文下面，前置按钮留在正文前。上下文大小是一个圆环加百分比，70% 起警告色、90% 起危险色，超过窗口时满格并写实际百分比，数字在提示里；只在单行版式里画，`usage` 不知道上限或还没有用量时不画。宿主允许登记附件时（单行没有附件条的位置）退回两层。
- 带角色的选择器：`composer.roles` 非空时，模型与思考档位的下拉换成按钮加面板。按钮写“选的是谁 · 实际用的模型 · 档位”，直接选模型时不重复（实际用的模型取 `composer.effectiveModel`）。面板贴着输入框、同宽、高度固定，分“角色”“模型库”两页，切页不跳；档位多于一个时有滑块。角色页：`models` 里 key 为空串的一项（跟随默认），梯度角色两列，专精角色另起一组；用不了的角色仍能选，选了不关面板。模型库页：搜索显示名、组名与 key，按组列出，右侧能力图标、窗口、输入与输出单价；用不了的不能选，选了关面板。有“管理模型…”时在底部。Esc 关闭并还焦点。
- 模型解析不了（`availability` 为 `profile-unavailable`）时选择器仍可用，用户才能在这里改；别的不可用状态下不可用。
- 模型下拉：同组的模型右侧写组名（不同服务商的同名模型分得清）；用不了的模型灰掉、不能选，悬停看原因；宿主不收附件时不标“不支持图片”。`interaction.canManageModels` 为真时末尾有“管理模型…”，发出 `model.manage`。
- 带触发字符的工具栏按钮（例如“插入引用”插 `@`）：编辑器聚焦到末尾，前一个字不是空白或标点时先补一个空格，再插入触发字符并打开它的菜单。
- 输入以 `/` 开头且命令名与已登记的输入框命令一致时，发出 `command.run`；否则按普通文字发送。宿主在 `interaction.commands` 里列出自己做了的内置命令时，没列出的内置命令不显示、也不算已登记：输入 `/new` 按普通文字发给模型（有意的取舍：以前这些命令发出去被宿主丢弃，是死入口）。
- 触发字符（`@`、`$`、`/` 及登记的其他字符）打开候选菜单，菜单内容来自 `services.resolveTriggerMenu`；`/` 位于正文开头时改为列出登记的输入框命令，显示说明与参数提示。方向键选择，回车或 Tab 确认，Escape 关闭。
- 输入框的内容始终是一段文字：引用、技能、选区、命令、图片、文件附件与粘贴块按统一的文字写法保存（见组件文档 `PromptEditor.md` 的“文字写法”），在输入框里显示为整体的标签或块，光标跨过和退格删除都按一整个算。输入框与历史消息的就地编辑共用这个编辑器。
- 图片与文件（PDF、txt 等）可以用“添加附件”选择、粘贴或拖入：输入框上方的附件条显示缩略图或卡片，正文在插入处留 `#N` 标签；图片一套编号，文件与粘贴块另一套。每个附件显示上传中、已就绪、失败三种状态，失败可重试或移除；会话不能登记附件时拒绝添加并在输入框上方说明原因。模型不支持图片时不拒绝：能力只作提示，发送时按实际解析的模型换成一行字。发给模型时图片保留在文字中的位置；文件以附件路径给模型，由模型按需读取。
- 粘贴文字按大小分三档：小段原样插入；中等的在粘贴处成为默认折叠的粘贴块（展开后可以直接编辑内容），以 `<paste>` 标签包起来发给模型，也可配置为放到开头、粘贴处只留位置标记；特别大的转为文件附件。阈值与放置方式可配置。Ctrl/⌘+Shift+V 粘贴原文，不分档。
- 空输入框里按上方向键调出上一条已发送的内容；Ctrl+R 搜索已发送的内容。
- 点击输入框里的标签：引用发出 `reference.open`，图片打开原图预览（纯界面行为），文件发出 `attachment.open`，技能发出 `skill.open`。
- 有待回答的提问或待批准的审批时，向导替换输入框的位置：放在消息流内容末尾、粘在底部，往上滚时浮在内容上，贴底时不盖最后一条；输入框隐藏但不卸载；最高占视图的 60%，内容内部滚动；表面和其它浮层相同；可以收起成一条小条（写等什么、第几个，没有批准按钮）。审批逐个处理，显示工具、目标与预览（`DiffView`，或命令的等宽代码块，或 nb-form 的展示态），按钮是批准、本会话都批准、拒绝，附言框写了字就是拒绝。提问向导支持单选、多选、“其他答案”、表单（nb-form 编辑态）、多题切换、终止本轮。未提交的答案是纯界面状态，只在当前批次内保留。
- `composer.resume` 为真时占位文字说明上次运行被中断、回车继续，发送按钮换成继续（图标 `>>>`，大小不变）；空着发送发出 `run.continue`，写了字照常发送。
- `availability` 不是 `ready` 时，输入框上方显示对应的横幅和恢复动作，输入框只读。
- 待处理区依次显示已登记条目；内置条目为 Workflow 待回答、工作区变更、排队消息。

### 状态栏

输入框下面一行小字。左边：上下文圆环与百分比（点击打开上下文检查器，90% 起变红）、运行阶段与用时（不写具体哪一步）、等重发、等你批准或回答、费用告警、非默认模式的标记（“全部放行”用警告色）、断线时的连接状态（需要操作时提供重连）。右边：累计 tokens、输入、输出、缓存命中、费用，图标与轮末用量相同，明细在悬停。状态栏窄于 400px 时右边只留缓存命中与费用（服务商不报缓存时留累计），累计、输入、输出在悬停里；左边放不下时省略，不挤右边。

### 会话列表

会话列表是包导出的独立组件，不在视图里；宿主把它放在左栏、下拉或弹窗里。会话列表弹窗的列表部分就是它。

```ts
type AgentSessionListItem = {
    id: string;
    title: string;                 // 空串时显示“未命名会话”
    description?: string;          // 第二行的补充说明，宿主写好，例如“3 轮 · 图当目录”
    updatedAt: number;             // 最近活动的时刻（毫秒）
    status: "idle" | "running" | "interrupted" | "error";   // 宿主按自己的状态映射
    note?: {text: string; icon?: string};                   // 需要注意的一句，提醒色，在说明那一行的右侧
};
// 属性：items、selectedId、state（"ready" | "loading" | "error"，缺省 ready）、errorMessage?、now、locale?（同视图）、
// header?（是否显示标题行与新建按钮，缺省显示）、labels?（覆盖标题、新建、加载中、空、出错、重试、未命名的文字）
```

- 每行固定两行，所有行等高：标题（单行截断）与时间同一行；第二行总在，左边是说明，右边依次是提醒（提醒色小字）与状态，运行中是转圈加“运行中”，已中断与出错是标记。宽度不够时说明先截完，提醒再截断。选中的行用强调色浅底并标为当前项。状态除颜色外都有文字。
- 加载中、空列表与出错同一版式：居中的圆底图标加一句说明；加载中的图标是转圈，出错时说明下面有“重试”。
- 时间按本地时区的日历日写：与 `now` 同一天写时刻，前一天写“昨天”，同一年写月日，否则加上年；`updatedAt` 晚于 `now` 时按同一天写。宿主要定期更新 `now`。
- 点一行（含已选中的）发出 `session.select`，点新建发出 `session.create`；出错时点“重试”发出 `sessions.refresh`。列表不持有展开状态：放在下拉里时，由宿主收到选中或新建后关下拉。
- 加载中、空、出错三种状态都保留标题行与新建按钮。
- 是导航式列表：每行一个按钮、Tab 逐行经过，不做方向键漫游。

### 模型目录

`AgentModelCatalog` 是从很大的模型目录里挑几个模型的对话框，宿主在自己的设置里用（不在对话视图里）。数据（服务商、模型、密钥状态、哪些已选过）全由宿主给，选好的引用经 `pick` 交回。

- 左栏是“全部”与各服务商：能用的在前（自定义的、密钥有值的最前），每家一个密钥状态圆点与模型数；用不了的（要登录而变量没值、云凭据链）排在分隔线后、变暗。右栏顶上一个搜索框，下面是模型表：模型（显示名与 `服务商/模型名`）、接口、上下文、推理、图片、单价（未知写“未知”，不写成免费）。
- 搜索按 `服务商/模型名` 与显示名，分精确、连续子串、模糊三层；左栏显示各家的命中数。一次最多画 200 行，多了写还有几个。
- 勾选多个后“加入候选”；已选过的写“已添加”、用不了的服务商的模型不能勾。点用不了的服务商时右栏是说明页：要设哪个环境变量、是否只能登录、目录里有几个模型。“添加自定义服务商…”发出 `add-provider`，表单由宿主做。
- 窄于 720px 先去掉接口列，窄于 560px 再去掉推理与图片列；窄于 640px 时左栏收成顶上的下拉。

### 面板与弹窗

- 附件面板：网格浏览、搜索、翻页、原图预览、插入到输入框（纯界面行为）。
- 关联 Agent：上下游列表、状态，点击切换到对应会话。
- 系统提示：打开时请求加载，Markdown 渲染，刷新。
- 会话面板 `AgentSessionPanel`：搜索、作品范围、过滤菜单（Profile、已归档；选了的条件是过滤按钮上的条数，有没有选高度都不变）、按日期分组，每行带 Profile 图标。新建、归档、恢复、改名发 action，选 Profile 与改名的输入框归宿主。组件独立导出，宿主决定放在下拉还是侧栏。
- 分支树：顶栏菜单打开，`interaction.canOpenTree` 为真才有入口；打开时发 `tree.refresh`，关掉时发 `tree.closed`，数据在 `panels.sessionTree`。内部节点（模型请求、轮次边界）穿过去，只显示用户的话、回复与工具；过滤有默认、不含工具、只看用户、全部。两种视图共用搜索与选中，写节点数与分叉数，图标按说话的人着色：
  - 列表（缺省）：竖着一行一个节点，分叉处缩进线，线按分支着色；当前路径的字亮、别的暗，当前那行有底色，有分叉的行写几条分支，分支的开头能收起。上下键选，左右键收起展开，回车切换。
  - 图：节点是小块，线连起来，当前路径强调色，别的分支各一种颜色；排列方向可调，缺省从上往下，也可以从左往右。分叉节点上有“‹ 1/3 ›”，点一下把选中换到另一条分支，先看再切。方向键沿时间走到父节点或孩子，垂直于时间的方向换分支。节点超过 1,500 个时说明并让用列表。
  - 底部写选中的节点与 id（点了复制）、“切换到这条分支”：已在当前路径或不能改写时不可点。切换后关闭。
- 上下文检查器：组成（下一次请求各块的估算、窗口与压缩线）、缓存（本会话与最近一次的命中率、累计用量；服务商不报缓存时说明，不写 0%）、系统提示词（展开时才发 `systemPrompt.load`）、扩展的槽、诊断、刷新。视图持有开关：打开时发 `context.refresh`，关掉时发 `context.closed`，宿主放掉数据；换会话时关掉。`interaction.canInspectContext` 为真时才有入口：状态栏的圆环与缓存命中、顶栏菜单。数据在 `panels.contextInspection`，算不出时 `state` 为 `unavailable` 并带原因。不做缓存时间线与请求选择。

### action

| 分组 | action |
|---|---|
| 会话 | `session.create {profileKey?}`、`session.select {sessionId}`、`session.rename {sessionId, title}`、`session.archive {sessionId}`、`session.restore {sessionId}`、`sessions.query {query}`、`sessions.refresh`、`view.close` |
| 消息 | `message.copy {messageId}`、`message.editStart {messageId}`、`message.editCancel`、`message.editSubmit {messageId, text}`、`message.retry {messageId}`、`message.branchFrom {messageId}`、`message.resend {messageId}`、`message.dismiss {messageId}`、`branch.switch {messageId, direction}`、`tool.copy {toolCallId}`、`history.loadPrevious`、`history.refresh` |
| 引用与文件 | `reference.open {target}`、`link.open {href}`、`file.openDiff {path, toolCallId}`、`attachment.open {target}`、`skill.open {name}` |
| 输入框 | `composer.submit {text, delivery}`（`delivery` 为 `prompt`、`steer` 或 `followup`；附件都写在文字里，不另带）、`composer.stop`、`composer.draftChanged {text}`、`composer.attachmentAdded {localId, kind, file}`（`kind` 为 `image` 或 `file`）、`composer.attachmentRetry {localId}`、`composer.attachmentRemoved {localId}`、`command.run {name, argsText}`、`menu.opened {trigger}` |
| 运行设置 | `mode.set {mode}`、`model.set {modelKey}`、`thinking.set {level}`、`model.manage`、`runtime.reset` |
| 审批与提问 | `input.submit {batchKey, resolutions}`（`batchKey` 是事项 id，一个事项一条；`resolutions` 是 `{kind: "approval", decision, note?}` 或 `{kind: "question", answer: {text, data}}`）、`input.cancelRun`、`input.resync`、`wizard.state {state}`（向导的界面状态，宿主放回 `ctx.wizardState`） |
| 中断与排队 | `run.continue`、`queued.edit {id}`、`queued.remove {id}` |
| 审批模式 | `approval.set {mode}` |
| 恢复 | `availability.act {action}`、`connection.reconnect` |
| 面板数据 | `attachments.query {search, offset}`、`linkedAgents.refresh`、`systemPrompt.load {refresh}`、`tree.activate {entryId}`、`tree.copyId {entryId}`、`context.selectTrace {traceId}`、`context.refresh` |
| 工作区变更 | `changes.select {path}`、`changes.accept {path}`、`changes.acceptAll`、`changes.refresh`、`changes.openInbox` |
| Workflow | `workflow.submit {runId, answers}`、`workflow.cancel {toolCallId}` |
| 插件 | `type` 为 `<插件 id>:<名称>`，负载由插件自行定义 |

## 状态与转换

本能力不引入持久状态。视图自持的纯界面状态包括：每个轮次是否被手动展开或收起、思维链、工具组、卡片与步骤的展开状态、面板与弹窗开关、输入框文字与图片的本地编辑、提问向导的未提交答案、视图模式（未受控时）、滚动吸底状态。

| 状态 | 事件 | 结果 |
|---|---|---|
| 轮次运行中 | 运行正常结束 | 中间 content 并入思维链，整轮收起，只露出结果与轮末汇总；按锚点规则保持阅读位置 |
| 已结束的轮次 | 用户点击整轮摘要行 | 切换收起状态，并标记为已手动操作 |
| 轮次运行中 | 运行进入等待 | 提问控件常显，提问向导替换输入框 |
| 轮次运行中 | 运行出错或被停止 | 错误或“已停止”常显在末尾 |
| 任意思维链 | 用户点击摘要行 | 切换折叠状态 |
| 任意 | `ctx.session` 的会话变化 | 清空全部纯界面状态，定位到最新内容 |
| 输入框只读（`availability` 非 `ready`） | `availability` 变为 `ready` | 输入框可编辑，横幅消失 |
| 视图模式 `turns` | 从溢出菜单选择“原始视图” | 变为 `raw`，发出 `update:viewMode` |

同一 action 可以重复发出，视图不去重；是否幂等由宿主决定。视图在发出 `composer.submit` 后不清空输入框；宿主受理提交后提供一个文字为空的新版本草稿，视图据此清空。这样提交失败时文字不会丢失。

## 副作用与数据

无副作用。视图不读写浏览器存储、不发起网络请求、不读写剪贴板、不自行计时轮询；复制、上传、持久化草稿等都通过 action 交给宿主。运行中用时依据 `ctx.now` 计算，因此在 Lab 中可以确定性回放。弹窗与浮层渲染到 `teleportTarget` 指定的位置，目标不存在时就地渲染。

## 失败与恢复

- 注册表构造时同一扩展点出现重复 `id`，或两个工具渲染器声明相同的工具名或前缀，或两个条目渲染器声明相同的 `customType`：构造失败并报出冲突的扩展点和 `id`、工具名或 `customType`，不静默覆盖。
- 某个渲染器渲染时抛错：只有该项降级为通用卡片并显示“此内容无法显示”，视图其余部分继续工作；错误通过开发诊断输出。工具渲染器的摘要、合并摘要、文件影响或 diff 回调抛错时，该项按通用渲染器的写法显示，没有 diff 时退回原始参数与结果。条目组件抛错时这条附注退回默认的淡色一行。
- 工具没有匹配的渲染器：使用通用渲染器，类别为 `other`。
- ctx 中引用了不存在的数据（例如 `branches` 指向不存在的消息）：忽略该引用，不报错。
- 宿主没有注入 Markdown 显示组件或提示词编辑器：用包内的缺省实现，Markdown 按纯文字显示，输入框退化为普通文本框（没有标签、附件与粘贴块）。
- 宿主注入了翻译端口却没有登记本包的目录：本包的文字显示为键名，由宿主的翻译引擎报缺键；不悄悄换成包内的中文。
- `services.resolveAttachmentUrl` 返回空或没有提供：附件显示“不可用”占位，不发起请求。
- `availability` 为 `load-error` 或 `profile-unavailable`：显示说明和恢复动作，消息流仍可阅读，输入框只读。
- 提交后宿主一直没有提供新版本草稿：输入框保持原文，由宿主通过 `availability` 或消息的 `delivery` 状态告知结果。

## 边界与兼容

- 视图是 `packages/nb-agent-ui` 包，建在 nb-ui 之上；Markdown 显示与提示词编辑器由宿主注入。数据层、接口调用与持久化属于宿主，当前宿主只有新应用 Component Lab 的场景；包里另有把 harness 会话日志与事件合成视图消息的适配器，供宿主使用。数据层的后续方案见[数据层后续提案](../../../packages/neuro-book-legacy/docs/proposals/agent-session-data-layer.md)。
- 视图不依赖旧应用 `packages/neuro-book-legacy`；旧组件的行为不受本规范约束。
- 顶层视图的能力标签只有 `state:local`、`state:inject`（宿主注入的渲染组件）与 `env:portal`；各渲染器与子组件的标签为空或只有 `state:local`，符合[组件规范](../../standards/code/components.md)。
- 视觉取值遵循 [nb-ui 设计语言](../../../packages/nb-ui/docs/design-language.md)与 [UI 开发规范](../../../packages/nb-ui/docs/ui-development-spec.md)，明暗两种主题都要满足对比度要求。
- 注册表中对插件稳定的部分，在 `runtime.plugins` 定型后另行确认；在此之前，注册表形状可以随内置需要调整。
- 界面文字在本包自带的消息目录里（命名空间 `nb-agent-ui`，源语言 zh-CN，经 `@notnotype/nb-agent-ui/locales` 导出），按[界面语言与消息目录](i18n.md)显示：宿主注入了翻译端口时登记这份目录，语言以端口为准，`locale` 属性不起作用；没有注入时视图、会话列表与模型目录按 `locale`（缺省 zh-CN）用缺省端口，单独挂载的内部零件用中文。分轮规则、注册表与 harness 适配器产出的文字是文字引用，显示时才翻译。宿主与插件登记的文字写中英两份或文字引用。
- 折叠的思维链不渲染其内部步骤，保证长会话的渲染开销与展开的内容量成正比。

## 验收与 Smoke

1. Given 一个已结束轮次，含 12 次普通工具调用（8 次读取、2 次改文件）、3 次任务清单调用、2 条系统提醒与若干中间 content，When 以分轮视图显示，Then 可见的只有用户消息、一行整轮摘要（写明 15 次操作、读了 8 个文件，改了 2 个）、最终回复，以及同一行里列出两个文件的改动文件条和用量；任务清单、系统提醒、思维链与中间 content 都收在整轮摘要里。
2. Given 同一轮次，When 点击整轮摘要行，Then 过程按时间顺序展开：3 张任务清单卡片、2 条淡色提醒、被它们切开的几条思维链摘要行；When 再点击一条思维链的摘要行，Then 它逐项展开，连续读取合为工具组，改文件各占一行，并入的中间 content 以 Markdown 显示，消息之间有边界。
3. Given 一个运行中的轮次，When 显示，Then 中间 content 常显，思维链保持折叠，最后一条思维链的摘要行显示转圈和当前执行的那一步；When 运行正常结束，Then 中间 content 并入思维链，整轮收起；When 用户随后展开它，Then 之后的自动规则不再改变它。
4. Given 用户向上滚动阅读，When 下方运行中的轮次结束并整轮收起，Then 视口中可见内容的位置不跳动；When 随后用户从输入框发出一条消息，Then 回到最新内容并恢复跟随。
5. Given 运行进入等待，When 显示，Then 提问控件常显，提问向导替换输入框；提交答案发出 `input.submit`。
6. Given 最新一轮运行出错或被停止，When 显示，Then 该轮展开，末尾显示错误或“已停止”，不显示内部英文错误原文；较早的出错轮次收起时错误仍露出。
7. Given 从历史加载的多个轮次，When 显示，Then 全部整轮收起；向上滚动加载更早一页后，可见内容位置不变。
8. Given 运行中的探查工具组，When 组内工具依次执行，Then 组保持折叠，组头显示当前执行项；某项出错时该项单独露出，所在思维链的摘要行计入失败次数。
9. Given 溢出菜单，When 选择“原始视图”，Then 消息逐条显示、系统条目全部可见，发出 `update:viewMode`；再次选择回到分轮视图。
10. Given 投递状态未知的用户消息，When 显示，Then 有文字说明及“重新发送”“移除”，分别发出 `message.resend` 与 `message.dismiss`。
11. Given 允许补充说明与排队的运行中输入框，When 输入文字后回车、Ctrl/⌘+回车、清空后点击按钮，Then 依次发出 `delivery` 为 `steer` 的 `composer.submit`、`delivery` 为 `followup` 的 `composer.submit`、`composer.stop`。
12. Given 已登记的 `compact` 命令，When 输入 `/compact 保留人物设定` 并发送，Then 发出 `command.run {name: "compact", argsText: "保留人物设定"}`；输入未登记的 `/foo` 时按普通文字发送。
13. Given 插件登记的新工具渲染器（类别 `explore`），When 该工具连续调用两次，Then 它们并入同一工具组，旧有分派代码无需修改。
14. Given 两个 `id` 相同的顶栏动作，When 构造注册表，Then 构造失败并指出冲突项。
15. Given 一个渲染时抛错的渲染器，When 显示对应工具，Then 该项降级为通用卡片，其余消息正常显示。
16. Given `availability` 为 `archived`，When 显示，Then 输入框只读，横幅提供恢复动作，点击发出 `availability.act`。
17. Given 390 × 844 视口，When 依次查看各 Lab 场景，Then 无横向滚动，顶栏标题区域不小于 160px，核心操作都能完成。
18. Given 明暗两种主题，When 查看各 Lab 场景，Then 文字与背景对比度满足 nb-ui 规范。
19. Given Lab 时间线回放一次完整的 ReAct 运行，When 从头播放与直接跳到同一步，Then 两者界面一致。
20. Given 已结束的一轮，结果工具先被退回一次、再交成功一次，其后跟着一条压缩分隔线，When 以分轮视图显示，Then 整轮收起后答案卡片仍露出，被退回的那次收在过程里，整轮摘要的操作次数不含交成功的那次；助手一侧的复制发出 `tool.copy`。
21. Given 宿主登记的 `node` 与详细内容组件，When 显示并点击其中的出处，Then 组件收到 ctx、服务与界面语言，发出的 `reference.open` 到达宿主；点击消息里的图片打开原图预览，宿主收不到预览 action。
22. Given `processDisclosure` 为 `live` 的运行中轮次，When 工具依次执行，Then 思维链与工具组展开、逐步列出每一步；When 运行结束，Then 整轮照常收起。
23. Given 运行中、`interaction` 既不允许补充说明也不允许排队，When 输入文字后回车或 Ctrl/⌘+回车，Then 不发出 `composer.submit`，输入框可继续输入，发送按钮禁用；只允许补充说明时 Ctrl/⌘+回车不发送；输入已登记的 `/` 命令时照常发出 `command.run`；`waiting` 与 `stopping` 时同运行中。
24. Given 没有可选模型与思考档位、`header` 为 false、也不提供 `resolveAttachmentUrl` 与 `resolveTriggerMenu` 的宿主，When 显示，Then 没有顶栏与模型下拉，附件显示不可用占位且点击不报错，输入 `@` 不打开空菜单；消息流为空且 `availability` 为 `loading` 时显示加载中。
25. Given 两个工具渲染器声明同一工具名，When 构造注册表，Then 构造失败并指出工具名；前缀 `list_` 与 `list_x_` 同时登记时 `list_x_items` 匹配后者，与登记顺序无关。

26. Given 五个会话（选中、运行中、已中断、出错、带提醒），When 显示会话列表，Then 每行有标题、说明、时间、状态与提醒，各行等高；点一行（含已选中的）发出 `session.select`，点新建发出 `session.create`；时间按日历日写今天的时刻、昨天、月日、年月日。
27. Given 会话列表处于加载中、空、出错，When 显示，Then 各有对应的说明且保留标题行与新建按钮；出错时点重试发出 `sessions.refresh`；`header` 为 false 时没有标题行；`labels` 覆盖包内文字。
28. Given 最终回复带一条已登记 `customType` 的附注，When 整轮收起，Then 宿主组件画在回复气泡里，收到 ctx、服务、界面语言、这条附注与消息，点出处发出的 `reference.open` 到达宿主；附注在中间文字上时随那一行展开显示，在没有文字的消息上时作为独立一行；没登记的 `customType` 与抛错的组件都显示为淡色一行；两个条目渲染器声明同一 `customType` 时构造失败。
29. Given 结果工具退回一次再交成功，When 展开整轮，Then 被退回的那次是思维链里的一行，宿主的 `node` 组件只出现一次，退回前后的过程是同一条思维链；全部被退回时这一轮没有结果区；运行结束时仍没有结果的结果调用同样是一行。Given 回复之后依次是压缩分隔线与系统提醒，Then 回复仍在结果区。
30. Given 思考第一行是 `**Finding X**`、`## X` 或两段粗体首尾相接，When 思考折叠，Then 露出去掉标记的文字，首尾相接的只露出第一段；行内代码里的星号、`snake_case`、`读取_章节_摘要`、`#伏笔` 保留；宿主注入了 `markdownPreview` 时用它。
31. Given 一个 `explore` 渲染器在一组里处理了三次调用，When 显示组头，Then 它的合并摘要收到这三次调用、可以按参数写（例如“读了第 33–37 章”）；合并摘要抛错时退回“调用了 3 次”。
32. Given 单行版式、带“插入引用”前置按钮（触发字符 `@`）的输入框，When 显示，Then 前置按钮在正文前、控件在同一行；正文以中文结尾时点按钮，Then 正文变成“原文 @”且引用菜单打开，没有发出插件 action；允许登记附件时退回两层。上下文用量 21%、75%、95%、120% 依次是普通、警告、危险、危险（写 120%），没有用量或不知道上限时不画。
33. Given 模型下拉里有两家的同名模型、其中一家用不了，`canManageModels` 为真，When 打开，Then 两项右侧各写服务商，用不了的那项灰掉并写原因，末尾“管理模型…”发出 `model.manage`。
34. Given 模型目录（能用、没值、要登录、云凭据链的服务商各一），When 打开，Then 左栏分两段；搜 `gpt` 只剩命中，勾两个后“加入候选”按勾选先后交回引用并关闭；已选过的写“已添加”不能勾；点要登录的服务商右栏写明要设的变量。
35. Given 宿主注入了英文的翻译端口、视图的 `locale` 是 zh-CN，When 显示，Then 视图与其中的 nb-ui 控件都是英文；端口换成中文后不重新挂载就变成中文。没有注入时 `locale` 为 en-US 显示英文，不传显示中文；单独挂载的内部零件显示中文。

Smoke：分轮、摘要、发送规则与注册表有单元测试（`packages/nb-agent-ui` 的 `bun run test`，第 13、14、15、20、23、25、28 到 31、34 条的搜索）；第 21、22、24、26 到 29、32 到 35 条另有挂载测试（`*.dom.test.ts`）与 e2e；消息流随时间变化的行为与输入框由新应用的 `bun run test:e2e -- lab-agent-ui` 覆盖（第 4、7、9、10、11 条及“历史与滚动”），全部 Lab 场景的手机宽度巡检在 `lab-scenes.e2e.ts`。第 18 条没有单独的自动检查：颜色都取 nb-ui 的文字与背景 token，对比度由 token 保证。

## 实现合同

- **公开入口**：`@notnotype/nb-agent-ui`（核心，纯 TS：视图合同、注册表、`createAgentContext`、输入框动作、harness 适配器与转录器）、`./vue`（渲染层：对话视图、会话列表、模型目录对话框）、`./locales`（目录）、`./lab` 与 `./lab-sources`（Lab 用）、`./tailwind.css`。视图里的零件不是宿主接口。
- **owner 与依赖方向**：`packages/nb-agent-ui` 拥有；核心只依赖 `@notnotype/nb-ui/text`，渲染层只依赖 `vue`、`@notnotype/nb-ui` 与核心；Markdown、输入框与翻译由宿主注入，不引用宿主源码。宿主的接线在 `nbook.agent` 的 `web/session-host.ts`。
- **关键不变量**：
  - 分轮视图能从 `Message[]` 反推，过程默认收在整轮摘要里，运行中与结束后的展开规则不互相覆盖（`conversation-turns.test.ts`、`process-summary.test.ts`、`AgentConversationView.dom.test.ts`）。
  - 界面只经 ctx、服务与 action 与宿主交互，工具渲染器、条目渲染器与面板都经注册表，同名冲突时构造失败（`registry.test.ts`）。
  - 核心与渲染层的导入边界：核心不引 Vue，两层都不引宿主源码（`boundary.test.ts`）。
  - 转录器按内核事件还原消息，不丢锚点与路径，分支与回退目标据此选取（`kernel-transcript.test.ts`、`harness.contract.test.ts`）。
  - 翻译端口换了不重新挂载就跟着变，两套目录的键与占位符一致（`text.dom.test.ts`、`locales.test.ts`）。

## 证据

- 批准依据：[Agent 对话视图重做提案](../../../packages/neuro-book-legacy/docs/proposals/agent-conversation-view.md)（2026-09-28 accepted）；开发者 2026-10-21 定单独成包 `nb-agent-ui`、做完整版（[w00019](../../../.agents/works/w00019-agent-conversation-view/README.md)）。
- 实现入口：[`packages/nb-agent-ui/src/index.ts`](../../../packages/nb-agent-ui/src/index.ts)、[`vue/index.ts`](../../../packages/nb-agent-ui/src/vue/index.ts)、[`kernel-transcript.ts`](../../../packages/nb-agent-ui/src/kernel-transcript.ts)、宿主接线 [`web/session-host.ts`](../../../packages/neuro-book/src/plugins/agent/web/session-host.ts)
- 合同测试：[`packages/nb-agent-ui`](../../../packages/nb-agent-ui/src) 的单元与挂载测试（`bun run test`）、[`session-host.test.ts`](../../../packages/neuro-book/src/plugins/agent/session-host.test.ts)；e2e：[`lab-agent-ui.e2e.ts`](../../../packages/neuro-book/e2e/lab-agent-ui.e2e.ts)、[`agent-conversation.e2e.ts`](../../../packages/neuro-book/e2e/agent-conversation.e2e.ts)、[`lab-scenes.e2e.ts`](../../../packages/neuro-book/e2e/lab-scenes.e2e.ts)
- Smoke：[`conversation.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/conversation.llm.test.ts)（`test:llm`，真实模型）
