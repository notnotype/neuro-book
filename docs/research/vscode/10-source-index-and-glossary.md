# 10 源码索引与人话术语表

> 研究快照固定为 `microsoft/vscode` release `1.133.0` 对应 `a5b500951314efd502d07465bd138dfbd714a960`。本章只做审计索引，不重新叙述专题正文。  
> “已验证”表示固定 commit 中能定位路径和符号；用户旅程是否在真实桌面/浏览器运行，仍按各章检查边界标记。

## 1. 按用户旅程索引

| 旅程 | 主章节 | 主证据 | 调用方向 | 固定 SHA |
| --- | --- | --- | --- | --- |
| 桌面打开 Workspace | [01](./01-modules-bootstrap-di.md) | `CodeMain.startup` → `DesktopMain.open` → `Workbench.startup` | Electron main → renderer → Workbench | [`main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/code/electron-main/main.ts)、[`desktop.main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/electron-browser/desktop.main.ts)、[`workbench.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/workbench.ts) |
| 浏览器连接微软 Server | [02](./02-hosts-web-remote-server.md) | `BrowserMain.open`、`createServer`、`RemoteExtensionHostAgentServer._handleWebSocketConnection` | Browser Workbench ↔ remote agent/server | [`web.main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/web.main.ts)、[`server.main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/server/node/server.main.ts)、[`remoteExtensionHostAgentServer.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/server/node/remoteExtensionHostAgentServer.ts) |
| View/Panel 移动 | [03](./03-workbench-layout-views.md) | `ViewDescriptorService.moveViewContainerToLocation/moveViewsToContainer` | DND intent → View model → layout/storage | [`viewDescriptorService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/views/browser/viewDescriptorService.ts)、[`dnd.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/dnd.ts) |
| 同容器内 View 重排 | [03](./03-workbench-layout-views.md) | `ViewContainerModel.move`、`PaneView` | Pane order/size → container model | [`viewContainerModel.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/views/common/viewContainerModel.ts)、[`paneview.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/splitview/paneview.ts) |
| 编辑器二维 Split | [03](./03-workbench-layout-views.md) | `EditorPart`、`SerializableGrid`、`editorpart.state` | split intent → Editor Group Grid → memento | [`editorPart.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPart.ts)、[`gridview.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/grid/gridview.ts) |
| Ctrl+P 打开文件 | [04](./04-quick-access-commands.md) | `BaseEditorQuickAccessProvider._getPicks/accept` | keybinding → Quick Access registry → EditorService | [`editorQuickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorQuickAccess.ts)、[`quickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/quickinput/common/quickAccess.ts)、[`editorService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/editor/browser/editorService.ts) |
| Command Palette 执行命令 | [04](./04-quick-access-commands.md) | `CommandsQuickAccessProvider`、`CommandsRegistry`、`CommandService.executeCommand` | `>` provider → registry → handler/activation | [`commandsQuickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts)、[`commands.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/commands/common/commands.ts)、[`commandService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/commands/common/commandService.ts) |
| 配置读取/inspect | [05](./05-configuration-system.md) | `ConfigurationModel`、`Configuration`、`inspect` | schema/model layers → consolidated value | [`configurationModels.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/configuration/common/configurationModels.ts)、[`configuration.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/configuration/common/configuration.ts) |
| 配置持久写入/change event | [05](./05-configuration-system.md) | `MainThreadConfiguration`、`ConfigurationEditing`、`ConfigurationService.updateValue` | extension/UI → target validation → file edit → reload/event | [`mainThreadConfiguration.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/browser/mainThreadConfiguration.ts)、[`configurationEditing.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/configuration/common/configurationEditing.ts)、[`configurationService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/configuration/common/configurationService.ts) |
| 打开/修改/保存文本文件 | [06](./06-editor-architecture.md) | `EditorService.openEditor`、`TextResourceEditorInput.resolve`、`TextResourceEditor.setInput` | URI → Input → Group → Pane → model → Monaco | [`editorService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/editor/browser/editorService.ts)、[`textResourceEditorInput.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/common/editor/textResourceEditorInput.ts)、[`textResourceEditor.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/textResourceEditor.ts) |
| 编辑 dirty/save/recover | [06](./06-editor-architecture.md) | `WorkingCopyService`、`EditorPart`、`editorpart.state` | content/dirty/save events → working copy/backup/layout state | [`workingCopyService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/workingCopy/common/workingCopyService.ts)、[`editorPart.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPart.ts) |
| 首次执行扩展 command | [07](./07-extension-system-deep-dive.md) | scan → registry → `onCommand` → `ExtensionsActivator` → `MainThreadCommands` | description/control plane → Extension Host → RPC → Workbench command | [`extensionService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/browser/extensionService.ts)、[`extensionDescriptionRegistry.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts)、[`extHostExtensionActivator.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/common/extHostExtensionActivator.ts)、[`mainThreadCommands.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/browser/mainThreadCommands.ts) |
| 首次打开扩展 View | [07](./07-extension-system-deep-dive.md) | View descriptor → `onView:<id>` → host/provider | View model → activation → Tree/Webview provider | [`viewDescriptorService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/views/browser/viewDescriptorService.ts)、[`abstractExtensionService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/common/abstractExtensionService.ts) |
| 当前章节生成角色插图 | [09](./09-text-to-image-plugin-journey.md) | Job/Tool/Attachment/History 现状 + 未实现 Provider 边界 | command → schema/approval → durable job → candidate provider → authority | NeuroBook 证据见 [08](./08-neurobook-mapping.md) 与 [09](./09-text-to-image-plugin-journey.md) |
| 图片输入到视觉模型 | [11](./11-image-input-to-text-current-journey.md) | `AgentAttachmentCodec`、`SessionAttachmentAuthority`、`hydrateForProvider`、Session transcript | 图片 bytes → Session ownership → 视觉模型 → 文本结果 | 当前包源码/测试 |
| 第一方 Workbench View 宿主 | [12](./12-workbench-view-host-refactor.md) | 固定槽位、Activity/Chrome、Novel IDE layout、resize boundary | Activity/descriptor → Container/View → Project/Session context | 当前包源码；View Registry 为研究建议 |
| 扩展控制面联邦描述快照 | [13](./13-extension-control-plane-refactor.md) | Profile/Skill/Workflow/Tool Catalog、Job、RuntimePaths | 各领域 owner → 只读 description snapshot → Host consumer | 当前包源码；统一快照为研究建议 |
| 双向图像系统边界 | [14](./14-bidirectional-image-system-boundaries.md) | 当前图生文链 + 候选文生图缺口 | 图生文 Session message；文生图 Provider/Job/Project asset 候选链 | 当前包源码与研究映射 |
| 重构顺序与决策门 | [15](./15-refactor-sequence-and-decision-gates.md) | capability 归属、迁移消费者、authority 和停止条件 | View Host → Description Snapshot → 图生文 → 独立文生图合同 | 研究建议；不替代 Proposal/Spec/Task |

