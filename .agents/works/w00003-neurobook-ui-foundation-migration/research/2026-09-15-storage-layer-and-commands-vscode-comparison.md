# 存储层与命令系统：对照 VS Code 的设计调研（2026-09-15）

> Storage 部分已由后续 [概念与同步取舍](2026-09-15-storage-concepts-and-sync.md) 修正；
> 已确定的 scope 见 [ADR 0020](../../../../packages/neuro-book/docs/adr/0020-user-project-storage-boundaries.md)。
> 下文 session/window 建议、USER 标记即同步等说法不作为当前 Storage 设计依据；命令系统不在本轮范围。

状态：调研结论，供开发者拍板；未改代码、未改规范。证据文件：同目录 [`2026-09-15-vscode-source-check-storage-grid-commands.md`](2026-09-15-vscode-source-check-storage-grid-commands.md)（omp 子代理逐文件实读 VS Code main 源码，每条带 URL）。仓库侧事实全部标了 `文件:行`。

标注约定：**[已核实]** = 读到源码/仓库原文；**[从代码推断]** = 由现有实现推出但未跑；**[未验证]** = 记忆或猜测。

## 一句话结论

1. **grid 尺寸不该是 session 级。** VS Code 把 part 尺寸存在 PROFILE/MACHINE（跨工作区、本机、永久），可见性与位置存在 WORKSPACE/MACHINE；它根本没有 session 级 storage，连扩展 API 都没有。我们今天的 `novel.ide.local` 存左右栏宽度是对的，缺的是可见性没进快照，以及「session」一词在仓库里同时指浏览器标签页寿命和 Agent 会话身份两件事。
2. **World Engine 能复用主界面 grid，尺寸走「按视图 id 的 memento」，插件永远不碰存储介质与键名。** nb-ui 的 `createGrid` 和 `WorkbenchBranch` 已经是通用的，不通用的只有 `WorkbenchShell.vue` 里那段编排。VS Code 的先例是 EditorPart：同一个 `SerializableGrid` 原语，序列化后存进自己的 memento，与主布局互不知情。
3. **VS Code 底层不是「一切皆命令」。** 具名动作（菜单、命令面板、快捷键、扩展调用）确实汇聚到 `ICommandService.executeCommand` 这一条管线；但控件手势（活动栏图标点击、sash 拖拽、tab 点击）直接调服务，不发命令。两条路殊途同归是因为都落到同一个 **服务**（`layoutService.setPartHidden`），不是因为点击变成了命令。别的模块订阅的是服务事件和 context key，不是命令事件；扩展 API 甚至没有 `onDidExecuteCommand`。

## 1. VS Code 存储层的骨架 [已核实]

一个服务 `IStorageService`，两条正交的轴，落到三个物理库：

| 轴 | 取值 | 含义 |
|---|---|---|
| `StorageScope` | `APPLICATION` / `PROFILE` / `WORKSPACE`（另有 `APPLICATION_SHARED`） | **寿命与归属**：跨所有工作区 / 跟随 profile / 只属当前工作区 |
| `StorageTarget` | `USER` / `MACHINE` | **是否随 Settings Sync 漫游**：USER 跨机器同步，MACHINE 只留本机 |

物理落点（桌面）：`User/globalStorage/state.vscdb`（APPLICATION 与默认 profile）、`User/profiles/<id>/globalStorage/state.vscdb`、`User/workspaceStorage/<hash>/state.vscdb`。**工作区状态不放在工作区目录里**，放在用户数据目录下按工作区 URI 哈希分目录；Web 端换成 IndexedDB `vscode-web-state-db-*`。

三个对我们最有用的机制：

