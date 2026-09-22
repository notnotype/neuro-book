# VS Code Storage 重新梳理与 NeuroBook 落层映射

> 本文保留为 omp 子代理原稿，未整体采信，不是规范。已复核的概念与当前设计见 [Storage 概念与同步取舍](2026-09-15-storage-concepts-and-sync.md)。
> 已发现：混用 master/w00003 的配置路径与字段；把非 UI 消费误判为 Config；强制 World Engine 全部 Project；
> 将快照一概否定；将未知版本重写默认；混淆 ConfigurationTarget 与 ConfigurationScope，以及 USER 标记与实际同步通道。
> 下文正文是原始取证过程，不能直接复制“建议落稿”作为当前合同。

> **取证元信息**
> - VS Code 源码：`microsoft/vscode` `main`，commit `7774b174c378a9d406a6a248ffed33f5e6eb22f5`（GitHub API 实测时间 2026-09-15T13:40:20Z）。下文所有「源码 Lxxxx」均指该 commit；链接格式为 `https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/<path>#Lx-Ly`。
> - 官方文档：`microsoft/vscode-docs` `main` 的 Markdown 源（settings / settings-sync / profiles / custom-layout / when-clause-contexts / extension capabilities），链接为 `https://github.com/microsoft/vscode-docs/blob/main/<path>`。
> - NeuroBook 本地核查：主树 `C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book`；另有 worktree `.worktree/w00003-neurobook-ui-foundation-migration`（简称 **w00003**）。prompt 点名的 `workbench-view-host.md`、`WorkbenchShell.vue`、`app/utils/workbench/layout.ts` **不在主树**，只在 w00003 分支；下文对这两处分别标注。
> - 读不到的条目明确写「未核实」；没有凭记忆补全的条目。

---

## 0. 结论速览

1. **VS Code 的 configuration 与 storage 是两套完全不同的东西。** 配置落 `settings.json` 文件（user / profile / workspace / folder / machine），storage 落 KV 数据库（IndexedDB / SQLite 等），两者唯一的交集是「Settings Sync 会同时同步 settings 与一部分 UI 状态的 storage 键」。
2. **`ConfigurationScope/Target` 里的 `USER/MACHINE` 与 `StorageScope/StorageTarget` 里的 `USER/MACHINE` 同名不同域**，不能互相引用。配置侧 `MACHINE` 表示「该设置只允许写在本机/远程用户设置」；存储侧 `MACHINE` 表示「这条 UI 状态不参与跨机同步」。
3. **当前 main 的 `StorageScope` 有 4 个值**：`APPLICATION_SHARED=-2`、`APPLICATION=-1`、`PROFILE=0`、`WORKSPACE=1`。其中前三个都是 user-like，`WORKSPACE` 是 project/workspace-like。
4. **VS Code 没有公开的 window / session storage scope**。工作台布局只用 `PROFILE` 与 `WORKSPACE` 两个 scope；窗口几何属于 Electron 主进程的 `WindowsStateHandler`，与 `IStorageService` 无关。→ NeuroBook 不引入 window scope 有充分依据。
5. **扩展 `globalState` 现在是 `PROFILE` scope**（不是 `APPLICATION`），`workspaceState` 是 `WORKSPACE` scope，两者 target 都是 `MACHINE`；扩展要跨机同步只能 `setKeysForSync`，且走 **Extensions** 同步资源，不直连 UI State 同步。
6. **「一个 layout snapshot」是错误抽象**：workbench 布局至少分散在 5 个 owner、6 类键上，scope/target/键名互不相同，其中一部分还与 configuration 互相写入（legacy settings 互写）。

---

## 1. configuration 与 storage/memento/context key 的边界

### 1.1 configuration（配置）