## 2. 按 VS Code 模块索引

### 启动与依赖注入

| 路径 | 关键符号 | 人话职责 | 关系 |
| --- | --- | --- | --- |
| [`src/vs/code/electron-main/main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/code/electron-main/main.ts) | `CodeMain.startup`, `createServices`, `claimInstance` | 桌面主进程建立服务、单实例和窗口启动前环境 | 调用 `CodeApplication.startup`，把配置交给 renderer |
| [`src/vs/code/electron-browser/workbench/workbench.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/code/electron-browser/workbench/workbench.ts) | `load`, `resolveWindowConfiguration` | renderer bootstrap，取得安全窗口配置并加载 desktop main | 动态 import `workbench.desktop.main` |
| [`src/vs/workbench/electron-browser/desktop.main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/electron-browser/desktop.main.ts) | `DesktopMain.open`, `initServices` | 等 DOM 和服务后创建 Workbench | 调用 `new Workbench(...).startup()` |
| [`src/vs/workbench/browser/workbench.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/workbench.ts) | `startup`, `restore`, `renderWorkbench` | 装配服务、创建 Parts、布局、恢复 editor/UI | 依赖 InstantiationService、Lifecycle 和各 Workbench service |
| [`src/vs/platform/instantiation/common/instantiationService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/instantiation/common/instantiationService.ts) | `invokeFunction`, `createInstance`, `createChild` | 按 descriptor 解析构造器依赖并管理 child scope | 从 ServiceCollection 找 service identifier |
| [`src/vs/platform/instantiation/common/extensions.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/instantiation/common/extensions.ts) | `registerSingleton`, `getSingletonServiceDescriptors` | 模块加载时登记 singleton descriptor | Workbench host 启动时消费 descriptor |

