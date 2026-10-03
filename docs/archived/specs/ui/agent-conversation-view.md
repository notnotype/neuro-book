---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.agent-conversation-view
owners:
  - agent-ui
---

# Agent 对话视图

## 目标与非目标

目标：提供一个纯受控的 Agent 对话视图 `AgentConversationView`，覆盖会话顶栏、消息流、输入框上方待处理区、输入框、状态栏、面板与弹窗。消息流按注意力分层：运行中 Agent 说出的话与人机交互控件常显、思维链默认折叠；已结束的轮次整轮收起，翻看历史时只看到最终回复与改动文件；长对话仍然易读；另提供逐条消息的原始视图用于调试。视图的数据全部由宿主传入，用户意图全部以 action 交给宿主执行；工具渲染、消息操作、顶栏动作、面板、待处理区、状态栏条目和输入框命令都通过注册表扩展。视图在 Component Lab 中以确定性 fixture 完成验证。

非目标：

- 不包含会话数据层：不订阅 SSE、不调用接口、不持久化任何数据，也不定义后端接口。
- 不包含 Inline AI、左侧会话栏和 Trace Viewer。
- 不包含“当前任务清单”面板：它独立于本视图，另行规划；消息流里只显示每一次任务清单调用。
- 不接入主页面；主页面切换与旧组件删除属于后续工作。
- 不实现插件加载；注册表的插件入口等插件运行时（`runtime.plugins`）定型后再接。

功能基线见[提案附录 A](../../../packages/neuro-book/docs/proposals/agent-conversation-view.md#附录-a功能基线)，本规范覆盖其中全部 61 项；交互方式以本规范为准。

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
- **最终回复**：轮次中最后一条正文非空、且其后再无工具调用的 assistant 消息。
- **步骤**：思维链中的一项，可以是一次工具调用、一段思考、一段并入的中间 content 或一条系统提示词。
- **工具组**：思维链中连续出现、同属“探查”类别的工具调用。
- **摘要行**：代表一条思维链或整轮过程的一行：开头一个种类图标，接一句像人说的概括（是否思考、读了和改了几个文件、其余操作次数），失败次数以危险色附在末尾，最后是折叠箭头。它是过程入口，宽度随内容、淡色，注意力低于正文；运行中图标换成转圈、概括换成正在执行的那一步。
- **轮末汇总**：每轮末尾的一行，左边是改动文件条（没改文件不显示），右边是用量（用时、tokens、输入、输出、缓存读取、费用）。
- **结果与过程**：结果是一轮末尾连续的最终回复与错误；其余内容都是过程。
- **整轮收起**：已结束的轮次把过程收成一行整轮摘要，只露出结果与轮末汇总。
- **角色**：消息的说话者，现在是用户与 Agent；登记在注册表里，为第三种角色预留。
- **原始视图**：一条消息对应一个块、按时间顺序平铺的调试视图。
- **注册表**：各扩展点登记项的集合，内置功能与插件使用同一套登记方式。
- **渲染器**：注册表中负责把某类数据画出来的登记项。

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
};

