# 12 Workbench View 宿主重构：从固定槽位到描述驱动

> 本章保存研究时的源码映射与建议，不是产品合同。当前已登记 [ui.workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)、
> [storage.persistence](../../../../../docs/specs/storage/persistence.md) 与 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)；后续实现按这些 Spec，不按本章历史切片直接开工。
> 证据状态：**已验证当前实现** = 当前包内源码与已读测试直接确认；**研究建议** = 对下一阶段宿主抽象的映射；**未验证/候选** = 没有 View Registry、真实 UI 或组合行为证据。

## 结论先行

NeuroBook 当前 Workbench 是 `app/pages/index.vue` 的固定槽位组合，不是 VS Code 式 View Registry：Activity Bar 有固定 union，左侧 Tool Panel 有固定三项，中央是单 Editor Group，Agent Surface 可作为右侧 drawer 或 Agent mode 中栏，World/Trace/History 多数是页面级 Dialog。现有 `useWorkbenchChrome` 是 app-scoped 的单槽 Chrome 状态注册表，不能直接当作 View Registry。

研究建议采用一个**app-scoped、host-owned、第一方 factory-only** 的 View 宿主：

```text
View descriptor（稳定身份/元数据/容器意图）
  → Host registry（校验重复 id/context/作用域）
  → Host container（位置、顺序、可见性、尺寸）
  → First-party view factory（宿主内部绑定）
  → Project/Session/Workspace authority
```

第一阶段只抽象描述、容器、生命周期和布局意图；不开放第三方 Vue component、render function、HTML/CSS、任意模块路径，不把 Editor Group/Split 伪装成 View Container，也不引入第二套 resize 或私有存储。

## 1. 当前宿主底图

### 1.1 页面槽位和入口分类

`app/pages/index.vue` 的模板直接装配 Activity Bar、Agent Session Sidebar、`NovelIdeToolPanel`、`MarkdownStudioWorkbench`、`AgentChatSurface` 和多个 Dialog。当前入口按行为分类如下：

| 入口/区域 | 当前组件或状态 | 当前分类 | 研究判断 |
| --- | --- | --- | --- |
| `files` | `NovelIdeToolPanel` 内 `WorkspaceFilePanel` | View，位于固定 Tool Container | 适合第一批 descriptor→container→view 迁移 |
| `characters` | `NovelIdeToolPanel` 内 `WorkspaceCharacterPanel` | View，位于固定 Tool Container | 可作为 Character Proposal 的第一方消费者；Proposal 仍为 reviewing，不是宿主合同 |
| `plot` | `NovelIdeToolPanel` 内 `NovelPlotPanel`，另有 `PlotWorkbenchDialog` | 左侧 View + 专用 Workbench/Dialog command | 不把 Dialog 和侧栏 View 合并成一个几何模型 |
| `world` | `WorldEngineWorkbenchDialog` | command 打开的专用 Workbench/Dialog | 继续以命令/对话框为主，不强行注册为侧栏 View |
| `trace` | `AgentTraceViewerDialog` | command 打开的诊断 Dialog | 诊断结果的 scope 与面板可见性分开 |
| `history` | `WorkspaceHistoryInboxDialog` | command 打开的 History Dialog | Project history authority 不交给 View |
| `agent-panel` | `AgentChatSurface` | 右侧停靠 View；Agent mode 时复用同一实例 | 候选 View，但 Session/Project lifecycle 必须仍由宿主拥有 |
| `home` | `ProjectPickerScreen` 或路由动作 | 整页入口/command | 不是 Tool Container 内 View |
| `account` | Account/Profile Dialog | command + Dialog | 不占用 Project View scope |
| `settings` | Settings Dialog | command + Dialog | 配置 authority 仍由宿主服务拥有 |
| Markdown Studio | `MarkdownStudioWorkbench` | Editor Part / 单 Editor Group | 与 View Container 分开；当前无 Editor split |
| Agent mode Studio | Markdown Studio + file tree | layout mode 下的 Editor/辅助 View | 不因三栏布局创建第二套 Editor Group 合同 |

`NOVEL_IDE_TABS` 只有 `files | characters | plot`；`WorkbenchActivityItemId` 有十个固定 id：`home`、`files`、`characters`、`plot`、`world`、`trace`、`history`、`agent-panel`、`account`、`settings`。`createWorkbenchActivityItems(context)` 根据 `desktopAvailable`、`surfaceActive`、`userAssetsMode` 计算 disabled，但不登记可扩展 descriptor。

### 1.2 当前状态 owner

`useNovelIdeStore` 当前持有：

