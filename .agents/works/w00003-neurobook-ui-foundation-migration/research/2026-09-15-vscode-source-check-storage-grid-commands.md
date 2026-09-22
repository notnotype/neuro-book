<!-- 来源：omp 子代理（Oh My Pi 18.1.21）2026-09-14 联网逐文件实读 microsoft/vscode main 分支源码后产出，原文未改；每条结论附源码路径与 URL，「未核实」为其自报边界。分析与决策见同目录 2026-09-15-storage-layer-and-commands-vscode-comparison.md。 -->

# VS Code（microsoft/vscode, main）存储 / 布局 / 命令系统 机制核对

核对方式：逐文件拉取 `raw.githubusercontent.com/microsoft/vscode/main/...` 源码原文阅读（2026-09-14 当日 main）。
代码块为原文摘录（可能省略不相关行，`…` 处为我省略）。凡我**没有实读**到的内容一律写「未核实」。

---

## A. 存储层（IStorageService / Memento）

### A1. StorageScope / StorageTarget / IStorageService

**结论**：`StorageScope` 有 4 个值（新版多了 `APPLICATION_SHARED = -2`），`StorageTarget` 有 USER / MACHINE 两个值（无显式数值，即 0 / 1）。`store()` 的签名是 `store(key, value, scope, target): void`——**没有返回值**，不是 Promise。`onDidChangeValue` 是带 `scope` 重载 + 必须传入 `DisposableStore` 的事件，`onWillSaveState` 是全局的「即将落盘」广播。

源码：`src/vs/platform/storage/common/storage.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/common/storage.ts#L196-L283

```ts
export const enum StorageScope {

	/**
	 * The stored data will be scoped to all workspaces across all profiles
	 * and shared across VS Code and Sessions app.
	 */
	APPLICATION_SHARED = -2,

	/**
	 * The stored data will be scoped to all workspaces across all profiles.
	 */
	APPLICATION = -1,

	/**
	 * The stored data will be scoped to all workspaces of the same profile.
	 */
	PROFILE = 0,

	/**
	 * The stored data will be scoped to the current workspace.
	 */
	WORKSPACE = 1
}

export const enum StorageTarget {

	/**
	 * The stored data is user specific and applies across machines.
	 */
	USER,

	/**
	 * The stored data is machine specific.
	 */
	MACHINE
}
```

接口（同文件 L46-L140 摘录）：

```ts
export interface IStorageService {
	readonly onDidChangeValue(scope: StorageScope.WORKSPACE, key: string | undefined, disposable: DisposableStore): Event<IWorkspaceStorageValueChangeEvent>;
	readonly onDidChangeValue(scope: StorageScope.PROFILE, key: string | undefined, disposable: DisposableStore): Event<IProfileStorageValueChangeEvent>;
	readonly onDidChangeValue(scope: StorageScope.APPLICATION, key: string | undefined, disposable: DisposableStore): Event<IApplicationStorageValueChangeEvent>;
	readonly onDidChangeValue(scope: StorageScope.APPLICATION_SHARED, key: string | undefined, disposable: DisposableStore): Event<IApplicationSharedStorageValueChangeEvent>;

	/**
	 * Emitted when the storage is about to persist. This is the right time
	 * to persist data to ensure it is stored before the application shuts down.
	 * Note: this event may be fired many times, not only on shutdown to prevent
	 * loss of state in situations where the shutdown is not sufficient to
	 * persist the data properly.
	 */
	readonly onWillSaveState: Event<IWillSaveStateEvent>;

	/**
	 * @param scope allows to define the scope of the storage operation
	 * to either the current workspace only, all workspaces or all profiles.
	 * @param target allows to define the target of the storage operation
	 * to either the current machine or user.
	 */
	store(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget): void;
}
```

补充（旧认知修正）：`get/getBoolean/getNumber/getObject(key, scope, fallback?)` 与 `remove`、`keys`、`isNew`、`optimize`、`flush(reason?)` 同在 `IStorageService` 上；`onDidChangeValue` 的第三个参数是 `DisposableStore`（不是可选参数），事件按 `scope` 分型。

---

### A2. 三个 scope 的物理落点 / in-memory 情形

**结论（桌面 Electron）**：所有 scope 都是 SQLite 文件 `state.vscdb`，靠**目录**区分：

| scope | 物理文件 | 决定它的代码 |
|---|---|---|
| `APPLICATION`（同时就是**默认 profile 的 PROFILE**） | `<userDataDir>/User/globalStorage/state.vscdb` | `ApplicationStorageMain` 用 `defaultProfile`；`defaultProfile.location = userRoamingDataHome(= userDataDir/User)`，`globalStorageHome = joinPath(location,'globalStorage')` |
| `PROFILE`（具名 profile） | `<userDataDir>/User/profiles/<profileId>/globalStorage/state.vscdb` | `ProfileStorageMain` + `profilesHome = joinPath(userRoamingDataHome,'profiles')` |
| `WORKSPACE` | `<userDataDir>/User/workspaceStorage/<workspaceId>/state.vscdb`（同目录另有 `workspace.json` 元数据） | `WorkspaceStorageMain` |
| `APPLICATION_SHARED` | `<appSharedDataHome>/sharedStorage/state.vscdb` | `ApplicationSharedStorageMain` |
| in-memory | `SQLiteStorageDatabase.IN_MEMORY_PATH`（`StorageHint.STORAGE_IN_MEMORY`） | 见下 |

源码 1（路径拼装）：`src/vs/platform/storage/electron-main/storageMain.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMain.ts#L283-L300,L413-L425

```ts
class BaseProfileAwareStorageMain extends BaseStorageMain {
	private static readonly STORAGE_NAME = 'state.vscdb';
	get path(): string | undefined {
		if (!this.options.useInMemoryStorage) {
			return join(this.profile.globalStorageHome.with({ scheme: Schemas.file }).fsPath, BaseProfileAwareStorageMain.STORAGE_NAME);
		}
		return undefined;
	}
}
export class ProfileStorageMain extends BaseProfileAwareStorageMain { }
export class ApplicationStorageMain extends BaseProfileAwareStorageMain { /* defaultProfile */ }

export class WorkspaceStorageMain extends BaseStorageMain {
	private static readonly WORKSPACE_STORAGE_NAME = 'state.vscdb';
	private static readonly WORKSPACE_META_NAME = 'workspace.json';
	get path(): string | undefined {
		if (!this.options.useInMemoryStorage) {
			return join(this.environmentService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath, this.workspace.id, WorkspaceStorageMain.WORKSPACE_STORAGE_NAME);
		}
		return undefined;
	}
}
```

源码 2（`workspaceStorageHome`、`appSettingsHome`）：`src/vs/platform/environment/common/environmentService.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/common/environmentService.ts#L53-L90

```ts
	get userDataPath(): string { return this.paths.userDataDir; }
	get appSettingsHome(): URI { return URI.file(join(this.userDataPath, 'User')); }
	get workspaceStorageHome(): URI { return joinPath(this.appSettingsHome, 'workspaceStorage'); }
```

源码 3（`<workspaceId>` 是 URI 的 hash；空窗口是常量 id）：`src/vs/platform/workspaces/common/workspaceIdentifier.ts`、`src/vs/platform/workspace/common/workspace.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/common/workspaceIdentifier.ts#L26-L38

```ts
function getWorkspaceId(uri: URI): string {
	return hash(uri.toString()).toString(16);
}
```
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspace/common/workspace.ts#L155-L176