### 宿主与远程

| 路径 | 关键符号 | 人话职责 | 关系 |
| --- | --- | --- | --- |
| [`src/vs/workbench/browser/web.main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/web.main.ts) | `BrowserMain.open`, `initServices` | Browser Workbench 服务和 DOM 入口 | 注册 Remote Authority/Agent/FileSystem 服务 |
| [`src/vs/server/node/server.main.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/server/node/server.main.ts) | `createServer`, `spawnCli` | 微软 VS Code Server Node 入口 | 创建远端 server/agent，不是第三方 code-server |
| [`src/vs/server/node/remoteExtensionHostAgentServer.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/server/node/remoteExtensionHostAgentServer.ts) | `_handleWebSocketConnection`, connection type/auth handlers | 接受远程客户端并创建管理/扩展主机通道 | 使用 PersistentProtocol、认证/版本协商 |
| [`src/vs/base/parts/ipc/common/ipc.net.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/parts/ipc/common/ipc.net.ts) | `PersistentProtocol`, reconnection/ACK | 有序传输、暂停/恢复、重连和 keep-alive | 承载 Remote Agent/Extension Host channel |
| [`src/vs/workbench/services/remote/browser/remoteAgentService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/remote/browser/remoteAgentService.ts) | remote connection/environment | 客户端对远端 agent 的服务门面 | 给 Workbench 和 Remote Extension Host 提供连接状态 |

### 布局、View 与 Editor

| 路径 | 关键符号 | 人话职责 | 关系 |
| --- | --- | --- | --- |
| [`src/vs/workbench/services/layout/browser/layoutService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/layout/browser/layoutService.ts) | `Parts`, `Position`, `PanelAlignment`, `LayoutSettings` | Part 词表、位置和布局配置 | Workbench Layout 使用它计算区域 |
| [`src/vs/workbench/browser/layout.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/layout.ts) | `Layout`, `SerializableGrid` | Part 几何和恢复布局树 | Side bar/Panel/Editor part 控制面 |
| [`src/vs/workbench/services/views/common/viewContainerModel.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/views/common/viewContainerModel.ts) | `ViewContainerModel`, `move`, `setVisible`, `setSizes` | 一个 View Container 内的顺序、可见性和尺寸 | 以一维 PaneView 模型承载 View |
| [`src/vs/workbench/services/views/browser/viewDescriptorService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/views/browser/viewDescriptorService.ts) | `moveViewContainerToLocation`, `moveViewsToContainer` | 跨位置/容器迁移和 `views.customizations` | 校验 descriptor、保存 profile 定制 |
| [`src/vs/base/browser/ui/splitview/paneview.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/splitview/paneview.ts) | `PaneView` | 一维 pane 顺序、sash 和 drop 区域 | 不是任意组件注入点 |
| [`src/vs/workbench/browser/dnd.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/dnd.ts) | `CompositeDragAndDropObserver` | 拖拽身份意图观察器 | 把实际迁移交回 ViewDescriptorService |
| [`src/vs/workbench/browser/parts/editor/editorPart.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPart.ts) | `EditorPart`, Editor Group Grid | 二维编辑器组、tabs 和 memento | 与 View Container 的一维模型分开 |
| [`src/vs/workbench/services/editor/browser/editorService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/editor/browser/editorService.ts) | `openEditor`, `openEditors` | untyped resource 到 typed EditorInput，并选择 group | 调用 resolver、TextEditorService、EditorGroup |
| [`src/vs/workbench/common/editor/textResourceEditorInput.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/common/editor/textResourceEditorInput.ts) | `resolve`, `matches`, `dispose` | 资源身份、model reference、释放 | 调用 TextModelService |
| [`src/vs/workbench/browser/parts/editor/textResourceEditor.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/textResourceEditor.ts) | `setInput`, `clearInput` | 把 resolved text model 接给 editor control | 调用 `control.setModel` 和 view state |
| [`src/vs/workbench/services/workingCopy/common/workingCopyService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/workingCopy/common/workingCopyService.ts) | `registerWorkingCopy`, dirty/save events | 统一脏状态、内容变化和保存观察 | 与 Input/File/TextFile 协作 |

### Quick Access 与命令