type AgentConversationViewEmits = {
    (e: "action", action: AgentViewAction): void;
    (e: "update:viewMode", mode: "turns" | "raw"): void;
};
```

视图对外暴露两个方法：`focusComposer()` 聚焦输入框，`scrollToLatest()` 滚动到最新内容。没有插槽；扩展一律通过注册表。

### ctx 的组成

| 部分 | 内容 |
|---|---|
| `session` | 当前会话的标题、摘要、Profile 名称与图标、状态、后台摘要状态；未选择会话时为 `null` |
| `availability` | `ready`、`loading`、`empty`、`unselected`、`archived`、`profile-unavailable`、`load-error` 之一，附用户可读说明和可执行的恢复动作 |
| `interaction` | 当前允许的操作：发送、回答提问、修改历史、停止、登记附件、修改模型与模式、归档、恢复 |
| `run` | 运行状态 `idle`、`running`、`waiting`、`stopping`，当前运行阶段文案，正在运行的轮次 |
| `messages` | 已加载的全部消息，按时间顺序排列，包含运行中尚未落盘的内容（见下文“消息”） |
| `history` | 是否还有更早的消息、是否正在加载、加载错误 |
| `branches` | 按消息 id 索引的分支切换信息：当前第几个、共几个 |
| `editing` | 正在编辑的历史消息：消息 id、完整原文、原文是否仍在加载 |
| `pendingInputs` | 等待用户回答的提问与审批，含题目、选项、表单规格 |
| `workflows` | 按工具调用 id 索引的 Workflow 运行状态：阶段、当前动作、等待中的问题、结果 |
| `workspaceChanges` | 待审阅的文件变更分组、每组的 diff 状态、加载与错误 |
| `composer` | 可选模型与当前模型、思考档位、Agent 模式、排队中的消息、已登记的会话附件、模型是否支持图片、输入框中附件（图片与文件）的上传状态（就绪的带附件目标）、已发送内容（供输入历史使用）、粘贴分档设置、草稿（文字加版本号；版本号变化时视图用它替换输入框内容） |
| `usage` | 上下文用量与上限、累计 tokens、缓存读写、缓存命中率、累计费用、费用显示币种 |
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
       toolCalls: ToolCallView[]; error?: string; contentOmitted: boolean}
    | {kind: "system"; id: string; timestamp: number;
       source: "prompt" | "reminder" | "compaction" | "branch_summary" | "custom";
       label: string; text: string}
    | {kind: "error"; id: string; timestamp: number; message: string; retryable: boolean};

type ToolCallView = {
    id: string; name: string;
    status: "streaming" | "running" | "success" | "error" | "invalid";
    args: JsonValue; result?: ToolResultView; error?: string;
};
```

字段名可以在实现时调整，语义以本节为准；调整后在晋升 `implemented` 时回写本规范。

### 服务

- `sanitizeHtml(html)`：Markdown 渲染出的 HTML 必须经过它才能插入页面。
- `resolveAttachmentUrl(locator, variant)`：返回附件的缩略图或原图地址；返回空表示不可用。
- `resolveTriggerMenu(context)`：按输入框中的触发字符、已输入文字以及触发字符是否位于开头返回候选菜单。候选可以分组、可以禁用；逐级进入的候选确认后按新的查询继续。

### 注册表

每个登记项有 `id`（同一扩展点内唯一）、排序值，以及可选的显示条件（以 ctx 为输入）。各扩展点另有专属字段：

| 扩展点 | 专属字段 |
|---|---|
| 角色 | 图标与名称；色调（强调色或中性色） |
| 工具渲染器 | 匹配的工具名；类别（`explore`、`mutate`、`interact`、`other`）；图标与名称；单行摘要；探查组的合并摘要；对文件的影响；展开后的详细内容组件；呈现层级（思维链中的一行 `line`、思维链中的卡片 `card`、常显的交互控件 `node`）；`node` 的专用组件 |
| 条目渲染器 | 匹配的消息类型与系统条目来源；内容组件 |
| 消息操作 | 适用的消息类型，可再按单条消息判断（例如尚未确认送达的用户消息不能编辑、重试或分支）；图标与名称；点击后发出的 action |
| 顶栏动作 | 图标与名称；角标数；点击后发出 action 或打开某个面板；是否允许常驻顶栏 |
| 面板 | 面板组件；打开方式（顶部浮层或弹窗） |
| 待处理区条目 | 条目组件 |
| 状态栏条目 | 条目组件 |
| 输入框命令 | 命令名、说明、参数提示 |
| 输入框触发字符 | 触发字符；菜单通过服务解析 |
| 输入框工具栏按钮 | 图标与名称；点击后发出的 action |

Markdown 扩展与空状态起手提示在本规范中只预留，不要求实现。

内置工具的类别：