```ts
export const EXTENSION_DEVELOPMENT_EMPTY_WINDOW_WORKSPACE: IEmptyWorkspaceIdentifier = { id: 'ext-dev' };
export const UNKNOWN_EMPTY_WINDOW_WORKSPACE: IEmptyWorkspaceIdentifier = { id: 'empty-window' };

export function toWorkspaceIdentifier(arg0: IWorkspace | string | undefined, isExtensionDevelopment?: boolean): IAnyWorkspaceIdentifier {
	// Empty workspace
	if (typeof arg0 === 'string' || typeof arg0 === 'undefined') {
		// With a backupPath, the basename is the empty workspace identifier
		if (typeof arg0 === 'string') { return { id: basename(arg0) }; }
		if (isExtensionDevelopment) { return EXTENSION_DEVELOPMENT_EMPTY_WINDOW_WORKSPACE; }
		return UNKNOWN_EMPTY_WINDOW_WORKSPACE;
	}
	…
}
```

源码 4（in-memory 的真实触发条件）：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMain.ts#L303-L309

```ts
	protected async doCreate(): Promise<Storage> {
		return new Storage(new SQLiteStorageDatabase(this.path ?? SQLiteStorageDatabase.IN_MEMORY_PATH, {
			logging: this.createLoggingOptions()
		}), !this.path ? { hint: StorageHint.STORAGE_IN_MEMORY } : undefined);
	}
```
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMainService.ts#L105-L112,L255-L265

```ts
	getStorageOptions(): IStorageMainOptions {
		return {
			useInMemoryStorage: !!this.environmentService.extensionTestsLocationURI // no storage during extension tests!
		};
	}
	…
	private createWorkspaceStorage(workspace: IAnyWorkspaceIdentifier): IStorageMain {
		if (this.shutdownReason === ShutdownReason.KILL) {
			// Workaround for native crashes that we see when
			// SQLite DBs are being created even after shutdown
			// https://github.com/microsoft/vscode/issues/143186
			return new InMemoryStorageMain(this.logService, this.fileService);
		}
		return new WorkspaceStorageMain(workspace, this.getStorageOptions(), this.logService, this.environmentService, this.fileService);
	}
```
另外 `BaseStorageMain` 在真正 init 完成前，先持有一个纯内存 `Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY })`（storageMain.ts L126）。

源码 5（Web 端不是 SQLite，而是 IndexedDB `vscode-web-state-db-*`，失败时降级为内存）：`src/vs/workbench/services/storage/browser/storageService.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/storage/browser/storageService.ts#L341-L380

```ts
	static async createApplicationStorage(logService: ILogService): Promise<IIndexedDBStorageDatabase> {
		return IndexedDBStorageDatabase.create({ id: 'global', broadcastChanges: true }, logService);
	}
	static async createApplicationSharedStorage(logService: ILogService): Promise<IIndexedDBStorageDatabase> {
		return IndexedDBStorageDatabase.create({ id: 'global-shared', broadcastChanges: true }, logService);
	}
	static async createProfileStorage(profile: IUserDataProfile, logService: ILogService): Promise<IIndexedDBStorageDatabase> {
		return IndexedDBStorageDatabase.create({ id: `global-${profile.id}`, broadcastChanges: true }, logService);
	}
	static async createWorkspaceStorage(workspaceId: string, logService: ILogService): Promise<IIndexedDBStorageDatabase> {
		return IndexedDBStorageDatabase.create({ id: workspaceId }, logService);
	}
	…
	private static readonly STORAGE_DATABASE_PREFIX = 'vscode-web-state-db-';
	private static readonly STORAGE_OBJECT_STORE = 'ItemTable';
```

**关于「untitled workspace 用 in-memory」的说法：与源码不符（未核实存在这样一条路径）。** 我实读到的 in-memory 触发点只有三个：(1) 扩展测试 `extensionTestsLocationURI`；(2) 主进程 `ShutdownReason.KILL`；(3) 真实的 SQLite/IndexedDB 初始化前/失败时的降级。空窗口（无工作区）走 `id: 'empty-window'`，**仍然落盘**；`toWorkspaceIdentifier(backupPath)`（untitled 备份）用 `basename(backupPath)` 作 id，同样有独立目录。若你关心的是某个特定版本里 `isTemporaryWorkspace` 对应的特殊处理，那部分我**未核实**。

---

### A3. workbench 内部 Memento

**结论**：`Memento<T>` 把「一个 JSON 对象」整体存在**单个 key** 下（key = `memento/` + id），按 scope 在静态 Map 里缓存实例；`saveMemento()` 在 `onWillSaveState` 时被调用（通过 `Component` 基类）。空对象会被 `remove` 掉而不是存空。

源码：`src/vs/workbench/common/memento.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/memento.ts#L12-L60,L120-L160

```ts
export class Memento<T extends object> {
	private static readonly applicationMementos = new Map<string, ScopedMemento<unknown>>();
	private static readonly profileMementos = new Map<string, ScopedMemento<unknown>>();
	private static readonly workspaceMementos = new Map<string, ScopedMemento<unknown>>();
	private static readonly COMMON_PREFIX = 'memento/';

	constructor(id: string, private storageService: IStorageService) {
		this.id = Memento.COMMON_PREFIX + id;
	}

	getMemento(scope: StorageScope, target: StorageTarget): Partial<T> { /* 按 scope 取/建 ScopedMemento 并返回其对象 */ }

	saveMemento(): void {
		Memento.workspaceMementos.get(this.id)?.save();
		Memento.profileMementos.get(this.id)?.save();
		Memento.applicationMementos.get(this.id)?.save();
		Memento.applicationSharedMementos.get(this.id)?.save();
	}
}
```

```ts
class ScopedMemento<T> {
	getMemento(): Partial<T> { return this.mementoObj; }
	save(): void {
		if (!isEmptyObject(this.mementoObj)) {
			this.storageService.store(this.id, this.mementoObj, this.scope, this.target);
		} else {
			this.storageService.remove(this.id, this.scope);
		}
	}
}
```

`Component`（`src/vs/workbench/common/component.ts`）把 `saveState()` + `memento.saveMemento()` 挂到 `onWillSaveState`：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/component.ts#L24-L38

```ts
		this.memento = new Memento(this.id, storageService);
		this._register(storageService.onWillSaveState(() => {
			// Ask the component to persist state into the memento
			this.saveState();
			// Then save the memento into storage
			this.memento.saveMemento();
		}));
```

---

### A4. 扩展侧：workspaceState / globalState / storageUri / globalStorageUri / secrets

**结论（vscode.d.ts）**：`ExtensionContext` 暴露 `workspaceState: Memento`、`globalState: Memento & { setKeysForSync(keys): void }`、`storageUri: Uri | undefined`、`globalStorageUri: Uri`、`secrets: SecretStorage`（+ 已废弃的 `storagePath` / `globalStoragePath`）。`Memento` 只有 `keys()/get()/update()`。

源码：`src/vscode-dts/vscode.d.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L8430-L8470,L8500-L8545,L8585-L8620

```ts
		/**
		 * A memento object that stores state in the context
		 * of the currently opened {@link workspace.workspaceFolders workspace}.
		 */
		readonly workspaceState: Memento;

		/**
		 * A memento object that stores state independent
		 * of the current opened {@link workspace.workspaceFolders workspace}.
		 */
		readonly globalState: Memento & {
			/**
			 * Set the keys whose values should be synchronized across devices when synchronizing user-data
			 * like configuration, extensions, and mementos.
			 * …
			 *  - calling it with an empty array stops synchronization for this memento
			 *  - calling it with a non-empty array replaces all keys whose values are synchronized
			 */
			setKeysForSync(keys: readonly string[]): void;
		};

		readonly secrets: SecretStorage;
		readonly storageUri: Uri | undefined;   // 「The value is `undefined` when no workspace nor folder has been opened.」
		readonly globalStorageUri: Uri;