- **Memento**：`memento/<组件 id>` 一个 key 存**整个 JSON 对象**，组件在 `onWillSaveState`（关机前和周期性）时把状态写回。扩展侧同样：storage key = 扩展 id，值 = 整个对象；`workspaceState` 落 WORKSPACE/MACHINE，`globalState` 落 PROFILE/MACHINE。扩展只拿到 `get/update/keys`，看不到 scope、介质、真实键名。
- **没有 session 级**：`StorageScope` 四个值里没有 session；内存库只在扩展测试、主进程 KILL、数据库初始化前/失败三种内部情形出现，扩展没有任何 API 能拿到「关窗即丢」的存储，只能靠宿主进程内存变量。
- **共享但不持久的状态 = ContextKey**：`IContextKeyService` 存内存里的键值（`sideBarVisible` 之类），可按 DOM 目标建 scoped 子服务与 overlay，`when` 子句对它求值；扩展只能 `setContext` 写、`when` 读。这就是「不持久化但要共享」那一类的正解，不是 storage 的一个 scope。

### 主布局怎么存 [已核实，纠正记忆]

VS Code **不序列化主 workbench grid**。`createGridDescriptor()` 每次启动重建固定拓扑，每个 part 的尺寸与可见性是独立 key（前缀 `workbench.`）：

| 状态 | scope / target |
|---|---|
| `sideBar.size` `panel.size` `auxiliaryBar.size` | PROFILE / MACHINE（跨工作区、本机） |
| `sideBar.hidden` `panel.hidden` `auxiliaryBar.hidden` `activityBar.hidden` `statusBar.hidden` | WORKSPACE / MACHINE（按工作区） |
| `sideBar.position` `panel.position` | WORKSPACE / MACHINE |
| `panel.alignment` | PROFILE / **USER**（唯一会漫游的布局项） |

真正 `serialize()` 的是 **EditorPart 的编辑器分组 grid**：`memento/workbench.parts.editor` 字段 `editorpart.state`，WORKSPACE/USER。视图容器（侧栏里的 pane 列表）不是 grid 而是 SplitView，状态存 `<viewContainerId>`（WORKSPACE/MACHINE：collapsed / isHidden / size / order）和 `<viewContainerId>.hidden`（PROFILE/USER）。WebviewView 的内容状态由宿主存 `memento/webviewView.<viewId>`（WORKSPACE/MACHINE），扩展只在 resolve 时拿回 `state`。

**读法**：尺寸是「这个人的使用习惯」→ 跨工作区；显隐和位置是「这个工作区正在做什么」→ 按工作区；只有极少数是「设置」才漫游。

## 2. 仓库现状对照

| 状态 | 现在在哪 | 对照 VS Code | 判断 |
|---|---|---|---|
| 左右栏宽度 `leftPanelWidth` / `agentPanelWidth` | `novel.ide.local`（localStorage，`app/stores/novel-ide.ts:1946-1975`），由 `WorkbenchShell.vue:159-163` 拖拽落账写回 | PROFILE/MACHINE | 层级正确 |
| 叶显隐 `hidden` | `WorkbenchShell.vue:62` 组件内 `ref`，**不持久化** | WORKSPACE/MACHINE | 与 Spec 「区域尺寸与可见性进布局快照」（`docs/specs/ui/workbench-shell.md:54,62`）不符，是缺口 |
| 打开的 tab、缓冲、撤销栈、当前项目 | `novel.ide.session`（sessionStorage） | VS Code 把编辑器分组与打开文件按 WORKSPACE **持久化**（hot exit） | 我们选 sessionStorage 的真实理由是**多标签页隔离**（两个浏览器标签页 = 两个窗口），不是「不值得持久化」；这一层应叫 window，不叫 session |
| World Engine 的 `sidebarWidth` / `inspectorWidth` | `WorldEngineWorkbenchDialog.vue:105-106,162-163` 组件内 `ref`，关掉就丢 | EditorPart 式：自己的 memento | 没有任何持久化，也没有可复用的入口 |
| descriptor `stateScope: user \| project \| session` | `app/utils/workbench/descriptors.ts:127-135`；`resolveViewStateLayer`（`:217-220`）把 `session` 解析成 `{sessionId}` = **Agent 会话 id** | — | 已声明、**无人消费**；且这里的 `session` 是领域身份，与 `frontend.md` 「会话瞬时态 = sessionStorage」不是一回事 |
| `ui.themeId` `ui.appearance` `ui.colorwayId` | Global Config（服务端，`server/config/registry.ts:95-125`），`editor.markdown` 已有 `global-workspace` 作用域，项目级落 `<project>/.nbook/config.json`（`config-service.ts:276`） | settings.json（用户意图，可编辑） | 对应的是 VS Code 的 **settings**，不是 storage；两者不能混 |
| 视图自身状态 `view.<id>` memento | 提案表格里有（`packages/neuro-book/docs/proposals/workbench-view-host.md:177-189`），无实现 | Memento | 正是缺的那一层 |

