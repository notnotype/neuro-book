# VS Code 插件系统与 NeuroBook 启发

> 调研日期：2026-08-18  
> 调研状态：research；本文是第三方资料与方案映射，不是当前产品合同。  
> 关联问题：VS Code 如何通过清单、贡献点、注册表、惰性激活、扩展宿主、RPC、信任与发布链路组织插件；VS Code 的 View / Panel 如何声明、注册、持久化、拖拽、分组和分屏；这些机制对 NeuroBook 的 Profile、Skill、Workflow、Tool 和工作台有什么启发？

## 结论先行

VS Code 的插件系统不是单一的“加载插件代码”机制，而是一条完整控制链：

```text
扩展包清单
  -> 能力与 UI 贡献点
  -> 描述注册表与激活索引
  -> 激活事件与依赖图
  -> Local / Web / Remote Extension Host
  -> RPC / API 代理
  -> 信任、兼容、发布、更新与测试
```

NeuroBook 已具备其中若干关键零件：Profile / Skill / Workflow Catalog、Profile 内容寻址 artifact、Profile Registry、Tool Registry、Runtime Hook、Session Event Hub，以及资产包和安装 provenance 协议。当前主要缺口不是再增加一个 `Plugin` 类，而是形成跨资产类型统一的：

1. 能力声明与描述注册表；
2. 注册表快照和 epoch 切换；
3. 运行时激活与依赖失败状态；
4. 宿主能力与隔离执行边界；
5. 工作台 View / Panel 的声明、布局持久化和拖放模型。

推荐借鉴 VS Code 的控制平面，不照搬任意 `activate()` 代码模型：保留 NeuroBook 的 Profile artifact、工具执行权限、TurnSnapshot、原子发布和来源账本；在第三方 Workflow / Profile 的隔离威胁模型完成前，不开放任意外部可执行资产的自动安装与执行。

## 一、VS Code 扩展控制平面

### 1. 清单声明身份、入口、兼容性和能力

VS Code 扩展根目录必须包含 `package.json`。重要字段包括：

- `name`、`version`、`publisher`：安装和市场身份；
- `engines.vscode`：兼容的 VS Code 版本范围；
- `main`：Node.js Extension Host 入口；
- `browser`：Web Extension 入口；
- `contributes`：命令、设置、菜单、语言、视图、Chat Agent、Skill 等声明式能力；
- `activationEvents`：何时加载运行时代码；
- `extensionDependencies`：扩展依赖；
- `extensionKind`：偏好 UI 侧还是 Workspace 侧运行；
- `capabilities`：例如是否支持不受信任工作区。

官方文档明确写出：

> Every Visual Studio Code extension needs a manifest file `package.json` at the root of the extension directory structure.

证据：[Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)。

### 2. Contribution Points 声明“向宿主贡献什么”

`contributes` 是声明式能力入口，当前覆盖 `commands`、`configuration`、`menus`、`views`、`viewsContainers`、`customEditors`、`debuggers`、`terminal`、`chatAgents`、`chatInstructions`、`chatPromptFiles`、`chatSkills`、`languageModelTools` 等。

它把以下问题分开：

| 问题 | 责任 |
| --- | --- |
| 扩展提供什么 | manifest / contribution points |
| 用户何时看见 | menus / when clauses / context keys |
| 点击后谁执行 | Extension Host 运行时代码 |
| 代码在哪执行 | `extensionKind` / running location |
| 跨进程如何调用 | RPC protocol |