```

**扩展 Memento = 用扩展 id 作单一 storage key 存一个 JSON 对象**（不是 `memento/` 前缀那一套）：

源码：`src/vs/workbench/api/common/extHostMemento.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostMemento.ts#L25-L90

```ts
	constructor(id: string, global: boolean, storage: ExtHostStorage) {
		this._id = id;                       // 扩展 id（ExtensionGlobalMemento 传 identifier.value）
		this._shared = global;
		this._storage = storage;

		this._init = this._storage.initializeExtensionStorage(this._shared, this._id, Object.create(null)).then(value => {
			this._value = value;
			return this;
		});
		…
	}

	update(key: string, value: any): Promise<void> {
		if (value !== null && typeof value === 'object') {
			// Prevent the value from being as-is for until we have
			// received the change event from the main side by emulating
			// the treatment of values via JSON parsing and stringifying.
			// (https://github.com/microsoft/vscode/issues/209479)
			this._value![key] = JSON.parse(JSON.stringify(value));
		} else {
			this._value![key] = value;
		}
		… // RunOnceScheduler(0) 里 await this._storage.setValue(this._shared, this._id, this._value!)
	}
```

```ts
export class ExtensionGlobalMemento extends ExtensionMemento {
	setKeysForSync(keys: string[]): void {
		this._storage.registerExtensionStorageKeysToSync({ id: this._id, version: this._extension.version }, keys);
	}
	constructor(extensionDescription: IExtensionDescription, storage: ExtHostStorage) {
		super(extensionDescription.identifier.value, true, storage);
	}
}
```

**落到哪个 scope/target**：`workspaceState` → `StorageScope.WORKSPACE`；`globalState` → `StorageScope.PROFILE`；两者 target 都是 `StorageTarget.MACHINE`（注释：扩展状态由 extensions 同步机制单独同步）。

源码：`src/vs/platform/extensionManagement/common/extensionStorage.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensionManagement/common/extensionStorage.ts#L159-L186

```ts
	getExtensionStateRaw(extension: IExtension | IGalleryExtension | string, global: boolean): string | undefined {
		const extensionId = this.getExtensionId(extension);
		const rawState = this.storageService.get(extensionId, global ? StorageScope.PROFILE : StorageScope.WORKSPACE);
		…
		return rawState;
	}

	setExtensionState(extension: IExtension | IGalleryExtension | string, state: IStringDictionary<unknown> | undefined, global: boolean): void {
		const extensionId = this.getExtensionId(extension);
		if (state === undefined) {
			this.storageService.remove(extensionId, global ? StorageScope.PROFILE : StorageScope.WORKSPACE);
		} else {
			this.storageService.store(extensionId, JSON.stringify(state), global ? StorageScope.PROFILE : StorageScope.WORKSPACE, StorageTarget.MACHINE /* Extension state is synced separately through extensions */);
		}
	}

	setKeysForSync(extensionIdWithVersion: IExtensionIdWithVersion, keys: string[]): void {
		this.storageService.store(ExtensionStorageService.toKey(extensionIdWithVersion), JSON.stringify(keys), StorageScope.PROFILE, StorageTarget.MACHINE);
	}
```
`toKey()` = `` `extensionKeys/${adoptToGalleryExtensionId(extension.id)}@${extension.version}` ``（同文件 L47-L49）。

链路：`ExtHostStorage.$setValue` → RPC → `MainThreadStorage.$setValue`（`src/vs/workbench/api/browser/mainThreadStorage.ts`）→ `IExtensionStorageService.setExtensionState`。注意 `ExtHostStorage` 只把 **value 当 string 传**（`initializeExtensionStorage` 返回 raw，然后 `JSON.parse`）。

`storageUri` / `globalStorageUri` 的真身：`src/vs/workbench/api/common/extHostStoragePaths.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostStoragePaths.ts#L38-L90

```ts
	protected async _getWorkspaceStorageURI(storageName: string): Promise<URI> {
		return URI.joinPath(this._environment.workspaceStorageHome, storageName);
	}
	private async _getOrCreateWorkspaceStoragePath(): Promise<URI | undefined> {
		if (!this._workspace) { return Promise.resolve(undefined); }
		const storageName = this._workspace.id;
		const storageUri = await this._getWorkspaceStorageURI(storageName);
		… // 不存在则 createDirectory + 写 meta.json
	}
	workspaceValue(extension: IExtensionDescription): URI | undefined {
		if (this._value) { return URI.joinPath(this._value, extension.identifier.value); }
		return undefined;
	}
	globalValue(extension: IExtensionDescription): URI {
		return URI.joinPath(this._environment.globalStorageHome, extension.identifier.value.toLowerCase());
	}
```
即：`storageUri = <userDataDir>/User/workspaceStorage/<workspaceId>/<extensionId>`，`globalStorageUri = <globalStorageHome>/<扩展 id 小写>`（默认 profile 下即 `<userDataDir>/User/globalStorage/<id 小写>`）。

---

### A5. 有没有「session 级（关窗即丢）」的扩展 API？

**结论：没有。** 我读到的 `ExtensionContext` 存储面只有 `workspaceState`（WORKSPACE，落盘）、`globalState`（PROFILE，落盘）、`secrets`（加密、非本仓库）、`storageUri` / `globalStorageUri`（文件系统目录，文件由扩展自己管）。**扩展能用的 `StorageScope` 只有 WORKSPACE 与 PROFILE 两种，两者都会写 `state.vscdb`**，没有 SESSION/TRANSIENT scope。

- `StorageScope` 的 4 个值全在 A1 列出，没有 session 值。
- 内部的 in-memory storage（`InMemoryStorageMain` / `InMemoryStorageDatabase` / `InMemoryIndexedDBStorageDatabase`）都由主进程或 workbench 服务在构造期选择，**没有对应的扩展 API 入口**：扩展侧唯一的存储通道是 `ExtHostStorage` → `MainThreadStorage` → `IExtensionStorageService`，而 `IExtensionStorageService` 的 scope 被写死为 PROFILE / WORKSPACE（见 A4 代码）。
- 因此「session 级状态」对扩展而言只能靠扩展宿主进程里的内存变量（模块/闭包级），窗口关闭即丢。

**部分未核实**：是否存在 `vscode.proposed.*.d.ts` 里的实验性 session 存储 API；我没有逐份读 proposed 声明文件。

---

## B. 布局与 Grid

### B1. SerializableGrid 的序列化契约

**结论**：`ISerializableGrid = { root: ISerializedNode; orientation: Orientation; width: number; height: number }`；叶子节点数据来自 `view.toJSON()`（`ISerializableView` 合同就是 `toJSON(): object`）；`deserialize(json, deserializer, options)` 会先校验 `orientation/width/height` 是 number，再交给 `GridView.deserialize`。**序列化不是「保存布局」本身**——它只产出 JSON，存不存、存哪由调用方决定。

源码：`src/vs/base/browser/ui/grid/grid.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/grid.ts#L791-L900

```ts
export interface ISerializableView extends IView {
	toJSON(): object;
}

export interface IViewDeserializer<T extends ISerializableView> {
	fromJSON(json: any): T;
}

export interface ISerializedLeafNode {
	type: 'leaf';
	data: unknown;
	size: number;
	visible?: boolean;
	maximized?: boolean;
}

export interface ISerializedBranchNode {
	type: 'branch';
	data: ISerializedNode[];
	size: number;
	visible?: boolean;
}

export type ISerializedNode = ISerializedLeafNode | ISerializedBranchNode;

