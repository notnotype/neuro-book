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

**目标**：NeuroBook 的**具名可发现动作**——命令面板、快捷键、按钮、未来的菜单与外部调用——拥有单一身份与单一执行入口。每条命令携带：全局唯一 id、人类标题（i18n）与语义描述、参数形状（`argsSchema`）、可用性条件（`when`）、默认快捷键、作用类型（`effect`）与对外暴露策略。执行产生结构化结果与审计事件；触发面只引用命令身份。

**本批（命令底座与 Lab 闭环）**交付六条命令——`nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line`、`nbook.quick-open.open-commands`、`nbook.quick-open.open-line`——以及机制底座与 Component Lab 可见闭环。

**第二批（外壳与 View 标题操作，2026-09-19）**交付 `view` 域的七条命令：面板位置/对齐/隐藏/收起/最大化切换、工具视图移动，以及一个真实 View 贡献的刷新入口。它们复用同一注册表与同一执行入口，不新开命令总线；面板标题的框架控件与 View 贡献操作分别调用这两组命令。

**非目标**：

- 不把高频交互流命令化：击键、滚动、拖拽中间态、光标移动不经命令执行管线。
- 不提供用户自定义快捷键界面：本能力只固定默认键位的派生与分发。
- 本批不移入活动栏/标题栏/桌面菜单/右键菜单等入口：别名机制就位，15 条桌面 id 的接线留待后续批次。
- 不实现自动视图派生命令（`nbook.view.toggle.*` / `nbook.view.focus.*`）。
- 不实现外部 agent 的接入通道（CLI / MCP / Skill 绑定）：本能力只固定暴露策略、结构化结果与审计语义。
- 不提供第三方不可信代码的沙箱、动态安装或签名机制。

## 术语与参与者

- **命令（Command）**：具名可发现动作的单一身份。id 全局唯一且稳定；元数据描述"是什么、何时可用、给谁看"；执行是请求/响应，不是事件广播。
- **别名（Alias）**：既有外部 id（如桌面菜单契约的 15 个 id）到标准命令的映射。别名只做解析，不产生第二份实现。本批只保留机制，不接线。
- **触发面（Trigger）**：命令面板、快捷键、按钮，以及未来的菜单与外部调用。触发面只引用命令 id。
- **上下文键（Context Key）**：具名宿主状态（如 `project`、`editor-focus`）。只有登记过的键可以被 `when` 引用；键的命名空间、登记与求值口径与 View descriptor 的 `when` 共用同一份登记表。
- **可用性（Availability）**：命令的 `when` 在其触发时刻求值的当前结果。不满足时面板不出现、快捷键不响应、`executeCommand` 返回结构化拒绝（不是静默忽略）。
- **作用类型（`effect`）**：`read` / `write`，必填。是只读模式（discuss / plan）阻断 agent 调用的唯一依据。
- **暴露级别（Exposure）**：命令对外部 agent 的可见性与约束——`never`（默认）、`confirm`（执行前需用户在界面确认）、`auto`（可直接执行）。
- **语义标注（Hints）**：`readOnly`、`destructive`、`idempotent`，仅作描述与确认提示生成，不承担阻断职责；与 `effect` 冲突的标注在注册期失败。
- **审计事件（Audit Event）**：一次执行的可观察记录：来源（用户 / 外部 agent）、命令 id、参数、结果、耗时。每次调用恰好一条，含未知 id、拒绝与异常。
- **参与者**：用户（触发、确认）；命令所有者（注册与维护命令的模块）；宿主（持有注册表、求值上下文键、呈现面板与确认）；外部 agent（经绑定调用，受暴露策略约束）。

## 输入与前置条件

- **触发方式**：用户交互（面板选择、快捷键、按钮）、页面代码 API、未来的外部调用（经绑定）。
- **输入形状**：命令 id（或已登记的别名）+ 一个对象参数。参数形状由命令自己的 `argsSchema` 约束；不声明参数的命令只接受空对象。调用省略参数时归一为 `{}`，显式 `null` 不归一（校验失败）。
- **前置状态**：注册表已装配；命令执行所需上下文键可求值。
- **权限**：本能力自身不引入权限模型。破坏性保护由暴露策略（`confirm` / `destructive` 标注）与只读模式（discuss / plan）承担；领域权限仍归各域 owner。

## 输出与可观察行为