- `activeLeftTab`、`layoutMode`；
- `agentPanelWidth`、`agentSessionPanelOpen/Width`、`agentStudioPanelOpen/Width`、`agentStudioFileTreeWidth`、`leftPanelWidth`；
- `workspaceTabs`、`workspaceBuffers`、`workspaceSessions`、`activeWorkspaceTabPath`；
- `plotWorkbenchOpen`、`plotWorkbenchTab`、选择项和 Project catalog generation。

持久化分为两条已验证链：

- `novel.ide.local`：localStorage 中的用户级 Activity/宽度/主题/编辑器偏好等；
- `novel.ide.session`：当前仍由 sessionStorage 承载、按 `user-assets` 或 `novel:<projectRoot>` 分区的 Workspace editor tabs/buffers/session 状态。2026-09-15 作用域取舍见 [ADR 0020](../../adr/0020-user-project-storage-boundaries.md)：项目界面记忆与用户资产界面记忆分别归 Project/User，未保存正文继续由编辑器恢复合同负责；不能把整个桶都迁入 Project Storage。

`layoutMode` 和 `plotWorkbenchOpen` 当前不是同一套“布局快照”中的持久化字段；`AgentModeSessionSidebar` 还有组件私有的 pinned session localStorage。这是现状，不应在研究文档中假设已拥有统一作用域。

### 1.3 Editor 与 View 的边界

`shared/editor-workbench.ts` 只有固定 `WorkspaceEditorKind = "markdown" | "monaco" | "readonly"` 和 `WorkspaceEditorViewMode = "rich" | "source"`。`resolveWorkspaceEditorKind(path, editable)` 根据文件可编辑性与 `.md` 扩展名选择 Editor 类型；这属于文件编辑器分发，不是 View contribution。

当前中央工作区是单编辑器/单标签模型：`MarkdownStudioWorkbench` 根据 active path 重挂载内容，没有 `EditorGroup`、二维 split 或可持久化 Editor grid 证据。第一阶段必须保留这一边界；先解决 View 容器和 Editor Part 的身份混淆，再决定是否研究 split。

## 2. 推荐的 View 宿主模型

### 2.1 Descriptor 只表达宿主意图

这是研究建议，不是当前 API。descriptor 的最小信息应限定为：

| 信息 | 用途 | 不允许携带 |
| --- | --- | --- |
| 稳定 `viewId` | 路由、恢复、事件和诊断索引 | 临时数组下标或组件实例地址 |
| 展示 metadata | 标题、图标、tooltip、可见入口 | 任意用户文案注入 HTML |
| 默认 `containerId` | 初始容器归属 | 绕过宿主布局的绝对 DOM selector |
| 可见条件 | 当前 workspace/project/context 是否可用 | 把可见条件当权限凭证 |
| 移动/尺寸约束 | 能否移动、最小/最大宽度、是否允许隐藏 | 私有 localStorage 或自建 resize handler |
| 所需 authority 标签 | 需要 Session、Project、Workspace 或纯 UI context | secret、raw filesystem path、Harness 实例 |
| state scope | user、Project 的恢复范围；页面瞬时态留内存 | 把所有状态塞进一个 view state blob |

View factory、service、数据 authority 和 storage 由宿主内部绑定。descriptor 不应暴露 Vue component、render function、HTML/CSS、绝对文件路径或可执行模块路径。第一阶段只登记仓库内第一方组件，扩展系统尚不能贡献第三方组件。

### 2.2 Container、Editor、Dialog 的分层

```text
Workbench shell
├── Activity Bar：入口索引，不等于 View
├── View Container：一维 View 顺序/可见性/尺寸
│   ├── files View
│   ├── characters View
│   └── plot View
├── Editor Part：当前单 Editor Group、tabs、dirty/flush
├── Agent View Container：Agent Session/Chat 的宿主槽位
└── Dialog/Workbench commands：world、trace、history、settings、account
```

容器只持有 View 的位置、顺序、可见性和面板几何；Editor Part 持有文件资源、Editor kind、tabs、dirty、save 和恢复；Dialog 由 command 按需打开。这样 `plot` 的左侧入口与 Plot Workbench Dialog 可以共享 command/authority，却不共享同一个布局状态。

### 2.3 生命周期和异步发布权

研究建议的宿主生命周期：

```text
described
  → eligible（当前 context 可用）
  → instantiated（首次需要时创建第一方组件）
  → visible ↔ hidden
  → disposed
  → error（保留 descriptor 与结构化 issue）
```

这些状态不能合并为 `open: boolean`：

- `described` 只表示 descriptor 已登记；
- `eligible` 表示 Project/Session/Workspace authority 可用；
- `instantiated` 表示组件创建，不表示 Provider/Job 已运行；
- `visible` 只表示 UI 可见，不表示模型调用成功；
- `disposed` 释放组件监听和临时资源；
- `error` 保留可诊断 issue，不能静默换成同名低优先级 View。