export interface ISerializedGrid {
	root: ISerializedNode;
	orientation: Orientation;
	width: number;
	height: number;
}
```

```ts
	static deserialize<T extends ISerializableView>(json: ISerializedGrid, deserializer: IViewDeserializer<T>, options: IGridOptions = {}): SerializableGrid<T> {
		if (typeof json.orientation !== 'number') {
			throw new Error('Invalid JSON: \'orientation\' property must be a number.');
		} else if (typeof json.width !== 'number') {
			throw new Error('Invalid JSON: \'width\' property must be a number.');
		} else if (typeof json.height !== 'number') {
			throw new Error('Invalid JSON: \'height\' property must be a number.');
		}

		const gridview = GridView.deserialize(json, deserializer, options);
		const result = new SerializableGrid<T>(gridview, options);

		return result;
	}

	serialize(): ISerializedGrid {
		return {
			root: SerializableGrid.serializeNode(this.getViews(), this.orientation),
			orientation: this.orientation,
			width: this.width,
			height: this.height
		};
	}
```
另有 `SerializableGrid.from(gridDescriptor, options)` 与导出函数 `createSerializedGrid(gridDescriptor)`（把 `GridDescriptor` 变成 `ISerializedGrid`），workbench 主布局用的就是 `createSerializedGrid` 这条路径（见 B2）。

---

### B2. workbench 主布局：各 key 的 scope/target（以及「grid 状态存哪」）

**结论：workbench 主 grid 不做 serialize。** `Layout.createWorkbenchLayout()` 每次都用 `createGridDescriptor()` 重新构建一棵固定的 grid 树（titlebar/banner/activitybar/sidebar/editor/panel/auxbar/statusbar），**每个 part 的尺寸与可见性被拆成独立 storage key** 保存。

key 名 = `workbench.` + `<key.name>`（`LayoutStateModel.STORAGE_PREFIX = 'workbench.'`）；因此实际键形如 `workbench.sideBar.size`、`workbench.sideBar.hidden`。

源码 A（构建 grid，而非反序列化持久状态）：`src/vs/workbench/browser/layout.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts#L1670-L1686

```ts
		const fromJSON = ({ type }: { type: Parts }) => viewMap[type];
		const workbenchGrid = SerializableGrid.deserialize(
			this.createGridDescriptor(),
			{ fromJSON },
			{ proportionalLayout: false }
		);
```