- **命令身份**：id 使用三段式命名空间 `nbook.<domain>.<action>`，全小写 kebab-case 分段（与 View descriptor 的 id 规则一致）。域词表见「边界与兼容」。
- **注册**：同一描述符对象重复注册返回同一幂等释放闭包；不同对象注册同一 id 是冲突——开发环境抛错并指名冲突，生产环境拒绝后来的注册、保留首个并记录一次。非法描述符（未登记 `when` 键、hint 与 `effect` 冲突等）同样开发期失败、生产期拒绝，不静默降级。
- **释放**：注册返回的释放闭包只删除自己注册时的条目；命令被释放后重新注册同 id 时，旧释放闭包不得影响新条目。别名在目标卸载时级联清除。
- **枚举**：任何消费者可获取全部 canonical 命令及其元数据（id、标题、描述、参数形状、`when`、默认键位、来源、暴露策略、`effect`）；别名不出现在 canonical 枚举中，审计的 `id` 用 canonical，`requestedId` 保留输入。
- **执行顺序**（固定，不可交换）：解析白名单 → agent 暴露检查 → 严格参数校验 → 当前 `when` → agent 只读检查 → 必要确认 → 复查条目身份/参数不变性/`when`/模式 → `run` → 单次审计。
- **结果合同**：成功为 `{ok:true, value}`（void 命令显式 `null`，不把 Promise rejection 当成功）；失败为 `{ok:false, code, reason}`，失败码固定九个：`unknown-command`、`unavailable`、`invalid-args`、`not-exposed`、`read-only`、`confirmation-required`、`denied`、`execution-error`、`stale-target`。
- **可用性求值**：`when` 是上下文键的 all-of 正条件；未登记的键在注册期失败，登记的键缺失按 false 求值。求值失败/不满足返回 `unavailable` 与缺失原因。
- **参数校验**：严格（JSON Schema 语义），不转换、不填充默认值、拒绝额外字段与显式 `null`；校验失败返回 `invalid-args` 并指出失败位置。
- **暴露**：外部 agent 面只可见暴露级别高于 `never` 的命令；`confirm` 命令被 agent 调用时，界面呈现确认（含命令标题、参数、发起者），用户批准后执行、拒绝则返回 `denied`。确认回调缺失返回 `confirmation-required`。确认使用参数的独立快照，等待期间调用方修改原参数不影响获批内容；等待期间注册对象被替换返回 `stale-target`。
- **只读联动**：宿主处于 discuss / plan 时，`effect: "write"` 或带 `destructive` 标注的命令对外部调用直接拒绝（`read-only`）；界面触发不受该模式影响。
- **审计**：每次执行产生恰好一条审计事件，来源字段区分 `user` 与 `agent:callerId`；监听器抛出的异常被隔离上报，不改变执行结果、不影响其它监听器。命令核心不弹通知、不维护可见日志队列——可见错误由触发宿主呈现一次。
- **键位分发**：声明了默认键位的命令由全局分发按当前可用性求值响应；命中后 `preventDefault` 并阻断同次事件继续传播；不满足 `when` 时不拦截。同规范化键位冲突的裁决见「失败与恢复」。

## 状态与转换

| 状态 | 触发 | 下一状态 | 拒绝条件 |
|---|---|---|---|
| 未注册 | 注册命令 / 别名 | 已注册（可枚举、可执行） | id 冲突（开发失败 / 生产拒绝并保留首个）；描述符非法 |
| 已注册 · 可用 | 执行触发 | 执行中 → 完成（成功 / 失败结果） | 参数校验失败、只读拒绝、确认被拒、等待期间条目被替换 |
| 已注册 · 不可用 | `when` 求值变化 | 可用 / 不可用 | 不可用时面板不出现、快捷键不响应、外部调用拒绝 |
| 已注册 · 键位占用 | 新命令声明同规范化键位 | 后来的绑定不启用（两环境一致） | 报告一次；原持有者释放后按注册顺序重建 |

本能力不引入持久状态；注册表与上下文键字典都在内存中重建。

## 副作用与数据

- 命令执行产生的业务副作用（打开视图、移动光标、编辑正文等）归各域 owner，本能力只负责调度与结果回传。
- 审计事件写入内存通道（订阅式分发），不写领域 Store、不持久化。
- 本能力不直接读写任何存储介质。

## 失败与恢复

- **未知命令 / 别名**：拒绝并返回结构化原因（不得静默忽略）。
- **参数校验失败**：拒绝并指出失败参数。
- **`when` 不满足**：界面隐藏/禁用；外部调用返回拒绝原因。
- **执行错误**：由执行入口的错误边界捕获，返回结构化失败结果，不导致整页崩溃；可见提示由触发宿主呈现一次（命令面板宿主用唯一的 `role="alert"` 区域）。
- **确认被拒 / 只读拒绝**：返回对应失败分类。
- **键位冲突**：同一规范化键位视为冲突——开发期与生产期均报告且**不启用后来的绑定**；原持有者释放后按仍注册的命令顺序重建，此时新首个可以接管。冲突不因 `when` 条件"看起来互斥"而放行（all-of 正条件无法证明互斥），首个命令不可用时也不回落到冲突命令。非法键位字符串同样不启用该绑定并报告，命令本身仍可通过按钮/面板执行，注册表元数据不被修改。
- **注册表装配失败**（冲突、未登记 `when` 键）：开发期暴露问题清单并失败，不静默降级。

