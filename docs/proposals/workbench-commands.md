# Workbench 命令系统与单一注册表提案

- **状态**：draft（2026-09-14 起草，待架构评审与开发者决策）
- **对应 Issue**：[#192 建立类 VS Code 的 Workbench 与 View Host 抽象](https://github.com/notnotype/neuro-book/issues/192)（硬前置 #191 主应用 nb-ui 底座迁移）
- **相关提案**：[`workbench-view-host.md`](../../packages/neuro-book/docs/proposals/workbench-view-host.md)（Workbench 与 View Host 抽象，状态 `accepted`）

---

## 问题

NeuroBook 的产品界面目前缺乏统一的命令（Command）抽象与注册表（Registry）。用户界面的各种交互入口——活动栏条目、桌面标题栏菜单、设置面板动作、对话框按钮、右键菜单以及键盘快捷键——均由各组件以私有事件、内联闭包或手工分发的形式各自实现。

这种割裂的现状导致了以下系统性问题：

1. **入口与行为强耦合**：UI 部件直接持有操作的具体实现逻辑（闭包或私有方法），无法在不修改组件源码的情况下从外部触发、重组或挂载已有动作。
2. **快捷键无法统一配置与分发**：键盘事件散落在各个业务组件的 `@keydown` 处理器中，缺少全局快捷键注册表（Keymap），无法集中检测快捷键冲突、无法派生快捷键速查表，更无法支持快捷键的用户级自定义。
3. **命令面板（Command Palette）与快速打开（Quick Open）无法落地**：由于系统不知道“当前存在哪些可用命令”、“这些命令由谁处理”、“它们在何种条件下有效”，导致类 VS Code 的快速打开与全局命令面板只能停留在占位文案阶段，缺少数据支撑。
4. **可见性与可执行性缺乏声明式表达**：动作在特定上下文（如无打开项目、正在运行 Agent、非只读模式等）下的禁用/隐藏判断缺乏类似 VS Code 的 `when` 上下文机制，依赖各组件内各自手写的 `v-if` 或 `disabled` 响应式逻辑，规则分散且不可维护。
5. **审计与可观测性缺失**：无法在单一通道拦截命令的调用生命周期（调用方、参数、执行结果、耗时、错误），导致用户操作流难以追踪与回溯。

---

## 目标与非目标

### 目标

1. **建立单一命令注册表（`app/utils/workbench/commands.ts`）**：
   - 命令成为系统一等公民，拥有全局唯一的字符串 `id`、i18n 标题键 `titleKey`、分类键 `categoryKey`、执行处理器 `run(args)`、声明式可见性与可用性谓词 `when`、默认快捷键 `defaultKeybinding` 以及来源标识 `source`（如 `builtin`）。
   - 实现严格的生命周期管理：支持幂等注册；在开发环境下检测到重复 `id` 注册时直接抛错拦截，防止隐式覆盖。
2. **所有 UI 交互入口统一改为发送命令 ID**：
   - 活动栏（Activity Bar）、桌面标题栏菜单、面板标签栏（Tab）、右键菜单（Context Menu）、全局快捷键、命令面板等入口一律解耦为声明式引用 `commandId`，统一走 `executeCommand(id, ...args)` 派发。
3. **与 View Host descriptor 模型深度对齐**：
   - 将视图与容器的标准操作（如 `workbench.view.toggle.${viewId}`、`workbench.view.move.${viewId}`、`factoryKey` 实例化、焦点切换等）编译/派生为标准命令，消除视图与容器内部的私有动作通道。
4. **构建命令面板与快速打开交互（nb-ui 原语驱动，Lab 先行）**：
   - 基于 nb-ui 现有原语（`Combobox`、`Listbox`、`DialogWindow`、`option-highlight.ts` 等）构建命令面板 UI。
   - 提供双模路由：`Ctrl+P` 进入快速打开模式（文件/符号检索），`Ctrl+Shift+P` 进入 `>` 前缀命令模式，支持字符模糊匹配、高亮与最近使用（MRU）加权排序。
5. **集中派生快捷键映射表（Keymap）**：
   - 快捷键绑定关系声明在命令注册表中，由注册表集中派生出全局 Keymap；消灭组件内散落内联的按键判定，统一根据当前全局/焦点 Context Keys 字典求值 `when` 谓词。

### 非目标（第一版明确不做）

1. **开放 L3 第三方不可信代码沙箱**：第一版仅支持 L1 内置模块与将来的 L2 声明式配置，不引入沙箱隔离、代码签名或运行时动态安装机制。
2. **复杂的动态多步骤 QuickInput 向导**：第一版 Quick Open 专注于单层选择、过滤与执行，不实现带前进/后退、多输入框链条的向导原语。
3. **用户自定义快捷键 UI 编辑器**：第一版确立声明式 Keymap 集中派生与分发机制，用户自定义按键覆盖与持久化配置界面留待后续阶段。
4. **引入沉重的外部命令框架**：不引入复杂状态机库，保持零额外第三方依赖，使用现代 TypeScript 与 Vue 响应式生态原生实现。

---

## 当前行为与证据

### 1. 仓库现状取证（事实记录）

基于 worktree `refactor/w00003-nb-ui-adoption` 的只读取证，当前交互与命令逻辑的分散现状如下：

| # | 交互入口 / 位置 | 代码位置（文件:行） | 现状事实与耦合方式 |
|---|---|---|---|
| 1 | **活动栏条目** | `app/utils/workbench-chrome.ts:12-38`、`:61-88`<br>`app/components/novel-ide/NovelIdeActivityBar.vue:100-118` | 条目仅为静态枚举 `WorkbenchActivityItemId`；`NovelIdeActivityBar.vue` 内的 `invoke()` 对条目 ID 进行 **switch 手工分发**，向外抛出 8 种硬编码 emit 事件（`open-home`、`open-tab`、`open-settings` 等），无统一执行机制。 |
| 2 | **标题栏菜单** | `app/components/common/DesktopTitleBarChrome.vue:19-22`、`:65-90`<br>`app/components/common/DesktopTitleBar.vue:17-20`、`:39-42` | **全仓当前唯一近似「命令 ID」的概念**：`TitleBarMenuItem` 使用来自 `@notnotype/neuro-book-contracts/desktop` 的 `DesktopMenuCommandId` 类型（如 `file.open`、`edit.undo`）。但其仅覆盖 Electron 桌面桥菜单，与活动栏、设置动作、快捷键互不相通。 |
| 3 | **设置面板动作** | `app/components/novel-ide/NovelIdeSettingsDialog.vue:243-291`<br>`app/components/novel-ide/diff/DiffWorkbenchDialog.vue:22-37` | 动作用对话框内部事件与写入器闭包（`saveGlobal`、`saveProject`）承载；`DiffWorkbenchDialog` 自定义了局部 `{id, label, tone}` 动作数组，完全没有命令抽象与跨组件查找能力。 |
| 4 | **右键菜单** | `app/components/common/ContextMenu.vue:62-70`、`:111` | `ContextMenuItem` 结构包含 `{label, iconClass, shortcut?, action?: () => void}`；`:111` 点击时直接调用 `item.action?.()` 闭包。`shortcut` 仅用于文本展示，不具备真实按键捕获能力。 |
| 5 | **散落快捷键绑定** | `app/components/novel-ide/editor/TipTapMarkdownEditor.vue:1219-1221`<br>`app/components/novel-ide/editor/TipTapFrontmatterPanel.vue:74-78`<br>`app/components/common/Dialog.vue:211-215`<br>`app/components/novel-ide/agent/AgentComposerInput.vue:43`<br>`app/components/novel-ide/editor/MarkdownSourceEditor.vue:226-230` | 没有任何集中注册表。各组件在内联 `@keydown` 事件中私自拦截：`isSaveShortcut` 拦截 `Ctrl+S`、`Dialog.vue` 拦截 `Escape`、`AgentComposerInput.vue` 拦截 `Ctrl/Cmd+Enter`、源码编辑器拦截 `Ctrl+滚轮`。按键与命令 ID 无任何关联。 |
| 6 | **命令面板占位** | `app/components/workbench-spike/WorkbenchEditorSurface.vue:36` | 仅存在占位 UI 文案：“Ctrl+P 快速打开 · Ctrl+Shift+P 命令面板”。代码库内**无任何对应的组件实现或底层逻辑**。 |
| 7 | **输入触发的浮层** | `app/components/novel-ide/agent/tiptap/agent-suggestion.ts`<br>`app/components/common/form/ReferencePlainTextEditor.vue:104-114`<br>`app/components/common/form/ReferenceSelectorPopover.vue` | 基于 TipTap Suggestion 实现了输入 `@` 或 `/` 触发的分段候选列表浮层。属富文本内补全原语，非全局性快速打开或命令面板。 |
| 8 | **既有类注册表设计** | `app/utils/workbench/descriptors.ts:163-200`、`:226-283`<br>`app/composables/useWorkbenchChrome.ts:10-23` | `descriptors.ts` 实现了 `WorkbenchRegistry`，包含 `when.requires`（`project`/`selection`/`desktop` 等）和 `requiredAuthority` 的结构化求值逻辑；`useWorkbenchChrome.ts` 维护了页面级 Chrome 回调闭包。两者形态接近 VS Code 规范，但管控对象是**视图和页面**，均无「命令」实体。 |
| 9 | **视图描述符字段缺位** | `app/utils/workbench/descriptors.ts:283-300` | `ViewDescriptor` 拥有 `factoryKey`、`when`、`requiredAuthority`、`canMoveView` 等字段，但没有关联命令，无法被命令系统统一索引、激活或隐藏。 |
| 10 | **nb-ui 基础原语** | `packages/nb-ui/src/components/form/Combobox.vue`（`index.ts:51`）<br>`packages/nb-ui/src/components/form/option-highlight.ts:1-4`<br>`packages/nb-ui/src/components/navigation/`（`Dropdown`、`Menubar`、`ContextMenu`）<br>`packages/nb-ui/src/components/feedback/DialogWindow.vue` | 共享组件库已有高完整度的键盘导航输入框、弹出层、列表与字符匹配高亮算法（`option-highlight.ts` 已被 Combobox 复用），具备组装命令面板的核心原料，但未封装专用 QuickPick/CommandPalette 组件。 |

---

### 2. VS Code 机制对照要点（机制与官方来源）

VS Code 的命令与交互系统经过长期演进，形成了一套工业级的解耦模式。以下梳理 12 项核心机制（控制在 10–15 条区间内），作为本提案方案设计的架构参照：

1. **命令单一身份（Command as Unique Identity）**：
   命令由唯一字符串 ID 与处理函数（Handler）绑定。在插件运行时通过 `vscode.commands.registerCommand(id, handler)` 绑定；在 `package.json` 的 `contributes.commands` 中声明元数据（`title`、`category`、`icon` 等）。声明即可被系统发现并懒加载激活插件。
   *来源*：[VS Code Command Guide](https://code.visualstudio.com/api/extension-guides/command) 及 [Contribution Points: Commands](https://code.visualstudio.com/api/references/contribution-points#contributes.commands)
2. **Quick Open 与命令面板共用同一控件**：
   VS Code 中 `Ctrl+Shift+P`（命令面板）与 `Ctrl+P`（快速打开文件）本质上是同一个 Quick Open 控件的不同模式。打开命令面板相当于打开 Quick Open 并预填 `>` 前缀字符；通过切换前缀，同一交互通道能无缝路由到不同领域。
   *来源*：[Tips and Tricks: Quick Open](https://code.visualstudio.com/docs/editing/tips-and-tricks#_quick-open)
3. **前缀路由机制（Prefix Routing）**：
   Quick Open 通过输入框首字符进行功能路由：`>` 路由到命令列表；`:` 路由到行号跳转；`@` 路由到当前文件符号；`@:` 路由到按类别分组的符号；`#` 路由到工作区全局符号；`?` 列出当前全部可用前缀帮助。
   *来源*：[Tips and Tricks: Quick Open](https://code.visualstudio.com/docs/editing/tips-and-tricks#_quick-open)
4. **模糊匹配与最近使用（Fuzzy Match & MRU）**：
   Quick Open 控件内置高性能子序列模糊匹配算法与高亮机制；在检索结果中优先根据最近使用历史（MRU, Most Recently Used）与使用频次加权提升显示次序，优化高频操作效率。
   *来源*：[VS Code User Interface](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) 与 [QuickPick API](https://code.visualstudio.com/api/references/vscode-api#QuickPick)
5. **同一命令 ID 多处复用（Multiple Triggers, Single Command）**：
   快捷键映射 `contributes.keybindings`（键位 + `command` + `when`）、菜单挂载 `contributes.menus`（菜单位置 + `command` + `when` + `group`）以及代码中 `executeCommand(id, ...args)` 均引用同一个命令 ID。菜单项、工具栏按钮、右键菜单和快捷键只是同一命令在不同场景的触发面。
   *来源*：[Contribution Points: Keybindings & Menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
6. **声明式 `when` 上下文键（Context Keys）**：
   使用布尔表达式或比较谓词控制命令在菜单、快捷键与面板中的可见性（Visibility）与启用状态（Enablement）。内置上下文键如 `editorTextFocus`、`inQuickOpen`、`isMac` 等；代码可通过 `setContext` 动态写入自定义上下文键。
   *来源*：[When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
7. **命令支持入参与返回值**：
   `vscode.commands.executeCommand(id, ...args)` 允许向 handler 传递任意参数并获取 `Thenable<T>` 返回值；菜单与快捷键的声明式配置中同样支持定义静态 `args` 字典，使得一个通用命令可被多个特化触发器复用。
   *来源*：[Commands API](https://code.visualstudio.com/api/references/commands)
8. **QuickInput 程序化原语**：
   VS Code 提供了 `window.showQuickPick`（简单列表选择）与 `window.createQuickPick` / `createInputBox`（底层受控对象）两层 API，支持异步项加载、自定义操作按钮、多步流程切换与焦点控制。
   *来源*：[QuickInput API](https://code.visualstudio.com/api/references/vscode-api#QuickInput)
9. **QuickInput 内部按键同样注册为命令**：
   QuickInput 控件内部的键盘行为（如 `quickInput.accept` 确认、`quickInput.next` 下一项）并非在 DOM 上硬编码，而是作为系统命令注册，其 `when` 条件为 `inQuickOpen && quickInputType == 'quickPick'`。保持了交互模型与按键分发的一致性。
   *来源*：[VS Code Key Bindings Reference](https://code.visualstudio.com/docs/configure/keybindings#_default-keyboard-shortcuts)
10. **上下文键可实时检视与调试**：
    提供内置命令 `Developer: Inspect Context Keys`，允许开发者在运行时点击任意 UI 部件查看当前活动的 Context Keys 字典及其布尔值，为排查 `when` 条件提供了确定性的诊断手段。
    *来源*：[When Clause Contexts: Inspect Context Keys](https://code.visualstudio.com/api/references/when-clause-contexts#_inspect-context-keys-utility)
11. **菜单贡献点与分组排序（Menus & Groups）**：
    菜单项通过将命令 ID 挂载至指定贡献位置（如 `commandPalette`、`view/title`、`editor/context`），并指定 `group` 字符串（如 `navigation@1`、`1_modification`）实现跨模块的确定性排序与分割线划分。
    *来源*：[Contribution Points: Menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
12. **快捷键优先级裁决规则（Keybinding Precedence）**：
    当按下按键时，系统检索所有绑定的规则，按优先级裁决：用户级覆盖 > 插件声明 > 系统默认；同层规则根据 `when` 条件的特异性与最后加载顺序判定，命中的第一个有效规则被执行并阻断传播。
    *来源*：[Key Bindings Precedence Rules](https://code.visualstudio.com/docs/configure/keybindings#_keyboard-rules)

---

## 方案

### 1. 单一命令注册表（`app/utils/workbench/commands.ts`）

在主应用的基础设施层建立集中式的 `CommandRegistry`：

```ts
/** 命令元数据与描述符 */
export interface CommandDescriptor<TArgs = unknown, TResult = unknown> {
    /** 全局唯一稳定标识符，点分命名空间：<namespace>.<domain>.<action> */
    id: string;
    /** i18n 标题键名，注册表只存 key，界面展示时动态解析 */
    titleKey: string;
    /** 可选 i18n 分类键名（如 "workbench.category.view"） */
    categoryKey?: string;
    /** 可选图标样式 token / class */
    icon?: string;
    /** 核心执行函数，支持同步与异步返回 */
    run: (args?: TArgs) => TResult | Promise<TResult>;
    /**
     * 声明式可见与可用谓词；复用 descriptors.ts 的 WhenPredicate
     * 当 when 不满足时，在命令面板中隐藏，快捷键不响应
     */
    when?: WhenPredicate;
    /** 默认绑定的全局快捷键（如 "Ctrl+Shift+P", "Alt+F"） */
    defaultKeybinding?: string;
    /** 来源标记：内置核心为 "builtin"，将来扩展为扩展 ID */
    source?: "builtin" | string;
    /** 是否在命令面板中排除（默认 false） */
    internal?: boolean;
}

/** 统一命令注册表接口 */
export interface ICommandRegistry {
    /** 注册命令；支持幂等处理；重复 id 在开发期抛错，生产期记录告警并拒绝覆盖 */
    registerCommand<TArgs, TResult>(descriptor: CommandDescriptor<TArgs, TResult>): IDisposable;
    /** 根据 ID 获取命令描述符 */
    getCommand(id: string): CommandDescriptor | undefined;
    /** 获取全部已注册命令列表 */
    getAllCommands(): readonly CommandDescriptor[];
    /** 执行命令，支持传参与拦截器 */
    executeCommand<TResult = unknown>(id: string, ...args: unknown[]): Promise<TResult>;
    /** 判断指定命令在当前上下文是否处于激活可用状态 */
    isCommandEnabled(id: string): boolean;
}
```

- **幂等与防冲突规则**：
  - 重复调用 `registerCommand` 时，若传入同一引用则直接返回既有销毁句柄。
  - 若传入不同引用但 `id` 相同：
    - `import.meta.dev`（开发环境）：直接抛出明确异常 `Error: Command '${id}' is already registered`，杜绝暗中覆盖；
    - 生产环境：记录结构化错误日志，忽略后来的注册，保持首创命令的稳定性。
  - 注册函数返回 `IDisposable`（`{ dispose: () => void }`），支持组件或模块生命周期卸载时安全回收。

### 2. 所有交互入口改造为发送命令 ID

解除各 UI 部件与具体业务动作之间的隐式闭包依赖：

1. **活动栏（Activity Bar）**：
   - 将 `WorkbenchActivityItem` 的类型重构为：
     ```ts
     export interface WorkbenchActivityItem {
         id: string;
         icon: string;
         titleKey: string;
         /** 点击时分发的命令 ID（取代 switch 硬编码事件） */
         commandId: string;
         /** 可选静态入参 */
         commandArgs?: unknown;
         /** 激活状态谓词或关联的容器 ID */
         targetContainerId?: string;
     }
     ```
   - `NovelIdeActivityBar.vue` 点击图标时，直接调用 `commands.executeCommand(item.commandId, item.commandArgs)`，消除原有的 8 种自定义 emit。
2. **桌面标题栏菜单（Titlebar Chrome）**：
   - 现有的 `DesktopMenuCommandId`（`@notnotype/neuro-book-contracts/desktop`）作为 `desktop.*` 命令子集，在初始化时自动向 `CommandRegistry` 批量注册对应的系统命令桥接。
   - `DesktopTitleBarChrome.vue` 中的菜单项仅声明引用的 `commandId`，由命令注册表提供标题解析、快捷键文本回显与可用性状态判定。
3. **右键菜单（Context Menu）与面板 Tab**：
   - `ContextMenuItem` 增加可选属性 `command?: string`，优先走命令分发；
   - 面板的关闭、最大化、分栏移动动作，均发命令（如 `workbench.action.closePanel`、`workbench.action.movePanel`）。

### 3. 与 Descriptor 模型的编译机制

在 `workbench-view-host.md` 确立的 `ViewDescriptor` 体系下，视图/容器不自带私有隐藏通道，统一由外壳编译为标准命令：

- **自动化命令派生**：
  当一个 `ViewDescriptor`（如 `id: "nbook.files"`）注册到 `WorkbenchRegistry` 时，系统自动在 `CommandRegistry` 派生并注册两条标准命令：
  1. `workbench.view.toggle.${view.id}`：切换该视图的显示/隐藏（绑定 `titleKey: view.titleKey`，继承视图的 `when` 与 `requiredAuthority`）；
  2. `workbench.view.focus.${view.id}`：激活并聚焦至该视图。
- **动作与权限映射**：
  视图 descriptor 的 `requiredAuthority` 与 `when` 直接编译进派生命令的 `when` 谓词求值链，保持视图可见性控制与命令系统的一致性。

### 4. 命令面板与 Quick Open（Lab 先行，nb-ui 驱动）

根据项目规范，命令面板组件不在主页面直接堆砌代码，而在 Component Lab（`app/component-lab/`）中先期实现成品并验收：

1. **底层原语复用**：
   - 浮层容器：使用 nb-ui `DialogWindow` 或 `Popover` 浮层宿主，居中置顶显示；
   - 结果列表：复用 nb-ui `Combobox` / `Listbox` 的无障碍键盘导航与焦点管理逻辑；
   - 文本高亮：复用 `packages/nb-ui/src/components/form/option-highlight.ts` 的 `highlightMatch` 算法，对命中片段进行视觉着色。
2. **双模路由设计**：
   - **快速打开（Quick Open，`Ctrl+P`）**：默认模式，输入内容实时匹配项目内文档、最近编辑章节、角色卡等工作区实体；
   - **命令模式（Command Palette，`Ctrl+Shift+P`）**：输入框自动以 `>` 起始，过滤并展示所有满足当前 `when` 条件的已注册命令，支持按 `category` 分组展示。
3. **模糊匹配与 MRU 排序**：
   - 建立轻量内存 LRU 账本，记录用户最近执行的命令 ID 与时间戳；
   - 匹配评分：`总分 = 字符连续匹配分 + 前缀命中分 + MRU 衰减权重`，确保高频命中命令排在前列。

### 5. 集中式快捷键映射表（Keymap）派生与分发

消灭组件内散落的 `@keydown` 处理器，实现集中调度：

1. **派生注册**：
   注册表收集所有声明了 `defaultKeybinding` 的 `CommandDescriptor`，构建单例 `KeymapManager`。
2. **统一事件监听**：
   在全局 `window` 上安装统一的捕获/冒泡键盘事件处理器。
3. **上下文感知求值**：
   当按键触发时（例如用户按下 `Ctrl+S`）：
   - `KeymapManager` 找到匹配该键位组合的所有命令；
   - 根据当前 DOM 焦点状态与上下文环境求值各个命令的 `when` 谓词；
   - 若命中唯一有效命令，立即调用 `commands.executeCommand(id)` 并调用 `event.preventDefault()` 阻止浏览器默认行为；
   - 若命中多个冲突项，按预定义的冲突裁决规则挑选最优者（见待决策点 3）。

---

## 备选方案与取舍

| 维度 / 取舍项 | 备选方案 A | 备选方案 B | 选用方案与决策理由 |
|---|---|---|---|
| **命令注册模式** | **单一全局注册表（CommandRegistry）** | 散落的全局事件总线（EventBus / mitt） | **选用 A**。事件总线只有通知、无集中账本，无法枚举已存在能力，无法构建命令面板与快捷键表；注册表具有单一真相源与自省能力。 |
| **状态与可见性判定** | **声明式 `when` 上下文谓词** | 命令自带动态闭包函数 `isEnabled: () => boolean` | **选用 A**。声明式 `when` 结构允许命令面板与快捷键系统进行静态解析、依赖订阅与统一调试（如 VS Code Inspect Context Keys），避免每帧无脑执行未知闭包。 |
| **快速打开交互形态** | **单一 Quick Open 控件 + 前缀路由（`>`）** | 两个独立的弹窗组件（CommandPalette.vue + FileSearch.vue） | **选用 A**。遵循 VS Code 经典验证设计，单控件双模降低用户认知成本，极大减少 UI 浮层和键盘焦点管理的重复实现。 |
| **快捷键绑定方式** | **由命令注册表集中派生 Keymap** | 在各业务组件内使用 `@keydown` 或 `useKeyModifier` | **选用 A**。组件内硬编码按键会导致键位冲突完全处于失控状态；集中派生可在开机时校验重复键位，为未来的用户自定义按键留出唯一通道。 |
| **命令 ID 标识体系** | **点分小写字符串命名空间（`nbook.edit.undo`）** | TypeScript 枚举类型（Enum） | **选用 A**。枚举属于编译期静态结构，无法支持插件化、动态派生（如 `workbench.view.toggle.${id}`）与配置反序列化；点分字符串兼具自解释性与扩展性。 |
| **视图操作归属** | **由注册表动态编译为标准命令** | 视图组件内部自留私有方法 | **选用 A**。消除任何私有调用旁路，所有影响系统外观与布局的操作都进入命令流水线，实现完备的可观测性与自动化测试覆盖。 |

---

## 待决策点（需开发者拍板）

以下 5 个关键架构取舍需开发者拍板确认，作为方案落地细化的依据：

1. **命令 ID 命名空间规范与现有桌面桥的映射方式**：
   - *选项 1*：全面统一采用三段式命名空间 `nbook.<domain>.<action>`（例如 `nbook.file.save`、`nbook.view.toggleFiles`）；桌面端既有的 `DesktopMenuCommandId`（如 `file.open`）通过别名映射表兼容。
   - *选项 2*：保留两段式 `domain.action`（例如 `file.save`、`view.toggle`），直接与既有桌面契约对齐。
2. **跨上下文 `when` 上下文键（Context Keys）的驱动源**：
   - *选项 1*：完全对齐 VS Code，维护独立的 `ContextKeyService`（存纯键值字典，组件显式 `setContext` 写入）；
   - *选项 2*：深度融入 Vue 3 响应式体系，`when` 上下文求值器直接读取系统响应式 Store 与 Composable 的状态计算属性（如 `isProjectOpen`、`isEditorFocused`）。
3. **快捷键冲突（Keybinding Conflict）裁决规则**：
   - 当多个命令绑定同一按键且 `when` 同时满足时：
   - *选项 1*：严格阻断——开发期控制台直接报错并拒绝后注册的快捷键生效，强制要求为命令收窄 `when` 范围；
   - *选项 2*：特异性评分——计算 `when` 表达式的条件项数量（项多者更特异，优先匹配），相等时后注册者优先。
4. **插件与扩展命令的隔离与鉴权**：
   - 第一版是否预留扩展命名空间（如 `<publisher>.<extName>.<action>`），是否限制非核心模块向 `workbench.*` 或 `nbook.*` 核心命名空间注册命令。
5. **命令审计日志与可观测性粒度**：
   - 命令执行历史（Command Execution Log）是否常驻内存队列（保留最近 100 条用于排查与宏重放），还是仅在 `import.meta.dev` 环境下通过 `console.debug` 打印。

---

## 数据、接口、安全、迁移、发布与回滚影响

### 1. 数据与持久化影响

- **无数据库变更**：命令系统本身为纯内存架构，不写入服务端配置或磁盘数据库。
- **本地存储（localStorage）轻量缓存**：
  - 命令面板的 MRU 历史记录缓存（仅存最近使用的命令 ID 数组，限制最多 30 条），键名遵循仓库持久化底座规范，写入专用键 `nbook.workbench.commands.mru.v1`。
  - 损坏值防御：读出时做数组与已注册命令存在性校验，非法值直接丢弃回退空数组。

### 2. 接口变动

- **新增核心接口**：
  - `app/utils/workbench/commands.ts`：导出 `CommandRegistry`、`useCommands()`、`executeCommand()`、`registerCommand()`。
- **现有组件 Props / Emits 清理**：
  - `DesktopTitleBarChrome.vue`：菜单项从依赖外部 bridge 回调改造为消费命令 ID；
  - `NovelIdeActivityBar.vue`：废弃原有 8 个 switch 派发的特定 emit，统一收拢为命令分发；
  - `ContextMenu.vue`：`ContextMenuItem` 结构扩充 `command?: string` 与 `commandArgs?: unknown`。

### 3. 安全考量

- **执行白名单防护**：`executeCommand(id)` 仅允许执行已在 `CommandRegistry` 显式注册的合法命令，任何未经注册的动态字符串均会被拒绝执行并报错，杜绝任意代码执行风险。
- **输入参数校验**：所有通过快捷键或外部菜单传入的 `commandArgs` 在进入 `run` 函数前由命令定义处的验证逻辑约束，不轻信外部输入。

### 4. 两步渐进式迁移策略

为确保系统稳定性，迁移工作划分为两个独立切片进行：

- **第一阶段（纯基础设施与入口重构，行为等价）**：
  1. 编写 `app/utils/workbench/commands.ts` 注册表实现与单元测试；
  2. 将活动栏（Activity Bar）、桌面标题栏菜单以及核心快捷键（如 `Ctrl+S`）注册至命令系统；
  3. 修改对应入口组件，将原来的私有分发改为调用 `executeCommand`；
  4. **验收标准**：所有既有界面交互与快捷键行为与重构前 100% 一致，无新增用户可见界面，零回归风险。
- **第二阶段（交互层构建与快捷键收拢）**：
  1. 在 Component Lab（`app/component-lab/`）中基于 nb-ui 原语构建 `CommandPalette` / `QuickOpen` 独立 Fixture 并完成四主题组合与键盘交互验收；
  2. 将 `CommandPalette` 装配至 Workbench Shell 顶层；
  3. 收拢散落在 TipTap 编辑器、对话框及各类 Input 内的内联按键逻辑至集中 Keymap；
  4. **验收标准**：用户按下 `Ctrl+P` 与 `Ctrl+Shift+P` 能稳定唤出弹窗并执行搜索与命令。

### 5. 发布与回滚

- 变更完全向后兼容；第一阶段迁移不触碰数据存储与服务端契约。
- 若第一阶段出现异常，可快速回滚入口组件的单一调用点，回退到既有 emit/bridge 闭包逻辑。

---

## 对 Spec 的预期改动

随着本提案进入评审并在将来获得批准，将在 `docs/specs/` 中规划登记以下规范条目：

- **目标 Capability**：`workbench.commands`（命令注册、查找、执行与生命周期）与 `workbench.quick-open`（快速打开与命令面板交互）。
- **输入**：
  - 命令定义 `CommandDescriptor`（唯一 ID、i18n 标题、执行函数、when 谓词、按键）；
  - 触发输入：交互点击、按键事件、代码 API 调用、快速打开输入字符串。
- **输出**：命令执行结果（Promise/数据）、命令面板高亮结果列表、上下文可用状态。
- **状态**：
  - 注册表状态：命令注册集合（ID → 描述符映射）；
  - 运行状态：当前 Context Keys 字典、命令面板开闭状态、当前检索前缀与结果列表。
- **副作用**：触发命令关联的业务状态变更（如打开面板、保存文件、切换主题等）；写入 MRU 偏好。
- **失败与恢复**：
  - 未知命令 ID 调用抛出 `CommandNotFoundError`；
  - 命令内部执行抛错被注册表错误边界捕获，统一展示全局 Toast 通知，不导致整页崩溃；
  - `when` 条件不满足时静默忽略调用请求。
- **验收与 Smoke 标准**：
  - 核心命令幂等注册与重复拦截单元测试通过；
  - 快捷键在输入框内外的聚焦/失焦条件下准确判定 `when` 条件；
  - 在 Component Lab 中以真实浏览器测试验证 `Ctrl+Shift+P` 呼出面板、键盘上下移动选中、回车执行指定命令。

---

## 决策记录

- **2026-09-14**：初始提案起草完成（状态 `draft`）。系统整理了当前代码库中 10 项交互入口与快捷键分散的取证事实，完成了类 VS Code 命令系统 12 项核心机制的技术对照，提出了单一命令注册表、入口统一改造、Descriptor 动作编译、nb-ui 驱动的命令面板以及集中快捷键派生的整体方案，并提炼了 5 项关键待决策点，提交架构与开发者评审。

---

## 参考资料

- 仓库内相关代码：
  - 活动栏与分发：`packages/neuro-book/app/utils/workbench-chrome.ts`、`packages/neuro-book/app/components/novel-ide/NovelIdeActivityBar.vue`
  - 标题栏与桌面菜单契约：`packages/neuro-book/app/components/common/DesktopTitleBarChrome.vue`、`packages/neuro-book/app/components/common/DesktopTitleBar.vue`
  - 视图描述符与求值：`packages/neuro-book/app/utils/workbench/descriptors.ts`
  - 散落快捷键样例：`packages/neuro-book/app/components/novel-ide/editor/TipTapMarkdownEditor.vue`、`packages/neuro-book/app/components/common/Dialog.vue`
  - 关联提案：`packages/neuro-book/docs/proposals/workbench-view-host.md`
- VS Code 官方文档：
  - [VS Code Extension API: Commands](https://code.visualstudio.com/api/extension-guides/command)
  - [VS Code Extension API: Contribution Points (commands, menus, keybindings)](https://code.visualstudio.com/api/references/contribution-points)
  - [VS Code Documentation: When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
  - [VS Code Documentation: Key Bindings](https://code.visualstudio.com/docs/configure/keybindings)
  - [VS Code Documentation: Quick Open & Tips and Tricks](https://code.visualstudio.com/docs/editing/tips-and-tricks)