源码 B（键定义，原样摘录）：`src/vs/workbench/browser/layout.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts#L2858-L2935

```ts
const LayoutStateKeys = {

	// Editor
	MAIN_EDITOR_CENTERED: new RuntimeStateKey<boolean>('editor.centered', StorageScope.WORKSPACE, StorageTarget.MACHINE, false),

	// Part Sizing
	SIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),
	AUXILIARYBAR_SIZE: new InitializationStateKey<number>('auxiliaryBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),
	PANEL_SIZE: new InitializationStateKey<number>('panel.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),

	// Part State
	PANEL_LAST_NON_MAXIMIZED_HEIGHT: new RuntimeStateKey<number>('panel.lastNonMaximizedHeight', StorageScope.PROFILE, StorageTarget.MACHINE, 300),
	PANEL_LAST_NON_MAXIMIZED_WIDTH: new RuntimeStateKey<number>('panel.lastNonMaximizedWidth', StorageScope.PROFILE, StorageTarget.MACHINE, 300),
	PANEL_WAS_LAST_MAXIMIZED: new RuntimeStateKey<boolean>('panel.wasLastMaximized', StorageScope.WORKSPACE, StorageTarget.MACHINE, false),
	AUXILIARYBAR_WAS_LAST_MAXIMIZED: new RuntimeStateKey<boolean>('auxiliaryBar.wasLastMaximized', StorageScope.WORKSPACE, StorageTarget.MACHINE, false),
	AUXILIARYBAR_LAST_NON_MAXIMIZED_SIZE: new RuntimeStateKey<number>('auxiliaryBar.lastNonMaximizedSize', StorageScope.PROFILE, StorageTarget.MACHINE, 300),
	AUXILIARYBAR_EMPTY: new InitializationStateKey<boolean>('auxiliaryBar.empty', StorageScope.PROFILE, StorageTarget.MACHINE, false),

	// Part Positions
	SIDEBAR_POSITON: new RuntimeStateKey<Position>('sideBar.position', StorageScope.WORKSPACE, StorageTarget.MACHINE, Position.LEFT),
	PANEL_POSITION: new RuntimeStateKey<Position>('panel.position', StorageScope.WORKSPACE, StorageTarget.MACHINE, Position.BOTTOM),
	PANEL_ALIGNMENT: new RuntimeStateKey<PanelAlignment>('panel.alignment', StorageScope.PROFILE, StorageTarget.USER, 'center'),

	// Part Visibility
	ACTIVITYBAR_HIDDEN: new RuntimeStateKey<boolean>('activityBar.hidden', StorageScope.WORKSPACE, StorageTarget.MACHINE, false, true),
	SIDEBAR_HIDDEN: new RuntimeStateKey<boolean>('sideBar.hidden', StorageScope.WORKSPACE, StorageTarget.MACHINE, false),
	EDITOR_HIDDEN: new RuntimeStateKey<boolean>('editor.hidden', StorageScope.WORKSPACE, StorageTarget.MACHINE, false),
	PANEL_HIDDEN: new RuntimeStateKey<boolean>('panel.hidden', StorageScope.WORKSPACE, StorageTarget.MACHINE, true),
	AUXILIARYBAR_HIDDEN: new RuntimeStateKey<boolean>('auxiliaryBar.hidden', StorageScope.WORKSPACE, StorageTarget.MACHINE, true),
	STATUSBAR_HIDDEN: new RuntimeStateKey<boolean>('statusBar.hidden', StorageScope.WORKSPACE, StorageTarget.MACHINE, false, true)

} as const;
```
（`RuntimeStateKey` 第 5 个参数是 `zenModeIgnore`；尺寸类用 `InitializationStateKey`，只在启动时读取。）

源码 C（实际写入/读取的键格式）：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts#L3225-L3240

```ts
	private saveKeyToStorage<T extends StorageKeyType>(key: WorkbenchLayoutStateKey<T>): void {
		const value = this.stateCache.get(key.name) as T;
		this.storageService.store(`${LayoutStateModel.STORAGE_PREFIX}${key.name}`, typeof value === 'object' ? JSON.stringify(value) : value, key.scope, key.target);
	}

	private loadKeyFromStorage<T extends StorageKeyType>(key: WorkbenchLayoutStateKey<T>): T | undefined {
		const value = this.storageService.get(`${LayoutStateModel.STORAGE_PREFIX}${key.name}`, key.scope);
		…
	}
```

**明确回答**：不存在 `workbench.grid.state` 这个键；`GRID_SIZE` 这个 key 名也不存在（**未核实**有任何叫 `GRID_SIZE` 的常量——我在 layout.ts 全文里没读到）。主 grid 的「状态」= 上表各 part 的 size/hidden/position 键的集合，尺寸存在 **PROFILE/MACHINE**，可见性存在 **WORKSPACE/MACHINE**。（例外：`PANEL_ALIGNMENT` 是 PROFILE/**USER**，`editor.centered` 是 WORKSPACE/MACHINE。）

---

### B3. Grid 在 workbench 里被复用了不止一次

**结论：至少两处**：
1. **workbench 主布局**（`Layer`/`Layout`，B2）——`workbench.grid` 只是运行时对象，不落盘；
2. **每个 EditorPart**（含辅助窗口/模态编辑器 part）——`SerializableGrid<IEditorGroupView>`，并且**真的会 serialize 到 storage**。

**ViewPaneContainer 不是 grid，而是 SplitView。** 它的 `PaneView`（`src/vs/base/browser/ui/splitview/paneview.ts:499`，内部 `new SplitView(this.element, {...})`）承载各 ViewPane。

源码 A（EditorPart）：`src/vs/workbench/browser/parts/editor/editorPart.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts#L102-L157,L1478-L1505

```ts
	private static readonly EDITOR_PART_UI_STATE_STORAGE_KEY = 'editorpart.state';
	…
	private readonly workspaceMemento = this.getMemento(StorageScope.WORKSPACE, StorageTarget.USER);
	private readonly profileMemento = this.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
	…
	protected override saveState(): void {
		// Persist grid UI state
		if (this.gridWidget) {
			if (this.isEmpty) {
				delete this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
			} else {
				this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY] = this.createState();
			}
		}
		…
		super.saveState();
	}

	createState(): IEditorPartUIState {
		return {
			serializedGrid: this.gridWidget.serialize(),
			activeGroup: this._activeGroup.id,
			mostRecentActiveGroups: this.mostRecentActiveGroups
		};
	}
```
注意 `EDITOR_PART_UI_STATE_STORAGE_KEY = 'editorpart.state'` 是 **memento 对象里的字段名**，不是 storage key；真正的 storage key 是 `memento/<Component id>`（EditorPart 的 id 传的是 `Parts.EDITOR_PART` = `'workbench.parts.editor'`，见 editorPart.ts L1672 与 layoutService.ts L30），scope/target = `WORKSPACE / USER`。反序列化见 `doCreateGridControlWithState()` → `SerializableGrid.deserialize(serializedGrid, { fromJSON: … }, { styles: … })`（editorPart.ts L1334-L1360）。

源码 B（ViewPaneContainer / PaneView）：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewPaneContainer.ts#L360-L382,L747-L755

```ts
		this.viewContainer = container;
		this.visibleViewsStorageId = `${id}.numberOfVisibleViews`;
		this.visibleViewsCountFromCache = this.storageService.getNumber(this.visibleViewsStorageId, StorageScope.WORKSPACE, undefined);
		this.viewContainerModel = this.viewDescriptorService.getViewContainerModel(container);
	…
	protected override saveState(): void {
		this.panes.forEach((view) => view.saveState());
		this.storageService.store(this.visibleViewsStorageId, this.length, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}
```
URL: https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/paneview.ts#L499-L520

```ts
export class PaneView extends Disposable {
	…
	private splitview: SplitView;
	…
	constructor(container: HTMLElement, options: IPaneViewOptions = {}) {
		super();
		…
		this.splitview = this._register(new SplitView(this.element, { orientation: this.orientation }));
```

源码 C（每个 view 的可见性/顺序/尺寸落在 viewContainerModel）：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/common/viewContainerModel.ts#L24-L25,L60-L71,L95-L110,L265-L277

```ts
export function getViewsStateStorageId(viewContainerStorageId: string): string { return `${viewContainerStorageId}.hidden`; }
```
```ts
		this.globalViewsStateStorageId = getViewsStateStorageId(viewContainerStorageId);   // `${id}.hidden`
		this.workspaceViewsStateStorageId = viewContainerStorageId;                        // `${id}`
```
```ts
			this.storageService.store(this.workspaceViewsStateStorageId, JSON.stringify(storedViewsStates), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	…
		this.storageService.store(this.globalViewsStateStorageId, value, StorageScope.PROFILE, StorageTarget.USER);
```
即：视图容器状态键是 `<viewContainerId>`（WORKSPACE/MACHINE，存 `{collapsed,isHidden,size,order}`）与 `<viewContainerId>.hidden`（PROFILE/USER，存全局隐藏/顺序），另有 `<viewContainerId>.numberOfVisibleViews`（WORKSPACE/MACHINE）。**没有 `${id}.state` 这个键**（我实读到的就是上面三种）。

---

### B4. 扩展贡献的 view：能不能自己搞 grid？

**结论：不能。** 扩展的 TreeView / WebviewView 都是**宿主创建的 ViewPane 叶子**，在 `PaneView`（SplitView）里由宿主分配尺寸与折叠。扩展唯一能表达的是 view 描述符里的 `weight`（初始化尺寸）与可见性；实际尺寸由宿主保存（viewContainerModel，见 B3/C）。WebviewView 内部自己做布局由自己的 HTML 决定，但**状态持久化由宿主的 Memento 负责**，扩展通过 `WebviewViewResolveContext.state` 拿回。

源码 A（TreeView 是 ViewPane）：`src/vs/workbench/browser/parts/views/treeView.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/treeView.ts#L81-L83

```ts
export class TreeViewPane extends ViewPane {
```
（真实渲染对象 `TreeView extends AbstractTreeView`（同文件 L1904）由 `TreeViewPane` 持有并 `render`/`layout` 到 pane 的 body 内；扩展侧 `extHostTreeViews.ts` 的 `ExtHostTreeView`（L318）没有任何布局/网格 API。）

源码 B（WebviewView 状态由宿主保存）：`src/vs/workbench/contrib/webviewView/browser/webviewViewPane.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webviewView/browser/webviewViewPane.ts#L25-L32,L63-L92,L140-L190

```ts
const storageKeys = {
	webviewState: 'webviewState',
} as const;

interface WebviewViewState {
	[storageKeys.webviewState]?: string | undefined;
}
```
```ts
		this.memento = new Memento(`webviewView.${this.id}`, storageService);
		this.viewState = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
```
```ts
			this.viewState[storageKeys.webviewState] = this._webview.value.state;   // saveState 时
			webview.state = this.viewState[storageKeys.webviewState];              // 重建 webview 时
```
即 storage key = `memento/webviewView.<viewId>`，scope/target = **WORKSPACE / MACHINE**。

源码 C（扩展侧读回该状态）：`src/vscode-dts/vscode.d.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L10290-L10330

```ts
	export interface WebviewViewResolveContext<T = unknown> {
		/**
		 * Persisted state from the webview content.
		 * …
		 * To save off a persisted state, inside the webview call `acquireVsCodeApi().setState()` with
		 * any json serializable object. To restore the state again, call `getState()`.
		 * …
		 * The editor ensures that the persisted state is saved correctly when a webview is hidden and across
		 * editor restarts.
		 */
		readonly state: T | undefined;
	}
```
**注意**：`vscode.WebviewView` 本身没有 `getState/setState`；state 只在这一处（resolve 时的 context）交给扩展，写回由 webview 内的 `acquireVsCodeApi().setState()` 完成。

---

## C. 命令系统

### C1. CommandsRegistry / ICommandService

源码：`src/vs/platform/commands/common/commands.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/commands/common/commands.ts#L15-L27,L58-L70

```ts
export const ICommandService = createDecorator<ICommandService>('commandService');

export interface ICommandEvent {
	readonly commandId: string;
	readonly args: unknown[];
}

export interface ICommandService {
	readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<ICommandEvent>;
	readonly onDidExecuteCommand: Event<ICommandEvent>;
	executeCommand<R = unknown>(commandId: string, ...args: unknown[]): Promise<R | undefined>;
}
```
```ts
export interface ICommandRegistry {
	readonly onDidRegisterCommand: Event<string>;
	registerCommand<Args extends unknown[]>(id: string, command: ICommandHandler<Args>): IDisposable;
	registerCommand<Args extends unknown[]>(command: ICommand<Args>): IDisposable;
	registerCommandAlias(oldId: string, newId: string): IDisposable;
	getCommand(id: string): ICommand | undefined;
	getCommands(): ICommandsMap;
}
```
`CommandsRegistry.registerCommand` 同名命令可叠加（`LinkedList`，后注册的在前），并支持 `metadata.args` 的运行期类型校验（同文件 L104-L140）。

---

### C2. Action2 / registerAction2：一次登记 command + menu + keybinding

源码：`src/vs/platform/actions/common/actions.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/actions/common/actions.ts#L723-L785

```ts
export function registerAction2(ctor: { new(): Action2 }): IDisposable {
	…
	const { f1, menu, keybinding, ...command } = action.desc;

	if (CommandsRegistry.getCommand(command.id)) {
		throw new Error(`Cannot register two commands with the same id: ${command.id}`);
	}

	// command
	disposables.push(CommandsRegistry.registerCommand({
		id: command.id,
		handler: (accessor, ...args) => action.run(accessor, ...args),
		metadata: command.metadata ?? { description: action.desc.title }
	}));

	// menu
	if (Array.isArray(menu)) { … MenuRegistry.appendMenuItem(item.id, { command: …, ...item }) }
	else if (menu) { … }
	if (f1) {
		disposables.push(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command, when: command.precondition }));
		disposables.push(MenuRegistry.addCommand(command));
	}

	// keybinding
	if (Array.isArray(keybinding)) { … KeybindingsRegistry.registerKeybindingRule({ ...item, id: command.id, when: … }) }
	else if (keybinding) { … KeybindingsRegistry.registerKeybindingRule({ ...keybinding, id: command.id, when: … }) }
	…
}
```

**`MenuItemAction.run` 确实走 `commandService.executeCommand`**：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/actions/common/actions.ts#L650-L672

```ts
	run(...args: unknown[]): Promise<void> {
		let runArgs: unknown[] = [];

		if (this._options?.args) {
			runArgs = [...runArgs, ...this._options.args];
		} else if (this._options?.arg) {
			runArgs = [...runArgs, this._options.arg];
		}

		if (this._options?.shouldForwardArgs) {
			runArgs = [...runArgs, ...args];
		}

		return this._commandService.executeCommand(this.id, ...runArgs);
	}