当前可复用的异步先例是 `AgentSurfaceOperationController`：它捕获 Project ready revision/scope，旧操作完成时返回 `superseded`，不把迟到结果、错误或 finally 写回当前 surface。View Host 应借用这条发布权原则，但不复制 Agent Session 业务状态。

## 3. 状态作用域与迁移顺序

### 3.1 历史状态映射与当前归属

下表是研究时的实现归类；当前 Storage 只有 user/project，Session/page 指内存生命周期。
2026-09-16 已决定主工作台和 World Engine 尺寸为 project/local，用户资产/未开项目尺寸为显式 user/local，详见 storage.persistence。

| scope | 应保存什么 | 当前对应 owner | 研究边界 |
| --- | --- | --- | --- |
| 用户级 | Activity/Container 位置、View 顺序、面板宽度、可隐藏偏好 | `novel.ide.local`、store 宽度字段 | 不把 Project 文件、Session 内容或 secret 放入布局快照 |
| Project 级 | 当前 editor tabs/buffers、选中的 View/文件、Project-specific selection | `novel.ide.session` 的 `novel:<projectRoot>`、Workspace store | 需要在 Project generation 变化时失效旧异步发布权 |
| Session/page 级 | Agent panel 展开、Dialog 临时开关、当前 invocation/preview | `index.vue` refs、Agent Surface session scope | 不跨 Project 重用临时运行实例 |

尺寸继续复用 `useResizablePanel`：`clampResizablePanelSize` 先限制范围，拖拽中通过 requestAnimationFrame 合并 preview，宿主在 `onResize`/`onResizeEnd` 提交。不得为 View contribution 创建第二个 resize helper。

### 3.2 第一方迁移顺序

1. **登记现状 descriptor**：为 `files`、`characters`、`plot` 建立第一方描述映射，但保持现有 `NOVEL_IDE_TABS` 和组件入口，先证明 id、容器和 disabled context 一一对应。
2. **抽宿主容器边界**：让 `NovelIdeToolPanel` 继续持有 resize 和宿主宽度；三项 View 只消费宿主传入的 Project/workspace context，不自行持久化宽度。
3. **迁移 Project generation 守卫**：沿用 `useProjectSession` 的 `opening/reconnecting/ready/failed` 与 `ProjectSessionSupersededError`；切换 Project 前走 dirty editor flush、save/discard/cancel，再清理旧 Dialog/Agent surface。
4. **保留专用 Dialog**：`world`、`trace`、`history`、settings、account 继续是 command/Dialog，记录其 command 入口和 authority，不迁入一维 View Container。
5. **接 Agent View**：在 Agent drawer 与 Agent mode 复用一个宿主 descriptor，但保持 Agent Session/Job/Attachment 状态由既有 server authority 所有。
6. **最后研究扩展贡献**：只有第一方 View 的空 registry、重复 id、恢复缺失和工厂错误均有证据后，才研究外部 contribution 描述；不直接开放组件实例。

## 4. 失败与恢复

| 场景 | 宿主应观察到什么 | 当前证据/研究处理 |
| --- | --- | --- |
| 空 registry | 保留宿主 shell，显示没有可用 View；不崩溃、不注入 fallback 组件 | 当前没有 View Registry；第一方迁移须定义稳定空态 |
| 重复 `viewId` | 新 descriptor 不发布，保留结构化 issue；不能按注册顺序静默覆盖 | 当前 Activity union 只在编译期约束；重复 id 运行时行为未验证 |
| 不可用 Project/Session context | descriptor 可存在但为 `ineligible/hidden`；不创建数据面组件 | `projectSurfaceActive` 只在 exact ready Project 后挂载；可作为宿主先例 |
| 恢复目标已删除 | 丢弃该位置/选中项，回到 descriptor 默认容器；保留 issue 供诊断 | 当前 `restoreWorkspaceSession` 未见恢复路径存在性校验；标为研究缺口 |
| View factory 抛错 | View 进入 error，其他 View/Editor 继续可用；不把 command 报成功 | 当前没有统一 factory error model；禁止静默 catch 后显示空面板 |
| 布局快照损坏 | 使用安全默认布局，保留原快照供诊断，不写入任意未知字段 | 当前 local/session 恢复分散；需要专用 snapshot 校验研究 |
| Project 切换时 dirty editor | 先 `registerActiveEditorFlush`，按既有 save/discard/cancel 决策；取消则恢复 URL/旧 surface | `syncWorkspaceRoute`、`resolveUnsavedWorkspaceChanges` 和 `saveDirtyWorkspaceFiles` 已有代码证据 |
| 旧异步结果迟到 | 返回/投影为 `superseded`，不通知用户、不写当前 View | `AgentSurfaceOperationController`、Project route revision、store catalog generation 有先例 |
| View hidden/disposed 时有 Job | Job 状态继续由 Job durable truth 管理；View 只停止展示/订阅，不取消未知副作用 | `AgentJobManager` 与 UI scope 分离；不能把 unmount 当 Job cancel |