| 类别 | 工具 |
|---|---|
| `explore` | `read`、`web_fetch`、`web_search`、`subject_rag_search`、`get_session`、`get_agent`、`get_agent_profile` 以及名称以 `list_` 开头的查询类工具 |
| `mutate` | `write`、`edit`、`apply_patch`、`subject_memory_update`、`subject_event_append` |
| `interact` | `request_user_input`、`switch_mode` |
| `other` | `task_create`、`task_set_status`、`run_workflow`、`bash`、`execute_sql`、Agent 协作类工具、`report_result`，以及所有未登记的工具 |

内置工具中以 `node` 呈现（常显的人机交互控件）的是 `request_user_input`、`switch_mode`、`task_create`、`task_set_status`、`run_workflow`；其余 `interact` 与 `other` 工具以 `card` 呈现在思维链里，`explore` 与 `mutate` 以 `line` 呈现。

### 前置条件

- ctx 与服务都由宿主提供，视图不自行取数。
- 注册表在传入前已构造完成；构造时同一扩展点出现重复 `id` 即报错（见“失败与恢复”）。
- 视图可用宽度不小于 360px；验收宽度为 390px 与 1200px。

## 输出与可观察行为

### 布局

自上而下依次为：顶栏、消息流、待处理区、输入框、状态栏。顶栏、待处理区、输入框和状态栏固定，消息流占据剩余高度并独立滚动。面板以顶栏下方的浮层打开，会话列表、分支树和上下文检查器以弹窗打开。内容变多时，待处理区先折叠为一行，消息流高度最后让位。

### 顶栏

- 显示会话标题、Profile 名称和后台摘要状态；悬停标题显示会话摘要。
- 常驻顶栏的动作不超过两个，其余动作收进溢出菜单。溢出菜单固定包含“原始视图”切换项。
- 390 宽时标题区域不小于 160px。

### 分轮视图

- 版式沿用旧 `AgentSidebarView` 的对话气泡：每个说话者一行角色行（头像、角色名、模型、时间、状态，右端操作条），下面是缩进 24px 的内容。气泡版式不区分角色，头像与名称取自角色注册表；Agent 的头像优先用会话 Profile 的图标。
- 一轮依次显示：用户消息；Agent 一侧的过程（按时间顺序的常显条目与思维链）与结果；轮末汇总。最终回复之后的分隔线显示在轮末汇总下方。
- **整轮收起**：轮次结束（完成、出错、被停止）且有过程时，过程收成一行整轮摘要，例如“过程 · 14 次操作 · 读了 7 个文件，改了 2 个 · 1 次失败”，下面只露出结果与轮末汇总。点击摘要展开，过程挂在从摘要图标垂下的竖线上、缩进一级。运行中与等待回答的轮次不收起。
- **常显层**：
  - 最终回复用完整气泡（Markdown）。运行中的中间 content 用轻一级的气泡常显；运行结束后并入所在位置的思维链，常显层只留最终回复。
  - 人机交互控件以卡片常显，并把思维链切开。任务清单每次调用都显示：新建时完整列出；更新时列出变化的项和进度，可展开看这一刻的完整清单。Workflow 卡片运行中显示当前动作。
  - 系统提醒与自定义系统消息显示为淡色一行（标签加正文第一行），点击在下方展开全文（Markdown，淡色小字）；`compaction` 与 `branch_summary` 以分隔线显示，带摘要正文时点击标签在线下展开摘要。
  - steer 以带“补充说明”标记的浅色条显示在发生的位置。
  - 错误以危险色气泡显示；被停止时末尾显示“已停止”。