## 边界与兼容

### 命名与域词表（第一批）

- 格式：`nbook.<domain>.<action>`；`action` 可为复合（如 `go-to-line`）。插件预留 `<source>.<domain>.<action>` 形式，本批只允许核心前缀注册。
- 域词表：`view`、`editor`、`edit`、`quick-open`、`settings`、`account`、`project`、`app`、`help`。本批只注册 `editor` / `edit` / `quick-open`。

### 命令目录（第一批 · 本批全部交付）

| 命令 id | 标题 | 参数 | `when` | `effect` | agent 暴露 |
|---|---|---|---|---|---|
| `nbook.editor.focus` | 聚焦编辑器 / Focus Editor | `{}` | 活动编辑器 | read | auto |
| `nbook.edit.undo` | 撤销 / Undo | `{}` | 活动编辑器且可写 | write | confirm |
| `nbook.edit.redo` | 重做 / Redo | `{}` | 活动编辑器且可写 | write | never |
| `nbook.editor.go-to-line` | 跳转到行 / Go to Line | `{target, line}`（`target` 为编辑器文档身份四字段，`line` 为 1 起正整数） | 活动编辑器且支持行导航 | read | auto |
| `nbook.quick-open.open-commands` | 命令面板 / Command Palette | `{}` | 无 | read | never |
| `nbook.quick-open.open-line` | 跳转到行… / Go to Line… | `{}` | 活动编辑器且支持行导航 | read | never |

### 命令目录（第二批 · 外壳与 View 标题）

| 命令 id | 标题 | 参数 | `when` | `effect` | agent 暴露 |
|---|---|---|---|---|---|
| `nbook.view.set-panel-position` | 面板位置 / Panel Position | `{position}`（`bottom`\|`top`\|`left`\|`right`） | 外壳就绪且非紧凑呈现 | write | never |
| `nbook.view.set-panel-alignment` | 面板对齐 / Panel Alignment | `{alignment}`（`center`\|`left`\|`right`\|`justify`） | 水平位置且非紧凑呈现 | write | never |
| `nbook.view.set-panel-hidden` | 隐藏/显示面板 / Hide or Show Panel | `{hidden}`（布尔） | 外壳就绪 | write | never |
| `nbook.view.set-panel-collapsed` | 收起为标题头 / Collapse to Title Bar | `{collapsed}`（布尔） | 水平位置 | write | never |
| `nbook.view.toggle-panel-maximized` | 最大化/还原面板 / Maximize or Restore Panel | `{}` | 左右位置或水平居中且非紧凑呈现 | write | never |
| `nbook.view.move-view` | 移动视图 / Move View | `{viewId, sourceContainerId, targetContainerId}` | 视图可移动且目标容器可接收 | write | never |
| `nbook.view.refresh-files` | 刷新文件 / Refresh Files | `{viewId, generation}`（精确实例代际） | 该实例贡献了 refresh 动作 | read | never |

- 参数一律严格校验（`additionalProperties: false`）：缺字段、未知取值都是失败，不静默补齐。
- 前六条写的是**同一份用户定制记录**（面板状态）或既有移动写入路径；尺寸（高度/宽度）不在这里写，只由手势落点提交，避免两个写者。
- `refresh-files` 是 View 贡献动作的样例：命令只携带 `{viewId, generation}`，命中句柄与代际校验归宿主；活动 View 或实例代际变化后的迟到点击按 `stale-target` 拒绝。
- 令牌语义：保存类返回 `saved`/`unchanged`/`pending`/`rejected`；`pending` 是「已接纳未保存」，不得在标题控件里显示成已保存。

### 上下文键（第一批）

| 键 | 含义 | 来源 |
|---|---|---|
| `project` | 已打开 Project | 现有视图可见性键 |
| `selection` | 存在选中条目 | 现有视图可见性键 |
| `user-assets` | 处于用户资产工作区 | 现有视图可见性键 |
| `desktop` | 桌面外壳（bridge）可用 | 现有视图可见性键 |
| `editor-focus` | 编辑区获得焦点 | 编辑器宿主 |
| `quick-open-visible` | 命令面板可见 | 面板宿主 |
| `agent-panel-open` | Agent 面板已打开 | 外壳宿主 |
| `editor-active` | 存在有效编辑器句柄 | 编辑器宿主 |
| `editor-writable` | 活动编辑器非只读 | 编辑器宿主 |
| `editor-line-navigation` | 活动编辑器支持行导航 | 编辑器宿主 |