| 路径 | 关键符号 | 人话职责 | 关系 |
| --- | --- | --- | --- |
| [`src/vs/platform/quickinput/common/quickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/quickinput/common/quickAccess.ts) | `QuickAccessRegistry` | prefix/default provider 注册表 | Controller 按输入选择 provider |
| [`src/vs/platform/quickinput/browser/quickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/quickinput/browser/quickAccess.ts) | `QuickAccessController` | 打开 Quick Input、实例化 provider、处理 picks | 连接 keybinding/context 与 provider |
| [`src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts) | `CommandsQuickAccessProvider` | `>` 后生成命令 picks | 读取 Menu/Command metadata，accept 后执行 |
| [`src/vs/workbench/browser/parts/editor/editorQuickAccess.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorQuickAccess.ts) | `BaseEditorQuickAccessProvider` | 无前缀时按资源/文件名生成 editor picks | accept 后走 EditorService |
| [`src/vs/platform/commands/common/commands.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/commands/common/commands.ts) | `CommandsRegistry` | command id 到 handler 的本地注册表 | CommandService 消费它 |
| [`src/vs/workbench/services/commands/common/commandService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/commands/common/commandService.ts) | `CommandService.executeCommand` | 找 handler、context/activation 后执行 | 缺失时报 `command '<id>' not found` |
| [`src/vs/platform/keybinding/common/keybindingResolver.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/keybinding/common/keybindingResolver.ts) | keybinding/context resolution | 把按键和 context key 解析成命令 | 不负责命令实现或权限 |

### 配置

| 路径 | 关键符号 | 人话职责 | 关系 |
| --- | --- | --- | --- |
| [`src/vs/platform/configuration/common/configurationRegistry.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/configuration/common/configurationRegistry.ts) | `IConfigurationRegistry`, property schema | 注册 setting schema、default 和 override identifier | extension point 与内置配置共同写入 |
| [`src/vs/workbench/api/common/configurationExtensionPoint.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/common/configurationExtensionPoint.ts) | `contributes.configuration` handler | 把扩展 manifest 配置送入 registry | 不直接写 settings file |
| [`src/vs/platform/configuration/common/configurationModels.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/configuration/common/configurationModels.ts) | `ConfigurationModel`, `Configuration`, `inspect` | 分层模型、override 和 consolidated cache | 产生最终读取视图 |
| [`src/vs/platform/configuration/common/configuration.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/configuration/common/configuration.ts) | `ConfigurationTarget`, `IConfigurationValue`, change event | 定义来源字段、写入 target、变化事件 | Workbench/Extension Host 共用类型 |
| [`src/vs/workbench/services/configuration/common/configurationEditing.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/configuration/common/configurationEditing.ts) | `ConfigurationEditing` | 串行编辑 settings/workspace/folder JSON | 校验 scope/target/policy/dirty |
| [`src/vs/workbench/api/browser/mainThreadConfiguration.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/browser/mainThreadConfiguration.ts) | `$updateConfigurationOption`, `deriveConfigurationTarget` | 扩展配置代理和 target 推导 | 通过 RPC 接收 ExtHost 请求 |

### 扩展与 RPC

| 路径 | 关键符号 | 人话职责 | 关系 |
| --- | --- | --- | --- |
| [`src/vs/workbench/services/extensions/browser/extensionService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/browser/extensionService.ts) | `_scanWebExtensions`, `_resolveExtensions`, `BrowserExtensionHostKindPicker` | 扫描 local/remote/web 扩展并选 host | 调 AbstractExtensionService 和 Host Factory |
| [`src/vs/workbench/services/extensions/common/abstractExtensionService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/common/abstractExtensionService.ts) | `_handleDeltaExtensions`, `_updateExtensionsOnExtHosts` | 动态 add/remove、extension point 和 host delta | 获取 registry lock 后更新各 host |
| [`src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts) | `ExtensionDescriptionRegistry`, `deltaExtensions`, activation map | description snapshot、ID 索引、activation 索引和 dependency loop | 被 ExtensionService/Activator 使用 |
| [`src/vs/workbench/api/common/extHostExtensionActivator.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/common/extHostExtensionActivator.ts) | `ExtensionsActivator`, `ActivationOperation` | 依赖等待、激活、失败和去重 | 调 `actualActivateExtension` |
| [`src/vs/workbench/api/common/extHostExtensionService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/common/extHostExtensionService.ts) | `_doActivateExtension`, `_loadExtensionContext`, `_callActivate` | 加载模块、构造 Context、调用 activate/deactivate | 使用 ExtHost registry 与 RPC proxy |
| [`src/vs/workbench/api/browser/mainThreadCommands.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/api/browser/mainThreadCommands.ts) | `$registerCommand`, `$executeCommand`, `$fireCommandActivationEvent` | Workbench 侧 command proxy | 调 ICommandService/ExtensionService |
| [`src/vs/workbench/services/extensions/common/rpcProtocol.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/common/rpcProtocol.ts) | `RPCProtocol`, `_remoteCall`, `_receiveRequest` | actor proxy、序列化、URI/Buffer、ACK、cancel/reply | MainThread ↔ ExtHost |
| [`src/vs/workbench/services/extensions/common/extensionHostManager.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/common/extensionHostManager.ts) | `start`, `activateByEvent`, `deltaExtensions` | Workbench 对 Extension Host 的管理门面 | 建立 RPCProtocol 和 host proxy |
| [`src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts) | `_onExtensionHostCrashed` | crash count、自动重启、version mismatch UI | 调 `startExtensionHosts` 或提示用户 |