```
（`MenuItemAction` 是「菜单项 → 命令」的桥；注意它不继承 `Action`，`id` 就是 command id。）

---

### C3. 命令面板的命令从哪来；Ctrl+P 与 Ctrl+Shift+P

**来源**：`MenuId.CommandPalette`。`MenuRegistry.getMenuItems(MenuId.CommandPalette)` 特殊处理——除了显式登记项，还会**把所有注册过的命令隐式追加进去**：

源码：`src/vs/platform/actions/common/actions.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/actions/common/actions.ts#L531-L562

```ts
	getMenuItems(id: MenuId): Array<IMenuItem | ISubmenuItem> {
		let result: Array<IMenuItem | ISubmenuItem>;
		…
		if (id === MenuId.CommandPalette) {
			// CommandPalette is special because it shows
			// all commands by default
			this._appendImplicitItems(result);
		}
		return result;
	}

	private _appendImplicitItems(result: Array<IMenuItem | ISubmenuItem>) {
		const set = new Set<string>();
		for (const item of result) {
			if (isIMenuItem(item)) {
				set.add(item.command.id);
				if (item.alt) { set.add(item.alt.id); }
			}
		}
		this._commands.forEach((command, id) => {
			if (!set.has(id)) { result.push({ command }); }
		});
	}
```

命令面板取数：`src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts#L226-L232,L273-L293

```ts
		const globalCommandsMenu = this.menuService.getMenuActions(MenuId.CommandPalette, scopedContextKeyService);
```
```ts
export class ShowAllCommandsAction extends Action2 {
	static readonly ID = 'workbench.action.showCommands';
	constructor() {
		super({
			id: ShowAllCommandsAction.ID,
			title: localize2('showTriggerActions', 'Show All Commands'),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: undefined,
				primary: !isFirefox ? (KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP) : undefined,
				secondary: [KeyCode.F1]
			},
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IQuickInputService).quickAccess.show(CommandsQuickAccessProvider.PREFIX);
	}
}
```

**`>` 前缀** 定义在基类：`src/vs/platform/quickinput/browser/commandsQuickAccess.ts:51` → `static PREFIX = '>';`；注册进 Quick Access：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/quickaccess/browser/quickAccess.contribution.ts#L41-L47

```ts
quickAccessRegistry.registerQuickAccessProvider({
	ctor: CommandsQuickAccessProvider,
	prefix: CommandsQuickAccessProvider.PREFIX,
	contextKey: 'inCommandsPicker',
	placeholder: localize('commandsQuickAccessPlaceholder', "Type the name of a command to run."),
	helpEntries: [{ description: localize('commandsQuickAccess', "Show and Run Commands"), commandId: ShowAllCommandsAction.ID, commandCenterOrder: 20 }]
});
```

**Ctrl+P 是 `workbench.action.quickOpen`**（无前缀 = anything provider；`prefix` 是它的可选参数）：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/quickAccessActions.ts#L25-L29,L126-L152

```ts
const globalQuickAccessKeybinding = {
	primary: KeyMod.CtrlCmd | KeyCode.KeyP,
	secondary: [KeyMod.CtrlCmd | KeyCode.KeyE],
	mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyP, secondary: undefined }
};
```
```ts
			id: 'workbench.action.quickOpen',
			title: localize2('quickOpen', "Go to File..."),
			…
			keybinding: { weight: KeybindingWeight.WorkbenchContrib, primary: globalQuickAccessKeybinding.primary, … },
	…
	run(accessor: ServicesAccessor, prefix: undefined): void {
		const quickInputService = accessor.get(IQuickInputService);
		quickInputService.quickAccess.show(typeof prefix === 'string' ? prefix : undefined, { preserveValue: typeof prefix === 'string' });
	}
```

**关系**：Ctrl+Shift+P 只是「带 `>` 前缀打开同一个 Quick Input」——两者最终都调 `quickAccess.show(...)`，`>` 让 QuickAccess 路由到 `CommandsQuickAccessProvider`，从而列出 `MenuId.CommandPalette` 的（= 几乎所有）命令。命令的 **label/category/别名/描述**（`metadata.description`）来自 `ICommandAction`，来源是 `registerAction2` 的 `title/category/metadata` 或 `CommandsRegistry` 的 `metadata`。

---

### C4. 具体案例：侧栏收起

**(a) 命令注册位置**

- `workbench.action.toggleSidebarVisibility` → `ToggleSidebarVisibilityAction`（`src/vs/workbench/browser/actions/layoutActions.ts:288-340`）：`f1: true`、`keybinding: Ctrl+B`、`toggled: { condition: SideBarVisibleContext }`，`menu` 进 `MenuId.LayoutControlMenuSubmenu` / `MenubarAppearanceMenu`；
- `workbench.action.closeSidebar` → 匿名 Action2（`src/vs/workbench/browser/parts/sidebar/sidebarActions.ts:18-31`）：`f1: true`、`precondition: SideBarVisibleContext`。

URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/layoutActions.ts#L312-L322
```ts
	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const isCurrentlyVisible = layoutService.isVisible(Parts.SIDEBAR_PART);

		layoutService.setPartHidden(isCurrentlyVisible, Parts.SIDEBAR_PART);

		// Announce visibility change to screen readers
		const alertMessage = isCurrentlyVisible
			? localize('sidebarHidden', "Primary Side Bar hidden")
			: localize('sidebarVisible', "Primary Side Bar shown");
		alert(alertMessage);
	}