- **思维链**：两个常显条目之间的内容合成一条，默认折叠为摘要行，例如“思考 · 读了 7 个文件，改了 2 个 · 另有 3 次操作 · 1 次失败”；没有 content 的连续 assistant 消息合在同一条里。运行中的思维链摘要行显示转圈，并换成正在执行的那一步。点击展开后逐项显示：
  - 连续的 `explore` 工具合成一个工具组，组头显示合并摘要（如“读了 5 个文件，搜索了 2 次”），点击展开逐项；思考与消息边界夹在其间时并入组内；
  - 每个 `mutate` 工具单独一行，显示目标和增删统计；
  - `card` 呈现的工具（命令、SQL、协作等）以可展开卡片显示；
  - 并入的中间 content 按 Markdown 渲染在浅底小气泡里，用正文色；
  - 思考显示为一行摘要，点击展开全文（Markdown）；
  - 系统提示词显示为一行，点开看全文；
  - 两条 assistant 消息之间有一道细分隔，让人能数出消息边界。
  - 每一次工具调用（单行、组内一项、出错单独露出的一项、卡片）都能点开看详情：渲染器登记了详情组件时用它（内置：`read` 为带行号的文件内容，`edit`、`write`、`apply_patch` 为 diff，`bash`、`execute_sql` 为命令与输出）；没有登记的工具显示原始参数 JSON、结果正文与结构化结果 JSON，开发者据此对照底层调用。出错时错误信息在最上方；有详情组件但出错且没有结果时附上原始参数。代码块超过最大高度时内部滚动，长行在块内横向滚动。
- 工具组在运行中保持折叠，组头实时显示正在执行的那一项；组内有工具出错时，出错项单独露出。
- 卡片最多嵌套一层。
- **轮末汇总**：只占一行，放不下时换行。改动文件条注意力低于回复气泡：它按路径合并本轮改动过的文件，每个文件一枚按内容宽度的小标签（只有细分隔线描边，文字用次级色），写文件名与增删行数，同名文件带上级目录，完整路径在悬停提示里；点击发出 `file.openDiff`，超过 5 个时其余收成“+N”；没改文件时不显示。同一行靠右是用量，显示用时、tokens、输入、输出、缓存读取与费用，悬停显示明细。
- 消息操作图标常显在角色行右端，颜色弱；有多个分支时分支切换在操作条最前。Agent 一侧的操作作用于最终回复。时间显示在角色行。
- 面板拉宽时每轮限宽 800px 居中，避免正文行过长。

### 展开与折叠

| 轮次状态 | 整轮默认 |
|---|---|
| 运行中、等待回答 | 不收起，过程全部显示 |
| 正常结束 | 自动收起 |
| 出错或被停止 | 最新一轮展开，较早的收起 |
| 从历史加载 | 收起 |

- 用户手动展开或收起过某轮后，该轮不再跟随自动规则。
- 思维链默认折叠，运行中也不自动展开。
- 以上都是纯界面状态，切换会话时清空。
- 运行结束时整轮自动收起，Agent 一侧会变短。若用户不在底部，视口顶部正在读的内容保持在原位；正在读的内容就在被收起的过程里时，改以该轮最终回复为锚点保持其在视口中的位置。若键盘焦点位于将被收起的过程内，焦点移到整轮摘要行。

### 原始视图

`viewMode` 为 `raw` 时，消息按时间顺序逐条显示：每条消息一个块，工具调用依附于所属 assistant 消息，系统条目全部可见，不做轮次折叠和工具合并。切换视图模式不改变消息数据与滚动到最新的状态。

### 历史与滚动

- 停在底部时跟随新内容；用户向上滚动离开底部后不再跟随，消息流底部出现“回到最新”按钮，点击后回到底部并恢复跟随。
- 视口上方或正在阅读的内容高度变化时（整轮收起、插入更早一页），视口中的内容位置不动。用户点开或收起某一项引起的变化以这一项为锚点，即使原本停在底部也不把它推走。
- 滚动到接近顶部，或内容不足一屏时，发出 `history.loadPrevious`。还有更早内容时消息流顶部有一行“更早的内容”，也可以点击加载；加载中显示加载指示，失败时显示错误与重试。最早一个轮次的用户消息尚未加载时，这一行就是它的开头标记，更早一页加载后与之合并。
- 切换会话后直接定位到最新内容，恢复跟随。

### 消息