## 3. NeuroBook 对照索引

| NeuroBook 路径 | 固定符号 | 现状 | VS Code 对照点 | 边界 |
| --- | --- | --- | --- | --- |
| [`server/agent/http.ts`](../../../server/agent/http.ts) | `useAgentHarness` | `globalThis` 单例；显式创建 Harness 依赖 | `InstantiationService`/singleton descriptor | 单例不是 IoC 容器，也不是插件沙箱 |
| [`server/runtime/paths/runtime-paths.ts`](../../../server/runtime/paths/runtime-paths.ts) | `createRuntimePaths` | immutable application/state/cache/workspace/secrets roots | Host/service environment | 模块不得从 cwd/环境自行猜 root |
| [`server/agent/profiles/catalog.ts`](../../../server/agent/profiles/catalog.ts) | `AgentProfileCatalog.snapshot`, `publishProfileRelease` | compiled Profile catalog、loadStatus、epoch-backed runtime view | ExtensionDescriptionRegistry snapshot/version | 不负责通用 activation |
| [`server/agent/profiles/profile-registry.ts`](../../../server/agent/profiles/profile-registry.ts) | `ProfileRegistry.publish` | 原子替换内存 catalog、递增 epoch | registry snapshot version | 不是跨磁盘/Provider 事务 |
| [`server/agent/jobs/agent-job-manager.ts`](../../../server/agent/jobs/agent-job-manager.ts) | `spawn`, `recoverInterrupted`, `commitTerminal` | durable background job、取消、恢复、幂等 delivery | Extension Host lifecycle | Job recovery 不重放未知副作用 |
| [`server/agent/tools/tool-registry.ts`](../../../server/agent/tools/tool-registry.ts) | `allowed`, `allowedWithOverrides` | Provider schema 与 execution authority 分离 | MainThread/ExtHost API proxy | schema 可见不等于授权执行 |
| [`server/agent/attachments/session-attachment-authority.ts`](../../../server/agent/attachments/session-attachment-authority.ts) | `resolveDurableOwnership`, `authorizeMessages` | JSONL canonical attachment authority | Resource/model authority | 不是通用 Project asset registry |
| [`server/workspace-history/project-history.ts`](../../../server/workspace-history/project-history.ts) | `recordProjectWrite` | 写后记账，fail-open，reconcile 补 external | Working copy/history | 不组成多资源原子事务 |
| [`server/config/config-service.ts`](../../../server/config/config-service.ts) | `readConfigSnapshot`, `saveGlobalConfig`, `saveProjectConfig` | global/project effective config 与 target 校验 | ConfigurationModel/ConfigurationEditing | 不是开放式 contributes.configuration |
| [`server/media/image-variant.ts`](../../../server/media/image-variant.ts) | `ImageVariantModule.render` | 已授权图片的受限 WebP variant cache/queue | editor/image resource transform | 不是 AI image generation |
| [`app/pages/index.vue`](../../../app/pages/index.vue) | `agentPanelOpen`, `layoutMode` | 当前 Workbench 固定槽位和模式 | Part/View host layout | 不开放第三方组件注入 |
| [`app/stores/novel-ide.ts`](../../../app/stores/novel-ide.ts) | panel widths/editor tabs | local/session UI state | View container/editor state | 不能直接扩成通用 plugin state |
| [`app/composables/useResizablePanel.ts`](../../../app/composables/useResizablePanel.ts) | `useResizablePanel` | 唯一 resize boundary、clamp、commit | PaneView/sash | 插件应复用宿主，不建私有尺寸链 |

