# Workbench 命令系统与 Live 操作面提案

- **状态**：draft（2026-09-14 起草；2026-09-18 依据需求讨论修订，待评审；2026-09-19 批准分批实施，首批范围见决策记录）
- **对应 Issue**：[#192 建立类 VS Code 的 Workbench 与 View Host 抽象](https://github.com/notnotype/neuro-book/issues/192)（硬前置 #191 主应用 nb-ui 底座迁移）
- **相关提案**：[`workbench-view-host.md`](../../packages/neuro-book/docs/proposals/workbench-view-host.md)（Workbench 与 View Host 抽象，状态 `accepted`；其阶段 5「命令与只读描述快照桥接」由本提案承接）

---

## 问题

NeuroBook 的产品界面目前缺乏统一的命令（Command）抽象与注册表（Registry）。用户界面的各种交互入口——活动栏条目、桌面标题栏菜单、设置面板动作、对话框按钮、右键菜单以及键盘快捷键——均由各组件以私有事件、内联闭包或手工分发的形式各自实现。

这种割裂的现状导致了以下系统性问题：

1. **入口与行为强耦合**：UI 部件直接持有操作的具体实现逻辑（闭包或私有方法），无法在不修改组件源码的情况下从外部触发、重组或挂载已有动作。
2. **快捷键无法统一配置与分发**：键盘事件散落在各个业务组件的 `@keydown` 处理器中，缺少全局快捷键注册表（Keymap），无法集中检测快捷键冲突、无法派生快捷键速查表，更无法支持快捷键的用户级自定义。
3. **命令面板（Command Palette）与快速打开（Quick Open）无法落地**：由于系统不知道“当前存在哪些可用命令”、“这些命令由谁处理”、“它们在何种条件下有效”，导致类 VS Code 的快速打开与全局命令面板只能停留在占位文案阶段，缺少数据支撑。
4. **可见性与可执行性缺乏声明式表达**：动作在特定上下文（如无打开项目、正在运行 Agent、非只读模式等）下的禁用/隐藏判断缺乏类似 VS Code 的 `when` 上下文机制，依赖各组件内各自手写的 `v-if` 或 `disabled` 响应式逻辑，规则分散且不可维护。
5. **审计与可观测性缺失**：无法在单一通道拦截命令的调用生命周期（调用方、参数、执行结果、耗时、错误），导致用户操作流难以追踪与回溯。
6. **缺少面向外部 agent 的白盒操作面**：NeuroBook 的目标之一是让**外部通用 agent**（不限于内置 Leader）能够操作自身。两条路线：Headless（CLI + 结构化输出，未开始）与 Live（运行中的界面 + 命令系统）。现状下，外部 agent 操作 Web UI 只能依赖黑盒 UI 自动化（Playwright / computer-use）：选择器与坐标随 UI 漂移、无语义、失败不可诊断、操作对用户不可见。命令系统是 Live 路线的底座，且天然优于黑盒自动化。
7. **感知面缺位**：外部 agent 无法读取“用户此刻的处境”（当前文档、选区、打开的视图、布局、脏标记）。命令面回答“能做什么”，感知面回答“现在是什么”。感知面另行设计；本提案只定义概念边界与两者共享的上下文键基础。

---

## 定位与术语

本提案位于「NeuroBook 作为可被 agent 操作的应用」的总体方向中，先固定术语（2026-09-18）：

**两种操作模式**：

| 模式 | 定义 | 操作者 | 状态 |
|---|---|---|---|
| **Headless（无头）** | 不启动界面，进程外操作项目数据与领域能力（CLI + 结构化输出） | 外部 agent / 工具；**也可以是用户**（`nbook` CLI、`nbook tui` 直接与 Leader 对话，不依赖 Web UI） | 未开始；本次不做 |
| **Live（在场）** | 界面运行中，以用户视角对真实实例执行操作 | 外部通用 agent；未来的自动化与教学场景 | 本提案（底座） |

**操作面（Action Surface）**：某个模式暴露的正式程序化接口集合。

- Headless 模式 → **无头面**（CLI + 结构化输出；本提案不涉及）。
- Live 模式 → **命令面（Command Surface，本提案）** + **感知面（Observation Surface，另行设计）**。

**接入形态（Binding）**：外部 agent 触达操作面的方式——CLI 绑定、MCP 绑定、Skill 绑定。本提案不实现绑定，但描述符按“可机械导出为工具定义”的形状设计。

**为什么命令面优于黑盒 UI 自动化**：

| 维度 | 黑盒（Playwright / computer-use） | 命令面 |
|---|---|---|
| 稳定性 | 选择器 / 坐标随 UI 漂移即坏 | 命令 id 是契约，UI 重构不破坏 |
| 语义 | 无（点 (x,y)、填选择器） | 有（“格式化文档”“切换主题”） |
| 失败诊断 | “没找到按钮” | 结构化原因（`when` 不满足 / 权限 / 参数 / 执行错误） |
| 结果 | 像素，需再解析 | 结构化返回值 + 感知面读取 |
| 用户可见性 | 静默点击或抢占输入 | 操作可呈现、可高亮，是教学与信任的基础 |
| 覆盖 | 像素可达处 | 命令面覆盖处（未覆盖角落仍可用黑盒兜底） |

**两类消费者的投影**：人类与外部 agent 共享同一命令注册表，但投影面不同——

- 人类投影：`titleKey`（i18n 标题）、分类分组、MRU、快捷键回显；
- agent 投影：稳定英文 id、locale 无关的 `description`、`argsSchema`、暴露策略（见方案 6）。

---

## 目标与非目标

### 目标

1. **建立单一命令注册表（`app/utils/workbench/commands.ts`）**：
   - 命令成为系统一等公民，拥有全局唯一字符串 `id`、i18n 标题键 `titleKey`、locale 无关语义描述 `description`、分类键 `categoryKey`、参数 schema `argsSchema`、执行处理器 `run(args)`、声明式可见性与可用性谓词 `when`、默认快捷键 `defaultKeybinding`、来源标识 `source` 与对外暴露策略 `expose`（见方案 1）。
   - 严格生命周期管理：幂等注册；开发环境重复 `id` 注册直接抛错拦截，生产环境记录并拒绝覆盖。
2. **具名可发现动作统一走命令**（边界收窄）：
   - 菜单、面板、快捷键、桌面菜单、右键菜单等**具名可发现动作**一律解耦为声明式引用 `commandId`，统一走 `executeCommand(id, ...args)`；
   - **控件手势**（sash 拖拽、tab 点击、展开箭头等）直接调用 store / 域服务，不伪装成命令——它们与命令最终落到同一个状态变更，订阅者看状态，不看命令。
3. **与 View Host descriptor 模型深度对齐**：
   - 视图与容器的标准操作（`view.toggle.<id>`、`view.focus.<id>` 等）由注册表从 `ViewDescriptor` 编译派生，消除视图与容器内部的私有动作通道。
4. **构建命令面板与快速打开（nb-ui 原语驱动，Lab 先行）**：
   - 单控件双模：`Ctrl+P` 快速打开模式、`Ctrl+Shift+P`（`>` 前缀）命令模式；模糊匹配、高亮与 MRU 加权排序；第一版默认模式匹配的工作区实体集见待决策点 6。
5. **集中派生快捷键映射表（Keymap）**：绑定声明在命令注册表中，集中派生与分发，按 context keys 求值 `when`。
6. **对外 agent 操作面**：暴露策略（默认关闭 + 三级 + 语义 hints）、结构化结果合同、审计 `source` 标记、与既有只读模式（discuss / plan）联动。
7. **感知面预留**：context keys 字典作为第一批感知键来源；命令与感知共用同一套键登记表名与求值器，避免两处真相源。
8. **配套**：Lab 右侧 inspect 新增命令调试 tab；`docs/standards/code/components.md` 扩展命令契约节（参与组件声明发出 / 响应 / 状态暴露）。

### 非目标（本次明确不做）

1. **Headless 模式**（`nbook` CLI / `nbook tui`）：本次只记录愿景——CLI 以结构化形式暴露 NeuroBook 功能（新建项目、查看配置、打开 agent TUI、headless 调用 agent），用户也可直接使用并与 Leader 对话；实现另行立项。
2. **感知面实现**：读工具（组件状态、应用状态、DOM、截图）另行设计；本提案只定边界。
3. **CLI / MCP / Skill 绑定实现**：另行设计。
4. 开放 L3 第三方不可信代码沙箱；复杂的多步骤 QuickInput 向导；用户自定义快捷键 UI 编辑器；沉重的外部命令框架。
5. **高频交互流进入命令管线**：击键、滚动、拖拽中间态等永不注册为命令（设计红线，见方案 7）。

---

## 当前行为与证据

### 1. 仓库现状取证（2026-09-18 基于 `refactor/w00003-nb-ui-adoption` 验证）

| # | 交互入口 / 位置 | 代码位置（文件:行） | 现状事实与耦合方式 |
|---|---|---|---|
| 1 | **活动栏条目** | `app/utils/workbench-chrome.ts`<br>`app/components/novel-ide/NovelIdeActivityBar.vue` | `WorkbenchActivityItem` 仅 `{id, disabled}`，图标与文案写死在组件；`invoke()` 对条目 ID **switch 手工分发**，抛出 10 种硬编码 emit（`open-home`、`open-tab`、`open-world-engine`、`open-trace-viewer`、`open-history-inbox`、`toggle-agent-panel`、`open-settings`、`open-profile`、`open-admin`、`logout`）。 |
| 2 | **桌面标题栏菜单** | `app/pages/index.vue`（`dispatchMenuCommand`）<br>`app/components/common/DesktopTitleBarChrome.vue`<br>`app/components/common/DesktopTitleBar.vue` | **全仓当前唯一近似「命令 ID」的概念**：`DesktopMenuCommandId` 15 个 id（`file.open` … `help.about`）经 `dispatchDesktopMenuCommand` switch 分发；原生桥与自绘菜单两条路径已汇合至同一 dispatch，但不与活动栏、设置动作、快捷键相通。 |
| 3 | **标题栏菜单 IA** | `app/utils/workbench-chrome.ts`（`TITLE_BAR_MENU_IA`） | 固定四组 File / Edit / View / Help，注释写明“调用方给不了别的表”；只允许按能力裁剪 enabled / visible。 |
| 4 | **设置与对话框动作** | `app/components/novel-ide/NovelIdeSettingsDialog.vue:243-291`<br>`app/components/novel-ide/diff/DiffWorkbenchDialog.vue:22-37` | 动作用对话框内部事件与写入器闭包（`saveGlobal`、`saveProject`）承载；`DiffWorkbenchDialog` 自定义局部 `{id, label, tone}` 动作数组，无命令抽象。 |
| 5 | **右键菜单** | `app/components/common/ContextMenu.vue:62-70`、`:111` | `ContextMenuItem` 含 `{label, iconClass, shortcut?, action?: () => void}`；点击直接 `item.action?.()` 闭包；`shortcut` 仅文本展示，无真实按键捕获。 |
| 6 | **编辑器工具栏** | `app/components/editor-workbench/EditorToolbar.vue` | 消费 `menus: MenubarMenuData[]` 并回传 `@select(item)`；快捷键标签（Ctrl+S / Ctrl+W）纯文本展示，无真实分发。 |
| 7 | **散落快捷键绑定** | `TipTapMarkdownEditor.vue`（`isSaveShortcut`）、`Dialog.vue`（Escape）、`EditorTabBar.vue`（window keydown，仅服务右键菜单导航）、`MarkdownCommentFlowPanel.vue`、`WorldEngineWorkbenchPreviewValueInput.vue`、`ProfileTemplateVisualEditor.vue` 等 | 无集中注册表；各组件内联 `@keydown` 拦截 Ctrl+S、Escape、Ctrl+Enter、Ctrl+滚轮 等；editor-workbench 落地后新增散落点（2026-09-18 复核）。 |
| 8 | **命令面板占位** | `app/components/workbench-spike/WorkbenchEditorSurface.vue:36` | 仅占位文案“Ctrl+P 快速打开 · Ctrl+Shift+P 命令面板”；**无任何对应组件或底层逻辑**。 |
| 9 | **输入触发的浮层** | `agent/tiptap/agent-suggestion.ts`、`ReferencePlainTextEditor.vue`、`ReferenceSelectorPopover.vue` | TipTap Suggestion 实现输入 `@` 或 `/` 的候选浮层；属富文本内补全，非全局快速打开。 |
| 10 | **既有类注册表设计** | `app/utils/workbench/descriptors.ts:163-200`、`:226-283`<br>`app/composables/useWorkbenchChrome.ts:10-23` | `WorkbenchRegistry` 含 `when.requires`（`project`/`selection`/`desktop` 等）与 `requiredAuthority` 结构化求值；管控对象是**视图与页面**，无「命令」实体。 |
| 11 | **视图描述符字段缺位** | `app/utils/workbench/descriptors.ts:283-300` | `ViewDescriptor` 有 `factoryKey`、`when`、`requiredAuthority`、`canMoveView`，但没有命令关联，无法被命令系统统一索引。 |
| 12 | **nb-ui 基础原语** | `packages/nb-ui/src/components/form/Combobox.vue`、`form/option-highlight.ts`、`navigation/`（Dropdown/Menubar/ContextMenu）、`feedback/DialogWindow.vue` | 键盘导航输入框、弹出层、列表与高亮算法齐备，具备组装命令面板的核心原料，未封装 QuickPick / CommandPalette。 |
| 13 | **无命令系统（否定证据）** | 全仓（`app/` 范围） | `CommandRegistry` / `registerCommand` / `executeCommand` **零命中**（2026-09-18 验证）——不存在任何命令注册或执行机制。 |
| 14 | **Agent 工具面现状** | `server/agent/tools/` | 已有丰富工具：`file-tools`（bash/读写）、`apply-patch`（编辑）、`web-tools`、`plot-tools`、`world-engine-tools`、`subject-memory-tools`、`agent-sql-project-module`、`workflow/task/job-tools`、`agent-collaboration-tools`、`control-tools`（`report_result` / `request_user_input` / `switch_mode`），并有 `approval` 审批机制；形态为 TypeBox schema + `defineAgentTool`。**没有任何操作前端工作台的通道**——“agent 操作 UI”是空白（前端 agent 目录无 `executeCommand` 类命中）。 |
| 15 | **Lab 与组件标准** | `app/component-lab/`（`EventLogPanel`、`inspect.ts`、`CollapsibleSidePanel`）<br>`docs/standards/code/components.md` | Lab 已有事件日志与元素检视体系，可扩展命令调试 tab；组件标准定义明面通道（props/emits/slots）与隐藏通道、能力标签与推荐配方，命令契约节待扩展。 |

---

### 2. VS Code 机制对照要点（机制与官方来源）

VS Code 的命令与交互系统经过长期演进，形成了一套工业级的解耦模式。以下梳理 12 项核心机制，作为本提案方案设计的架构参照（第 3 条与第 9 条同时是 2026-09-15 对照调研的修正依据）：

1. **命令单一身份（Command as Unique Identity）**：命令由唯一字符串 ID 与处理函数绑定；元数据（`title`、`category`、`icon`）声明后即可被系统发现。
   *来源*：[VS Code Command Guide](https://code.visualstudio.com/api/extension-guides/command) 及 [Contribution Points: Commands](https://code.visualstudio.com/api/references/contribution-points#contributes.commands)
2. **Quick Open 与命令面板共用同一控件**：`Ctrl+Shift+P` 与 `Ctrl+P` 是同一个 Quick Open 控件的不同模式，命令面板即预填 `>` 前缀。
   *来源*：[Tips and Tricks: Quick Open](https://code.visualstudio.com/docs/editing/tips-and-tricks#_quick-open)
3. **前缀路由机制（Prefix Routing）**：`>` 命令、`:` 行号、`@` 当前文件符号、`#` 工作区符号、`?` 前缀帮助。
   *来源*：同上
4. **模糊匹配与最近使用（Fuzzy Match & MRU）**：子序列模糊匹配 + 高亮 + MRU / 频次加权排序。
   *来源*：[VS Code User Interface](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) 与 [QuickPick API](https://code.visualstudio.com/api/references/vscode-api#QuickPick)
5. **同一命令 ID 多处复用（Multiple Triggers, Single Command）**：快捷键、菜单挂载、代码调用均引用同一 ID；菜单项、工具栏、右键菜单与快捷键只是同一命令的触发面。
   *来源*：[Contribution Points: Keybindings & Menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
6. **声明式 `when` 上下文键（Context Keys）**：布尔表达式控制可见性与启用状态；`editorTextFocus`、`inQuickOpen`、`isMac` 等内置键。
   *来源*：[When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
7. **命令支持入参与返回值**：`executeCommand(id, ...args)` 传参并获取 `Thenable<T>`；声明式配置支持静态 `args` 字典。
   *来源*：[Commands API](https://code.visualstudio.com/api/references/commands)
8. **QuickInput 程序化原语**：`showQuickPick` 与 `createQuickPick` / `createInputBox` 两层 API，支持异步加载与多步流程。
   *来源*：[QuickInput API](https://code.visualstudio.com/api/references/vscode-api#QuickInput)
9. **QuickInput 内部按键同样注册为命令**：`quickInput.accept` / `quickInput.next` 等都是命令，`when` 为 `inQuickOpen && quickInputType == 'quickPick'`——保持交互模型与按键分发一致。
   *来源*：[VS Code Key Bindings Reference](https://code.visualstudio.com/docs/configure/keybindings#_default-keyboard-shortcuts)
10. **上下文键可实时检视与调试**：`Developer: Inspect Context Keys` 运行时检视当前键值字典。
    *来源*：[When Clause Contexts: Inspect Context Keys](https://code.visualstudio.com/api/references/when-clause-contexts#_inspect-context-keys-utility)
11. **菜单贡献点与分组排序（Menus & Groups）**：命令 ID 挂载至贡献位置（`commandPalette`、`view/title`、`editor/context`），`group` 字符串（如 `navigation@1`）决定排序与分割线。
    *来源*：[Contribution Points: Menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
12. **快捷键优先级裁决规则（Keybinding Precedence）**：用户级覆盖 > 插件声明 > 系统默认；同层按 `when` 特异性与加载顺序裁决，首个命中执行并阻断传播。
    *来源*：[Key Bindings Precedence Rules](https://code.visualstudio.com/docs/configure/keybindings#_keyboard-rules)

---

## 方案

### 1. 单一命令注册表（`app/utils/workbench/commands.ts`）

在主应用基础设施层建立集中式 `CommandRegistry`。描述符在 09-14 草案基础上扩充两类字段：**对外 agent 消费**（`description`、`argsSchema`、`expose`）与**结果合同**。

```ts
/** 命令元数据与描述符 */
export interface CommandDescriptor<TArgs = unknown, TResult = unknown> {
    /** 全局唯一稳定标识符，三段式命名空间：nbook.<domain>.<action> */
    id: string;
    /** i18n 标题键名（人类投影：面板、菜单、快捷键回显） */
    titleKey: string;
    /** locale 无关的语义描述（agent 投影：工具定义描述；命令面板次要展示） */
    description: string;
    /** 可选 i18n 分类键名（如 "workbench.category.view"） */
    categoryKey?: string;
    /** 可选图标样式 token / class */
    icon?: string;
    /** 可选参数 schema（JSON Schema / TypeBox）：面板输入校验与 agent 参数校验共用同一来源 */
    argsSchema?: TSchema;
    /** 核心执行函数，支持同步与异步返回 */
    run: (args?: TArgs) => TResult | Promise<TResult>;
    /**
     * 声明式可见与可用谓词；复用 descriptors.ts 的 WhenPredicate 形态。
     * when 引用的键必须来自登记表（注册期校验）；不满足时面板隐藏、快捷键不响应。
     */
    when?: WhenPredicate;
    /** 默认绑定的全局快捷键（如 "Ctrl+Shift+P"） */
    defaultKeybinding?: string;
    /** 来源标记：内置核心为 "builtin"，将来扩展为扩展 ID */
    source?: "builtin" | string;
    /** 对外 agent 暴露策略；见方案 6。默认：human 可见、agent 不可见 */
    expose?: {
        /** 人类界面可见性，默认 true；人类面隐藏用它，不再单设 internal 字段 */
        human?: boolean;
        /** agent 面可见性，默认 "never"（显式 opt-in） */
        agent?: "never" | "confirm" | "auto";
        /** 语义标注（MCP annotations 风格），供 agent 推理与确认提示生成 */
        hints?: {
            readOnly?: boolean;
            destructive?: boolean;
            idempotent?: boolean;
        };
    };
}
```

**注册表接口**（与草案一致，补充别名与审计钩子）：

```ts
export interface ICommandRegistry {
    registerCommand<TArgs, TResult>(descriptor: CommandDescriptor<TArgs, TResult>): IDisposable;
    /** 注册别名：桌面契约等既有 id 映射到标准命令（见方案 2） */
    registerCommandAlias(alias: string, targetId: string): IDisposable;
    getCommand(id: string): CommandDescriptor | undefined;
    getAllCommands(): readonly CommandDescriptor[];
    /** 执行命令；返回结构化结果（成功值 / 失败原因分类） */
    executeCommand<TResult = unknown>(id: string, ...args: unknown[]): Promise<TResult>;
    isCommandEnabled(id: string): boolean;
    /** 审计钩子：每次执行记录 source / id / args / 结果 / 耗时（见方案 6） */
    onDidExecuteCommand(listener: (event: CommandExecutionEvent) => void): IDisposable;
}
```

- **幂等与防冲突规则**：重复注册同引用返回既有句柄；不同引用但同 `id`——开发环境抛错 `Error: Command '${id}' is already registered`，生产环境记录结构化错误并拒绝覆盖。
- **执行管线**：白名单（未注册 id 拒绝）+ 参数校验 + 错误边界（统一捕获，不崩溃）+ 结果合同 + 审计钩子。

### 2. 具名入口统一与组件通道

**具名可发现动作统一走命令**（09-18 收窄，取代草案「所有交互入口」的表述）：

1. **活动栏**：`WorkbenchActivityItem` 扩充 `commandId` 与可选静态 `commandArgs`（保留 `id` / `disabled`）；`NovelIdeActivityBar.vue` 点击分发命令，替代 10 种硬编码 emit。
2. **标题栏菜单**：`DesktopMenuCommandId` 15 个 id 作为**别名**接入标准命令（`registerCommandAlias`）——不保留双轨；`DesktopTitleBarChrome.vue` 菜单项声明 `commandId`，标题、快捷键回显与可用性由注册表提供。
3. **右键菜单与面板动作**：`ContextMenuItem` 增加 `command?: string` 与 `commandArgs?: unknown`；面板关闭 / 移动等动作改发命令。
4. **控件手势不伪装成命令**：sash 拖拽、tab 点击、展开箭头等直接调 store / 域服务；与命令殊途同归到同一个状态变更（“订阅者看 store，不看命令”）。

**组件通道形态**（09-18 确认，与 `docs/standards/code/components.md` 的哲学对齐）：

- **纯组件不参与命令系统**——与“大部分组件不自己调用 API”同理；命令是**域 / 宿主层**概念。
- 组件产生外部影响时：① emit 语义化意图（宿主执行命令），或 ② 使用宿主通过 props 注入的命令端口（可替换入口）。两种都不让组件直接触碰全局注册表。
- 组件“响应命令”多数通过状态：命令 → 域服务 / store 变化 → 组件响应；少数「当前实例」语义的命令（如“格式化当前编辑器”）由宿主路由到活动实例。
- **组件文档命令契约**：参与命令的组件在组件文档声明——**发出**（命令 id + 参数 + 通道）、**响应**（参与的语义）、**状态暴露**（供感知面读取的状态，预留）。

### 3. 与 Descriptor 模型的编译机制

在 `workbench-view-host.md` 的 `ViewDescriptor` 体系下，视图 / 容器不自带私有隐藏通道，统一由外壳编译为标准命令：

- 当 `ViewDescriptor`（如 `id: "nbook.files"`）注册到 `WorkbenchRegistry` 时，自动派生并注册：
  1. `nbook.view.toggle.<view.id>`：切换显示 / 隐藏（继承视图 `titleKey`、`when`、`requiredAuthority`）；
  2. `nbook.view.focus.<view.id>`：激活并聚焦。
- `requiredAuthority` 与 `when` 直接编译进派生命令的求值链，保持视图可见性与命令可用性一致。

### 4. 命令面板与 Quick Open（Lab 先行，nb-ui 驱动）

1. **底层原语复用**：浮层容器用 nb-ui `DialogWindow` / `Popover`；结果列表复用 `Combobox` / `Listbox` 的键盘导航与焦点管理；高亮复用 `option-highlight.ts` 的 `highlightMatch`。
2. **双模路由**：`Ctrl+P` 默认模式；`Ctrl+Shift+P` 命令模式（输入框以 `>` 起始，列出满足 `when` 的命令，按 `category` 分组）。第一版默认模式匹配的工作区实体集见待决策点 6。
3. **模糊匹配与 MRU**：内存 LRU 账本记录最近执行的命令 ID 与时间戳；评分 = 字符连续匹配分 + 前缀命中分 + MRU 衰减权重。持久化按 Storage 规范（≤30 条、user 归属，见影响章节）。
4. **Lab 先行**：先在 Component Lab 构建 `CommandPalette` / `QuickOpen` fixture 完成四主题与键盘交互验收，再接入主页面。

### 5. 集中式快捷键映射表（Keymap）派生与分发

1. **派生注册**：收集所有声明 `defaultKeybinding` 的描述符，构建单例 `KeymapManager`。
2. **统一监听**：全局 `window` 单一键盘事件处理器。
3. **上下文感知求值**：按键触发时按序——匹配键位组合 → 求值候选命令的 `when` → 唯一有效者 `executeCommand` 并 `preventDefault` → 多冲突项按裁决规则处理（见待决策点 3）。
4. **收拢节奏**：第一版覆盖应用级快捷键（保存、面板、编辑器域动作）；控件局部按键（Dialog Escape、TipTap 内部、tablist 导航）保持在组件内，不进 Keymap。

### 6. 对外 agent 暴露策略（Live 操作面的安全与信任设计）

外部通用 agent 经绑定触达命令面时，注册表必须回答三个问题：哪些命令可以暴露、暴露后如何约束、执行如何留痕。设计如下（2026-09-18）：

**默认关闭，显式开放**。`expose.agent` 默认 `"never"`：新命令默认不进 agent 面，由命令所有者逐条声明开放。理由：

- 外部 agent 是新消费者，安全边界取保守；开放面应是精选子集（域动作与稳定的界面动作），不是全部 UI 细节命令；
- 与 MCP 工具声明惯例一致——工具是显式列举的清单，不是“全部可执行动作”；
- 强制每个命令所有者思考“agent 执行它意味着什么”。

**三级暴露**：

| 级别 | 含义 | 典型 |
|---|---|---|
| `never`（默认） | agent 面不可见、不可调用 | 调试命令、内部组合命令、UI 细节动作 |
| `confirm` | 可调用，但每次执行需用户在界面确认 | 破坏性、覆盖性、批量类 |
| `auto` | 可直接执行 | 读类、幂等、安全类（打开视图、切换主题） |

**语义标注（hints，MCP annotations 风格）**：`readOnly` / `destructive` / `idempotent`——供 agent 推理与确认提示生成；`destructive: true` 的命令强制不低于 `confirm` 档。

**只读模式联动**：复用 NeuroBook 既有 agent 模式语义（discuss / plan 为只读、写操作需审批）——只读模式下 `destructive` 与写类命令直接拒绝，返回结构化原因；保证模式语义在所有执行面上一致。

**审计**：执行管线钩子记录 `source`（`user` / `agent:<绑定与会话标识>`）、命令 id、参数、结果、耗时。审计不是普通日志，是后续绑定与信任模型的判据。

**结果合同**：对 agent 的调用返回结构化结果——成功值 / 失败原因分类（未知命令、`when` 不满足、参数校验失败、执行错误、被拒绝 / 未确认），不依赖 UI Toast。

**确认流**（设计预留）：`confirm` 命令被 agent 调用时，界面呈现确认对话框（命令标题、参数、发起者）；用户批准后执行，结果回传调用方。Live 模式的意义之一正是：用户在场，确认天然可用。

**桥与绑定不在本提案**：server ↔ frontend 通道与 CLI / MCP / Skill 的具体形态另行设计；本提案只要求描述符可枚举、可导出（描述符即工具定义的形状：稳定 id、`description`、`argsSchema`、hints）。

### 7. 精细度原则（设计准则）

精细度不是单一维度，“越细越好”不成立。按下表分层：

| 层 | 内容 | 规则 |
|---|---|---|
| **L1 命令层（意图级）** | 用户 / agent 可发现、可命名的动作 | 判断三问：能进命令面板被搜索吗？会被 ≥2 个触发面引用吗？需要 `when` 条件吗？变化维度用参数承载（`nbook.theme.set(themeId)` 而非每个主题一条命令） |
| **L2 域操作层（能力级）** | 原子编辑、文件操作、领域动作 | 命令的 `run` 调用它；agent 的细粒度操作（“插入一段文本”＝一次可撤销的原子编辑）也走它，**不经过命令** |
| **L3 内部状态层** | 光标位置、滚动偏移、hover、DOM 状态 | 不进公开面（感知面按只读快照另行设计） |

**红线**：击键、滚动、拖拽中间态等高频流不进命令管线。“每次输入＝命令”在四个维度都不成立——频率（管线常数开销）、语义（命令是可取名单元，击键没有名字）、审计（执行日志变成击键日志）、确认粒度（命令是确认的最小单元）。细粒度操作的正确落点是 L2。

**性能边界**：命令数量不是性能问题（几百至几千条，内存模糊匹配与排序均可即时）；真正的关注点是 ① 执行管线的常数开销（对意图频率无感，对高频流不可接受）与 ② `when` 求值时机——推送式 context key（状态变化时更新字典），面板打开时求值一次“此刻可用集”，不做每帧轮询。

### 8. 感知面边界（预留）

- **概念**：外部 agent 的“读取”通道；与命令面构成 Live 操作面的两半。
- **第一批键来源**：现有 `when.requires`（`project` / `selection` / `desktop` 等）提炼为具名 context key 字典——命令与感知共用同登记表与求值器。
- **后续扩展**（另行设计，不在本提案）：组件状态、应用状态、DOM、截图等读工具。
- 本提案只保证：命令系统落地时，上下文键的命名与求值不造第二套真相源。

---

## 备选方案与取舍

| 维度 / 取舍项 | 备选方案 A | 备选方案 B | 选用方案与决策理由 |
|---|---|---|---|
| **命令注册模式** | **单一全局注册表（CommandRegistry）** | 散落的全局事件总线（EventBus / mitt） | **选用 A**。事件总线只有通知、无集中账本，无法枚举已存在能力，无法构建命令面板、快捷键表与 agent 工具面；注册表具有单一真相源与自省能力。 |
| **状态与可见性判定** | **声明式 `when` 上下文谓词** | 命令自带动态闭包 `isEnabled: () => boolean` | **选用 A**。声明式结构允许静态解析、依赖订阅与统一调试（如 Inspect Context Keys），避免每帧执行未知闭包。 |
| **快速打开交互形态** | **单一 Quick Open 控件 + 前缀路由** | 两个独立弹窗组件 | **选用 A**。单控件双模降低认知成本，消除浮层与焦点管理的重复实现。 |
| **快捷键绑定方式** | **注册表集中派生 Keymap** | 组件内 `@keydown` | **选用 A**。组件内硬编码导致冲突失控；集中派生可开机校验，并为用户自定义按键留出唯一通道。 |
| **命令 ID 标识体系** | **点分小写字符串命名空间** | TypeScript 枚举 | **选用 A**。枚举无法支持动态派生（`nbook.view.toggle.<id>`）与配置反序列化。 |
| **视图操作归属** | **由注册表编译为标准命令** | 视图组件私有方法 | **选用 A**。消除私有旁路，获得可观测性与自动化测试覆盖。 |
| **对外暴露默认值** | **默认关闭 + 显式 opt-in**（选用） | 默认全量开放 / 默认 confirm | 外部 agent 是新消费者，保守边界优先；开放面应是精选子集；与 MCP 显式列举惯例一致。 |
| **细粒度操作归属** | **编辑 / 域操作层（L2）** | 击键级命令（每次输入＝命令） | **选用 A**。B 在频率、语义、审计、确认粒度四个维度均不成立（见方案 7）。 |

---

## 待决策点（需开发者拍板）

2026-09-19 落定：第 1、2、3、5 项已决（见决策记录）；第 4、6、7 项移出首批批次，保留待后续。

1. **命令 ID 命名空间**：建议全面三段式 `nbook.<domain>.<action>`，桌面契约 15 个 id 以 `registerCommandAlias` 兼容（2026-09-15 调研建议，倾向采纳）——待确认。
2. **`when` 上下文键驱动源**：建议混合——具名键登记表（`when` 只引用登记键，注册期校验）+ store computed 派生 + provide 作用域（2026-09-15 调研建议，倾向采纳）——待确认。
3. **快捷键冲突裁决**：选项 1 严格阻断（开发期报错，强制收窄 `when`；建议）vs 选项 2 特异性评分（`when` 条件项多者优先，相等时后注册优先）。
4. **插件与扩展命名空间**：第一版是否只允许核心前缀注册、以 `source` 字段预留扩展 id（建议）vs 开放 `<publisher>.<ext>.<action>`。
5. **审计粒度**：执行钩子 + 开发环境日志（建议，常驻内存队列后置到绑定阶段）vs 常驻内存队列（最近 100 条，供排查与宏重放）。
6. **命令面板默认模式（`Ctrl+P`）第一版匹配的实体集**：工作区文档 / 章节、最近编辑、角色卡等——范围越窄落地越快。
7. **两种模式的动作集关系**：统一命名空间与描述符形状、注册表实现独立（建议）vs 更强统一（单一注册表同时服务 Headless 与 Live）。

---

## 数据、接口、安全、迁移、发布与回滚影响

### 1. 数据与持久化影响

- **命令注册与执行**：保留在内存；本提案不规定持久化介质或数据库变更。
- **命令面板 MRU**：只存最近使用的命令 ID 数组，最多 30 条，由命令宿主按 [Storage 架构规范](../specs/storage/boundaries.md) 接入逻辑键（建议 user 归属）；读取时校验数组与已注册命令引用，显示可回退为空；按 [storage.persistence](../specs/storage/persistence.md) 区分损坏、未知版本与读取失败，临时缺失或显示回退不得自动重写原记录。
- **审计事件**：是否常驻见待决策点 5；无论何种形态，审计数据不写入领域 Store。

### 2. 接口变动

- **新增核心接口**：`app/utils/workbench/commands.ts`（`CommandRegistry`、`useCommands()`、`executeCommand()`、`registerCommand()`、`registerCommandAlias()`）。
- **现有组件清理**：
  - `DesktopTitleBarChrome.vue`：菜单项改为消费 `commandId`；
  - `NovelIdeActivityBar.vue`：废弃 10 个 switch 派发 emit，改命令分发；
  - `ContextMenu.vue`：`ContextMenuItem` 扩充 `command?` / `commandArgs?`。
- **标准与 Lab 扩展**：`docs/standards/code/components.md` 命令契约节；`app/component-lab/` 命令调试 tab（命令清单 + `when` 求值 + 执行日志 + context keys 字典）。

### 3. 安全考量

- **执行白名单**：`executeCommand(id)` 仅允许已注册命令；未注册字符串拒绝并报错。
- **参数校验**：`commandArgs` 在进入 `run` 前按 `argsSchema` 校验，不轻信外部输入。
- **对外暴露策略**（核心新增）：默认关闭 + 三级 + hints + 只读联动 + 审计（见方案 6）。外部 agent 的操作权限与用户操作权限**不等价**——开放面是显式子集，且破坏性操作需确认。

### 4. 渐进式迁移策略

- **阶段 1（底座与入口统一，行为等价）**：注册表 + 描述符 + `when` + 执行管线实现与单测；活动栏、标题栏、右键菜单改命令分发；验收标准——既有交互与快捷键行为 100% 一致，无新增用户可见界面。
- **阶段 2（交互层与调试配套）**：Lab fixture 构建 `CommandPalette` / `QuickOpen`（四主题 + 键盘验收）→ 主页面接入；最小 Keymap；Lab 命令 tab；组件文档命令契约。验收标准——`Ctrl+P` / `Ctrl+Shift+P` 稳定唤出并执行。
- **阶段 3（另行立项）**：感知面、CLI / MCP / Skill 绑定、Headless 模式。
- 每阶段独立验收、独立回滚；阶段 1 回滚即恢复入口组件的原分发点。

### 5. 发布与回滚

- 变更向后兼容；阶段 1、2 不触碰数据存储与服务端契约。
- 出现异常时按阶段回滚：入口组件单一调用点可快速恢复既有 emit / bridge 闭包。

---

## 对 Spec 的预期改动

随着本提案进入评审并获批，将在 `docs/specs/` 规划登记：

- **目标 Capability**：`workbench.commands`（注册、查找、执行、生命周期、暴露策略与审计）与 `workbench.quick-open`（快速打开与命令面板交互）。
- **预留（不属本提案）**：`workbench.observation`（感知面）；外部绑定（CLI / MCP / Skill）。
- **输入**：命令定义（id、标题、描述、schema、`when`、按键、暴露策略）；触发输入（点击、按键、代码 API、面板输入、外部 agent 调用）。
- **输出**：结构化执行结果；面板高亮列表；可用性状态；审计事件。
- **状态**：注册集合；当前 context keys 字典；面板开闭与检索前缀。
- **副作用**：命令关联的业务状态变更；MRU 偏好写入；（agent 场景）审计事件。
- **失败与恢复**：未知命令 → `CommandNotFoundError`；执行错误被错误边界捕获（结构化返回 + 全局提示，不崩溃）；`when` 不满足 → 拒绝并说明原因（agent 场景返回结构化原因，而非静默忽略）。
- **验收与 Smoke 标准**：幂等注册与重复拦截单测；`when` 聚焦 / 失焦判定；Lab 真实浏览器验证 `Ctrl+Shift+P` 呼出、键盘移动、回车执行；暴露策略单测（默认 never、destructive 降级、只读模式拒绝）。

---

## 决策记录

- **2026-09-14**：初始提案起草（`draft`）。整理 10 项交互入口与快捷键分散的取证事实，完成类 VS Code 命令系统 12 项机制对照，提出单一注册表、入口统一、Descriptor 编译、命令面板与集中快捷键派生方案，提炼 5 项待决策点。
- **2026-09-15**：VS Code 对照调研完成（w00003 research），提出三处修正建议——①「所有交互入口改造」收窄为「具名可发现动作 = 命令，控件手势 ≠ 命令」；② 待决策 1 采用三段式 + `registerCommandAlias` 别名；③ 待决策 2 采用混合 context key（登记表 + computed 派生 + provide 作用域）。
- **2026-09-18**：需求讨论修订并采纳——
  - 定位升级：命令系统是**外部通用 agent 的 Live 操作面底座**（非内置 Leader 专属）；确立 Headless / Live 双模式与「操作面 = 命令面 + 感知面」术语；记录 `nbook` CLI / TUI 愿景（用户也可直接使用），本次不做 Headless。
  - 范围确认：命令面板纳入本次；纯组件不参与命令系统（同“组件不自己调 API”）；对外暴露策略由本 Work 设计（默认关闭 + 三级 + hints + 审计 + 只读联动）。
  - 设计新增：精细度三层模型与高频流红线；组件通道形态与组件文档命令契约；Lab 命令调试 tab。
  - 非目标固化：感知面实现（读工具 / DOM / 截图）、CLI / MCP / Skill 绑定另行设计。
  - 采纳 2026-09-15 三处修正；取证表按 2026-09-18 复核刷新。
- **2026-09-19**：范围收敛并批准分批实施（w00016）。首批交付限定为机制底座 + 真实 `CodeEditorView` 样板 + Component Lab 的 S4 命令面板（`>` 命令与 `:` 行号，`Ctrl/Cmd+Shift+P`）；`@` 符号导航、`Ctrl/Cmd+P` 文件综合搜索、入口迁移（活动栏/标题栏/桌面 15 别名接线/右键菜单）、视图派生命令与 MRU 持久化移出本批。待决策点落定：1、2 采纳既有建议；3 取严格规则——同一规范化键位两环境均不启用后来的绑定、报告一次、原持有者释放后重建；5 取执行钩子 + 宿主一次性呈现，不建常驻内存队列；4、6、7 留待后续批次。两规范原位收窄为 [`commands.md`](../specs/workbench/commands.md) 与 [`quick-open.md`](../specs/workbench/quick-open.md)。

---

## 参考资料

- 仓库内相关代码与文档：
  - 活动栏与分发：`packages/neuro-book/app/utils/workbench-chrome.ts`、`packages/neuro-book/app/components/novel-ide/NovelIdeActivityBar.vue`
  - 标题栏与桌面菜单契约：`packages/neuro-book/app/components/common/DesktopTitleBarChrome.vue`、`DesktopTitleBar.vue`、`packages/neuro-book-contracts/src/desktop-menu-command.ts`
  - 视图描述符与求值：`packages/neuro-book/app/utils/workbench/descriptors.ts`
  - Agent 工具面形态参照：`packages/neuro-book/server/agent/tools/`（TypeBox schema + `defineAgentTool` + approval）
  - 组件标准与 Lab：`docs/standards/code/components.md`、`packages/neuro-book/app/component-lab/`
  - 关联提案：`packages/neuro-book/docs/proposals/workbench-view-host.md`
  - 对照调研：`.agents/works/w00003-neurobook-ui-foundation-migration/research/2026-09-15-storage-layer-and-commands-vscode-comparison.md`
- VS Code 官方文档（见「VS Code 机制对照要点」内联来源）：Commands / Contribution Points / When Clause Contexts / Key Bindings / Quick Open。
- MCP 工具与 annotations（`readOnlyHint` / `destructiveHint` / `idempotentHint`）与 VS Code Language Model Tools 的「工具显式声明」惯例——外部 agent 暴露策略的形态参照。