证据：[Contribution Points](https://code.visualstudio.com/api/references/contribution-points)。

### 3. Description Registry 先登记描述，再决定运行

核心源码是 [`ExtensionDescriptionRegistry`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts)。注册表维护：

- 扩展 ID 到描述的索引；
- activation event 到扩展描述列表的索引；
- 全量扩展快照；
- registry `versionId`；
- 增量添加和删除。

`deltaExtensions(toAdd, toRemove)` 先移除、再添加、检查依赖循环、移除循环扩展、重建索引并递增版本。源码注释直接写明：

> Immediately remove looping extensions!

这说明注册表不是简单的数组，而是带版本和依赖完整性检查的控制平面。

### 4. Activation Events 实现惰性激活

激活事件包括 `onCommand`、`onLanguage`、`onView`、`onFileSystem`、`onNotebook`、`onWebviewPanel`、`onCustomEditor`、`onTerminal`、`onStartupFinished`、`workspaceContains`、`onUri` 等。

官方文档说明，扩展通过 `activationEvents` 声明何时被加载，目标是只在用户需要时激活，而不是启动时加载所有扩展。证据：[Activation Events](https://code.visualstudio.com/api/references/activation-events)。

`extHostExtensionActivator.ts` 的 `ActivationOperation` 会：

1. 为扩展递归创建依赖操作；
2. 等待依赖完成；
3. 依赖失败时阻断当前扩展；
4. 依赖未知时产生明确错误；
5. 调用扩展宿主执行激活；
6. 保存成功或失败状态，避免重复激活。

官方源码中的错误语义包括：

```text
Cannot activate the '${currentExtensionFriendlyName}' extension because it depends on unknown extension '${depId}'
Cannot activate the '${this.friendlyName}' extension because its dependency '${dep.friendlyName}' failed to activate
```

源码还分开记录代码加载时间、`activate()` 调用时间和异步激活完成时间，可定位启动性能瓶颈。

### 5. Extension Host 隔离运行位置

VS Code 目前有三类扩展宿主：

| 宿主 | 运行时 | 位置 |
| --- | --- | --- |
| local | Node.js | 用户本机 |
| web | Browser WebWorker | 浏览器或桌面 Web 宿主 |
| remote | Node.js | 容器、SSH、WSL、Codespace |

证据：[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)。

`extensionKind` 让扩展声明偏好：

- `ui`：靠近 UI；
- `workspace`：靠近工作区；
- `["ui", "workspace"]` 或 `["workspace", "ui"]`：有顺序的偏好。

UI Extension 和 Workspace Extension 的代码运行位置不同。远程场景下，不同宿主不能直接共享 `activate()` 返回的 JavaScript API；跨宿主通信要用命令等异步边界。

### 6. RPC 把扩展 API 变成代理

相关源码：

- [`extHostRpcService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostRpcService.ts)；
- [`extensionHostManager.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/extensionHostManager.ts)；
- [`extHostCommands.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostCommands.ts)。

`ExtensionHostManager` 启动宿主、建立 `RPCProtocol`、注册 Main Thread / Extension Host 代理，并缓存 activation event 的 Promise。`ExtHostCommands` 在扩展宿主内保存命令处理器；跨宿主命令通过 RPC 发送，参数经过类型转换和约束校验。

核心启发：扩展不应直接持有 Workbench、数据库、HTTP 请求上下文或原始文件系统根目录；宿主通过窄的、可校验的代理接口暴露能力。

## 二、VS Code 安全、发布和测试

### 1. Workspace Trust 是独立的信任维度

扩展可在清单中声明：

```json
{
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": "limited",
      "description": "..."
    }
  }
}
```

三种状态是：完整支持、完全不支持、部分能力支持。VS Code 还提供 `workspace.isTrusted`、`onDidGrantWorkspaceTrust` 和 `isWorkspaceTrusted` context key。

官方要求作者考虑扩展是否读取工作区代码、是否执行工作区内容、是否把工作区设置传给 CLI、是否使用工作区依赖。证据：[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)。

对 NeuroBook 的直接启发：资产来源信任和项目内容信任必须分开：

```text
assetTrust      bundled / workshop / git / local
workspaceTrust  当前 Project Workspace 是否允许项目驱动的执行
```

### 2. Web Extension 受浏览器宿主限制

Web Extension 使用 `browser` 入口，在 Browser WebWorker 中执行。它不能直接使用 Node.js API、创建子进程或执行系统程序；文件需要经过 `vscode.workspace.fs`，网络通过 `fetch` 和 CORS。

证据：[Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)。

### 3. Webview 是消息边界，不是直接注入 UI

Webview 类似隔离 iframe：页面不能直接访问 VS Code API，通过 `postMessage` 双向通信。官方建议：

- 最小化脚本和本地资源权限；
- 设置 Content Security Policy；
- 只加载必要的 HTTPS 外部资源；
- 清洗文件内容、路径、设置等用户输入；
- 用 `getState` / `setState` 保存状态；
- 用 serializer 支持重启恢复。

证据：[Webview API](https://code.visualstudio.com/api/extension-guides/webview)。

### 4. 发布是“构建—校验—归档—分发”的链路

VS Code 用 `vsce package` 生成 VSIX，用 `vsce publish` 发布。发布链路检查清单、版本、engine 兼容性、包内容、图片来源、平台目标和预发布构建。

证据：[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。

NeuroBook 的 Agent Asset Package / Install Protocol 已经有相似分层：固定入口、SemVer、ZIP 路径安全、原子落盘、来源账本、dirty 检测和安装事务。

### 5. Proposed API 是明确的实验 API 门禁

VS Code Proposed API 只在 Insiders 可用，通过 `enabledApiProposals` 显式开启，不允许作为稳定 Marketplace 扩展依赖，最终稳定后才进入公共 API。

证据：[Using Proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)。

NeuroBook 应保持稳定 `profile-sdk` / `variable-sdk` 合同，实验宿主能力不直接成为 Profile artifact 对 `server/**` 的依赖。

### 6. 扩展测试运行在真实宿主中

VS Code 集成测试运行在 Extension Development Host 中，可使用完整 API。官方工具包括 `@vscode/test-cli`、`@vscode/test-electron` 和 Web 场景的 `@vscode/test-web`。

证据：[Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)。

NeuroBook 对应的测试不能只测 parser 或 catalog，还应覆盖：

```text
发现 -> 安装 -> 注册 -> 激活 -> 能力调用 -> 失败 -> 更新 / 卸载
```

## 三、对 NeuroBook 当前结构的映射

| VS Code | NeuroBook 当前对应物 | 判断 |
| --- | --- | --- |
| `package.json` manifest | Agent Asset Package、Profile Manifest、Skill frontmatter、Workflow definition | 有多套局部清单，尚未完全统一 |
| `contributes` | Profile `tools`、`settingsForm`、Workflow `argsHint`、Skill metadata、Agent catalog | 已有声明式能力，分散在类型内部 |
| Description Registry | SkillCatalog、WorkflowCatalog、AgentProfileCatalog、ProfileRegistry | 已有多个 registry，需要统一 snapshot 语义 |
| Activation Event | Profile invocation、source watcher、Workflow run、tool call | 源码构建与运行时激活尚未统一 |
| ActivationOperation | Harness invocation admission、Profile Build Coordinator、Runtime Hook | 有运行态，但没有统一插件激活协议 |
| Extension Host | Nitro server、Profile artifact import、Workflow restricted eval | 可执行资产仍主要在受信宿主内 |
| RPC | API DTO、SSE、SessionEventHub、Tool execution context | 事件通道较成熟，通用 capability bus 仍可抽象 |
| Workspace Trust | Project Workspace 与 asset origin | 当前协议明确仍是 owner-only trusted |
| VSIX / Marketplace | Agent Asset ZIP、Workshop、Install Root、provenance ledger | 安装和来源记账已经有较强基础 |
| Extension Development Host | workspace fixture、Profile artifact 测试、Agent 测试 | 需补“资产宿主”端到端测试矩阵 |

### 已经做对的部分

#### Profile Registry 已接近 VS Code 的 Registry / epoch 模式

`AgentProfileCatalog`：

- roots 由宿主显式传入，不从 cwd 或环境猜路径；
- 用户 Profile 按 key 覆盖系统 Profile；
- Runtime 只加载 `.compiled` artifact；
- 普通请求不编译 TSX；
- 通过显式 refresh 翻转运行时 registry。

`ProfileRegistry.publish()` 原子替换内存视图并递增 epoch。证据：

- `server/agent/profiles/catalog.ts`；
- `server/agent/profiles/profile-registry.ts`。

#### Profile artifact 发布边界比任意插件热加载更严格

当前协议有 staging、内容寻址 artifact、manifest 原子替换、per-root lock、源码 freshness 校验、Registry 翻转错误、GC 安全年龄、依赖白名单和 `4 MiB` artifact 上限。

证据：`reference/agent/profile-compiled-artifacts.md`、`server/agent/profiles/profile-artifact-compiler.ts`。

#### Tool Registry 已分离“模型可见能力”和“执行能力”

`AgentToolRegistry` 对外提供工具 schema；实际执行函数、审批、用户输入等待和 Workspace 写入元数据仍由 Harness / Tool Registry 控制。证据：

- `server/agent/tools/tool-registry.ts`；
- `server/agent/tools/types.ts`。

#### Harness 已有 TurnSnapshot 优势

Runtime Hook 合同把状态分为：

- `SessionLog`：append-only 持久事实；
- `RunFrame`：一次 invocation 运行态；
- `TurnSnapshot`：单次 Provider 请求冻结快照。

证据：`reference/agent/runtime-hooks.md`。这比把所有插件状态放在全局可变 singleton 中更适合多轮 Agent。

### 当前不一致

三类 Catalog 当前对高优先级同名资产损坏时的处理不同：

- Skill：用户目录含 `SKILL.md` 即占用 key；无效用户覆盖不会静默回退系统 Skill；
- Workflow：加载失败记录 warning 并跳过，可能继续看到系统同名 Workflow；
- Profile：用户 unloaded source 会删除同 key 的已加载 Profile，并保留不可用状态。

证据：

- `server/agent/skills/skill-catalog.ts`；
- `server/agent/workflow/workflow-catalog.ts`；
- `server/agent/profiles/catalog.ts`。

统一扩展协议需要显式决定：高优先级同 ID 资产损坏时，阻断低优先级回退，还是安全回退。不能在不同 Catalog 中继续隐式分叉。

冻结安装协议规定 Seed Root 不是 catalog 层，catalog 应是 Install Root -> Project Root；但现有若干 Catalog 仍以 `systemRoot` / `userRoot` 参数为主。这表明资产安装协议向统一运行时入口的切换仍有边界，后续应由宿主生成统一的 root snapshot。

还应保持：

```text
source change -> rebuild / invalidate
user or host event -> runtime activation
```

Profile watcher / Build Coordinator 解决源码构建，不等于 VS Code 的 Activation Event。两者合并会让半成品编译、构建失败和运行态激活互相污染。

## 四、VS Code View / Panel 与编辑器分屏机制

### 1. 声明层：View 是贡献点，不是任意组件注入

[已验证] 官方 `contributes.views` 要求每个 View 声明稳定 `id` 和 `name`，可贡献到 Explorer、SCM、Debug、Test 或扩展提供的自定义 View Container。打开 View 时，宿主触发 `onView:${viewId}` activation event；内容由 TreeView 数据提供者或 WebviewView provider 填充，而不是由清单直接注入任意 HTML / Vue 组件。证据：[Contribution Points](https://code.visualstudio.com/api/references/contribution-points#contributes.views)、[Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)。

官方文档的关键语义是：

> When the user opens the view, VS Code will then emit an activationEvent `onView:${viewId}`.

`contributes.viewsContainers` 声明容器的 `id`、标题和图标；当前官方文档列出的贡献位置是 Activity Bar (`activitybar`) 和 Panel (`panel`)。这把“资产声明了什么”与“宿主把它放进哪个工作台容器”分开。`when` 只控制 View 是否显示，不是执行权限或信任边界。

### 2. Workbench View 是三层模型：位置、容器、View

[已验证] VS Code 核心 `src/vs/workbench/common/views.ts` 定义了 `ViewContainerLocation`：`Sidebar`、`Panel`、`AuxiliaryBar`。`IViewContainersRegistry` 注册和注销容器，`IViewsRegistry` 注册和注销 View，`IViewDescriptorService` 负责查询位置、移动 View / Container、发出位置变化事件。它不是一个把 DOM 节点直接搬来搬去的 UI helper，而是先改描述和模型，再由宿主重排 UI。

`IViewDescriptor` 的字段已经覆盖大部分用户可见布局约束：

- `order` / `weight`：默认排序和初始尺寸权重；
- `collapsed`、`hideByDefault`、`canToggleVisibility`：初始或可切换的可见状态；
- `canMoveView`：是否允许用户把 View 移到别的容器；
- `workspace`：排序和可见状态是否偏向 Workspace 级保存；
- `when`：按 context key 控制贡献是否出现。

容器内部由 `ViewContainerModel` 维护三种集合：`allViewDescriptors`、`activeViewDescriptors`、`visibleViewDescriptors`，并提供 `setVisible`、`setCollapsed`、`setSizes`、`move`。状态模型显式包含 `collapsed`、`visibleGlobal`、`visibleWorkspace`、`active`、`order`、`size`。因此“注册过”不等于“当前可见”，也不等于“已经激活运行”。

### 3. 布局持久化分成位置定制和容器内状态

[已验证] `ViewDescriptorService` 将用户改变的 View / Container 位置写入 `StorageScope.PROFILE`、`StorageTarget.USER` 下的 `views.customizations`，结构包含：

```text
viewContainerLocations
viewLocations
viewContainerBadgeEnablementStates
```

它只保存偏离默认位置的定制：恢复到默认位置时会删除对应记录。View 容器自身的可见、折叠、顺序和尺寸状态由 `ViewContainerModel` 使用独立的容器存储标识保存，其中全局状态与 Workspace 状态分开。这样，用户通常想跨项目保留的“这个 View 放在 Panel 还是 Sidebar”不会和某个项目中的“这个 View 是否展开、当前多高”混成一个不可迁移的布局对象。

当用户把 View 移到某个区域而没有现成容器可承载时，`moveViewToLocation` 会注册一个 generated View Container；当它没有 View 且没有迁移中的 View 时，服务会清理该容器及其缓存。这个细节使“用户自由摆放”仍然有稳定的容器身份和可回收的空壳，而不是生成无法追踪的临时 DOM。

证据：[viewDescriptorService.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/browser/viewDescriptorService.ts)、[viewContainerModel.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/common/viewContainerModel.ts)、[views.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/views.ts)。

### 4. View / Panel 拖拽：先产生身份意图，再由模型执行迁移

[已验证] `src/vs/workbench/browser/dnd.ts` 的 `CompositeDragAndDropObserver` 不把组件实例或任意序列化对象放进拖拽数据，而只传递：

```ts
{ type: 'view' | 'composite'; id: string }
```

拖拽目标收到 `id` 后，再从 `IViewDescriptorService` 查询描述、来源容器和 `canMoveView`。目标根据允许性显示 `ViewPaneDropOverlay`；禁止移动的 View 或拒绝外来 View 的容器不会接受 drop。真正提交时调用 `moveViewsToContainer`、`moveViewToLocation` 或 `ViewContainerModel.move`，而不是让拖拽回调自行改一份 UI 数组。

同一 View Container 内部是**一维**的 `PaneView`：它基于 `SplitView` 堆叠 Pane，拖拽只改变顺序，sash 只改变相邻 Pane 的尺寸。`ViewPaneContainer` 的 overlay 根据容器方向把目标半区解释为上 / 下或左 / 右；Panel 的方向再根据 Panel 当前位于顶部、底部、左侧或右侧进行计算。跨容器拖拽则先迁移 View，再在目标容器内按锚点调整顺序。

官方用户文档确认了可见行为：View 和 Panel 可以在 Primary Side Bar、Secondary Side Bar、Panel 之间拖动，拖到现有 View 上可以创建分组，也可以用 **View: Move View** / **View: Move Focused View** 完成同样的迁移，并可用 **View: Reset View Locations** 恢复默认位置。官方原文：

> At any time, you can drag and drop views and panels into the Primary or Secondary Side Bar. VS Code will remember the layout of views and panels across your sessions.

证据：[Custom Layout](https://code.visualstudio.com/docs/configure/custom-layout#_drag_and_drop_views_and_panels)、[dnd.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/dnd.ts)、[viewPaneContainer.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPaneContainer.ts)、[paneview.ts](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/paneview.ts)。

### 5. 编辑器组的“切分”是另一套二维 Grid，不是 View Container 的升级版

[已验证] 编辑器区域使用 `Grid` / `GridView`，其内部是由正交 `SplitView` 组成的树。`GridLocation` 是从根开始的子节点索引路径；路径深度决定当前分支的方向，`Direction.Up` / `Down` / `Left` / `Right` 决定把新 View 放到参照 View 的哪一侧。`Grid.addView` 的 API 直接表达“相对哪个 View、向哪个方向、用何种尺寸策略插入”，因此可以表达多行多列，而不是只有一个 View 列表。

二维 Grid 的序列化也显式保存结构：`ISerializedGridView` 包含 `root`、`orientation`、`width`、`height`；叶子节点保存 View 数据、尺寸、可见性和最大化状态，分支节点保存子节点和尺寸。`EditorPart` 把 `serializedGrid`、活动组和最近使用组写进 UI memento，启动时通过 `SerializableGrid.deserialize` 恢复。这里持久化的是布局树，不是某个组件当前的 DOM 矩形。

官方用户文档把这个边界说得很清楚：拖动编辑器到边缘或使用 Split 命令创建 Editor Group；需要多行多列时使用 Grid layout，并通过 sash 调整组大小。编辑器、Terminal 或特定 View 还可以脱离到浮动窗口，但浮动窗口是跨 Window 的另一层生命周期，不应和普通 View Container 的组内拖拽混为一谈。

因此，VS Code 的“随意拖拽、分屏”实际是至少四种不同操作：

| 用户动作 | 真实模型操作 | 结果 |
| --- | --- | --- |
| 在同一容器内拖 View | `PaneView.movePane` / `ViewContainerModel.move` | 改变一维顺序 |
| 把 View 拖到 Sidebar、Panel 或 AuxiliaryBar | `moveViewsToContainer` / `moveViewToLocation` | 改变容器归属，位置可持久化 |
| 拖到已有 View 上 | 目标容器迁移 + 锚点排序 | 形成同一容器内的分组 |
| 把编辑器拖到边缘或执行 Split | `Grid.addView` / Grid 树变换 | 创建二维 Editor Group 分割 |

证据：[Grid API](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/grid.ts)、[GridView](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/gridview.ts)、[EditorPart](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts)、[Custom Layout 的 Grid layout](https://code.visualstudio.com/docs/configure/custom-layout#_grid_layout)。

### 6. 对 NeuroBook 当前工作台的映射

[已验证] NeuroBook 已有一套适合继续复用的宿主边界：

- `app/pages/index.vue` 由宿主持有 `agentPanelOpen`、`layoutMode` 和多个面板尺寸；Agent Panel 只有在打开后才挂载完整 Agent Surface，避免普通启动提前建立 Session / SSE；
- `app/stores/novel-ide.ts` 持有 `agentPanelWidth`、`agentSessionPanelWidth`、`agentStudioPanelWidth`、`agentStudioFileTreeWidth` 和 `leftPanelWidth`，并通过 Pinia 持久化分成 `novel.ide.session` 与 `novel.ide.local`；
- `app/composables/useResizablePanel.ts` 统一处理边缘拖拽、最小 / 最大尺寸、`requestAnimationFrame` 合并 pointer move，以及 `onResize` / `onResizeEnd` 提交；
- `app/AGENTS.md` 已明确：可调整面板必须使用 `useResizablePanel.ts`，尺寸由宿主保存，组件通过 `update:width` / `update:height` 回传。

[从代码推断] 当前工作台仍是固定槽位和固定布局模式：`layoutMode` 在 `ide` / `agent` 之间切换，Agent 面板和 Studio / Session / File Tree 之间有显式的 open、width、resize handle 状态，但尚未形成 VS Code 式的通用 View Descriptor、View Container Registry、跨容器拖放协议或二维布局树。现有尺寸持久化是可复用基础，不应被新的布局模型替换成组件自行读写浏览器存储。

对 NeuroBook 的建议不是复制 VS Code 的所有 UI，而是借鉴它的控制平面：

1. **先统一描述，再允许移动。** 为可贡献的工作台 View 建立稳定 `viewId`、默认容器、允许位置、默认顺序、可移动性、可见性、尺寸策略和 activation reason；运行时组件仍通过固定的 Vue host / provider 创建，不开放任意第三方 Vue 组件直接注入主应用。
2. **把拖拽变成宿主命令。** DND 层只产生 `{ viewId, targetContainerId, position }` 意图；宿主校验 `canMove`、目标容器、trust / capability 和当前布局版本，再一次性更新布局快照。组件不能在 drag callback 中各自维护顺序和持久化。
3. **沿用现有尺寸宿主。** View Container 的 `size` 应通过 `useResizablePanel` 和现有 `update:width` / `update:height` 边界提交；不要为 View 系统再引入第二套 resize composable。拖拽排序、容器迁移和 resize 是三种不同命令，分别记录以便恢复和诊断。
4. **先实现一维容器，后实现二维 Grid。** Sidebar / Panel / Agent 面板先支持容器内排序、跨容器迁移、折叠和尺寸记忆；只有编辑器或真正需要同时展示多块内容的工作台才引入 Grid 树。不要把所有 Panel 都强行建模成二维 Grid，否则每个浮层、侧栏和响应式断点都要承担复杂的树合并、最小尺寸和恢复冲突。
5. **明确状态作用域。** 可跨 Project 复用的容器位置、View 顺序和用户隐藏状态放用户级布局；某个 Project 的打开 View、折叠状态和工作区尺寸放 Project / Workspace 级布局；Session / SSE / Agent 运行态仍留在现有 Session / RunFrame / TurnSnapshot 生命周期内，不写入布局快照。
6. **保持惰性激活和安全边界。** View 的描述、图标、菜单和允许位置可以在启动时登记；真正的 Profile / Workflow / Tool / Agent Surface 运行时在 View 打开或命令触发时激活。`when` 或 View 可见性不得替代 `assetTrust`、`workspaceTrust`、`processTrust` 和工具审批。

一个足够小的布局快照应至少能表达 `schemaVersion`、容器位置和顺序、View 的容器归属 / 顺序 / visible / collapsed / size、可选的 Grid 树以及 active View；所有改变都应通过版本化的宿主操作提交。这个建议是研究映射，不是已批准的 Spec。

### 7. 工作台分阶段建议

| 阶段 | 建议行为 | 不做什么 |
| --- | --- | --- |
| P0 | 固定 View / Container 描述、位置枚举、移动能力、状态作用域和布局快照版本；复用现有 resize 宿主 | 不开放任意第三方组件注入，不做全局二维布局 |
| P1 | 在稳定容器之间支持拖拽迁移、容器内排序、折叠、尺寸恢复、键盘 Move 和 Reset；建立非法目标 / 冲突恢复测试 | 不把拖拽事件直接绑定到业务组件数组 |
| P2 | 为编辑器 / 复杂工作台增加二维 Grid、方向切分、sash 尺寸和树快照恢复；必要时再研究浮动 Window | 不把 Panel、Dialog、Popover 和 Editor Group 混用一个布局树 |

## 五、对 NeuroBook 的阶段性建议

### P0：先固定控制平面合同

通过 Proposal、planned Spec 和必要 ADR 明确：

- 统一资产身份、版本和兼容性；
- Seed / Install / Project Root；
- 同名覆盖、损坏和回退；
- activation event 命名；
- dependency、host、capability 和 trust 类型；
- View / Panel 是否属于资产贡献点。

### P1：建立统一 Description Registry

新增只处理描述信息的 registry：

```text
manifest -> descriptor -> immutable snapshot -> epoch
```

它只负责解析 manifest、验证固定入口、记录 source / root / contentHash、处理覆盖、建立 activation / dependency 索引和输出不可用状态，不编译 Profile、不执行 Workflow、不执行 Tool、不读 Provider、不直接发 UI 事件。

### P1：分离构建失效和运行时激活

增加类似 VS Code `ActivationOperation` 的状态：

```text
discovered -> eligible -> activating -> active
                         -> activation_failed
                         -> dependency_failed
                         -> incompatible
                         -> disabled
```

每个操作应记录 activation reason、依赖、耗时、取消、失败原因和可观察诊断。

### P1：第三方可执行资产先隔离，再扩大 Workshop

当前 owner-only 私有内测可以继续使用 trusted source，但这必须保持为阶段性边界。公开分发前需要独立进程或等价隔离、能力 token、路径 containment、网络 / 进程 / 凭据默认关闭、超时和取消、崩溃恢复、结构化 RPC、错误脱敏和依赖安装策略。

现有 Workflow 的 `new Function` + 禁止 `require` 是受限求值边界，不是恶意代码安全沙箱。现有资产协议已明确 TypeScript AST 检查不是安全沙箱，第三方执行威胁模型尚未完成。

### P2：优先增加声明式 UI 贡献点

优先级建议：

1. commands；
2. settings；
3. menus；
4. views / view containers；
5. workflow args form；
6. profile settings form；
7. Agent / Skill catalog entry。

暂不支持任意第三方 Vue 组件直接注入主应用。

### P2：建立资产宿主 Smoke Matrix

至少覆盖 bundled、local、Workshop-like、invalid、incompatible、missing dependency、dependency cycle、activation failure、tool approval、Workspace write、cancel、host crash、update conflict 和 uninstall。

## 六、当前决策点

### 决策点一：第三方资产是否允许自动执行代码

- 推荐：第三方先只允许声明式资产；可执行 Profile / Workflow 等待隔离宿主完成后开放。
- 内测选项：继续 owner-only 全信任，成本低但不能直接扩展到公开 Workshop。
- 高安全选项：立即实现隔离宿主，边界完整但需要较多进程、RPC、授权和恢复工作。

这是低可逆决策。公开安装并执行第三方代码后，再撤回信任会涉及依赖、脚本和本地数据。

### 决策点二：统一 manifest，保留类型化固定入口

推荐统一身份、版本、来源、兼容性、activation、host、capabilities 和 contributions，但保留：

- Skill 的 `SKILL.md`；
- Workflow 的 `workflow.ts`；
- Profile 的 `<name>.profile.tsx`；
- Tool 的 Typed Definition。

不建议把所有资产改造成任意扩展代码。

### 决策点三：采用惰性激活

推荐启动时只加载描述和声明式贡献，Profile invocation、Workflow run、Tool call 或 View 打开时再初始化运行时。这样可以保留 catalog 的即时可见性，同时降低启动、内存和失败面。

## 检查边界

### 已验证

- VS Code 官方 Extension Manifest、Contribution Points、Activation Events、Extension Host、Remote Extensions、Web Extensions、Workspace Trust、Webview、Publishing、Testing、Proposed API、When Clause 文档，以及 `contributes.views` / `contributes.viewsContainers`、Tree View、Custom Layout 文档；
- VS Code 核心源码中的 `ExtensionDescriptionRegistry`、`ExtensionsActivator`、`ExtensionHostManager`、`ExtHostCommands`、`ExtHostRpcService`；
- VS Code 核心源码中的 `views.ts`、`viewDescriptorService.ts`、`viewContainerModel.ts`、`viewPaneContainer.ts`、`paneview.ts`、`dnd.ts`、`grid.ts`、`gridview.ts` 和 `editorPart.ts`；
- NeuroBook 的 Profile、Skill、Workflow、Tool、Harness、Session Event、artifact、asset package 和 install protocol；
- NeuroBook 前端 `app/pages/index.vue`、`app/stores/novel-ide.ts`、`app/composables/useResizablePanel.ts` 及 `app/AGENTS.md` 的现有面板宿主与尺寸持久化约定。

### 从代码推断

- NeuroBook 尚未形成覆盖所有资产类型的统一 manifest、contribution registry 和 activation scheduler；
- 三类 Catalog 的覆盖和错误回退语义不一致；
- 当前 Workflow 受限求值与 Profile dependency gate 都不是面向恶意第三方代码的完整安全沙箱；
- 现有资产安装协议和各 Catalog 运行时入口仍存在迁移边界；
- 当前工作台仍以固定槽位、`ide` / `agent` 布局模式和宿主持有的尺寸状态为主，尚未形成通用 View Descriptor、View Container Registry、跨容器拖放协议或二维布局树。

### 未验证

- 未构建或运行 VS Code；
- 未运行 NeuroBook 测试、安装链、Workshop 或真实 Provider；
- 未通过浏览器或实际桌面窗口逐项验收 View 拖拽、容器迁移、布局恢复、编辑器 Grid 分屏或浮动窗口行为；
- 未对 VS Code Marketplace 服务端、扩展签名验证链和更新服务内部实现做完整审计；
- 本次调研没有修改 NeuroBook 产品源码、测试或产品规范，仅更新本研究文档。

## 当前状态

本文件现在同时保存 VS Code 扩展控制平面与 View / Panel 布局机制的研究证据。任何采用的行为合同必须继续落到 `docs/specs/`；长期且难以逆转的取舍应进入 ADR。调研原文不替代 Spec、Proposal 或实现代码。
