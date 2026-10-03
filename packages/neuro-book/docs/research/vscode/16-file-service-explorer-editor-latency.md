# 16 文件服务、资源管理器与编辑器切换：VS Code 怎样做到不卡

> 证据状态：VS Code 部分按固定 SHA `a5b500951314efd502d07465bd138dfbd714a960`（1.133.0）源码核实，标 **已验证**；没有运行 VS Code 实测耗时。NeuroBook 映射使用 **已验证当前实现**、**已批准但未实施的目标合同**、**研究建议**、**未验证/候选**。本章服务于 w00017 t42，研究建议不能替代 Spec。

## 结论先行

VS Code 的流畅不靠某一个优化，而是五条规则叠加：

1. **资源管理器从不读文件内容。** 名字、图标、排序只来自目录项本身；展开一个目录只做一次 `readdir`，不对子项逐个 `stat`（按修改时间排序时例外）。
2. **只解析看得见的部分。** 目录第一次展开时才列出，之后缓存；外部变化只在影响到已展开、可见的部分时才刷新，并且合并 500 ms 再处理。
3. **只渲染看得见的行。** 树被展平成一个列表，列表只为视口内的行建 DOM，行模板按类型复用。
4. **切换编辑器时，标签与清空同步完成，内容异步到达。** 编辑器控件按类型缓存复用，只换模型；已有模型立即显示，后台再按 etag 核对磁盘；进度条 800 ms 后才出现，新的打开会取消上一次。
5. **文件监视在独立进程里递归监视工作区根，事件先合并再节流。** 外部改名表现为删除加新建，只有经文件服务的移动才带新旧地址。