nb-ui 原语侧：`packages/nb-ui/src/components/layout/grid.ts:77-86` 的 `Grid<T>` 已有 `serialize()` / `restore(snapshot, resolveRef)`，恢复结果带 `dropped` / `clamped` 诊断，快照带 `version`（`GRID_SNAPSHOT_VERSION = 1`）。`WorkbenchBranch.vue:13-21` 的 props 是 `node / sizes / onResize / hidden / epoch`，不引用任何 shell 常量。外壳专属的只有 `app/utils/workbench/layout.ts` 的 `SHELL_*` 常量与 `WorkbenchShell.vue:88-175` 那段「取 store 值 → recalc → 重建树 → 拖拽落账 → 写回 store」的编排。

## 3. 建议的存储层形态

### 3.1 一个端口、两条轴、三个层

不照抄 VS Code 的四个 scope，但保留「scope 与 target 正交」这条骨架：

| 层（scope） | 寿命 | 第一版介质 | VS Code 对应 |
|---|---|---|---|
| `user` | 本机、跨项目、永久 | Pinia 持久化 → localStorage（沿用 `frontend.md` 第 1 条） | PROFILE / MACHINE |
| `project` | 跟随项目根、永久 | 服务端，位置见决策 D1 | WORKSPACE / MACHINE |
| `window` | 本浏览器标签页 / 本桌面窗口，关即丢 | sessionStorage（沿用 `frontend.md` 第 2 条） | 无（VS Code 一窗一工作区，不需要） |

target 轴在 NeuroBook 里已经存在，只是没被这么叫：**Global Config 就是 `USER` target**（服务端权威、可在设置页编辑、将来可跨端），**storage 就是 `MACHINE` target**。规则一句话：**用户主动设置的进 Global Config，交互留下的痕迹进 storage**。主题 id 是设置，侧栏宽度是痕迹；不要把痕迹塞进 `ui.*`。

「不持久化但要共享」不是第四个层，是另一个机制：Pinia store 的响应式状态 + `provide/inject`，加上给 `when` 用的 context key（见第 5 节）。活的 grid 树属于这一类：住在外壳组件或一个 `workbench-layout` store 里，别人只读，不进任何 storage。

### 3.2 memento：插件消费存储的唯一入口

照 VS Code 扩展 Memento 的形状，但由 descriptor 决定层：

```ts
// 宿主提供；插件/内置视图只拿到这个对象
type ViewMemento = {
    readonly scope: "user" | "project" | "window";
    get<T>(key: string, fallback: T): T;
    update(key: string, value: unknown): void;   // 整对象合并后延迟写回
};
useViewMemento(viewId): ViewMemento;               // scope 来自 descriptor.stateScope，宿主解析
```

规范条款（拟进 `docs/standards/code/frontend.md` 持久化节或视图宿主 Spec）：

1. 视图与插件**不得**直接读写 localStorage / sessionStorage / Global Config；只能经宿主注入的 memento。
2. 键空间归宿主：`view.<viewId>` 一个键存整个对象；插件内部键任意，整对象**必须**带 `schema` 版本（沿用 `frontend.md` 版本条款）。
3. 层由 descriptor 的 `stateScope` 声明，运行期不可改；同一视图要放两层的状态（尺寸习惯 vs 项目内选择），拆成两个 memento 键而不是一个视图两个 scope。
4. 默认落层：尺寸、折叠、面板比例 → `user`；与项目内容绑定的展开项、筛选、选中主体 → `project`；只有「本标签页身份」类 → `window`。
5. 恢复失败合同同 `grid.restore`：回落默认 + 逐条 issue，不抛异常、不部分恢复错误结构。
6. 大体量或草稿类数据不进 memento，走服务端 Store（`frontend.md` 第 4 条不变）。
7. 按实例分键（World Engine 按主体、编辑器按文件）用 `memento.forResource(key)`，宿主加 LRU 上限；VS Code 的 EditorMemento 是这个形状 **[未验证：上限数值与实现细节未核]**。

