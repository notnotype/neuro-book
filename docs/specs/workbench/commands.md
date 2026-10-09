---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.commands
owners:
  - ui
---

# Workbench 命令系统

## 目标与非目标

**目标**：NeuroBook 的**具名可发现动作**——命令面板、快捷键、按钮、未来的菜单与外部调用——拥有单一身份与单一执行入口。每条命令携带：全局唯一 id、人类标题（中英文本）与语义描述、参数形状（`args`）、可用性条件（`when`）、默认快捷键、作用类型（`effect`）与对外暴露策略。执行产生结构化结果与审计事件；触发面只引用命令身份。

命令系统是内置插件 `nbook.commands` 提供的能力，与运行位置无关（2026-10-06 开发者确认，见 [ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 决策 2）：服务端、每个浏览器窗口（以后的终端界面）各有一份命令表，登记本位置入口贡献的命令；用户与 Agent 可以不经界面执行命令。界面只是命令的触发面：浏览器里的命令面板与键位分发归 `nbook.workbench`，界面没有加载时（例如终端界面打开、或页面不挂命令宿主）命令照样能执行。

**本批（命令底座与 Lab 闭环）**交付六条命令——`nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line`、`nbook.quick-open.open-commands`、`nbook.quick-open.open-line`——以及机制底座与 Component Lab 可见闭环。

**第二批（外壳与 View 标题操作，2026-09-19）**交付 `view` 域的七条命令：面板位置/对齐/隐藏/收起/最大化切换、工具视图移动，以及一个真实 View 贡献的刷新入口。它们复用同一命令表与同一执行入口，不新开命令总线；面板标题的框架控件与 View 贡献操作分别调用这两组命令。新应用里五条面板命令随外壳一、移动视图随外壳二、刷新文件随 Files 迁入（[`ui.workbench-shell`](../ui/workbench-shell.md) 定义外壳的行为与公开状态）。

**非目标**：

- 不把高频交互流命令化：击键、滚动、拖拽中间态、光标移动不经命令执行管线。
- 不提供用户自定义快捷键界面：本能力只固定默认键位的派生与分发。
- 本批不移入活动栏/标题栏/桌面菜单/右键菜单等入口：别名机制就位，15 条桌面 id 的接线留待后续批次。
- 不实现自动视图派生命令（`nbook.view.toggle.*` / `nbook.view.focus.*`）。
- 不实现外部 agent 的接入通道（CLI / MCP / Skill 绑定）：本能力只固定暴露策略、结构化结果与审计语义。
- 其它方向的跨运行位置执行（终端界面执行服务端命令、一个窗口执行另一个窗口的命令）：另行设计。服务端列出与执行窗口里的命令见“跨实例列出与执行”。
- 内核不提供 `ctx.commands`：命令只经 `nbook.commands` 的贡献点与命令服务（[`runtime.plugin-api`](../runtime/plugin-api.md)）。
- 不提供第三方不可信代码的沙箱、动态安装或签名机制。

## 术语与参与者

- **命令（Command）**：具名可发现动作的单一身份。id 全局唯一且稳定；元数据描述"是什么、何时可用、给谁看"；执行是请求/响应，不是事件广播。
- **命令表（Registry）**：一个运行实例里的全部命令。`nbook.commands` 的每个入口持有本运行位置的一份；Component Lab 的命令场景另建自己的本地命令表，与场景同寿。
- **命令服务**：命令表对外的查询与执行接口（`get`、`list`、`isEnabled`、`execute`、`onDidChange`、`onDidExecute`）；不提供命令式登记。
- **别名（Alias）**：既有外部 id（如桌面菜单契约的 15 个 id）到标准命令的映射。别名只做解析，不产生第二份实现；别名与命令 id 共用一张名字表，同名时不论先登记哪个，后来者都被拒绝。本批只保留机制，不接线。
- **触发面（Trigger）**：命令面板、快捷键、按钮，以及未来的菜单与外部调用。触发面只引用命令 id。
- **界面宿主**：在某个页面上持有键位分发与命令面板的一方：产品 `/` 页上是工作台的命令宿主，Lab 里是命令场景的局部宿主。宿主随页面或场景挂载与释放。
- **上下文键（Context Key）**：具名的布尔状态，`when` 只能引用登记过的键；视图的 `when` 共用同一套求值口径。产品命令表的键是公开状态里的布尔键，写限定名 `<插件 id>/<名>`（[`state.public`](../state/public-state.md)）；Lab 命令场景的本地命令表另有自己的键表（见“上下文键（第一批）”）。
- **可用性（Availability）**：命令的 `when` 在其触发时刻求值的当前结果。不满足时面板不出现、快捷键不响应、执行返回结构化拒绝（不是静默忽略）。
- **作用类型（`effect`）**：`read` / `write`，必填。是只读模式（discuss / plan）阻断 agent 调用的唯一依据。
- **暴露级别（Exposure）**：命令对外部 agent 的可见性与约束——`never`（默认）、`confirm`（执行前需用户在界面确认）、`auto`（可直接执行）。
- **语义标注（Hints）**：`readOnly`、`destructive`、`idempotent`，仅作描述与确认提示生成，不承担阻断职责；与 `effect` 冲突的标注在登记时被拒。
- **审计事件（Audit Event）**：一次执行的可观察记录：来源（用户 / 外部 agent）、命令 id、参数、结果、耗时。每次调用恰好一条，含未知 id、拒绝与异常。
- **参与者**：用户（触发、确认）；命令的贡献方（向贡献点提交命令声明与处理函数的插件）；`nbook.commands`（持有命令表、求值上下文键、执行与审计）；界面宿主（键位分发、面板、确认呈现）；外部 agent（经绑定调用，受暴露策略约束）。

## 输入与前置条件

- **登记**：插件向 `nbook.commands` 的贡献点 `commands.definitions` 提交命令，贡献 id 写命令 id。声明（标题、分类、描述、参数 schema、`when`、`effect`、暴露策略、默认键位）写在贡献里，处理函数随贡献方入口激活交出；贡献方入口停止或插件被禁用时，内核撤回贡献，命令离开命令表。声明可以来自代码，也可以来自以后的清单 JSON，登记时按同一份 schema 整体校验。Lab 的命令场景直接向本地命令表登记。
- **执行**：要执行命令的入口在依赖里声明命令服务（`nbook.commands/service`），按 id 执行；依赖的是命令系统，不是提供命令的插件。
- **输入形状**：命令 id（或已登记的别名）+ 一个对象参数。参数形状由命令自己的 `args` 约束；不声明参数的命令只接受空对象。调用省略参数时归一为 `{}`，显式 `null` 不归一（校验失败）。
- **前置状态**：所在运行位置的 `nbook.commands` 入口已激活（它在各运行位置都是启动必需插件）；命令执行所需上下文键可求值。
- **权限**：本能力自身不引入权限模型。破坏性保护由暴露策略（`confirm` / `destructive` 标注）与只读模式（discuss / plan）承担；领域权限仍归各域 owner。

## 输出与可观察行为

- **命令身份**：内置插件（`nbook.*`）的命令 id 使用三段式命名空间 `nbook.<domain>.<action>`，全小写 kebab-case 分段（与 View descriptor 的 id 规则一致），域词表见「边界与兼容」；其它插件的命令 id 以自己的插件 id 开头、再接一段动作（`<插件 id>.<action>`），不能占用 `nbook` 命名空间。
- **标题**：`title` 与可选的 `category` 是中英两份文本 `{zh-CN, en-US}`，界面按当前显示语言（配置项 `nbook.settings/locale`，[`settings.configuration`](../settings/configuration.md)）取其中一份，语言切换后已打开的面板即时换文字；`description` 是稳定的英文语义说明，不随界面语言变化。
- **登记与冲突**：
  - 经贡献点：内核要求贡献 id 在贡献点内唯一，两个插件贡献同一命令 id 时两条一起被拒绝，原因可查，与加载顺序无关；不合格的声明（id 不合规则、标注与 `effect` 冲突、结构不符）只拒绝这一条，插件的其它贡献照常。
  - 直接向本地命令表登记（Lab 场景）：同一定义对象重复登记幂等，返回同一个释放函数；不同对象登记同一 id 时拒绝后来者、保留首个，同一原因只报告一次。
- **释放**：贡献撤回时命令离开命令表，之后执行得到 `unknown-command`。本地命令表的释放函数只删除自己登记时的条目；命令被释放后重新登记同 id 时，旧释放函数不得影响新条目。别名在目标释放时级联清除。
- **枚举**：任何消费者可获取本运行位置全部 canonical 命令及其元数据（id、贡献方、标题、描述、参数形状、`when`、默认键位、暴露策略、`effect`）；别名不出现在 canonical 枚举中，审计的 `id` 用 canonical，`requestedId` 保留输入。两个运行位置的命令表互不相见。
- **执行顺序**（固定，不可交换）：解析白名单 → agent 暴露检查 → 严格参数校验 → 当前 `when` → agent 只读检查 → 必要确认 → 复查条目身份/参数不变性/`when`/模式 → `run` → 单次审计。
- **结果合同**：成功为 `{ok:true, value}`（void 命令显式 `null`，不把 Promise rejection 当成功）；失败为 `{ok:false, code, reason}`，失败码固定九个：`unknown-command`、`unavailable`、`invalid-args`、`not-exposed`、`read-only`、`confirmation-required`、`denied`、`execution-error`、`stale-target`。
- **可用性求值**：`when` 是上下文键的 all-of 正条件；登记的键缺失按 false 求值。`when` 引用的键是否存在在求值时判断，不在登记时判断：未登记（或不是布尔）的键使命令不可用，原因写明是哪个键，命令表对同一命令的同一个键只记一次诊断；之后这个键被登记，命令按它的值求值。求值失败/不满足返回 `unavailable` 与缺失原因；原因按求值时的显示语言给出，已记下的诊断保留当时的文字。
- **`when` 读公开状态**：产品命令表里，`when` 引用的键是本运行位置入口声明的、已被接受的布尔公开键；求值时键未就绪按 false，原因取声明的 `reason`；键未声明、只在别的运行位置声明或不是布尔，按上一条为不可用。`when` 只在命令所在的实例求值，不跨实例读状态；拥有键的入口激活、停止与值的变化即时反映在可用性上，命令面板开着时候选随之变化。
- **跨实例列出与执行**：浏览器的 `nbook.commands` 入口提供远程服务 `nbook.commands/remote`，第一版只允许服务端调用，服务端插件以 `.at({client: 窗口实例 id})` 选定窗口：
  - `list({})`（读）：该窗口命令表里 `expose.agent` 不为 `never` 的命令元数据，每条带此刻按该窗口公开状态求出的可用性与不满足的原因；
  - `execute({id, args})`（写）：以 `{source: "agent", callerId: 调用方插件}` 走该窗口命令表的执行管线，执行前按该窗口此刻的状态复查 `when`，返回结果合同里的结果；`expose.agent` 为 `never` 的命令为 `not-exposed`。
- **参数校验**：严格（JSON Schema 语义），不转换、不填充默认值、拒绝额外字段与显式 `null`；校验失败返回 `invalid-args` 并指出失败位置。
- **暴露**：外部 agent 面只可见暴露级别高于 `never` 的命令；`confirm` 命令被 agent 调用时，界面呈现确认（含命令标题、参数、发起者），用户批准后执行、拒绝则返回 `denied`。没有确认通道的命令表返回 `confirmation-required`（产品命令表在 Agent 接入前没有确认通道）。确认使用参数的独立快照，等待期间调用方修改原参数不影响获批内容；等待期间命令被替换返回 `stale-target`。
- **只读联动**：处于 discuss / plan 时，`effect: "write"` 或带 `destructive` 标注的命令对外部调用直接拒绝（`read-only`），确认等待期间切到这两种模式的，批准后同样拒绝；界面触发不受该模式影响。
- **审计**：每次执行产生恰好一条审计事件，来源字段区分 `user` 与 `agent:callerId`；监听器抛出的异常被隔离上报，不改变执行结果、不影响其它监听器。命令系统不弹通知、不维护可见日志队列——可见错误由触发宿主呈现一次。
- **键位分发**：默认键位写在命令声明里，由各运行位置的界面宿主解析与分发：命中且命令当前可用时 `preventDefault` 并阻断同次事件继续传播，然后执行；不满足 `when` 时不拦截。键位监听随界面宿主挂载与释放：没有挂宿主的页面（例如 Lab 的非命令场景）按同一组合键不打开任何面板。同规范化键位冲突的裁决见「失败与恢复」。

## 状态与转换

| 状态 | 触发 | 下一状态 | 拒绝条件 |
|---|---|---|---|
| 未登记 | 贡献方入口激活交出命令 / 本地命令表登记 / 登记别名 | 已登记（可枚举、可执行） | 同 id 的两条贡献（一起拒绝）；本地登记冲突（拒绝后来者）；声明不合格 |
| 已登记 · 可用 | 执行触发 | 执行中 → 完成（成功 / 失败结果） | 参数校验失败、只读拒绝、确认被拒、等待期间条目被替换 |
| 已登记 · 不可用 | `when` 求值变化 | 可用 / 不可用 | 不可用时面板不出现、快捷键不响应、外部调用拒绝 |
| 已登记 · 键位占用 | 新命令声明同规范化键位 | 后来的绑定不启用 | 报告一次；原持有者释放后按登记顺序重建 |
| 已登记 | 贡献撤回（入口停止、插件禁用）/ 本地释放 | 未登记 | — |

本能力不引入持久状态；命令表与上下文键都在内存中，随运行实例重建。

## 副作用与数据

- 命令执行产生的业务副作用（打开视图、移动光标、编辑正文等）归各域 owner，本能力只负责调度与结果回传。
- 审计事件写入内存通道（订阅式分发），不写领域 Store、不持久化。
- 处理函数抛出的异常除返回 `execution-error` 外，按贡献方插件记入诊断（[`runtime.diagnostics`](../runtime/diagnostics.md)）；键位不合法、冲突与快捷键执行失败由界面宿主记入诊断。
- 本能力不直接读写任何存储介质。

## 失败与恢复

- **未知命令 / 别名**：拒绝并返回结构化原因（不得静默忽略）。
- **参数校验失败**：拒绝并指出失败参数。
- **`when` 不满足**：界面隐藏/禁用；外部调用返回拒绝原因。
- **执行错误**：由执行入口的错误边界捕获，返回结构化失败结果，不导致整页崩溃；可见提示由触发宿主呈现一次（Lab 命令场景在检视区唯一的 `role="alert"` 区域；产品页记入诊断）。
- **确认被拒 / 只读拒绝**：返回对应失败分类。
- **键位冲突**：同一规范化键位视为冲突——报告且**不启用后来的绑定**；原持有者释放后按仍登记的命令顺序重建，此时新首个可以接管。冲突不因 `when` 条件"看起来互斥"而放行（all-of 正条件无法证明互斥），首个命令不可用时也不回落到冲突命令。非法键位字符串同样不启用该绑定并报告，命令本身仍可通过按钮/面板执行，命令表里的元数据不被修改。
- **登记被拒**：经贡献点时原因写在贡献状态里（插件详情可查），不影响同一插件的其它贡献；本地命令表登记被拒时报告原因、不静默降级。
- **跨实例调用失败**：窗口不在为 `target-gone`，目标实例没有命令表（没有 `nbook.commands` 的入口）为 `not-provided`，请求帧发出前断线为 `unavailable`，`execute` 的帧发出后断线、超时或取消为 `unknown-outcome`（不自动重试），服务端以外的实例调用为 `denied`；失败码与阶段规则见 [远程服务与 RPC 协议](../runtime/plugin-channel.md)。

## 边界与兼容

### 命令服务只限内置插件

命令服务的 `get`、`list`、`isEnabled` 是同步的，按 [`runtime.plugin-api`](../runtime/plugin-api.md) 的选用规则，命令服务属于内置插件之间的内部服务，只给内置插件依赖。第三方插件贡献命令不受影响；第三方查询与执行命令的写法随第三方插件 API 设计。

### 命名与域词表（第一批）

- 格式：内置插件写 `nbook.<domain>.<action>`；`action` 可为复合（如 `go-to-line`）。其它插件写 `<插件 id>.<action>`。
- 域词表：`view`、`editor`、`edit`、`quick-open`、`settings`、`account`、`project`、`app`、`help`、`files`。本批只用 `editor` / `edit` / `quick-open`；`files` 随资源管理器加入。

### 命令目录（第一批 · 本批全部交付）

| 命令 id | 标题 | 参数 | `when` | `effect` | agent 暴露 | 提供方 |
|---|---|---|---|---|---|---|
| `nbook.editor.focus` | 聚焦编辑器 / Focus Editor | `{}` | 活动编辑器 | read | auto | 编辑器（第 5 步编辑器插件迁入前由 Lab 命令场景在样板编辑器上登记） |
| `nbook.edit.undo` | 撤销 / Undo | `{}` | 活动编辑器且可写 | write | confirm | 同上 |
| `nbook.edit.redo` | 重做 / Redo | `{}` | 活动编辑器且可写 | write | never | 同上 |
| `nbook.editor.go-to-line` | 跳转到行 / Go to Line | `{target, line}`（`target` 为编辑器文档身份四字段，`line` 为 1 起正整数） | 活动编辑器且支持行导航 | read | auto | 同上 |
| `nbook.quick-open.open-commands` | 命令面板 / Command Palette | `{}` | 无 | read | never | `nbook.workbench`（产品命令表）；Lab 命令场景另登记一份 |
| `nbook.quick-open.open-line` | 跳转到行… / Go to Line… | `{}` | 活动编辑器且支持行导航 | read | never | 随编辑器插件接入；现阶段只在 Lab 命令场景登记 |

### 命令目录（项目）

| 命令 id | 标题 | 参数 | `when` | `effect` | agent 暴露 | 提供方 |
|---|---|---|---|---|---|---|
| `nbook.project.open` | 打开项目 / Open Project | `{}` | 无 | write | never（整页重新加载会打断 Agent 所在的窗口） | `nbook.projects` 浏览器入口；经命令面板的选择模式选项目或输入目录，行为见 [`runtime.projects`](../runtime/projects.md) 输出第 10 条 |

### 命令目录（设置）

三条命令给了参数就直接写入、不打开选择；没给参数时经命令面板的选择模式列出可选值，用户取消为成功、无副作用。

| 命令 id | 标题 | 参数 | `when` | `effect` | agent 暴露 | 提供方 |
|---|---|---|---|---|---|---|
| `nbook.settings.switch-locale` | 切换界面语言 / Change Display Language | `{locale?}`（`zh-CN`\|`en-US`） | 无 | write | auto | `nbook.settings` 浏览器入口；写用户层 |
| `nbook.settings.switch-theme` | 切换主题 / Change Theme | `{theme?}`（`nbook`\|`macos`） | 无 | write | auto | `nbook.workbench`；写入目标 `auto` |
| `nbook.settings.switch-appearance` | 切换明暗 / Change Appearance | `{appearance?}`（`light`\|`dark`\|`system`） | 无 | write | auto | `nbook.workbench`；写入目标 `auto` |

- 域取 `settings`：内置命令的域表示功能领域，不等于提供方插件 id。
- 配置写入失败转换为命令失败：`denied` → `denied`；`unavailable`、`no-project` → `unavailable`；`invalid-value` → `invalid-args`；其余 → `execution-error`，`reason` 写明配置的失败码与说明。

### 命令目录（第二批 · 外壳与 View 标题）

五条面板命令由 `nbook.workbench` 的浏览器入口贡献（随外壳一），`when` 读工作台的公开状态（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 13）；移动视图随外壳二，刷新文件随 Files。

| 命令 id | 标题 | 参数 | `when.requires` | `effect` | agent 暴露 |
|---|---|---|---|---|---|
| `nbook.view.set-panel-position` | 面板位置 / Panel Position | `{position?}`（`bottom`\|`top`\|`left`\|`right`）；省略时经选择列出四个位置、标出当前 | `nbook.workbench/layoutReady`、`nbook.workbench/nonCompact` | write | never |
| `nbook.view.set-panel-alignment` | 面板对齐 / Panel Alignment | `{alignment?}`（`center`\|`left`\|`right`\|`justify`）；省略时经选择 | `nbook.workbench/panelHorizontal`、`nbook.workbench/nonCompact` | write | never |
| `nbook.view.set-panel-hidden` | 隐藏/显示面板 / Hide or Show Panel | `{hidden?}`（布尔）；省略时切换 | `nbook.workbench/layoutReady` | write | never |
| `nbook.view.set-panel-collapsed` | 收起为标题头 / Collapse to Title Bar | `{collapsed?}`（布尔）；省略时切换 | `nbook.workbench/panelHorizontal` | write | never |
| `nbook.view.toggle-panel-maximized` | 最大化/还原面板 / Maximize or Restore Panel | `{}` | `nbook.workbench/panelMaximizable`、`nbook.workbench/nonCompact` | write | never |
| `nbook.view.move-view` | 移动视图 / Move View | `{viewId, sourceContainerId, targetContainerId}` 或 `{viewId, sourceContainerId, newContainerIn}`（`sidebar`\|`auxiliarybar`\|`panel`），或全部省略；省略时经选择先选视图、再选目标 | `nbook.workbench/layoutReady` | write | never |
| `nbook.view.refresh-files` | 刷新文件 / Refresh Files | `{viewId, generation}`（精确实例代际） | 该实例贡献了 refresh 动作 | read | never |

- 参数一律严格校验（`additionalProperties: false`）：多余字段、未知取值都是 `invalid-args`，不静默补齐；四条面板命令的参数可以省略（命令面板对普通候选执行 `{}`，与设置命令同一写法），选择被取消为成功且不写。
- 前六条写的是**同一份用户定制记录**（面板状态）或既有移动写入路径；尺寸（高度/宽度）不在这里写，只由手势落点提交，避免两个写者。
- `move-view` 的目标是除来源外的已有容器，或 `newContainerIn` 指定的 ToolPart 里新建的自建容器（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 24；自建容器的身份在这次执行接纳时生成一次）。`targetContainerId` 与 `newContainerIn` 互斥，同时给或只给一部分参数为 `invalid-args`；视图不存在、不可移动或目标容器不存在为 `invalid-args`；视图已不在 `sourceContainerId`（菜单或选择过期）为 `stale-target` 且零写入；目标就是当前容器为成功且不写。无参的两步选择之间视图被移走，同样按过期拒绝。
- `refresh-files` 是 View 贡献动作的样例：命令只携带 `{viewId, generation}`，命中句柄与代际校验归宿主；活动 View 或实例代际变化后的迟到点击按 `stale-target` 拒绝。视图标题动作这一触发面做出来之前，资源管理器视图内的工具栏按钮带本实例的视图 id 与代次调用它。
- 面板命令返回时布局已按新值显示；保存在后台进行，失败由状态栏的“布局未保存”给出（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 11），命令不等保存完成、也不把“已接纳”说成“已保存”。

### 命令目录（资源管理器）

由 `nbook.explorer` 的浏览器入口贡献，作用于本窗口资源管理器的选择；行为、公开键与树内按键见 [`workbench.files-explorer`](files-explorer.md#新应用的插件命令与界面)。参数一律 `{}`，Agent 暴露一律 `never`。`when` 都另要求 `nbook.explorer/ready`。

| 命令 id | 标题 | `when.requires`（除 `ready`） | `effect` | 树内按键 |
|---|---|---|---|---|
| `nbook.files.new-file` | 新建文件 / New File | `nbook.explorer/canCreate` | write | — |
| `nbook.files.new-folder` | 新建文件夹 / New Folder | `nbook.explorer/canCreate` | write | — |
| `nbook.files.collapse-all` | 全部收起 / Collapse All | — | read | — |
| `nbook.files.toggle-manifests` | 显示清单文件 / Show Manifest Files | — | write | — |
| `nbook.files.rename` | 重命名 / Rename | `nbook.explorer/hasSelection` | write | F2 |
| `nbook.files.delete` | 删除 / Delete | `nbook.explorer/hasSelection` | write，`destructive` | Delete |
| `nbook.files.copy` | 复制 / Copy | `nbook.explorer/hasSelection` | read | `Mod+C` |
| `nbook.files.cut` | 剪切 / Cut | `nbook.explorer/hasSelection` | read | `Mod+X` |
| `nbook.files.paste` | 粘贴 / Paste | `nbook.explorer/canPaste` | write | `Mod+V` |
| `nbook.files.move-up` | 上移 / Move Up | `nbook.explorer/canReorder` | write | `Alt+ArrowUp` |
| `nbook.files.move-down` | 下移 / Move Down | `nbook.explorer/canReorder` | write | `Alt+ArrowDown` |
| `nbook.files.create-content` | 创建内容 / Create Content | `nbook.explorer/canCreateContent` | write | — |
| `nbook.files.convert` | 转换文件夹类型 / Convert Folder | `nbook.explorer/canConvert` | write | — |
| `nbook.files.set-display` | 修改展示名与图标 / Edit Display Name and Icon | `nbook.explorer/canEditManifest` | write | — |
| `nbook.files.include` | 加入清单 / Add to Manifest | `nbook.explorer/canEditManifest` | write | — |
| `nbook.files.drop-entry` | 从清单移除 / Remove from Manifest | `nbook.explorer/canEditManifest` | write | — |
| `nbook.files.clear-cut` | 清除剪切标记 / Clear Cut | — | read | Escape |

- 树内按键不是命令声明里的默认键位：由资源管理器的树在自己拥有焦点时处理并执行这条命令（宿主的键位分发是全局的，`Delete` 不能在树之外删文件）。从命令面板执行时作用于当前选择，不要求树有焦点。
- 资源管理器尚未打开时为 `unavailable`；需要界面输入的命令（新建、改名、展示名、带碰撞的粘贴、删除）还要求视图已挂上且可见。
- `when` 只表示有没有可作用的选择；执行时再按选择核对（例如选中项里有根行时改名不可用），不合格返回 `unavailable` 与原因。

### 上下文键（第一批）

上下文键由拥有该状态的插件登记，命令系统本身不认识任何领域键。产品命令表的键来自公开状态：拥有状态的插件声明布尔公开键，`when` 写它的限定名。下表的键只在 Lab 命令场景的本地命令表里登记，不进产品的公开状态；编辑器插件接入时改为它的公开键。

| 键 | 含义 | 拥有者 |
|---|---|---|
| `editor-focus` | 编辑区获得焦点 | 编辑器 |
| `editor-active` | 存在有效编辑器句柄 | 编辑器 |
| `editor-writable` | 活动编辑器非只读 | 编辑器 |
| `editor-line-navigation` | 活动编辑器支持行导航 | 编辑器 |
| `quick-open-visible` | 命令面板可见 | 面板所在的界面宿主 |

`when` 引用未登记的键时命令不可用（见“可用性求值”）。新增键必须同步更新本规范。

### 默认键位（第一批）

| 键位 | 命令 |
|---|---|
| `Ctrl/Cmd+Shift+P` | `nbook.quick-open.open-commands` |

`Mod` 在 macOS 上是 Cmd，其它平台是 Ctrl。浏览器不可拦截或与宿主冲突的系统组合不注册；控件局部按键（对话框 Escape、列表导航、编辑器内部按键）不属于本能力。`Ctrl/Cmd+P` 文件快速打开不在本批。

### 兼容与安全

- 与桌面菜单契约：15 个既有 id 将来以别名兼容；本批只实现别名机制，不接线、不出现双轨。
- 与组件标准：纯组件不直接触达命令表；命令作用于域 / 宿主层，组件通过事件或注入端口参与。
- 白名单：只有已登记的命令（含别名目标）可执行。
- 参数校验：外部与键位来源的参数在进入执行前校验，不轻信输入。
- 暴露默认关闭：新命令默认不对 agent 开放，逐条显式开放。

## 验收与 Smoke

1. **登记与冲突**：Given 两个内置插件贡献同一命令 id；When 装配；Then 两条一起被拒绝、原因可查，命令表里没有它，与加载顺序无关。Given 本地命令表上两个不同定义登记同一 id；Then 拒绝后来者、保留首个、只报告一次；释放后重新登记时旧释放函数不误删新条目。
2. **别名机制**：Given 已登记命令与其别名；When 经别名执行；Then 与 canonical 执行同一实现、审计 id 用 canonical；目标释放后别名不可用；与已登记别名同名的命令、与已登记命令同名的别名都被拒绝，别名仍指向原命令。
3. **`when` 三面**：Given 命令声明 `when.requires: [editor-active, editor-writable]`；When 无活动编辑器；Then 面板不出现、快捷键不响应、执行返回 `unavailable` 与原因；编辑器就绪后三面同时恢复。
4. **参数严格性**：Given 无参命令与带参命令；When 传入额外字段、缺必填、`null` 或非对象；Then `invalid-args`，处理器未运行。
5. **暴露策略**：Given 命令 A（默认 `never`）、B（`confirm`）；When agent 调用 A；Then `not-exposed`；调用 B；Then 界面出现确认，确认后执行、取消后 `denied`。
6. **只读联动与快照**：Given discuss/plan 模式；When agent 调用 `write` 命令；Then `read-only` 直接拒绝。确认等待期间命令被替换，批准后返回 `stale-target`；等待期间切到 discuss/plan，批准后返回 `read-only`；两种情况都不执行旧请求。
7. **审计单一**：Given 同一命令由用户与 agent 各触发一次；Then 每条调用恰好一条审计、来源可区分；一个监听器抛错不影响结果与其它监听器。
8. **执行错误边界**：Given 命令执行抛出异常；When 触发；Then 返回 `execution-error` 且页面不崩溃；经贡献点登记的命令另按贡献方插件记入诊断。
9. **键位裁决**：Given 两个命令声明同一规范化键位；Then 后来的绑定不启用并报告一次；原持有者释放后重建、新首个接管；不满足 `when` 时按键不拦截。
10. **Smoke 入口**：在 Component Lab 的 `WorkbenchCommandPalette` 命令场景以真实浏览器触发 `Ctrl/Cmd+Shift+P`，检索并执行 `nbook.edit.undo`，样板编辑器的正文回退，事件 tab 有对应的 `command` 事件；无活动编辑器的场景里命令检视给出可读的不可用原因；切到其它组件后同一快捷键不再响应。
11. **贡献与撤回**：Given 一个插件向 `commands.definitions` 贡献命令；When 它激活；Then 命令出现在本运行位置的命令表里、经命令服务执行得到处理函数的结果，枚举里的贡献方是该插件；When 它的入口停止；Then 命令离开命令表，执行得到 `unknown-command`。同一插件里不合格的那条贡献被拒、原因可查，其它照常。
12. **两端各自的命令表**：同一份 `nbook.commands` 入口在服务端与浏览器各自装配；服务端插件贡献的命令只在服务端的命令表里，浏览器窗口的命令表里只有浏览器入口贡献的命令。
13. **产品页的命令面板**：Given 生产构建的 `/` 页；When 按 `Ctrl/Cmd+Shift+P`；Then 打开命令面板（面板入口命令由 `nbook.workbench` 贡献，不进候选，产品命令表里暂时没有别的人类可见命令时显示空态）；Escape 关闭并把焦点还回去。
14. **两个窗口的状态不同**：Given 两个窗口都有一条 `when` 引用某插件布尔公开键的命令，只在一个窗口里该键为 true；Then 各自的命令面板只在那一个窗口列出它；服务端经 `nbook.commands/remote` 分别问两个窗口，得到的可用性各按那个窗口此刻的状态；对另一个窗口执行为 `unavailable`、不执行。
15. **懒激活插件的键**：Given 命令的 `when` 引用一个懒激活插件声明的键；Then 命令登记成功；入口未激活时不可执行并给出声明的原因；激活后按值求值；入口停止后回到不可用。
16. **未声明的键**：Given 命令的 `when` 引用一个没有任何插件声明的键（或非布尔键）；Then 命令登记成功、出现在枚举里，但不可用，面板不列出、执行为 `unavailable`，原因写明那个键；同一命令同一个键只记一次诊断；Lab 的本地命令表同样如此。

## 实现合同

已实现（合同测试与 Component Lab 真实浏览器验收闭合）：

- 命令系统 `packages/neuro-book/src/plugins/commands/`：
  - `plugin.ts` 是插件描述，两个运行位置都有入口。
  - `shared/contracts.ts` 定义贡献点 `commands.definitions`、声明的 TypeBox schema、命令服务接口与 `commandServiceKey`。
  - `shared/registry.ts` 是命令表与执行管线，声明校验 `commandDeclarationProblems` 由贡献点校验与本地登记共用。
  - `shared/context-keys.ts` 负责上下文键的登记表与 `when` 求值；键是否存在只在求值时判断。
  - `shared/plugin.ts` 的 `commandsPlugin` 是插件定义，含服务端与浏览器两个入口，每个实例的入口各自一份命令表：接收者在贡献发布后（`published`）登记、撤回时释放，每次执行经 `implementation()` 取实现，执行异常记入诊断。
  - 装配在 `src/server/plugins.ts` 与 `src/web/plugins.ts` 的定义表。
- 中英文本：`packages/neuro-book/src/shared/localized-text.ts`。
- 浏览器界面 `packages/neuro-book/src/plugins/workbench/web/`：
  - `commands/keymap.ts` 负责键位解析与分发。
  - `commands/WorkbenchCommandHost.vue` 是 `/` 页上的界面宿主。
  - `commands/open-commands.ts` 是面板入口命令与“当前面板”槽位。
  - 命令面板见 [`workbench.quick-open`](quick-open.md)。
- Lab 命令场景 `packages/neuro-book/src/plugins/lab/web/fixtures/command-scene/`：
  - `lab-command-scene.ts` 是局部宿主：本地命令表、确认闸门、审计转 Lab 事件，切场景即释放。
  - `editor-commands.ts` 是四条编辑器命令，第 5 步随编辑器插件迁走。
  - `SampleTextEditor.vue` 是 textarea 样板编辑器，`LabCommandInspector.vue` 是命令检视。

## 证据

- 实现入口：[`registry.ts`](../../../packages/neuro-book/src/plugins/commands/shared/registry.ts)、[`plugin.ts`](../../../packages/neuro-book/src/plugins/commands/shared/plugin.ts)
- 合同测试：[`registry.test.ts`](../../../packages/neuro-book/src/plugins/commands/shared/registry.test.ts)（场景 1–8、16）、[`context-keys.test.ts`](../../../packages/neuro-book/src/plugins/commands/shared/context-keys.test.ts)、[`plugin.test.ts`](../../../packages/neuro-book/src/plugins/commands/shared/plugin.test.ts)（经真实内核：场景 1、8、11、12、15、16 与 `when` 读公开状态）、[`remote.test.ts`](../../../packages/neuro-book/src/plugins/commands/shared/remote.test.ts)（跨实例列出与执行、跨实例调用失败、场景 14）、[`keymap.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/keymap.test.ts)（场景 3、9）、[`editor-commands.test.ts`](../../../packages/neuro-book/src/plugins/lab/web/fixtures/command-scene/editor-commands.test.ts)；组件测试 [`lab-command-scene.dom.test.ts`](../../../packages/neuro-book/src/plugins/lab/web/fixtures/command-scene/lab-command-scene.dom.test.ts)（场景 5 的确认界面）、[`WorkbenchCommandHost.dom.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/WorkbenchCommandHost.dom.test.ts)
- Smoke：[`e2e/lab-commands.e2e.ts`](../../../packages/neuro-book/e2e/lab-commands.e2e.ts)（场景 10，开发会话，真实 Chrome）、[`e2e/commands.e2e.ts`](../../../packages/neuro-book/e2e/commands.e2e.ts)（场景 13，生产构建）、[`e2e/state.e2e.ts`](../../../packages/neuro-book/e2e/state.e2e.ts)（场景 14，测试外壳）
- 批准依据：[命令系统提案](../../proposals/workbench-commands.md)（2026-09-14 起草，2026-09-18 需求讨论修订）；命令改由内置插件提供，见[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P3（2026-10-06）；一份定义含服务端与浏览器两个入口依据 [ADR 0026](../../adr/0026-plugin-definitions-as-constants.md)（2026-10-08）；`when` 读公开状态、跨实例命令直接问目标窗口由开发者 2026-10-08 在 [t56 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t56-plugin-state/plan.md) 中确认；`when` 的键改在求值时判断由开发者 2026-10-08 在 [t60 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t60-plugin-api-ergonomics/plan.md) 中确认。