## 4. 人话术语表

下面的解释以本组报告的用法为准。英文保留是为了和固定 SHA 源码中的类名、字段名对应；首次阅读只需先看“人话解释”，不需要把它们当成同义词。

| 术语 | 一句话解释 | 在这组报告里的边界 |
| --- | --- | --- |
| process / 进程 | 操作系统隔离的运行单元，有自己的内存和崩溃边界 | 不等于线程、页面或扩展 API |
| renderer | Electron 里负责窗口页面和 Workbench UI 的进程 | 不等于 Electron Main，也不代表所有服务都在这里实现 |
| DOM | 浏览器把 HTML 页面表示成的节点树 | 研究只把它当 UI 渲染载体；扩展不因此获得任意 Workbench DOM 注入权 |
| Web Worker | 浏览器后台 JavaScript 运行单元，可与页面线程隔离 | 不是 Node 进程，也不是自动成立的安全沙箱 |
| IPC | Inter-Process Communication，进程间通信 | 本报告主要指 Electron Main 与 renderer 之间的通道 |
| RPC | Remote Procedure Call，远程过程调用；把方法调用编码为消息 | 既可用于进程间，也可用于远程机器；不共享原始对象引用 |
| service identifier | 服务的类型安全名字，像 DI 容器的钥匙 | 只标识服务，不等于实例本身 |
| DI / dependency injection | 依赖注入；对象声明需要哪些服务，由宿主在创建时提供 | 是装配方式，不是权限系统 |
| IoC container | 控制反转容器；集中登记/解析依赖的运行时设施 | `InstantiationService` + `ServiceCollection` 是本报告讨论的 VS Code 形态，不直接等于通用插件容器 |
| `ServiceCollection` | 当前宿主 scope 里“某个 identifier 对应什么”的表 | 可以有 parent/child scope |
| `InstantiationService` | 看到构造器依赖后，按依赖图创建服务的解析器 | 不是简单的全局 `new` 工厂 |
| descriptor | 延迟创建服务所需的类/工厂描述 | 登记 descriptor 不代表实例已创建 |
| singleton | 一个 scope 中复用的一份服务实例 | 不等于进程全局、也不等于持久化 |
| contribution | 扩展向宿主声明“我提供什么”的 manifest 入口 | 声明层，不自动执行运行时代码 |
| extension point | 宿主接收某类 contribution 的注册接口 | 每种 point 有自己的 schema/handler |
| provider | 提供某类数据/内容/资源能力的实现或回调 | 要结合上下文判断是 Quick Access provider、FileSystemProvider、View provider 还是外部服务；不自动拥有写入权 |
| Description Registry | 保存扩展描述、ID 索引和激活索引的注册表 | 不是代码执行器 |
| registry snapshot/version | 描述/内存视图每次原子发布后的版本水位 | 用来判断快照新旧，不是业务 revision 的替代品 |
| activation event | 宿主用来触发惰性激活的事件名 | `onCommand:<id>`、`onView:<id>` 等 |
| activation operation | 一次扩展依赖等待和激活的状态对象 | 成功/失败都应可观察 |
| authority | 某个资源或连接的归属、解析和访问入口 | 不等于认证 token、用户授权或文件权限；这三者必须分开 |
| URI | Uniform Resource Identifier，资源身份字符串；可表示文件、远程资源或虚拟资源 | 是“指向谁”的标识，不是已经读到的内容和权限凭据 |
| DTO | Data Transfer Object，跨边界传输的普通数据对象 | 只表达可序列化数据；不能把它当成另一端的活对象引用 |
| ACK | acknowledgement，确认消息已收到/进入处理 | ACK 不等于业务成功，业务结果要看 reply/result |
| cancellation token | 可传递的取消信号 | 表示调用方不再等待或希望停止；不能保证已经发出的外部副作用可撤销 |
| Workbench | VS Code 的用户界面控制平面 | 管布局、Editor、View、命令和生命周期 |
| Workbench Part | Workbench 的大区域，如 Sidebar、Panel、Editor Part | Part 与 View 不是同一级对象 |
| Composite | 能显示一个视图/面板并参与 Workbench 布局的复合 UI | 常作为 Part 的内容/切换单元 |
| View Container | 装一组 View 的宿主容器 | 有位置、顺序、可见性和存储 |
| View | 容器内一项能力的描述与内容 Pane | descriptor/位置不等于已激活 |
| Pane | 可在容器中布局的一块 UI 面板 | `PaneView` 是其布局实现，不是任意组件注入口 |
| `PaneView` | 把多个 pane 以一维 SplitView 堆叠的模型 | 不表达任意二维编辑器树 |
| `ViewDescriptorService` | 管 View/Container 注册、位置、迁移和定制保存的服务 | 拖拽最终回到它/相关 model |
| Editor Part | 专门承载编辑器区域的 Workbench Part | 内部维护多个 Editor Group 的二维 Grid |
| EditorInput | “当前打开的资源是什么”的对象 | 不等于 UI pane 或磁盘文件 |
| EditorPane | 把某种 EditorInput 显示出来的 UI 壳 | 可能是文本、diff、custom editor 等 |
| EditorGroup | 一组 tabs 的编辑器分组 | 多组通过 Editor Part 的 Grid 组织 |
| model | 内存中的文档/领域数据对象 | model 变更不自动等于已持久化 |
| text model | 文本内容、语言和编辑事件的内存模型 | Monaco control 可以绑定它 |
| Monaco control | Monaco 提供的编辑器视图控制对象 | 管光标、滚动、装饰和绑定 model，不拥有 Workspace 最终保存权 |
| working copy | 统一 dirty/content/save/backup 语义的可写副本 | 不只是一个字符串 buffer |
| memento | 用于恢复 UI/对象状态的小型持久化快照 | 不是完整业务数据库，也不等于 durable job record |
| Extension Host | 承载扩展运行时代码的 Node 进程或 Web Worker | 有 API/RPC 边界，不自动成为安全沙箱 |
| local extension host | 在用户本地运行的扩展宿主 | 桌面可能是 Node process，Web 场景可能是 Web Worker |
| remote extension host | 在远程 Workspace 所在机器运行的扩展宿主 | 通过 Remote Agent/connection 接入 |
| remote agent | 微软 VS Code Server 端向客户端提供远程环境/通道的 Node 服务 | 不等于第三方 `coder/code-server` |
| PersistentProtocol | 维护长连接消息序号、ACK、暂停/恢复和重连重放的协议 | 解决传输连续性，不替代业务状态真相 |
| MainThread/ExtHost proxy | Workbench 主线程与 Extension Host 双向 API 代理 | 通过 RPC，不共享对象引用 |
| `RPCProtocol` | 把 proxy method 编成消息、处理 ACK/reply/cancel 的协议 | 业务成功要看 reply，不只看 ACK |
| Quick Access | 统一的输入框 + provider 选择控制面 | Ctrl+P 和 `>` 是不同 provider 入口 |
| Quick Pick | Quick Input 中可过滤、选择的候选项交互 | 它不是 command registry |
| context key | 宿主记录当前 UI/工作区条件的键 | 可决定显示/keybinding，不等于权限授权 |
| command | 带稳定 ID 的可执行宿主意图/处理器 | 可以有菜单、keybinding、Quick Access 多个入口 |
| menu item | 在某个菜单显示 command 的描述项 | 可见不等于 handler 已激活 |
| configuration schema | setting 的类型、scope、默认、描述和限制声明 | 不等于某个用户当前值 |
| configuration model | 某一配置来源层的树形值与 override | 多层 model 才产生 consolidated value |
| configuration target | 写入的作用域，如 user/workspace/folder/memory | target 合法性由宿主校验 |
| override identifier | 语言/资源专用配置视图的 identifier | 不是普通第九个优先级层 |
| policy value | 管理策略提供的不可由普通用户覆盖的读取值 | 常在读取合并最后覆盖 |
| Profile（VS Code User Data Profile） | 选择哪套用户设置和扩展资源的上下文 | 不等于 NeuroBook Agent Profile artifact |
| Profile（NeuroBook） | Agent 能力、schema、工具和运行入口的业务资产 | 不应因同名而当作 VS Code User Data Profile |
| durable job | 有持久记录、状态、恢复和结果/回流语义的后台任务 | 不保证外部 side effect 可安全重放 |
| authority boundary | 某类状态或副作用的唯一允许读写守门边界 | UI preview 不等于 authority commit |
| first-party View Host | 宿主拥有的第一方 View descriptor、Container、生命周期和布局边界 | 第一阶段不接收第三方 Vue component、render function、HTML/CSS 或任意模块路径 |
| federated Description Snapshot | 把各领域稳定描述投影成只读宿主视图 | 不接管 Profile/Skill/Workflow/Tool 的加载、覆盖、编译、执行或持久化真相 |
| Session Attachment authority | 校验 Session JSONL 对附件的 durable ownership、locator、canonical metadata 和 Provider admission | `AttachmentRef`/locator 不等于 Project canonical asset |
| Project canonical image asset | 经 Project authority 校验、hash、metadata 和提交后的图片原图 | Provider bytes、预览、Session attachment 或 WebP variant 都不自动等于该状态 |
## 5. 源码锚点与检查边界