写回时机：拖拽落账后防抖写；`pagehide` / `visibilitychange` 时 flush。VS Code 用 `onWillSaveState` 集中触发，我们没有统一关机钩子，先在 store 层做。

### 3.3 grid 复用：抽 `useGridLayout`

把 `WorkbenchShell.vue:88-175` 的编排抽成一个 composable，参数化三样东西：叶约束表、默认拓扑、memento 键。外壳传 `SHELL_*` 与 `workbench.layout`，World Engine 传自己的约束与 `view.world-engine`。快照格式直接用 `grid.serialize()`，恢复走 `grid.restore()` 拿诊断。

边界照 VS Code EditorPart：内部 grid **不写外壳的键**，外壳**不知道**内部有 grid；Spec 里「不新增第二套尺寸持久化」（`workbench-shell.md:83`）约束的是外壳尺寸，视图自己的 memento 是提案第三行明文允许的那一层。

对 World Engine 具体意味着：两个 `ref` 换成一棵三叶树（sidebar / main / inspector），尺寸进 `user` 层 memento；它是 DialogWindow 不是外壳叶子，所以第一版不涉及「Splitter 套 Splitter」 **[从代码推断：reka Splitter 嵌套未在本仓库验证]**。

### 3.4 布局快照本身

外壳布局 `workbench.layout`（尺寸 + 显隐 + 容器落位 + 视图位置覆盖）第一版只放 `user` 层，与 Spec 一致，也与提案「第一版不引入 Project 级布局覆盖」一致。VS Code 把显隐拆到工作区级是可选的第二步（决策 D3）。补上 `hidden` 进快照是眼前的缺口。

## 4. 对三个问题的直接回答

### Q1 view grid 尺寸需要 session 级 storage？

不需要，需要的是 **user 层 + 明确的层名**。VS Code 尺寸在 PROFILE/MACHINE；我们的 `novel.ide.local` 已在同一层。真正该在 `window` 层的是「这个标签页打开的是哪个项目、活动视图是谁」这类身份，以及多标签页隔离要求的编辑器会话。建议把 `frontend.md` 第 2 条与 descriptor 的 `session` 统一改叫 `window`，Agent 会话 id 另算（决策 D2）。

### Q2 World Engine 内部复杂布局能否复用 grid？尺寸存哪？

能复用，缺的是编排 composable 和 memento 入口，不是原语。尺寸存 `view.world-engine` memento 的 `user` 层；如果它还要记「上次看的主体、展开的切片」，那是 `project` 层的另一个键。插件规范就是 3.2 的七条：插件看不到介质、键名、scope 解析，只看到 `get/update`。

### Q3 VS Code 是不是底层全靠命令？点按钮 = 命令面板输命令？

分三句：

- **具名动作是命令**。`registerAction2` 一次登记 command + 菜单项 + 快捷键；菜单按钮是 `MenuItemAction`，点击即 `commandService.executeCommand(id)`；快捷键解析出 `commandId` 后同样 `executeCommand`；命令面板列的是 `MenuId.CommandPalette`，匹配的是**标题**不是 id，且要 `>` 前缀（Ctrl+P 是 Go to File，Ctrl+Shift+P 只是带 `>` 打开同一个 Quick Input）。
- **控件手势不是命令**。活动栏图标「再点一次收起」直接 `layoutService.setPartHidden(true, SIDEBAR_PART)`，不经命令服务，`onWillExecuteCommand` 不会响；面板标题区的「×」则是菜单项，走命令 `workbench.action.togglePanel`。两条入口最终调同一个服务方法，所以效果一致。
- **命令不是事件总线**。一个 id 一个处理器（同名可叠加但按栈取最新），有返回值，是请求/响应；`onDidExecuteCommand` 只在 workbench 内部用（遥测、扩展激活），扩展 API 里没有。别的模块要知道「侧栏收起了」，订阅 `onDidChangePartVisibility` 或 context key `sideBarVisible`。