这五条与[项目文件底座设计稿](../../proposals/project-file-foundation.md)的方案第 5、6 节方向一致。主要差异是：VS Code 的资源管理器没有任何“读一个清单得到展示名”的步骤，我们的内容文件夹与活页夹每次展开要多读一份清单。进度提示的延迟原先也不同（我们的 Spec 定为 100 ms），2026-10-03 开发者已改为与 VS Code 相同的 800 ms。见[对 NeuroBook 的研究映射](#对-neurobook-的研究映射)。

## 1. 提供者的能力声明与 `FileService` 的分派

**已验证。**

- 提供者按方案注册，同一方案重复注册直接抛错（[`fileService.ts#L52`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L52)）。注册时转发提供者的 `onDidChangeFile`：带关联标识的事件只进入内部事件，不带的才进入全局 `onDidFilesChange`。
- 提供者可以晚到：`activateProvider` 先发 `onWillActivateFileSystemProvider`，让扩展在事件里 `join` 自己的注册承诺，方案还不存在时等这些承诺结算（[`#L94`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L94)）。每次操作都先经 `withProvider`：校验绝对路径、激活、找不到提供者时报 `ENOPRO`（[`#L137`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L137)）。
- 能力是位标志（[`files.ts#L598`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/files.ts#L598)）：读写方式（整读整写、打开/读/写/关闭、流式读）、复制、路径大小写敏感、只读、回收站、原子读写删、克隆、真实路径、追加。能力可以变化（`onDidChangeCapabilities`）。
- 读取按能力选路（[`#L586`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L586)）：调用方不需要流时优先整读，否则优先流式，最后退到分块读。**读内容与取元数据并行**：只有调用方带了 etag 才先等元数据（可能直接得到“未修改”），否则二者同时进行，以缩短首次打开时间。
- `resolve` 默认只读一层（[`#L209`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L209)）：对目录调用一次 `readdir`，得到 `[名字, 类型]`；只有要求元数据时才对每个子项 `stat`（[`#L271`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L271)）。`resolveTo` 可以一次展开到某个深层路径（用于定位当前文件），`resolveSingleChildDescendants` 自动展开只有一个子项的目录。
- 提供者接口（[`files.ts#L678`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/files.ts#L678)）只有 `stat`、`readdir`、读写、`mkdir`、`delete`、`rename`、`copy`、`watch` 等，**没有 glob 与 grep**；搜索是另一套服务（本次未读搜索服务源码）。

## 2. 资源管理器：按需解析与刷新

**已验证。**

- 数据源 `ExplorerDataSource.getChildren` 调 `ExplorerItem.fetchChildren`（[`explorerViewer.ts#L120`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L120)、[`explorerModel.ts#L312`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/common/explorerModel.ts#L312)）。目录未解析时调 `fileService.resolve(目录, {resolveSingleChildDescendants: true, resolveMetadata})`，其中 `resolveMetadata` 只在按修改时间排序时为真；解析结果与本地模型合并（保留已展开子树），之后标记为已解析，不再重复列出。
- 树组件对同一节点的并发取子项去重（[`asyncDataTree.ts#L1184`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1184)）；取子项超过 800 ms 才把节点标为“慢”并显示加载状态（[`#L1140`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1140)）。资源管理器整体的进度条同样延迟 800 ms，启动恢复期间延迟 1500 ms（[`explorerViewer.ts#L163`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L163)）。
- 行标签只用资源地址与名字，图标由文件类型与图标主题决定（[`explorerViewer.ts#L1013`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L1013)）。资源管理器不读文件内容。
- 展开状态随视图状态保存，下次 `setInput(input, viewState)` 时只重新列出原来展开的目录（[`explorerView.ts#L763`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerView.ts#L763)）。
- 刷新分两条路（[`explorerService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts)）：
  - **自己的操作**（新建、复制、移动、删除）走 `onDidRunOperation`（[`#L363`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L363)），直接在模型上增删改对应节点，只刷新受影响的父节点。
  - **外部变化**走 `onDidFilesChange`：事件攒进队列，500 ms 后统一处理（[`#L37`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L37)、[`#L69`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L69)）。删除（按修改时间排序时还有修改）只看可见且已解析的节点（[`doesFileEventAffect`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L524)）；新增只在父目录已解析且模型里没有这个名字时才算。只有命中时才刷新。用户正在改名时暂停处理外部事件。
  - 窗口重新获得焦点时刷新一次，弥补漏掉的事件（[`#L137`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L137)）。

## 3. 长列表虚拟化

**已验证。**

- 树不是嵌套 DOM：树模型把“当前可见的节点”展平成序列，展开与折叠表现为对列表的 `splice`（[`abstractTree.ts#L3239`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/tree/abstractTree.ts#L3239)）。
- 列表 `ListView` 只为视口范围内的行建 DOM（[`listView.ts#L913`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/list/listView.ts#L913)）：滚动时算出新旧可见范围的差集，只插入新进入的行、移除离开的行；行容器用 `translate3d` 与 `contain: strict` 隔离布局（[`#L413`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/list/listView.ts#L413)）。
- 移除的行进入 `RowCache`，下次按模板类型取回复用，不重建 DOM（[`rowCache.ts#L31`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/list/rowCache.ts#L31)）。
- 结果：展开一个有几千个子项的目录，代价是一次 `readdir`、一次模型 `splice` 和视口内几十行的渲染，与子项总数基本无关。

## 4. 文件监视

**已验证。**

- 工作区监视对每个工作区根发起一次递归监视，排除项来自 `files.watcherExclude`（[`workspaceWatcher.ts#L177`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/workspaceWatcher.ts#L177)）；默认排除 `.git/objects` 等大目录（[`files.contribution.ts#L294`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/files.contribution.ts#L294)）。
- 递归监视用 `@parcel/watcher`，运行在单独的监视进程里（[`watcherClient.ts#L30`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/node/watcher/watcherClient.ts#L30)），不占渲染进程与主服务的事件循环。非递归监视用 Node 的 `fs.watch`。
- 事件处理（[`parcelWatcher.ts#L177`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/node/watcher/parcel/parcelWatcher.ts#L177)）：
  - 先攒 75 ms；
  - 再合并（[`watcher.ts#L342`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/watcher.ts#L342)）：同一路径先建后删则抵消，先删后建合并为修改，已删除目录下的删除事件被丢弃；
  - 最后节流：每批最多 500 条，批间歇 200 ms，内存中最多缓存 30000 条。
- 监视事件只有新增、修改、删除三种。外部改名就是删除加新建；带新旧地址的移动只出现在文件服务自己的操作事件里。

## 5. 编辑器打开与切换路径上的延迟处理

**已验证。**

- **标签先变，内容后到。** `EditorGroupView.doShowEditor` 先启动编辑区的异步打开，紧接着同步更新标签栏（[`editorGroupView.ts#L1288`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1288)、[`#L1326`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1326)）。
- **编辑器控件按类型复用。** `EditorPanes` 为每种编辑器类型只实例化一次，当前控件能处理新输入就直接复用，不销毁也不重建（[`editorPanes.ts#L323`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L323)、[`#L394`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L394)）。
- **先清空，不显示旧内容；新的打开取消旧的。** `doSetInput` 开始一次长操作：上一次操作被取消，进度条 800 ms 后才出现（启动恢复时 3200 ms）（[`#L452`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L452)、[`progress.ts#L184`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/progress/common/progress.ts#L184)）。随后先 `clearInput()` 再 `setInput()`，慢的输入加载期间不会留着上一个文件（[`#L461`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L461)）。
- **只换模型。** 文本编辑器的 `setInput` 解析模型后调用 `control.setModel()`，再恢复该文件的视图状态（光标、滚动）（[`textFileEditor.ts#L102`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/editors/textFileEditor.ts#L102)）。视图状态按编辑器类型保存，最多保留 100 条（[`editorWithViewState.ts#L46`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorWithViewState.ts#L46)）。前后各打一个性能标记（`code/willSetInputToTextFileEditor`、`code/didSetInputToTextFileEditor`），产品代码常驻。
- **已有模型立即显示，后台再核对。** 打开文件时以 `reload: {async: true}` 解析（[`fileEditorInput.ts#L364`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts#L364)）：模型已存在时立即返回，后台触发重新加载（[`textFileEditorModelManager.ts#L382`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L382)）。重新加载带上次的 etag，磁盘没变时只取元数据，不读内容（[`textFileEditorModel.ts#L433`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L433)）。
- **模型的生命周期跟随打开的编辑器。** 编辑器输入持有模型引用，直到该编辑器输入被释放（[`fileEditorInput.ts#L469`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts#L469)）。所以在已打开的标签之间切换不需要任何读盘。

## 对 NeuroBook 的研究映射

| VS Code 做法 | NeuroBook 现状或目标 | 标签 |
|---|---|---|
| 资源管理器不读文件内容，展开只 `readdir` 一层 | 现状：打开项目时预读全部文件并解析 frontmatter，建好索引后才进入（设计稿“当前行为与证据”）。目标：普通文件夹只列目录，内容文件夹与活页夹展开时多读一份清单（[`workspace.folder-kinds`](../../../../../docs/specs/workspace/folder-kinds.md)） | 已验证当前实现 / 已批准但未实施的目标合同 |
| 展开状态持久化，重开只列原来展开的目录 | 目标：再次打开约 300 ms（[`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md#打开与切换)）。要达到，需要保存展开状态并只重新列出这些目录 | 研究建议 |
| 自己的操作就地改模型；外部事件合并 500 ms，只处理可见且已解析的部分 | 目标：按监视事件增量刷新。建议采用同样的两路区分：经文件服务的操作带来源，直接更新；监视事件合并后只处理已展开的目录 | 研究建议 |
| 树展平为列表，只渲染视口行并复用行 DOM | 目标：虚拟化列表。现有 `WorkspaceFileTree.vue` 是否按视口渲染，留给第 3 片核对 | 未验证/候选 |
| 递归监视在独立进程，75 ms 合并、500 条一批节流 | 现状：项目文件索引在服务进程内用 chokidar 递归监视项目根，激活要等 chokidar 报告就绪（`server/workspace-files/project-file-index.ts` 的 `openProductionWatcher`）。就绪前 chokidar 要遍历整棵目录，这段时间算在打开项目里，占比待 t42 测量 | 已验证当前实现 / 未验证/候选 |
| 外部改名 = 删除 + 新建；带新旧地址的移动只来自自己的操作 | [`workspace.resources`](../../../../../docs/specs/workspace/resources.md) 已写同样规则 | 已批准但未实施的目标合同 |
| 提供者接口没有 glob/grep，搜索是独立服务 | `workspace.resources` 把 glob、grep 列为提供者能力。两种做法都可行；把搜索放进提供者，虚拟方案（如将来的 `plot://`）就要自己实现 grep，或声明不支持 | 研究建议 |
| 读文件时元数据与内容并行 | 现状：切换文件时，文件树里找不到节点就先 `stat` 再 `read`，两次请求串行（`app/stores/novel-ide.ts` 的 `activateWorkspaceFile`）。建议一次请求同时返回内容与元数据 | 已验证当前实现 / 研究建议 |
| 标签同步切换、先清空、新打开取消旧打开、进度 800 ms 后出现 | 目标：一帧内切换标签与选中，编辑区保持空白，进度条 800 ms 后出现。现状已有按组的激活序号（`acceptsActivation`），旧请求的结果被丢弃，但请求本身不取消 | 已批准但未实施的目标合同 / 已验证当前实现 |
| 编辑器控件复用，只换模型；已有模型立即显示，后台按 etag 核对 | 现状：已打开文件的缓冲直接复用，不发请求，也不在后台核对磁盘（磁盘变化靠事件推送）。[t24](../../../../../.agents/works/w00017-application-runtime-architecture/tasks/t24-files-switch-performance/README.md) 在开发构建、两份 8 KiB 文件上实测：已打开标签之间热切换 p50 33–47 ms，期间无文件请求，控件不逐次创建。首次从文件树打开一个文件只有 [t16](../../../../../.agents/works/w00017-application-runtime-architecture/tasks/t16-files-baseline/README.md) 的两次观测（401.5 ms、269.4 ms），与开发者感到的约 0.3 秒吻合，构成待 t42 拆分 | 已验证当前实现 / 未验证/候选 |

### 进度提示延迟的取舍

VS Code 把编辑区与资源管理器的进度提示都推迟到 800 ms，原因是绝大多数打开都在这之前完成，提前显示只会闪一下。我们的 Spec 原先要求未打开过的文件在 200 ms 内显示正文，同时要求 100 ms 后出现进度条，正常情况下进度条会在 100–200 ms 之间闪现一次。2026-10-03 开发者决定改为 800 ms：800 ms 内编辑区保持空白、不显示任何加载提示，之后才显示进度条（已写入 [`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md#打开与切换)）。

## 源码锚点与检查边界

已读：`platform/files/common/{files,fileService,watcher}.ts`、`platform/files/node/watcher/{watcherClient,parcel/parcelWatcher}.ts`、`workbench/contrib/files/{common/explorerModel,browser/explorerService,browser/workspaceWatcher,browser/files.contribution,browser/views/explorerViewer,browser/views/explorerView,browser/editors/textFileEditor,browser/editors/fileEditorInput}.ts`、`base/browser/ui/list/{listView,rowCache}.ts`、`base/browser/ui/tree/{abstractTree,asyncDataTree}.ts`、`workbench/browser/parts/editor/{editorGroupView,editorPanes,editorWithViewState}.ts`、`workbench/services/textfile/common/{textFileEditorModelManager,textFileEditorModel}.ts`、`platform/progress/common/progress.ts` 中与上文相关的函数。

未读或未运行：搜索服务与 ripgrep 集成；`DiskFileSystemProvider` 的具体读写实现；`@parcel/watcher` 原生部分；Monaco `TextModel` 的创建成本；文件嵌套（`explorer.fileNesting`）的完整规则。本章没有在 VS Code 上实测耗时，不把上述机制写成具体的性能数字。