- 用户消息区分普通与 steer；显示图文内容块和附件；正文被省略时显示“仅显示预览”。图片、文件附件与粘贴块按输入框的方式显示：附件条加正文里的 `#N` 标签，粘贴块默认折叠。
- 投递状态为 `unknown` 的用户消息显示文字说明：“可能已发送，重新发送可能产生重复”，并提供“重新发送”和“移除”。
- 编辑历史消息时，消息就地变为编辑器，支持 `@` 引用与插图；原文仍在加载时编辑器为只读并显示加载状态。
- assistant 消息流式生成时显示光标；被停止时显示“已停止”，不显示内部错误原文。

### 输入框与待处理区

- 回车发送；运行中回车为 steer，Ctrl/⌘+回车为 followup；运行中且输入为空时，发送按钮变为停止。Shift+Tab 切换 Agent 模式。
- 输入以 `/` 开头且命令名与已登记的输入框命令一致时，发出 `command.run`；否则按普通文字发送。
- 触发字符（`@`、`$`、`/` 及登记的其他字符）打开候选菜单，菜单内容来自 `services.resolveTriggerMenu`；方向键选择，回车或 Tab 确认，Escape 关闭。
- 输入框的内容始终是一段文字：引用、技能、选区、命令、图片、文件附件与粘贴块按统一的文字写法保存（见组件文档 `PromptEditor.md` 的“文字写法”），在输入框里显示为整体的标签或块，光标跨过和退格删除都按一整个算。输入框与历史消息的就地编辑共用这个编辑器。
- 图片与文件（PDF、txt 等）可以选择、粘贴或拖入：输入框上方的附件条显示缩略图或卡片，正文在插入处留 `#N` 标签；图片一套编号，文件与粘贴块另一套。每个附件显示上传中、已就绪、失败三种状态，失败可重试或移除；模型不支持图片时拒绝添加图片并说明原因。发给模型时图片保留在文字中的位置；文件以附件路径给模型，由模型按需读取。
- 粘贴文字按大小分三档：小段原样插入；中等的在粘贴处成为默认折叠的粘贴块，以 `<paste>` 标签包起来发给模型，也可配置为放到开头、粘贴处只留位置标记；特别大的转为文件附件。阈值与放置方式可配置。Ctrl/⌘+Shift+V 粘贴原文，不分档。
- 空输入框里按上方向键调出上一条已发送的内容；Ctrl+R 搜索已发送的内容。
- 点击输入框里的标签：引用发出 `reference.open`，图片打开原图预览（纯界面行为），文件发出 `attachment.open`，技能发出 `skill.open`。
- 有待回答的提问时，提问向导替换输入框：支持单选、“其他答案”、表单、备注、多题切换、终止本轮和重新同步。未提交的答案是纯界面状态，只在当前批次内保留。
- `availability` 不是 `ready` 时，输入框上方显示对应的横幅和恢复动作，输入框只读。
- 待处理区依次显示已登记条目；内置条目为 Workflow 待回答、工作区变更、排队消息。

### 状态栏

显示上下文用量（点击打开上下文检查器）、累计 tokens 与费用、连接状态（需要操作时提供重连）、运行阶段和非普通模式的模式标记。

### 面板与弹窗

- 附件面板：网格浏览、搜索、翻页、原图预览、插入到输入框（纯界面行为）。
- 关联 Agent：上下游列表、状态，点击切换到对应会话。
- 系统提示：打开时请求加载，Markdown 渲染，刷新。
- 会话列表：三种筛选、搜索、翻页、新建（多 Profile 时选择 Profile）、归档、恢复、就地重命名。
- 分支树：搜索、折叠、键盘导航、节点详情、复制 ID、切换到选中分支。
- 上下文检查器：组成、缓存时间线、诊断、请求选择、刷新。

### action