所以「点收起按钮发 `sidebar.left.close`，和用户在面板里执行同一条命令等效」这个目标是对的，但实现方式是：**按钮如果是菜单项/工具栏动作，就发命令；如果是控件手势，直接改 store；两者都落到同一个 store 动作；订阅者看 store，不看命令**。

对 `docs/proposals/workbench-commands.md` 的两点修正建议：

- §方案 2「所有交互入口改造为发送命令 ID」收窄为「所有**具名可发现动作**（菜单、面板、快捷键、桌面菜单）必须是命令；控件手势直接调 store」。否则 sash 拖拽、tab 点击都得伪装成命令，既没收益又把命令日志灌满。
- 待决策点 1 可以直接选三段式：VS Code 有 `registerCommandAlias(oldId, newId)`，桌面契约的 `file.open` 等 15 个 id（`packages/neuro-book-contracts/src/desktop-menu-command.ts`）做别名即可，不用双轨。

## 5. context key 的落法（回应提案待决策点 2）

VS Code 的 context key 是独立字典，靠各服务在事件里 `set`。在 Vue 里照抄会多一套手工同步；完全用 computed 又让 `when` 字符串失去可校验的键表。建议**混合**：

- 一张具名键登记表（`sideBarVisible`、`projectOpen`、`focusedView` ……），`when` 只能引用登记过的键，编译期或注册期校验；
- 键值由 store 的 computed 派生，不手工 `set`；
- 作用域覆盖（「当前聚焦的视图」）用 `provide` 建子作用域，对应 VS Code 的 `createScoped(domTarget)`。

## 6. 需要开发者拍板

| # | 问题 | 建议 | 取舍 |
|---|---|---|---|
| D1 | `project` 层 UI 状态放哪 | **State Root 下按项目哈希分目录**（VS Code 的 workspaceStorage 方式），不进 `<project>/.nbook/` | 进 `.nbook/` 会让 UI 痕迹污染项目目录与 git diff；`.nbook/config.json` 留给用户意图配置 |
| D2 | descriptor `stateScope: "session"` 的含义 | 改名 `window` = 标签页寿命；Agent 会话相关状态归 `project` 层按 sessionId 分键 | 现在 `resolveViewStateLayer` 要的是 Agent sessionId，与 `frontend.md` 的「会话瞬时态」同名异义，早晚踩坑 |
| D3 | 外壳显隐是否按项目分层 | 第一版不分，全在 `user` | VS Code 分了；我们 Spec 已定用户级，先补 `hidden` 进快照 |
| D4 | 命令边界 | 具名动作 = 命令，手势 ≠ 命令 | 与提案 §方案 2 的措辞冲突，需改提案 |
| D5 | context key 形态 | 混合（登记表 + computed 派生 + provide 作用域） | 对应提案待决策点 2 的两个选项都不完整 |

## 7. 不做的事

- 不把命令做成发布/订阅总线；不给命令加多处理器扇出。
- 不把 UI 痕迹写进 Global Config `ui.*`。
- 不让视图或插件自选存储介质、自造顶层键。
- 不为外壳尺寸新增第二套持久化；现有 `leftPanelWidth` / `agentPanelWidth` 迁入 `workbench.layout` 时按 Spec「并存期单写者」处理。

## 8. 落地顺序（供拆 Task 参考，未开工）

1. `workbench-state` store：`user` / `window` 两个 slice + `useViewMemento`；`project` slice 等 D1 定后接服务端。
2. 外壳：`hidden` 进 `workbench.layout` 快照；`leftPanelWidth` / `agentPanelWidth` 迁入快照，旧键按 Spec 退役。
3. 抽 `useGridLayout`，World Engine 对话框首个复用。
4. 命令注册表 + `registerCommandAlias` 接桌面契约；context key 登记表。