### 已验证

- 固定 SHA 路径存在，关键 symbol 可由 GitHub `blob/<full-sha>/...` 链接复查；
- 本组 01–07 逐章列出源码锚点与未读边界；
- NeuroBook 08–15 分别标注当前源码证据、目标合同、研究建议和未验证候选，不把研究建议当作当前现状。
- 既有 [`../vscode-extension-system.md`](../vscode-extension-system.md) 继续保留研究证据身份，新专题引用而不复制其正文。

### 从源码推断

- 把多个模块组成“打开窗口 → Workbench → View/Editor → Extension Host”的用户旅程；
- 把 VS Code 的 registry/version、host boundary、lazy activation 映射到 NeuroBook 的渐进解耦路径；
- 把文生图图中的职责分配到 command/config/job/asset/history/editor 等宿主边界。

### 未验证

- 桌面真实打开 Workspace、浏览器真实连接微软 Server、真实重连/断线；
- Ctrl+P、Command Palette、View 拖拽、Editor Split 的人工交互；
- Settings UI、真实配置文件监听、Settings Sync 和 policy 部署；
- 文件保存、备份恢复、语言服务和大型文件表现；
- Marketplace/VSIX 下载、签名、更新服务和真实扩展安装；
- Web Extension、Webview、Remote Extension Host 的真实运行；
- NeuroBook 真实图片 Provider、NovelAI、生成图 asset authority、正文回写事务和 hostile plugin fixture。