| 分组 | action |
|---|---|
| 会话 | `session.create {profileKey?}`、`session.select {sessionId}`、`session.rename {sessionId, title}`、`session.archive {sessionId}`、`session.restore {sessionId}`、`sessions.query {query}`、`view.close` |
| 消息 | `message.copy {messageId}`、`message.editStart {messageId}`、`message.editCancel`、`message.editSubmit {messageId, text}`、`message.retry {messageId}`、`message.branchFrom {messageId}`、`message.resend {messageId}`、`message.dismiss {messageId}`、`branch.switch {messageId, direction}`、`tool.copy {toolCallId}`、`history.loadPrevious`、`history.refresh` |
| 引用与文件 | `reference.open {target}`、`file.openDiff {path, toolCallId}`、`attachment.open {target}`、`skill.open {name}` |
| 输入框 | `composer.submit {text, images, delivery}`（`delivery` 为 `prompt`、`steer` 或 `followup`）、`composer.stop`、`composer.draftChanged {text}`、`composer.attachmentAdded {localId, kind, file}`（`kind` 为 `image` 或 `file`）、`composer.attachmentRetry {localId}`、`composer.attachmentRemoved {localId}`、`command.run {name, argsText}`、`menu.opened {trigger}` |
| 运行设置 | `mode.set {mode}`、`model.set {modelKey}`、`thinking.set {level}`、`runtime.reset` |
| 提问 | `input.submit {batchKey, resolutions}`、`input.cancelRun`、`input.resync` |
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

- 注册表构造时同一扩展点出现重复 `id`：构造失败并报出冲突的扩展点和 `id`，不静默覆盖。
- 某个渲染器渲染时抛错：只有该项降级为通用卡片并显示“此内容无法显示”，视图其余部分继续工作；错误通过开发诊断输出。
- 工具没有匹配的渲染器：使用通用渲染器，类别为 `other`。
- ctx 中引用了不存在的数据（例如 `branches` 指向不存在的消息）：忽略该引用，不报错。
- `services.sanitizeHtml` 缺失：Markdown 以纯文本显示，不插入任何 HTML。
- `services.resolveAttachmentUrl` 返回空：附件显示“不可用”占位，不发起请求。
- `availability` 为 `load-error` 或 `profile-unavailable`：显示说明和恢复动作，消息流仍可阅读，输入框只读。
- 提交后宿主一直没有提供新版本草稿：输入框保持原文，由宿主通过 `availability` 或消息的 `delivery` 状态告知结果。

## 边界与兼容

- 视图属于 `agent-ui` 功能插件的视图部分；数据层、接口调用与持久化属于宿主，当前宿主只有 Lab fixture。数据层的后续方案见[数据层后续提案](../../../packages/neuro-book/docs/proposals/agent-session-data-layer.md)。
- 视图与旧目录 `app/components/novel-ide/agent/` 互不依赖；旧组件的行为不受本规范约束。
- 顶层视图的能力标签只有 `state:local` 与 `env:portal`；各渲染器与子组件的标签为空或只有 `state:local`，符合[组件规范](../../standards/code/components.md)。
- 视觉取值遵循 [nb-ui 设计语言](../../../packages/nb-ui/docs/design-language.md)与 [UI 开发规范](../../../packages/nb-ui/docs/ui-development-spec.md)，明暗两种主题都要满足对比度要求。
- 注册表中对插件稳定的部分，在 `runtime.plugins` 定型后另行确认；在此之前，注册表形状可以随内置需要调整。
- 界面文字走 i18n。
- 折叠的思维链不渲染其内部步骤，保证长会话的渲染开销与展开的内容量成正比。

## 验收与 Smoke