```
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/sidebar/sidebarActions.ts#L18-L31
```ts
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.closeSidebar',
			title: localize2('closeSidebar', 'Close Primary Side Bar'),
			category: Categories.View,
			f1: true,
			precondition: SideBarVisibleContext
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.SIDEBAR_PART);
	}
});
```

**(b) 活动栏图标点击：直接调服务，不走命令**

`src/vs/workbench/browser/parts/paneCompositeBar.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/paneCompositeBar.ts#L804-L836

```ts
		if (this.part === Parts.ACTIVITYBAR_PART) {
			const sideBarVisible = this.layoutService.isVisible(Parts.SIDEBAR_PART);
			const activeViewlet = this.paneCompositePart.getActivePaneComposite();
			const focusBehavior = this.configurationService.getValue<string>('workbench.activityBar.iconClickBehavior');

			if (sideBarVisible && activeViewlet?.getId() === this.compositeBarActionItem.id) {
				switch (focusBehavior) {
					case 'focus':
						this.paneCompositePart.openPaneComposite(this.compositeBarActionItem.id, focus);
						break;
					case 'toggle':
					default:
						// Hide sidebar if selected viewlet already visible
						this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
						break;
				}

				return;
			}
		}

		await this.paneCompositePart.openPaneComposite(this.compositeBarActionItem.id, focus);
		return this.activate();
```
（`ViewContainerActivityAction.run`——`IWorkbenchLayoutService.setPartHidden` 是直接注入调用，**没有经过 `ICommandService`**。）

**(c) 标题栏按钮：分两种情况，已核实的是面板**

面板标题区的「×」是 **`MenuId.PanelTitle` 上的菜单项**，指向命令 `workbench.action.togglePanel`：
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/panel/panelActions.ts#L74-L82
```ts
MenuRegistry.appendMenuItem(MenuId.PanelTitle, {
	command: {
		id: TogglePanelAction.ID,
		title: localize('closePanel', 'Hide Panel'),
		icon: closeIcon
	},
	group: 'navigation',
	order: 2
});
```
该按钮由 `MenuItemAction` 渲染 → 点击即 `executeCommand('workbench.action.togglePanel')` → `layoutService.setPartHidden(layoutService.isVisible(Parts.PANEL_PART), Parts.PANEL_PART)`（panelActions.ts L30-L63）。

侧栏同位置的「标题区动作栏」用的菜单 id 是 `MenuId.SidebarTitle`（`SidebarPart` 构造时作为 `globalActionsMenuId` 传入，`src/vs/workbench/browser/parts/sidebar/sidebarPart.ts:104`），另外 `MenuId.ViewContainerTitleContext` 上挂了「Hide Primary Side Bar」（layoutActions.ts L343-L353，右键菜单）。**「侧栏标题栏上是否还有一个独立的关闭 ×、以及它由谁贡献」我未核实**（需要全仓库穷举 `MenuId.SidebarTitle` 的贡献者；我试过 grep.app 检索但被限流，GitHub 代码搜索 API 需要鉴权）。可确证的是：**只要它是通过菜单项渲染的，点击就等价于 `executeCommand`**（C2 的 `MenuItemAction.run`）。

**(d) 结论**：**不是同一条管线。**
- 活动栏图标（含「再点一次收起」）→ 直接调用 `IWorkbenchLayoutService.setPartHidden` / `IPaneCompositePartService.openPaneComposite`，**不经过命令系统**，因此 `onWillExecuteCommand`/`onDidExecuteCommand` 不会触发；
- 命令面板 / 键绑定 / 菜单按钮（含面板 ×）→ `ICommandService.executeCommand('workbench.action.…')` → `Action2.run` → 最终也是调用同一个 `layoutService.setPartHidden`。即：**副作用一致（都落到 layoutService + storage），但入口管线不同**。

---

### C5. 其他模块如何「订阅」侧栏被收起

**主渠道是服务事件 + ContextKey，而不是命令事件。** 两个都可核实的订阅面：

1. `IWorkbenchLayoutService.onDidChangePartVisibility`（`src/vs/workbench/services/layout/browser/layoutService.ts:473-L511`）：
```ts
export interface IPartVisibilityChangeEvent {
	readonly partId: string;
	readonly visible: boolean;
	readonly source?: 'resize';
}

export interface IWorkbenchLayoutService extends ILayoutService {
	/**
	 * Emit when part visibility changes.
	 */
	readonly onDidChangePartVisibility: Event<IPartVisibilityChangeEvent>;
	…
	setPartHidden(hidden: boolean, part: Parts): void;
```
2. 由它驱动 **ContextKey `sideBarVisible`**：`src/vs/workbench/browser/contextkeys.ts`（`WorkbenchContextKeysHandler`）
URL: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/contextkeys.ts#L183-L184,L252-L259
```ts
		// Sidebar
		this.sideBarVisibleContext = SideBarVisibleContext.bindTo(this.contextKeyService);
		this.sideBarVisibleContext.set(this.layoutService.isVisible(Parts.SIDEBAR_PART));
```
```ts
		this._register(this.layoutService.onDidChangePartVisibility(() => {
			this.mainEditorAreaVisibleContext.set(this.layoutService.isVisible(Parts.EDITOR_PART, mainWindow));
			this.panelVisibleContext.set(this.layoutService.isVisible(Parts.PANEL_PART));
			…
			this.sideBarVisibleContext.set(this.layoutService.isVisible(Parts.SIDEBAR_PART));
		}));
```
其他消费者同理：`ActivitybarPart` 直接 `this._register(this.layoutService.onDidChangePartVisibility(e => {…}))`（activitybarPart.ts L228）。

**扩展 API 有没有 onDidExecuteCommand？——没有。** `vscode.d.ts` 的 `commands` 命名空间只有 `registerCommand / registerTextEditorCommand / executeCommand / getCommands`（vscode.d.ts L10976-L11042，我逐成员读过）。扩展要「感知 UI 状态」的正规做法是：监听具体 API 事件（如 `window.onDidChangeActiveTextEditor`）、或读/写 ContextKey（`vscode.commands.executeCommand('setContext', …)`）+ `when` 子句。**部分未核实**：proposed API 里是否有命令执行事件钩子（未逐份读 proposed d.ts）。

---

### C6. 键绑定解析 → 命令

**是。** `KeybindingResolver` 只负责「chord → commandId + args + bubble」；`when` 由 `IContextKeyService` 提供的 `IContext` 求值；真正执行发生在 `AbstractKeybindingService._doDispatch` → `ICommandService.executeCommand(commandId, args)`。

源码 A（解析结果为命令 id；when 用 `rules.evaluate(context)`）：
`src/vs/platform/keybinding/common/keybindingResolver.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/keybindingResolver.ts#L22-L34,L378-L400

```ts
export type ResolutionResult =
	| { kind: ResultKind.NoMatchingKb }
	| { kind: ResultKind.MoreChordsNeeded }
	| { kind: ResultKind.KbFound; commandId: string | null; commandArgs: any; isBubble: boolean };
```
```ts
	private _findCommand(context: IContext, matches: ResolvedKeybindingItem[]): ResolvedKeybindingItem | null {
		for (let i = matches.length - 1; i >= 0; i--) {
			const k = matches[i];

			if (!KeybindingResolver._contextMatchesRules(context, k.when)) {
				continue;
			}

			return k;
		}

		return null;
	}

	private static _contextMatchesRules(context: IContext, rules: ContextKeyExpression | null | undefined): boolean {
		if (!rules) {
			return true;
		}
		return rules.evaluate(context);
	}
```

源码 B（context 来自被聚焦 DOM target 的 scoped context key service；命中后 executeCommand）：
`src/vs/platform/keybinding/common/abstractKeybindingService.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/abstractKeybindingService.ts#L340-L346,L386-L400