这些缺口会限制：

- 不能从源码报告像素、动画、排序、网络延迟或部署重试；
- 不能把协议分支等同于最终通知 UI；
- 不能把 Extension Host crash recovery 等同于安全沙箱；
- 不能把 NeuroBook Job/Attachment/History 现状等同于文生图端到端能力；
- 不能在没有 Proposal/Spec/ADR 的情况下把映射建议当作产品合同。

## 6. 验收索引

交付前应检查：

1. 01–15 每章存在；README 阅读顺序和用户旅程矩阵链接到对应章节。
2. 每条 VS Code 主源码路径在固定 SHA commit tree 中存在，链接不使用 `main`。
3. README 矩阵每一行都能找到入口、宿主、服务/模型、状态/持久化、成功和失败闭环。
4. 07 的 command/View 时序都明确“描述已登记”与“运行代码已激活”的差异。
5. 09 的边界表没有“NeuroBook 已支持文生图”或“ImageVariantModule 是生图队列”等超范围声称。
6. 11 的主旅程闭环图片 bytes、Attachment/Session authority、视觉模型 hydration、文本结果和 Session 事件/消息。
7. 12–15 明确当前证据、研究建议、失败/恢复和源码锚点；13/15 不把 Task 135 或空 Spec 注册表写成当前实现。
8. `docs:check` 通过后，另跑研究目录专用相对链接检查，因为仓库文档脚本可能排除 `docs/research/`。
9. 变更范围只包含 `packages/neuro-book/docs/research/vscode/**`；保留用户已有的 `packages/neuro-book/docs/research/vscode-extension-system.md` 和其他未跟踪文件。

本索引不替代固定 SHA 源码本身。若后续报告引用了本章术语，应同时保留章节证据状态和对应源码链接。