1. Given 一个已结束轮次，含 12 次普通工具调用（8 次读取、2 次改文件）、3 次任务清单调用、2 条系统提醒与若干中间 content，When 以分轮视图显示，Then 可见的只有用户消息、一行整轮摘要（写明 15 次操作、读了 8 个文件，改了 2 个）、最终回复，以及同一行里列出两个文件的改动文件条和用量；任务清单、系统提醒、思维链与中间 content 都收在整轮摘要里。
2. Given 同一轮次，When 点击整轮摘要行，Then 过程按时间顺序展开：3 张任务清单卡片、2 条淡色提醒、被它们切开的几条思维链摘要行；When 再点击一条思维链的摘要行，Then 它逐项展开，连续读取合为工具组，改文件各占一行，并入的中间 content 以 Markdown 显示，消息之间有边界。
3. Given 一个运行中的轮次，When 显示，Then 中间 content 常显，思维链保持折叠，最后一条思维链的摘要行显示转圈和当前执行的那一步；When 运行正常结束，Then 中间 content 并入思维链，整轮收起；When 用户随后展开它，Then 之后的自动规则不再改变它。
4. Given 用户向上滚动阅读，When 下方运行中的轮次结束并整轮收起，Then 视口中可见内容的位置不跳动。
5. Given 运行进入等待，When 显示，Then 提问控件常显，提问向导替换输入框；提交答案发出 `input.submit`。
6. Given 最新一轮运行出错或被停止，When 显示，Then 该轮展开，末尾显示错误或“已停止”，不显示内部英文错误原文；较早的出错轮次收起时错误仍露出。
7. Given 从历史加载的多个轮次，When 显示，Then 全部整轮收起；向上滚动加载更早一页后，可见内容位置不变。
8. Given 运行中的探查工具组，When 组内工具依次执行，Then 组保持折叠，组头显示当前执行项；某项出错时该项单独露出，所在思维链的摘要行计入失败次数。
9. Given 溢出菜单，When 选择“原始视图”，Then 消息逐条显示、系统条目全部可见，发出 `update:viewMode`；再次选择回到分轮视图。
10. Given 投递状态未知的用户消息，When 显示，Then 有文字说明及“重新发送”“移除”，分别发出 `message.resend` 与 `message.dismiss`。
11. Given 运行中的输入框，When 输入文字后回车、Ctrl/⌘+回车、清空后点击按钮，Then 依次发出 `delivery` 为 `steer` 的 `composer.submit`、`delivery` 为 `followup` 的 `composer.submit`、`composer.stop`。
12. Given 已登记的 `compact` 命令，When 输入 `/compact 保留人物设定` 并发送，Then 发出 `command.run {name: "compact", argsText: "保留人物设定"}`；输入未登记的 `/foo` 时按普通文字发送。
13. Given 插件登记的新工具渲染器（类别 `explore`），When 该工具连续调用两次，Then 它们并入同一工具组，旧有分派代码无需修改。
14. Given 两个 `id` 相同的顶栏动作，When 构造注册表，Then 构造失败并指出冲突项。
15. Given 一个渲染时抛错的渲染器，When 显示对应工具，Then 该项降级为通用卡片，其余消息正常显示。
16. Given `availability` 为 `archived`，When 显示，Then 输入框只读，横幅提供恢复动作，点击发出 `availability.act`。
17. Given 390 × 844 视口，When 依次查看各 Lab 场景，Then 无横向滚动，顶栏标题区域不小于 160px，核心操作都能完成。
18. Given 明暗两种主题，When 查看各 Lab 场景，Then 文字与背景对比度满足 nb-ui 规范。
19. Given Lab 时间线回放一次完整的 ReAct 运行，When 从头播放与直接跳到同一步，Then 两者界面一致。

Smoke：分轮规则有单元测试（`conversation-turns.test.ts`）；消息流随时间变化的行为由 `bun run smoke:component-lab:agent-conversation -- --url <开发服务> --browser-executable <chromium>` 覆盖（第 4、7、9、10 条及“历史与滚动”）。其余条目随后续切片补充。

## 实现合同

尚未实现。

## 证据

- 批准依据：[Agent 对话视图重做提案](../../../packages/neuro-book/docs/proposals/agent-conversation-view.md)（2026-09-28 accepted）。
- 执行记录：Work [w00019](../../../.agents/works/w00019-agent-conversation-view/README.md)。