```ts
		const contextValue = this._contextKeyService.getContext(target);
		const keypressLabel = userKeypress.getLabel();

		const resolveResult = this._getResolver().resolve(contextValue, currentChords, userPressedChord);
```
```ts
					this._log(`+ Invoking command ${resolveResult.commandId}.`);
					this._currentlyDispatchingCommandId = resolveResult.commandId;
					try {
						if (typeof resolveResult.commandArgs === 'undefined') {
							this._commandService.executeCommand(resolveResult.commandId).then(undefined, err => this._notificationService.warn(err));
						} else {
							this._commandService.executeCommand(resolveResult.commandId, resolveResult.commandArgs).then(undefined, err => this._notificationService.warn(err));
						}
					} finally {
						this._currentlyDispatchingCommandId = null;
					}
```

**ContextKey = 「跨模块共享、不持久化」的状态容器**：`src/vs/platform/contextkey/common/contextkey.ts`
URL: https://github.com/microsoft/vscode/blob/main/src/vs/platform/contextkey/common/contextkey.ts#L2034-L2082

```ts
export type ContextKeyValue = null | undefined | boolean | number | string
	| Array<null | undefined | boolean | number | string>
	| Record<string, null | undefined | boolean | number | string>;

export interface IContext {
	getValue<T extends ContextKeyValue = ContextKeyValue>(key: string): T | undefined;
}

export interface IContextKey<T extends ContextKeyValue = ContextKeyValue> {
	set(value: T): void;
	reset(): void;
	get(): T | undefined;
}

export const IContextKeyService = createDecorator<IContextKeyService>('contextKeyService');

export interface IContextKeyService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeContext: Event<IContextKeyChangeEvent>;
	bufferChangeEvents(callback: Function): void;

	createKey<T extends ContextKeyValue>(key: string, defaultValue: T | undefined): IContextKey<T>;
	contextMatchesRules(rules: ContextKeyExpression | undefined): boolean;
	getContextKeyValue<T>(key: string): T | undefined;

	createScoped(target: IContextKeyServiceTarget): IScopedContextKeyService;
	createOverlay(overlay: Iterable<[string, any]>): IContextKeyService;
	getContext(target: IContextKeyServiceTarget | null): IContext;
	…
}
```
键的定义用 `RawContextKey`（如 `new RawContextKey<boolean>('sideBarVisible', false, …)`，`src/vs/workbench/common/contextkeys.ts:135`），绑定用 `bindTo(contextKeyService)`。**ContextKey 不落盘**，它是 workbench 内跨模块的「瞬时共享状态」；扩展侧只能通过 `setContext` 写、通过 `when` 读，**没有读 API**（未核实有 proposed 读接口）。

---

## 总表：持久化状态 / 会话瞬时态 / 共享非持久态

| 类别 | 机制 | 存储位置 / 键 | 谁能访问 |
|---|---|---|---|
| 持久化（全局） | `IStorageService` `StorageScope.APPLICATION`(+`_SHARED`) | `User/globalStorage/state.vscdb`（`appSharedDataHome/sharedStorage/state.vscdb`） | 仅 workbench 内部；扩展无该 scope |
| 持久化（profile） | `StorageScope.PROFILE` + target | 默认 profile = `User/globalStorage/state.vscdb`；具名 profile = `User/profiles/<id>/globalStorage/state.vscdb` | workbench 内部；扩展经 `globalState`(=PROFILE/MACHINE) 间接使用 |
| 持久化（工作区） | `StorageScope.WORKSPACE` + `StorageTarget`(USER/MACHINE) | `User/workspaceStorage/<hash>/state.vscdb` | workbench 内部；扩展经 `workspaceState`(=WORKSPACE/MACHINE) |
| 扩展键值状态 | `ExtHostStorage` → `MainThreadStorage` → `IExtensionStorageService` | storage key = **扩展 id**，值 = **整个 JSON 对象** | 扩展（唯一入口） |
| 扩展密钥 | `ExtensionContext.secrets` (`SecretStorage`) | 平台加密存储（非 state.vscdb） | 扩展 |
| 扩展文件态 | `storageUri` / `globalStorageUri` | `workspaceStorage/<id>/<extId>` / `globalStorage/<extId 小写>` | 扩展（文件系统） |
| workbench 组件态 | `Memento`（`memento/<id>`，一个 JSON 对象） | 由 scope/target 决定落在上面三个库 | workbench 内部 |
| 编辑器分组布局 | `SerializableGrid.serialize()` → EditorPart memento 字段 `editorpart.state` | `memento/workbench.parts.editor`（WORKSPACE/USER） | workbench 内部 |
| 主窗口 part 布局 | **不序列化 grid**；`workbench.sideBar.size`、`workbench.sideBar.hidden` 等分散键 | size 系列 PROFILE/MACHINE；hidden/position 系列 WORKSPACE/MACHINE | workbench 内部 |
| 视图容器状态 | `<viewContainerId>`(WORKSPACE/MACHINE) + `<viewContainerId>.hidden`(PROFILE/USER) + `.numberOfVisibleViews`(WORKSPACE/MACHINE) | state.vscdb | workbench 内部（扩展只能间接受影响） |
| WebviewView 内容状态 | `Memento` 键 `memento/webviewView.<viewId>`，字段 `webviewState` | WORKSPACE/MACHINE | 宿主写读，扩展经 `WebviewViewResolveContext.state` / `acquireVsCodeApi().setState()` |
| 会话瞬时态（内存） | `InMemoryStorageMain` / `InMemoryStorageDatabase` / `InMemoryIndexedDBStorageDatabase` | 无文件；触发点：扩展测试、主进程 KILL、DB 初始化前/失败 | 仅 workbench / 主进程内部，**扩展无 API** |
| 共享非持久态 | `IContextKeyService` + `RawContextKey`（如 `sideBarVisible`） | 内存（scoped/overlay，无持久化） | workbench 内部任意模块 `bindTo`；扩展只能 `setContext` 写、`when` 读 |
| 命令运行时 | `ICommandService`（`onWillExecuteCommand` / `onDidExecuteCommand`） | 内存事件 | **仅 workbench 内部**（扩展 API 无此事件） |
| 扩展会话态 | 只能靠扩展宿主进程内存变量 | 无 | 扩展自己 |

---

## 未核实清单（明确边界）

1. **侧栏标题栏是否存在独立的关闭 × 按钮、由谁贡献**：我只证实了 `MenuId.SidebarTitle` 被 `SidebarPart` 作为 `globalActionsMenuId` 传入，以及 `MenuId.ViewContainerTitleContext` 上挂有「Hide Primary Side Bar」。全仓库 `MenuId.SidebarTitle` 的贡献者未穷举（grep.app 检索被限流、GitHub 代码搜索 API 需鉴权）。
2. **`workbench.grid.state` / `GRID_SIZE`**：在 layout.ts / editorPart.ts 及我读到的相关文件中**不存在**；「全仓库绝无此名」未做穷举验证。
3. **workbench 中除「主布局 grid」与「EditorPart grid」之外是否还有第三处 `SerializableGrid`**：未穷举（我用仓库 tree 确认 `src/vs/workbench` 下没有文件名含 grid 的文件，但未逐文件 grep 内容）。
4. **untitled workspace 是否有专门的非持久化 storage 路径**：未核实（现有证据指向「仍然落盘」）。
5. **proposed API 是否有命令执行事件 / session 级存储**：未逐份阅读 `src/vscode-dts/vscode.proposed.*.d.ts`。
6. **macOS/Linux 的 `userDataDir` 具体路径**：未核实（只读了 `environmentService` 的路径拼接逻辑，未读各平台的取值）。