- 载体是 **settings JSON 文件**，不是 storage 数据库：
  - User settings：`%APPDATA%\Code\User\settings.json`（Windows；macOS/Linux 见文档）；
  - Profile settings：`%APPDATA%\Code\User\profiles\<profile ID>\settings.json`；
  - Workspace settings：`<root>/.vscode/settings.json`（multi-root 时在 workspace 文件内）；
  - Application settings：非默认 profile 下用 **Preferences: Open Application Settings (JSON)** 访问默认 profile 的用户设置。
  - 来源：[docs/configure/settings.md](https://github.com/microsoft/vscode-docs/blob/main/docs/configure/settings.md)（User/Workspace/Profile 设置与文件位置、Settings precedence）。
- 写入目标由 `ConfigurationTarget` 枚举表达（源码 `src/vs/platform/configuration/common/configuration.ts` L40-49）：
  `APPLICATION=1, USER, USER_LOCAL, USER_REMOTE, WORKSPACE, WORKSPACE_FOLDER, DEFAULT, MEMORY`。
  注意有 `APPLICATION`、`USER_LOCAL`、`USER_REMOTE` 三个在 NeuroBook 语境里不存在的档位。
- 「某项设置允许被写到哪里」由注册侧的 `ConfigurationScope` 约束（源码 `src/vs/platform/configuration/common/configurationRegistry.ts` L184-214）：
  `APPLICATION`（只能写在默认 profile 用户设置）、`MACHINE`（只能写 local/remote 用户设置）、`APPLICATION_MACHINE`、`WINDOW`（user 或 workspace）、`RESOURCE`（user/workspace/folder）、`LANGUAGE_OVERRIDABLE`、`MACHINE_OVERRIDABLE`。
  这些 scope 到文件的映射定义在 `src/vs/workbench/services/configuration/common/configuration.ts`：`APPLICATION_SCOPES`、`PROFILE_SCOPES`、`LOCAL_MACHINE_SCOPES`、`REMOTE_MACHINE_SCOPES`、`WORKSPACE_SCOPES`、`FOLDER_SCOPES`，以及 `machineSettingsSchemaId`/`profileSettingsSchemaId` 等 schema id（workbench 侧注册见 `src/vs/workbench/services/configuration/browser/configurationService.ts`）。
- 配置项 schema 上还有同步开关：`ignoreSync`（该项在同步中被忽略且用户可覆盖）与 `disallowSyncIgnore`（configurationRegistry.ts 内 `IConfigurationPropertySchema` 注释）。

### 1.2 storage / memento（状态存储）

- 面向源码的 KV 存储接口是 `IStorageService`（`src/vs/platform/storage/common/storage.ts` L61 起）：`get/getBoolean/getNumber/getObject`、`store(key, value, scope, target)`、`remove`、`storeAll`、`keys(scope, target)`、`hasScope`、`switch`、`isNew`、`optimize`、`flush`，以及 `onDidChangeValue(scope, key)`、`onDidChangeTarget`、`onWillSaveState` 事件。
- **memento 是 storage 之上的一层 façade**，不是独立机制：VS Code 内部大量服务用 `getMemento(StorageScope.X, StorageTarget.Y)` 换来一个按对象属性读写的包装（例：`editorPart.ts` L156-157）。扩展 API 的两档 `globalState/workspaceState` 就是这种 memento。
- storage 的键必须带 `scope` 与 `target`（`store()` 签名要求两者都传）；值会被序列化成字符串，`undefined/null` 即删除；`keys()` 只返回有 target 记录的键（L174-190 注释）。

### 1.3 context key（运行时上下文）

- context key 是**运行时求值**的表达式变量，服务于 `when` 子句（命令、菜单、视图可见性等），没有持久化 API：
  - `IContextKeyService`/`RawContextKey` 定义在 `src/vs/platform/contextkey/common/contextkey.ts`；对该文件 grep `storage|persist|Memento` **零命中**（只有纯运行时结构）。
  - 扩展写 context 的唯一入口是命令 `vscode.commands.executeCommand('setContext', key, value)`，文档见 [api/references/when-clause-contexts.md](https://github.com/microsoft/vscode-docs/blob/main/api/references/when-clause-contexts.md)（「Add a custom when clause context」一节）。
- 结论：context key 是「当前这一帧的求值状态」，不是存储。任何「要记住」的上下文值必须由某个真实 owner 从 storage/config 读出来后再 set。

### 1.4 `USER/MACHINE`：两个同名不同域的轴（重点澄清）

| 轴 | 定义处 | 取值 | 语义 |
|---|---|---|---|
| `ConfigurationTarget` / `ConfigurationScope` 的 USER/MACHINE | `platform/configuration/common/configuration.ts` L40-49；`configurationRegistry.ts` L184-214 | `USER`/`USER_LOCAL`/`USER_REMOTE`/`WORKSPACE`/`WORKSPACE_FOLDER`/`APPLICATION`/`MACHINE`/`MACHINE_OVERRIDABLE`/… | **写到哪个设置文件**。`MACHINE` 表示该设置只写本机（或远程机）的用户设置，因此天然不参与默认同步（见 1.5）。 |
| `StorageTarget` 的 USER/MACHINE | `platform/storage/common/storage.ts` L252-262 | `USER, MACHINE` | **这条 storage 键是否随用户数据同步**。`USER`=「user specific and applies across machines」；`MACHINE`=「machine specific」。 |

`StorageTarget.USER` 真的被同步系统消费，证据（不是注释推断）：
- `src/vs/platform/userDataSync/common/globalStateSync.ts`：`getStorageKeys()` 按 `value.target === StorageTarget.USER / MACHINE` 把键分流；`LocalGlobalStateProvider.getLocalGlobalState()` 只把 `value.target === StorageTarget.USER` 的值放入同步内容。
- 同步是「UI State」资源（`SyncResource.GlobalState = 'globalState'`，`userDataSync.ts` L169-181）；官方文档里它的展示名即 **UI State**，同步清单列出 Display Language / Activity Bar entries / Panel entries / **Views layout and visibility** / Recently used commands / Do not show again notifications（[docs/configure/settings-sync.md](https://github.com/microsoft/vscode-docs/blob/main/docs/configure/settings-sync.md)）。

### 1.5 哪些属于配置同步、哪些属于 UI 状态存储

- **配置同步**（Settings Sync 项，文档 + 源码 `SyncResource`）：
  - Settings（user `settings.json`）、Keyboard shortcuts、User snippets、User tasks、Extensions（含内置与已装扩展的启用状态）、Profiles、MCP、Prompts；
  - 源码枚举：`Settings/Keybindings/Snippets/Prompts/Tasks/Mcp/Extensions/GlobalState/Profiles/WorkspaceState`（`userDataSync.ts` L169-181），其中 `ALL_SYNC_RESOURCES` **不含** `WorkspaceState`。
  - Machine / machine-overridable 作用域的设置默认不同步（settings-sync 文档 + `settingsSync.ignoredSettings`）。
- **UI 状态存储（会同步的部分）**：`PROFILE` scope 且 `target=USER` 的 storage 键，例如：
  - `views.customizations`（视图位置/显隐定制；`viewDescriptorService.ts` 存储点 L150、L722，`StorageScope.PROFILE, StorageTarget.USER`）；
  - `workbench.panel.alignment`（`layout.ts` LayoutStateKeys 表中唯一 `target=USER` 的布局键）。
- **UI 状态存储（不同步的部分）**：其余布局键 target 都是 `MACHINE`（见 §4 表）；编辑器组网格、视图容器内尺寸在 `WORKSPACE` scope，不参与 UI State 同步（同步管线的输入是 profile 级 storage 数据）。
- **扩展状态的特殊通道**：扩展 `globalState` 存 `PROFILE/MACHINE`，默认**不随 UI State 同步**；扩展声明 `setKeysForSync` 后，这些键随 **Extensions** 同步资源携带（`extensionsSync.ts` L396-400、L566-570），见 §3。

---

## 2. 当前 `StorageScope` 与 `IStorageService` 语义

### 2.1 枚举原文（`src/vs/platform/storage/common/storage.ts` L228-247）

```ts
export const enum StorageScope {
	/** The stored data will be scoped to all workspaces across all profiles
	 *  and shared across VS Code and Sessions app. */
	APPLICATION_SHARED = -2,
	/** The stored data will be scoped to all workspaces across all profiles. */
	APPLICATION = -1,
	/** The stored data will be scoped to all workspaces of the same profile. */
	PROFILE = 0,
	/** The stored data will be scoped to the current workspace. */
	WORKSPACE = 1
}
```

```ts
export const enum StorageTarget {
	/** The stored data is user specific and applies across machines. */
	USER,      // = 0
	/** The stored data is machine specific. */
	MACHINE    // = 1
}
```

- **user-like**：`APPLICATION_SHARED`、`APPLICATION`、`PROFILE`（跨 workspace；区别只在「跨不跨 profile」以及是否与 Sessions app 共享）。
- **project/workspace-like**：`WORKSPACE`（仅当前 workspace）。
- **不存在公开的 window / session storage**：
  - 枚举没有 window/session 档；`IStorageService.hasScope()` 只接受 `IAnyWorkspaceIdentifier | IUserDataProfile`，`switch()` 也只在 workspace/profile 之间切换；
  - workbench 布局层只出现 `PROFILE`/`WORKSPACE`（`layout.ts` LayoutStateKeys、`editorPart.ts` memento、`viewContainerModel.ts`、`viewDescriptorService.ts`）；
  - 窗口几何的持久化在 Electron 主进程：`WindowsStateHandler`（`src/vs/platform/windows/electron-main/windowsStateHandler.ts` L53-73）通过 `IStateService` 的 `windowsState` 键读写，由 `windowsMainService.ts`（L44、L1024-1026）消费，与 `IStorageService` 无交集。
- **公开给扩展的只有两档**：`workspaceState` 与 `globalState`（`vscode.d.ts` L8431-8461），对应到内部即 `WORKSPACE` 与 `PROFILE`。

### 2.2 `IStorageService` 语义要点

- 键值读写必须显式给出 scope（+ target 写入时）；有 `getObject`（JSON.parse）等便捷重载；`store` 文档注明「值会转成 string；存 `undefined`/`null` 等于删除」。
- 事件：`onDidChangeValue(scope, key)`（分层重载 + 通用重载）、`onDidChangeTarget`、`onWillSaveState`；`IStorageValueChangeEvent.external` 标注「改动来自其他进程/同步/profile 切换」。
- 生命周期：`isNew(scope)` 判断该 scope 是否本会话新建；`flush(reason?)` 在退出前强制落盘；`AbstractStorageService`（同文件 L329 起）说明周期性 flush（默认 60s；浏览器端实现为 5s）与 `TARGET_KEY` 特殊处理。
- 物理 adapter（**web 端已核实**）：`src/vs/workbench/services/storage/browser/storageService.ts` L342-358 —— `createApplicationStorage` → IndexedDB `...global`、`createApplicationSharedStorage` → `...global-shared`、`createProfileStorage` → `...global-<profile.id>`、`createWorkspaceStorage` → `...<workspaceId>`；创建失败回落 `InMemoryIndexedDBStorageDatabase`（L360-370）。**桌面端（Electron）adapter 文件未读，未核实。**
- profile 切换会整体切换 `PROFILE` 存储并触发事件（同文件 L210-214）。

---

## 3. Memento、`extensionContext.globalState/workspaceState/storageUri/globalStorageUri` 的边界

### 3.1 公开 API（`src/vscode-dts/vscode.d.ts`）

- `workspaceState: Memento`（L8437）——「state in the context of the currently opened workspace」；
- `globalState: Memento & { setKeysForSync(keys) }`（L8443-8461）——「state independent of the current opened workspace」；
- `secrets: SecretStorage`（L8464；L8637 起注释：加密存储、**不同步**跨机器）；
- `storageUri: Uri | undefined`（L8506）——workspace 级目录；
- `globalStorageUri: Uri`（L8530）——全局目录；
- `storagePath` / `globalStoragePath`（L8518、L8541）**已 deprecated**，替代为上面两个 Uri；
- `Memento`（L8585-8624）：`keys()` / `get<T>(key[, default])` / `update(key, value)`；`update` 需 JSON-stringifyable，`undefined` 即删除。

### 3.2 宿主实现与作用域映射（关键）

装配点：`src/vs/workbench/api/common/extHostExtensionService.ts` L501-541：

```ts
const globalState = ... new ExtensionGlobalMemento(extensionDescription, this._storage);
const workspaceState = ... new ExtensionMemento(extensionDescription.identifier.value, false, this._storage);
const secrets = ... new ExtensionSecrets(extensionDescription, this._secretState);
...
get storageUri() { return that._storagePath.workspaceValue(extensionDescription); },
get globalStorageUri() { return that._storagePath.globalValue(extensionDescription); },
```

写路径：`extHostMemento.ts`（`ExtensionMemento(id, global, storage)`）→ `extHostStorage.ts`（RPC `$initializeExtensionStorage/$setValue`）→ `mainThreadStorage.ts`（`MainThreadStorage`）→ `platform/extensionManagement/common/extensionStorage.ts`（`ExtensionStorageService`）：

```ts
getExtensionStateRaw(extension, global) {
    return this.storageService.get(extensionId, global ? StorageScope.PROFILE : StorageScope.WORKSPACE);
}
setExtensionState(extension, state, global) {
    this.storageService.store(extensionId, JSON.stringify(state),
        global ? StorageScope.PROFILE : StorageScope.WORKSPACE,
        StorageTarget.MACHINE /* Extension state is synced separately through extensions */);
}
```

结论（可直接引用的边界）：

| 扩展概念 | 内部 scope | target | 说明 |
|---|---|---|---|
| `workspaceState` | `WORKSPACE` | `MACHINE` | 每 workspace 一份；不跨机同步 |
| `globalState` | `PROFILE` | `MACHINE` | 「所有 workspace 共享」但**按 profile 分开**；默认不随 UI State 同步 |
| `globalState.setKeysForSync` | 元数据 `extensionKeys/<id>@<version>` 存 `PROFILE/MACHINE` | — | 同步时由 Extensions 资源携带这些 key 的值（`extensionsSync.ts` L396-400、L566-570） |
| `secrets` | 独立 `ISecretStorageService`（未读实现） | — | 加密、不跨机同步 |

### 3.3 key 隔离与文件型存储

- **key 隔离方式**：每条扩展状态是**一条 storage 记录**，记录 key = 扩展 id（`publisher.name`，`ExtensionStorageService.getExtensionId`），扩展自己的子 key 打包在这条 JSON blob 里（`getExtensionStateRaw/setExtensionState`）。扩 A 看不到扩 B 的记录；扩展内部 key 无需全局前缀。
- **文件型**（`src/vs/workbench/api/common/extHostStoragePaths.ts`）：
  - `workspaceValue(ext)` → `URI.joinPath(this._value, extension.identifier.value)`，其中 `_value = workspaceStorageHome/<workspace.id>`，目录创建时写 `meta.json`（id / configuration / name，L72-98）；
  - `globalValue(ext)` → `globalStorageHome/<extensionId.toLowerCase()>`（L105-107）。
- **大值警戒线**：`ExtensionStorageService.LARGE_STATE_WARNING_THRESHOLD = 512 * 1024`，超限时日志警告「Consider to use 'storageUri' or 'globalStorageUri'」（`platform-extensionStorage.ts` L46 与 `getExtensionStateRaw`）。
- 文档口径一致：扩展存数据五选项 = `workspaceState` / `globalState`(+`setKeysForSync`) / `storageUri` / `globalStorageUri` / `secrets`（[api/extension-capabilities/common-capabilities.md#data-storage](https://github.com/microsoft/vscode-docs/blob/main/api/extension-capabilities/common-capabilities.md)）。

---

## 4. workbench layout 的真实持久化（为什么不能笼统叫「一个 layout snapshot」）

布局状态至少由 **5 个 owner、6 类键**构成，且 scope/target 各不相同；还有一部分「布局」同时被写回 configuration。

### 4.1 LayoutStateModel（`src/vs/workbench/browser/layout.ts`）

- 键前缀 `workbench.`（`STORAGE_PREFIX = 'workbench.'`，L2941），写入按 scope 分两批（`save(workspace, global)`，L3151-3160：`WORKSPACE` 键在 workspace 批，`PROFILE` 键在 global 批）。
- 键表（L2860-2915，`LayoutStateKeys`，格式 `键名 → scope/target`）：

| 键 | scope / target | 备注 |
|---|---|---|
| `editor.centered` | WORKSPACE / MACHINE | |
| `zenMode.active`、`zenMode.exitInfo` | WORKSPACE / MACHINE | |
| `sideBar.size`、`auxiliaryBar.size`、`panel.size` | **PROFILE / MACHINE** | 尺寸在 profile 级、不同步 |
| `panel.lastNonMaximizedHeight/Width` | PROFILE / MACHINE | |
| `panel.wasLastMaximized` | WORKSPACE / MACHINE | |
| `auxiliaryBar.wasLastMaximized` | WORKSPACE / MACHINE | |
| `auxiliaryBar.lastNonMaximizedSize` | PROFILE / MACHINE | |
| `auxiliaryBar.lastNonMaximizedVisibility` | WORKSPACE / MACHINE | |
| `auxiliaryBar.empty` | PROFILE / MACHINE | |
| `sideBar.position`、`panel.position` | WORKSPACE / MACHINE | |
| `panel.alignment` | **PROFILE / USER** | 唯一 target=USER 的布局键 → 随 UI State 同步 |
| `activityBar.hidden`（zenModeIgnore）、`sideBar.hidden`、`editor.hidden`、`panel.hidden`、`auxiliaryBar.hidden`、`statusBar.hidden` | WORKSPACE / MACHINE | 显隐属于 workspace 级 |

- 对 `target=USER` 的键，LayoutStateModel 监听 `onDidChangeValue(StorageScope.PROFILE, ...)` 以响应外部（同步）改写（L3081-3088）。
- 面板/侧栏尺寸的采集：`setInitializationValue(PANEL_SIZE/SIDEBAR_SIZE/AUXILIARYBAR_SIZE, ...)`（L1723-1743）。
- **config 与 state 互写**（L2987-2999）：`activitiBar.hidden` ↔ 设置 `workbench.activityBar.location`、`statusBar.hidden` ↔ `workbench.statusBar.visible`、`sideBar.position` ↔ `workbench.sideBar.location`；还有 `panel.defaultLocation`、`zenMode`、`workbench.secondarySideBar.defaultVisibility` 等只作为默认值参与（L2918-2932）。即「布局」是 config 默认值 + storage 记忆的共同产物。

### 4.2 编辑器组网格（EditorPart，`src/vs/workbench/browser/parts/editor/editorPart.ts`）

- 键：`editorpart.state`（`serializedGrid + activeGroup + mostRecentActiveGroups`，L49-52、L1509-1513），存在 **`workspaceMemento = getMemento(WORKSPACE, USER)`**（L156）；另有 `editorpart.centeredview` 存 **`profileMemento = getMemento(PROFILE, MACHINE)`**（L157、L1495-1497）。
- 即：**编辑器拆分树是 workspace 级存储，而布局表里的 part 尺寸是 profile 级存储**——两者既不同 scope 也不同 owner。

### 4.3 每个 part 当前显示的 view container

- `layout.ts` L807 / L831 / L842 分别用 `SidebarPart.activeViewletSettingsKey`、`PanelPart.activePanelSettingsKey`、`AuxiliaryBarPart.activeViewSettingsKey` 从 **WORKSPACE** scope 恢复「上一会话停在哪个容器」。

### 4.4 容器内视图（ViewContainerModel / ViewPaneContainer）

- 视图的 workspace 状态（`collapsed/size/order`）→ 键 = 容器 `storageId`（缺省 `${viewContainer.id}.state`），**WORKSPACE / MACHINE**（`viewContainerModel.ts` L340、L105-108）；
- 视图的全局状态（`isHidden/order`）→ 键 = `${storageId}.hidden`，**PROFILE / USER**（L24、L69-71、L276）；
- 可见视图数量 → `${containerId}.numberOfVisibleViews`，**WORKSPACE / MACHINE**（`viewPaneContainer.ts` L378-379、L753）；
- pane 尺寸的保存/恢复走 `viewContainerModel.getSize/setSizes`（`viewPaneContainer.ts` L706-733；`viewContainerModel.ts` L464-475）。
- 视图跨容器移动/隐藏的定制 → `views.customizations`，**PROFILE / USER**（`viewDescriptorService.ts` L41、L150、L722）。

### 4.5 结论

- 说「一个 layout snapshot」会同时掩盖三件事实：**scope 不同**（用户级 vs 项目级）、**target/同步语义不同**（USER 同步 vs MACHINE 不同步）、**owner 不同**（新消费者必须选对 scope 与键）。
- 补充：Customize Layout 里的密度是设置项 `window.density.layout`（[docs/configure/custom-layout.md](https://github.com/microsoft/vscode-docs/blob/main/docs/configure/custom-layout.md)）；编辑器组的锁定状态跨重启保留（同文档「editor group lock」段）。这再次说明「布局」横跨 config 与 storage。

---

## 5. NeuroBook 映射（Config: Global/Project；Storage: User/Project）

### 5.1 四层总表

| 层 | owner | 物理 adapter（现状/建议） | key / name space | 典型消费者 | 生命周期与同步 |
|---|---|---|---|---|---|
| **Global Config** | Config service（`server/config/config-service.ts`） | State Root 下 `config.json`（`globalConfigPath()`，L9-11） | 顶层 section：`agent / ui / editor / observability / web / ...`（如 `ui.theme`、`ui.customThemes`、`ui.costCurrency`，L208-212） | 服务端 runtime、`readConfigBootstrap`、设置页、Agent profiles | 用户级、跨 Project；按「所有 NeuroBook 配置同一同步语义」处理 |
| **Project Config** | Config service project 面 | `<workspaceRoot>/.nbook/config.json`（`readGlobalConfigFileAtWorkspaceRoot` 同构，L454-456） | 同上顶层 section，但拒收 global-only 字段（`assertProjectConfigDoesNotContainGlobalOnly`） | Project 打开后的 `EffectiveConfig` | 随 Project 文件；不跨 Project |
| **User Storage** | 宿主（Workbench Shell / 宿主 service），唯一 writer | 客户端持久化：浏览器 localStorage 分区（经登记的 Pinia persisted store）或 desktop user-state；插件与组件不得直连 | `nbook.user.*`（提案中的 `workbench.layout`、`workbench.views.customizations` 保留为 User 命名空间内的键名） | 布局快照（Part 几何/可见性/位置）、视图显隐与顺序覆盖、全局 UI 偏好（语言、编辑器外观偏好） | 跨 Project、跨会话；同步语义由宿主决定 |
| **Project Storage** | Project Session / 宿主 | Project 内 `.nbook/` 状态文件，或按 `projectRoot` 分区的客户端持久化 | `nbook.project.<projectId>.*`（编辑器会话可沿用 `novel:${projectRoot}` 分区作为实现细节） | 编辑器会话（tabs/buffers/active tab）、视图容器内部 pane 尺寸、Project 级 UI 状态（最近选择/展开态） | 随 Project；换 Project 重置 |
| ~~Session/Window Storage~~ | — | 禁止：不得用浏览器 `sessionStorage` 或任何窗口级持久化承载产品状态 | — | — | 页面/窗口销毁即释放，仅内存 |

### 5.2 grid 尺寸落层

| 网格 | 落层 | 规则与 VS Code 对照 |
|---|---|---|
| **主 workbench grid**（Part 几何：图标栏/左栏/编辑器/右栏/面板的尺寸、可见性、位置；即提案 `workbench.layout` 快照） | **User Storage** | VS Code：`sideBar.size/panel.size/auxiliaryBar.size` = PROFILE/MACHINE；`*.hidden` = WORKSPACE/MACHINE；`panel.alignment` = PROFILE/USER。part 级「用户布局」在 VS Code 归 profile（user-like），NeuroBook 折叠为 User。编辑器是吸收余量的叶，不落尺寸（w00003 `WorkbenchShell.vue` L146-147 同口径） |
| **World Engine 内部 grid**（`sidebarWidth`/`inspectorWidth`/`mutationEditorHeight`） | **Project Storage**（尺寸）；显隐偏好 → **User Storage** | VS Code：视图容器内 pane 尺寸存 **WORKSPACE** scope（`viewContainer.storageId`）、容器级 hidden/order 存 **PROFILE/USER**（`${storageId}.hidden`、`views.customizations`）。默认按「随 Project 恢复」；仅当产品明确把 World Engine 定为与 Project 无关的全局工具时，尺寸才上移 User Storage |
| **Editor group grid**（多组拆分树；第一版不做） | **Project Storage** | VS Code：`editorpart.state` = WORKSPACE/USER memento；编辑器网格是 workspace 级存储，不是 part 布局键 |

### 5.3 不持久化但跨模块共享 → 只用这三种机制

- **宿主 service**（跨模块单实例，如 Project Session、Workbench Shell service）；
- **Pinia store**（前端领域状态，禁用 persisted 插件即为内存态）；
- **provide/inject context**（组件树内受控共享）。
- 禁止：window/session scope、全局可变单例、浏览器 `sessionStorage`。

### 5.4 Config 与 Storage 的判别规则

1. 会不会**改变系统行为**、且需要跨端一致？→ Config。
2. 是否会被**非 UI 代码**（服务端、Agent、Job）读取？→ Config。
3. 是否有**默认值、校验、迁移、用户可解释的"设置项"语义**？→ Config。
4. 只是**界面呈现的记忆**（尺寸、显隐、位置、展开、最近选择）？→ Storage。
5. 同一语义**只能有一个权威层**；禁止双写（例：主题 = Global Config `ui.*`，storage 只能缓存渲染结果，且缓存不得反写权威）。
6. user 还是 project 的判据：**换 Project 后应当保持** → User；**随 Project 走或应当重置** → Project。

### 5.5 插件/内置系统消费 storage 的 API 边界

- 插件只拿到宿主发放的 storage capability：`user` / `project` 两个 memento（若提供文件型，另发 `storageUri` 作用域）。
- 插件 **不得**直接触碰 `localStorage`/`sessionStorage`、文件路径或底层 key；宿主按插件 id 隔离命名空间（VS Code 的做法：一条记录 key=extensionId，子 key 打包在 JSON blob；NeuroBook 建议 `nbook.plugin.<pluginId>.*`）。
- 同步语义由宿主决定：NeuroBook 的「所有配置同一同步语义」不自动覆盖插件 storage；需要同步的键必须显式登记（VS Code 对应 `setKeysForSync` → Extensions 资源）。
- 大对象引导到文件型存储（VS Code 512KB 警戒线可作为参考）。

---

## 6. 与 NeuroBook 现状的冲突与最小改文档范围

> 说明：prompt 点名的三份文件（`workbench-view-host.md`、`WorkbenchShell.vue`、`app/utils/workbench/layout.ts`）**只在 w00003 分支**（UI 底座迁移），主树不存在；`docs/standards/code/frontend.md` 的「sessionStorage/session store」段也**只在 w00003 分支**（主树版本只有 32 行，无存储分层内容）。下列行号以我实读到的版本为准。

### 6.1 `docs/standards/code/frontend.md`（w00003 版）

- 现状：新增「客户端持久化与存储分层」整节，其中第 2 条把「会话瞬时态（打开标签页、当前活动 tab、编辑器缓冲、即时撤销栈、工作区恢复点等）」定义为 **`sessionStorage` 或 session store**（键例 `novel.ide.session`）——**与「不做 session/window 级 storage」的产品决定直接冲突**。
- 冲突点：
  1. 「会话」在这里是**标签页生命周期**（sessionStorage 语义），不是产品 scope；
  2. 编辑器会话（tabs/buffers）按 w00003 `workbench-view-host.md` 自己的分层是**项目级**（`novel:${projectRoot}` 分区），与「sessionStorage」自相矛盾；
  3. 债务表中 `agent:last-session:*` 的迁移方向也写成「迁移至 session store」。
- 最小改动：第 2 条改为「**内存瞬时态**：页面级/组件级状态用组件 ref/store，**不写任何持久化**」；「编辑器会话」并入 Project Storage；债务表「迁移方向」列去掉 session store 提法。**主树与 w00003 合并时必须带着这次语义改写落地**。

### 6.2 `packages/neuro-book/docs/proposals/workbench-view-host.md`（w00003 版）

- 现状：descriptor 字段 `stateScope: "user" | "project" | "session"`（「该视图的 memento 存在哪一层」）；状态分层表含「Session / 页面级 → 组件内 ref」；布局键 `workbench.layout`（用户级）、`workbench.views.customizations`（用户级）；编辑器会话（项目级）沿用 `novel.ide.session` 的 `novel:${projectRoot}` 分区。
- 冲突点：`stateScope` 的 `session` 档位不应存在；「页面级 ref」本身没错，但把它写成一种 *scope* 会诱导实现为可持久化档位。
- 最小改动：
  1. `stateScope` 枚举收敛为 `"user" | "project"`；
  2. 「Session / 页面级」行的措辞改为「**内存态，不持久化；不进入任何持久化键**」；
  3. `workbench.layout`、`workbench.views.customizations` 标注归属 **User Storage** 命名空间（键名可保留）；
  4. 编辑器会话一节明确归属 **Project Storage**（`novel:${projectRoot}` 作为分区实现，不再是 sessionStorage）。

### 6.3 `packages/neuro-book/app/stores/novel-ide.ts`（主树，2026-09-15 实读）

- 现状：`persist` 两个桶——
  - `novel.ide.session` 用 `piniaPluginPersistedstate.sessionStorage()` 持久化 `currentProjectRoot / selectedLorebookEntryId / selectedCharacterId / workspaceSessions / detailUndoStacks`（L1996-2009）；
  - `novel.ide.local` 走默认 localStorage，持久化面板宽度、`viewMode`、`activeThemeId / activeThemeAppearance / customThemes / themeVarsSnapshot`、编辑器偏好等（L2010-2030）。
- 冲突点：
  1. `sessionStorage` 桶 = session 级 storage，须删除该档；
  2. `workspaceSessions`（编辑器会话）应归 **Project Storage**；选中身份（`selectedLorebookEntryId` 等）按提案属「选择身份」，若不需跨会话恢复则留内存，若需恢复则进 Project Storage——**必须二选一并写清**；
  3. 主题三件套（`activeThemeId/customThemes/themeVarsSnapshot`）与 Global Config `ui.theme/ui.customThemes` 构成**双权威**，违反「单一权威」。
- 最小改动（文档层）：在 storage 规范中明确三条口径（session 档禁用、编辑器会话归 Project、主题以 Global Config 为权威），代码迁移另开任务；现有 w00003 债务表可作为迁移清单入口。

### 6.4 `server/config/config-service.ts`（主树）

- 现状：Global Config = State Root `config.json`（L9-11）；Project Config = `<workspaceRoot>/.nbook/config.json`；`saveProjectConfig` 明确拒绝 global-only 字段；`ui.*`（theme/customThemes/costCurrency）在 Global Config 中（L208-212）。
- 冲突点：**无结构性冲突**（Global/Project 已严格分离，符合产品决定）。只需文档声明「Config 与 Storage 不相干；禁止像 VS Code legacy settings 那样与 storage 互写」。
- 最小改动：在 storage 规范里加一条「禁止 config↔storage 互写」；**代码不改**。

### 6.5 布局组件（尺寸消费）

- `WorkbenchShell.vue`（w00003，`app/components/workbench/WorkbenchShell.vue`）：`leftPanelWidth/agentPanelWidth` 从 store 读（L56-57），拖拽结算后回写（L149-165）；`hidden` 是**组件内 ref、不持久化**（L62、L66）。→ 需在文档中定：Part 尺寸落 **User Storage**（现状 store 键在 `novel.ide.local`，属命名空间迁移问题）；`hidden` 建议按 VS Code `sideBar.hidden` 先例落 **User Storage 布局快照**（否则「收起」行为无法跨会话保持）。
- `WorldEngineWorkbenchDialog.vue`（主树）：`sidebarWidth/inspectorWidth/mutationEditorHeight` 是纯 ref（L106-108、L163-165），仅做 props 传值与 `@update:width` 回写（L1961/1967、L2168/2175），**当前不落任何 storage**。→ 文档需按 §5.2 给出落层（默认 Project Storage），否则实现者会把它塞进组件私有持久化或配置。
- `app/utils/workbench/layout.ts`（w00003）：纯几何原语（limits/clamp/distribute/recalc），**无持久化职责**——这一点与规范一致，需要在文档中保留「原语不拥有持久化键」的边界描述。

### 6.6 其他裸 `localStorage` 写入点（与 w00003 债务表一致）

`nbook.settingsDialog.size`（对话框尺寸）、`nbook.locale`（语言）、`nbook.costDisplay.usdToCnyRate`（汇率缓存）、`agent:pinned-sessions:*` / `agent:last-session:*` / `agent:inline-editor-session:*`（Agent 会话记忆）、`world-engine preview` 的 mock 草稿。全部按同一规则处置：**布局/偏好 → User Storage；随 Project → Project Storage；纯瞬时 → 内存；服务端权威 → Global Config**。

### 6.7 最小改文档范围（汇总）

1. w00003 `docs/standards/code/frontend.md`：重写「客户端持久化与存储分层」第 2 条 + 债务表「迁移方向」列；补「禁止 session/window storage」硬条。
2. w00003 `packages/neuro-book/docs/proposals/workbench-view-host.md`：`stateScope` 去 `session`；「Session / 页面级」行改内存表述；`workbench.layout`/`workbench.views.customizations` 标注 User Storage。
3. 新增/合入一份 storage 规范（可直接用 §7 条文），并回链 `server/config/config-service.ts` 的 Config 边界。
4. `novel-ide.ts`、`WorkbenchShell.vue`、`WorldEngineWorkbenchDialog.vue`、债务表各写入点：只登记迁移方向与落层，不在本次改代码。

---

## 7. 建议落稿

### 7.1 规范条文草案（≤80 行）

```text
# NeuroBook 状态与配置分层规范（草案 v0）

适用范围：app/**、宿主服务、内置与第三方插件运行时。任何持久化状态必须且只能落入
Global Config / Project Config / User Storage / Project Storage 四者之一；不存在第五层。

术语
- Config：改变系统行为、需要跨端一致与校验的键值。
- Storage：只记录界面呈现记忆的键值，由宿主统一管理与隔离。
- memento：宿主发放给视图/插件的具名 KV，按 id 隔离。
- 内存态：不持久化，页面或进程销毁即释放。

硬性条文
1. Config 只有 Global Config 与 Project Config：Global 落 State Root/config.json，
   Project 落 <workspaceRoot>/.nbook/config.json。
2. Project Config MUST NOT 接受 global-only 字段；Project 未打开时不得写 Project Config。
3. Storage 只有 user 与 project 两个 scope。MUST NOT 引入 session、window、tab、
   machine、profile 等第三档。
4. 浏览器 sessionStorage 及任何窗口级持久化 MUST NOT 承载产品状态；组件瞬时态用内存
   store/service 表达。
5. 判别规则：被非 UI 代码消费、改变系统行为、需要默认值/校验/迁移语义 → Config；
   仅界面记忆（尺寸/显隐/位置/展开/最近选择） → Storage。
6. 同一语义 MUST 只有一个权威层（例：主题与配色 = Global Config ui.*；面板宽度 = User
   Storage）。Storage 可以缓存渲染结果，但 MUST NOT 反写权威。
7. 布局 MUST NOT 笼统存成"一个快照"：按 owner 分键（Part 几何 / 编辑器组网格 /
   容器内视图 / 视图位置覆盖），owner 各自持有键与恢复时机。
8. 用户级布局（Part 尺寸、可见性、位置、视图隐藏偏好）归 User Storage；
   随 Project 恢复的容器内尺寸与编辑器会话归 Project Storage。
9. 每个持久化键 MUST 带 schema 版本；反序列化失败 MUST 告警 + 回默认 + 重写合法结构，
   MUST NOT 抛出未捕获异常阻断初始化。
10. 组件 MUST NOT 直接读写 localStorage/sessionStorage/文件；持久化只经宿主 storage
    service 或已登记的 Pinia persisted store。
11. 插件（含内置）只使用宿主发放的 storage capability：user/project memento；
    宿主按 plugin id 隔离命名空间；插件 MUST NOT 触碰底层 key、文件路径或浏览器存储。
12. 插件 storage 是否同步由宿主统一决定；需要跨设备同步的键 MUST 显式登记，
    插件不得假设默认同步。
13. 不持久化但需跨模块共享的状态，只能使用：宿主 service、Pinia store、
    provide/inject context。MUST NOT 引入 window scope 或可变全局单例。
14. 旧键退役单独开迁移：读旧写新一次完成；并存期不双写，任一时刻只有一个写者。
15. 新增键必须在最近作用域的 AGENTS.md / 规范中登记键名、scope、owner 与恢复时机；
    未登记的新键不得合并。
```

### 7.2 术语清单

**保留（VS Code 术语，语义真实且已在本仓库使用）**

- **Part**（标题栏/图标栏/侧栏/右栏/编辑器区/面板/状态栏）：区域级几何、可见性、位置。
- **View Container / View / PaneView / sash**：容器、视图、可拖分隔 pane 与分隔条。
- **Grid（可序列化拆分树）**：承载 Part 排布与将来的 Editor Group。
- **memento**：按 id 命名的一小块持久化 KV（视图自身状态），仅指机制，不指 scope。
- **descriptor / factoryKey / when**：descriptor 注册表、宿主白名单解析、可见性谓词。
- **stateScope（user | project）**：视图 memento 的落层；**去掉 session**。
- **editor group / editor part**：若做多组拆分，沿用。
- **UI State**：仅指「同步语义」这一类 storage 键的集合名，不指某个 scope。

**避免照搬**

- **StorageScope 的四档名**（`APPLICATION_SHARED / APPLICATION / PROFILE / WORKSPACE`）：NeuroBook 折叠为 user/project 两档，直接照搬会把 profile/machine 概念带进来。
- **StorageTarget 的 `USER / MACHINE`**：与 NeuroBook 的 user/project 命名冲突；若将来需要"不同步"开关，用独立布尔字段表达。
- **`ConfigurationTarget.USER_LOCAL / USER_REMOTE / APPLICATION / MEMORY`** 与 **`ConfigurationScope.MACHINE / MACHINE_OVERRIDABLE`**：导出「User/Machine 配置同步分档」与「远程设置」的暗示，与「所有 NeuroBook 配置同一同步语义」冲突。
- **machine settings / 机器级配置文件**：不引入。
- **session storage / window scope / "window 级布局"**：不引入；窗口几何由桌面层另行处理，不进产品 storage。
- **"layout snapshot"（整体快照）**：会把多 owner、多 scope 的现实掩盖成单键；改说「布局状态按 owner 分键」。
- **sessionStorage 作为 scope 名**：即使只出现在文档，也会被实现者当成一档。
```

---

## 附：本次实读的源码/文档清单（便于复核）

- VS Code 源码（commit `7774b17`）：`src/vs/platform/storage/common/storage.ts`、`src/vs/platform/configuration/common/configuration.ts`、`src/vs/platform/configuration/common/configurationRegistry.ts`、`src/vs/platform/contextkey/common/contextkey.ts`、`src/vs/platform/extensionManagement/common/extensionStorage.ts`、`src/vs/platform/userDataSync/common/{userDataSync,globalStateSync,extensionsSync}.ts`、`src/vs/workbench/api/common/{extHostExtensionService,extHostStorage,extHostStoragePaths,extHostMemento}.ts`、`src/vs/workbench/api/browser/mainThreadStorage.ts`、`src/vs/workbench/services/storage/browser/storageService.ts`、`src/vs/workbench/services/configuration/{common/configuration,browser/configurationService}.ts`、`src/vs/workbench/browser/layout.ts`、`src/vs/workbench/browser/parts/{editor/editorPart,views/viewPaneContainer,paneCompositePart}.ts`、`src/vs/workbench/services/views/{common/viewContainerModel,browser/viewDescriptorService}.ts`、`src/vs/platform/windows/electron-main/{windowsMainService,windowsStateHandler}.ts`、`src/vscode-dts/vscode.d.ts`。
- 官方文档 Markdown：`docs/configure/{settings,settings-sync,profiles,custom-layout}.md`、`api/extension-capabilities/common-capabilities.md`、`api/references/when-clause-contexts.md`。
- NeuroBook：主树 `docs/standards/code/frontend.md`、`packages/neuro-book/app/stores/novel-ide.ts`、`packages/neuro-book/app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`、`packages/neuro-book/server/config/config-service.ts`、`packages/neuro-book/app/components/novel-ide/agent/{AgentChatSurface.vue,AgentModeSessionSidebar.vue,agent-composer-draft.ts}`、`packages/neuro-book/app/composables/useCostDisplay.ts`、`packages/neuro-book/app/plugins/i18n-locale.client.ts`；w00003 `docs/standards/code/frontend.md`、`packages/neuro-book/docs/proposals/workbench-view-host.md`、`packages/neuro-book/app/components/workbench/WorkbenchShell.vue`、`packages/neuro-book/app/utils/workbench/layout.ts`。

**未核实项**：VS Code 桌面端（Electron）storage adapter 的具体实现文件；`ISecretStorageService`（secrets）实现细节；VS Code 内部是否存在零星浏览器 `sessionStorage` 用法；w00003 之外的 worktree（如 w00005）是否已含同类文档改动。