## 5. 场景烟测的研究判定

### 场景：点击 Characters，再切换 Project

当前代码可追踪为：

```text
Activity item "characters"
  → NovelIdeActivityBar.invoke("open-tab")
  → index.vue.handleSidebarToggle
  → activeLeftTab = "characters"
  → NovelIdeToolPanel
  → WorkspaceCharacterPanel

切换 Project
  → route intent revision
  → dirty editor flush/save-discard-cancel
  → releaseProjectSurface
  → ProjectSession.open + presence_ready
  → switchToNovelWorkspace
  → exact ready revision
  → 新 View/Agent surface 允许挂载
```

当前已验证的保护是 Project route revision、ProjectSession token/ready revision、workspace editor flush 和 Agent surface operation scope；尚未验证的是 descriptor registry、View Container 迁移、布局快照损坏和 View factory error。该差距正是本章研究对象，不应改写成已实现的 View Host。

## 6. 源码锚点与检查边界

### 当前实现锚点

- [`../../../app/pages/index.vue`](../../../app/pages/index.vue)：固定槽位、`projectSurfaceActive`、Agent drawer/Agent mode、Dialog 装配、route sync、`releaseProjectSurface`。
- [`../../../app/stores/novel-ide.ts`](../../../app/stores/novel-ide.ts)：`activeLeftTab`、`layoutMode`、面板宽度、workspace tabs/buffers/sessions、`persistWorkspaceSession`、`restoreWorkspaceSession`、`registerActiveEditorFlush`、catalog generation。
- [`../../../app/utils/workbench-chrome.ts`](../../../app/utils/workbench-chrome.ts)：`WorkbenchActivityItemId`、`createWorkbenchActivityItems`、disabled context 和 More 溢出。
- [`../../../app/composables/useWorkbenchChrome.ts`](../../../app/composables/useWorkbenchChrome.ts)：app-scoped `createWorkbenchChromeRegistry`，只有当前 Chrome registration 单槽。
- [`../../../app/composables/useResizablePanel.ts`](../../../app/composables/useResizablePanel.ts)：clamp、requestAnimationFrame 合并、preview/commit 的唯一 resize 宿主。
- [`../../../app/components/novel-ide/NovelIdeToolPanel.vue`](../../../app/components/novel-ide/NovelIdeToolPanel.vue)：`files/characters/plot` 固定 View 槽位与面板 resize。
- [`../../../app/components/novel-ide/NovelIdeActivityBar.vue`](../../../app/components/novel-ide/NovelIdeActivityBar.vue)：Activity id 到 open-tab/command/dialog emit 的映射。
- [`../../../shared/editor-workbench.ts`](../../../shared/editor-workbench.ts)：固定 `WorkspaceEditorKind`、ViewMode 与文件到编辑器的解析。
- [`../../../app/composables/useProjectSession.ts`](../../../app/composables/useProjectSession.ts)：Project `idle/opening/reconnecting/ready/failed`、token、ready revision、superseded。
- [`../../../app/components/novel-ide/agent/agent-chat-surface-state.ts`](../../../app/components/novel-ide/agent/agent-chat-surface-state.ts)：`AgentSurfaceOperationController` 的旧 scope 结果隔离测试先例。
- [`../../../app/utils/workbench-chrome.test.ts`](../../../app/utils/workbench-chrome.test.ts)、[`../../../app/composables/useWorkbenchChrome.test.ts`](../../../app/composables/useWorkbenchChrome.test.ts)、[`../../../app/stores/novel-ide.test.ts`](../../../app/stores/novel-ide.test.ts)、[`../../../app/composables/useProjectSession.test.ts`](../../../app/composables/useProjectSession.test.ts)、[`../../../shared/editor-workbench.test.ts`](../../../shared/editor-workbench.test.ts)：当前已核对的 Workbench/布局/Project Session/Editor 测试锚点。
- [`../../proposals/character-workbench.md`](../../proposals/character-workbench.md)：Character Proposal `reviewing`，不能当 View Host 合同。

### 检查边界

本章读取了当前页面、store、Activity/Chrome、resize、Project Session、Editor 类型和相关测试索引；没有实现 View Registry，没有执行浏览器 UI 验收，没有发现 Editor Group/Split、View descriptor 或第三方组件 contribution 代码。因此 descriptor 字段、生命周期名称和迁移顺序均是**研究建议**，不是当前 API 或已批准 Spec。