`when` 引用未登记键在注册期失败。新增键必须同步更新本规范。

### 默认键位（第一批）

| 键位 | 命令 |
|---|---|
| `Ctrl/Cmd+Shift+P` | `nbook.quick-open.open-commands` |

浏览器不可拦截或与宿主冲突的系统组合不注册；控件局部按键（对话框 Escape、列表导航、编辑器内部按键）不属于本能力。`Ctrl/Cmd+P` 文件快速打开不在本批。

### 兼容与安全

- 与桌面菜单契约：15 个既有 id 将来以别名兼容；本批只实现别名机制，不接线、不出现双轨。
- 与组件标准：纯组件不直接触达注册表；命令作用于域 / 宿主层，组件通过事件或注入端口参与。
- 白名单：只有已注册的命令（含别名目标）可执行。
- 参数校验：外部与键位来源的参数在进入执行前校验，不轻信输入。
- 暴露默认关闭：新命令默认不对 agent 开放，逐条显式开放。

## 验收与 Smoke

1. **注册与冲突**：Given 两个描述符注册同一 id；When 装配注册表；Then 开发环境失败并指名冲突，生产环境保留首个并记录一次；释放重注册后旧闭包不误删新条目。
2. **别名机制**：Given 已注册命令与其别名；When 经别名执行；Then 与 canonical 执行同一实现、审计 id 用 canonical；目标释放后别名不可用。
3. **`when` 三面**：Given 命令声明 `when.requires: [editor-active, editor-writable]`；When 无活动编辑器；Then 面板不出现、快捷键不响应、`executeCommand` 返回 `unavailable` 与原因；编辑器就绪后三面同时恢复。
4. **参数严格性**：Given 无参命令与带参命令；When 传入额外字段、缺必填、`null` 或非对象；Then `invalid-args`，处理器未运行。
5. **暴露策略**：Given 命令 A（默认 `never`）、B（`confirm`）；When agent 调用 A；Then `not-exposed`；调用 B；Then 界面出现确认，确认后执行、取消后 `denied`。
6. **只读联动与快照**：Given discuss/plan 模式；When agent 调用 `write` 命令；Then `read-only` 直接拒绝；确认等待期间替换注册对象或模式变化，批准后也不执行旧请求（`stale-target`）。
7. **审计单一**：Given 同一命令由用户与 agent 各触发一次；Then 每条调用恰好一条审计、来源可区分；一个监听器抛错不影响结果与其它监听器。
8. **执行错误边界**：Given 命令执行抛出异常；When 触发；Then 返回 `execution-error` 且页面不崩溃。
9. **键位裁决**：Given 两个命令声明同一规范化键位；Then 后来的绑定不启用并报告一次；原持有者释放后重建、新首个接管；不满足 `when` 时按键不拦截。
10. **Smoke 入口**：在 Component Lab 以真实浏览器触发 `Ctrl+Shift+P`，检索并执行 `nbook.edit.undo`，在「命令」检视 tab 观察审计事件与结果；对不可用命令确认拒绝原因可读。

## 实现合同

已实现（合同测试与 Component Lab 真实浏览器验收闭合）：

- 底座：`packages/neuro-book/app/utils/workbench/context-keys.ts`（共享键登记与求值）、`commands.ts`（注册表与执行管线）、`keymap.ts`（键位解析与分发）、`app/composables/useWorkbenchCommands.ts`（宿主 provide/inject 与上下文投影）。
- 真实样板：`app/utils/workbench/editor-commands.ts` 注册四条编辑器命令；`CodeEditorView` 暴露行导航能力。
- 面板宿主：`app/components/workbench/WorkbenchCommandPalette.vue` 与 `app/component-lab/LabShell.vue`（全局唯一的 S4 面板实例、确认宿主、只读命令调试 tab）。

## 证据

- 实现入口：[`commands.ts`](../../../packages/neuro-book/app/utils/workbench/commands.ts)
- 合同测试：[`commands.test.ts`](../../../packages/neuro-book/app/utils/workbench/commands.test.ts)
- Smoke：不适用——命令面板的 S4 入口在 `/lab` 真实浏览器里人工验收，`component-lab.ts` smoke 只覆盖检查器「命令」面板 tab。
- 批准该目标的提案：[`../../proposals/workbench-commands.md`](../../proposals/workbench-commands.md)（2026-09-14 起草，2026-09-18 需求讨论修订）。
- 相关规范：[`../ui/workbench-shell.md`](../ui/workbench-shell.md)（视图描述与 `when` / authority 求值口径）；[`quick-open.md`](quick-open.md)（命令面板与行号跳转交互）。
