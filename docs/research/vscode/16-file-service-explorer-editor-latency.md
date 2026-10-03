# 16 文件服务、资源管理器与编辑器切换的机制

> 日期：2026-10-03。问题：VS Code 在打开工作区、展开目录、切换文件这三条路径上做了哪些事、推迟了哪些事；NeuroBook 当前在同样路径上做了什么。来源：VS Code `1.133.0` 固定 SHA `a5b500951314efd502d07465bd138dfbd714a960` 源码；NeuroBook 当前 worktree 源码；w00017 t16、t24 的实测记录。
> 证据等级逐节标注：**源码**（直接读到的代码）、**实测**（已有运行记录）。没有运行 VS Code 测耗时；下文不含 VS Code 的性能数字。本章服务于 w00017 t42，只记事实与对照，取舍写在 t42 结论与相关 Spec。

## 要点

1. **资源管理器不读文件内容。** 行标签只用资源地址与名字；展开一个目录调用一次 `readdir`，只有按修改时间排序时才对子项逐个 `stat`。
2. **目录在首次展开时才列出，结果缓存。** 外部变化先攒 500 ms，只有涉及可见且已解析的节点时才刷新。
3. **列表只为视口内的行建 DOM。** 树被展平成列表，离开视口的行按模板类型回收复用。
4. **切换编辑器时，标签更新与清空编辑区同步发生，内容异步到达。** 编辑器控件按类型复用，只换模型；已有模型立即返回，后台按 etag 重新核对磁盘；进度提示 800 ms 后出现；新的打开取消上一次。
5. **递归文件监视运行在独立进程。** 事件先攒 75 ms 合并，再分批节流。外部改名表现为删除加新建，带新旧地址的移动只出现在文件服务自己的操作事件里。

与[项目文件底座设计稿](../../proposals/project-file-foundation.md)方案第 5、6 节的对照见[与 NeuroBook 的对照](#与-neurobook-的对照)。

## 1. 提供者的能力声明与 `FileService` 的分派

证据等级：源码。

- 提供者按方案注册，同一方案重复注册直接抛错（[`fileService.ts#L52`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L52)）。注册时转发提供者的 `onDidChangeFile`：带关联标识的事件只进入内部事件，不带的才进入全局 `onDidFilesChange`。
- 提供者可以晚到：`activateProvider` 先发 `onWillActivateFileSystemProvider`，让扩展在事件里 `join` 自己的注册承诺，方案还不存在时等这些承诺结算（[`#L94`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L94)）。每次操作都先经 `withProvider`：校验绝对路径、激活、找不到提供者时报 `ENOPRO`（[`#L137`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L137)）。
- 能力是位标志（[`files.ts#L598`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/files.ts#L598)）：读写方式（整读整写、打开/读/写/关闭、流式读）、复制、路径大小写敏感、只读、回收站、原子读写删、克隆、真实路径、追加。能力可以变化（`onDidChangeCapabilities`）。
- 读取按能力选路（[`#L586`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L586)）：调用方不需要流时优先整读，否则优先流式，最后退到分块读。**读内容与取元数据并行**：只有调用方带了 etag 才先等元数据（可能直接得到“未修改”），否则二者同时进行（源码注释写明目的是优化启动性能）。
- `resolve` 默认只读一层（[`#L209`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L209)）：对目录调用一次 `readdir`，得到 `[名字, 类型]`；只有要求元数据时才对每个子项 `stat`（[`#L271`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/fileService.ts#L271)）。`resolveTo` 可以一次展开到某个深层路径（用于定位当前文件），`resolveSingleChildDescendants` 自动展开只有一个子项的目录。
- 提供者接口（[`files.ts#L678`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/files.ts#L678)）只有 `stat`、`readdir`、读写、`mkdir`、`delete`、`rename`、`copy`、`watch` 等，**没有 glob 与 grep**；搜索是另一套服务（本次未读搜索服务源码）。

## 2. 资源管理器：按需解析与刷新

证据等级：源码。

- 数据源 `ExplorerDataSource.getChildren` 调 `ExplorerItem.fetchChildren`（[`explorerViewer.ts#L120`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L120)、[`explorerModel.ts#L312`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/common/explorerModel.ts#L312)）。目录未解析时调 `fileService.resolve(目录, {resolveSingleChildDescendants: true, resolveMetadata})`，其中 `resolveMetadata` 只在按修改时间排序时为真；解析结果与本地模型合并（保留已展开子树），之后标记为已解析，不再重复列出。
- 树组件对同一节点的并发取子项去重（[`asyncDataTree.ts#L1184`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1184)）；取子项超过 800 ms 才把节点标为“慢”并显示加载状态（[`#L1140`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1140)）。资源管理器整体的进度条同样延迟 800 ms，启动恢复期间延迟 1500 ms（[`explorerViewer.ts#L163`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L163)）。
- 行标签只用资源地址与名字，图标由文件类型与图标主题决定（[`explorerViewer.ts#L1013`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L1013)）。资源管理器不读文件内容。
- 展开状态随视图状态保存，下次 `setInput(input, viewState)` 时只重新列出原来展开的目录（[`explorerView.ts#L763`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/views/explorerView.ts#L763)）。
- 刷新分两条路（[`explorerService.ts`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts)）：
  - **自己的操作**（新建、复制、移动、删除）走 `onDidRunOperation`（[`#L363`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L363)），直接在模型上增删改对应节点，只刷新受影响的父节点。
  - **外部变化**走 `onDidFilesChange`：事件攒进队列，500 ms 后统一处理（[`#L37`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L37)、[`#L69`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L69)）。删除（按修改时间排序时还有修改）只看可见且已解析的节点（[`doesFileEventAffect`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L524)）；新增只在父目录已解析且模型里没有这个名字时才算。只有命中时才刷新。用户正在改名时暂停处理外部事件。
  - 窗口重新获得焦点时刷新一次，弥补漏掉的事件（[`#L137`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/explorerService.ts#L137)）。

## 3. 长列表虚拟化

证据等级：源码。

- 树不是嵌套 DOM：树模型把“当前可见的节点”展平成序列，展开与折叠表现为对列表的 `splice`（[`abstractTree.ts#L3239`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/tree/abstractTree.ts#L3239)）。
- 列表 `ListView` 只为视口范围内的行建 DOM（[`listView.ts#L913`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/list/listView.ts#L913)）：滚动时算出新旧可见范围的差集，只插入新进入的行、移除离开的行；行容器用 `translate3d` 与 `contain: strict` 隔离布局（[`#L413`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/list/listView.ts#L413)）。
- 移除的行进入 `RowCache`，下次按模板类型取回复用，不重建 DOM（[`rowCache.ts#L31`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/base/browser/ui/list/rowCache.ts#L31)）。
- 由上面三点，展开目录时建立的 DOM 行数由视口高度决定，不随子项总数增加；子项总数影响的是一次 `readdir` 与一次模型 `splice`。

## 4. 文件监视

证据等级：源码。

- 工作区监视对每个工作区根发起一次递归监视，排除项来自 `files.watcherExclude`（[`workspaceWatcher.ts#L177`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/workspaceWatcher.ts#L177)）；默认排除 `.git/objects` 等大目录（[`files.contribution.ts#L294`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/files.contribution.ts#L294)）。
- 递归监视用 `@parcel/watcher`，运行在单独的监视进程里（[`watcherClient.ts#L30`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/node/watcher/watcherClient.ts#L30)），与渲染进程分开。非递归监视用 Node 的 `fs.watch`。
- 事件处理（[`parcelWatcher.ts#L177`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/node/watcher/parcel/parcelWatcher.ts#L177)）：
  - 先攒 75 ms；
  - 再合并（[`watcher.ts#L342`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/files/common/watcher.ts#L342)）：同一路径先建后删则抵消，先删后建合并为修改，已删除目录下的删除事件被丢弃；
  - 最后节流：每批最多 500 条，批间歇 200 ms，内存中最多缓存 30000 条。
- 监视事件只有新增、修改、删除三种。外部改名就是删除加新建；带新旧地址的移动只出现在文件服务自己的操作事件里。

## 5. 编辑器打开与切换路径上的延迟处理

证据等级：源码。

- **标签先变，内容后到。** `EditorGroupView.doShowEditor` 先启动编辑区的异步打开，紧接着同步更新标签栏（[`editorGroupView.ts#L1288`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1288)、[`#L1326`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1326)）。
- **编辑器控件按类型复用。** `EditorPanes` 为每种编辑器类型只实例化一次，当前控件能处理新输入就直接复用，不销毁也不重建（[`editorPanes.ts#L323`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L323)、[`#L394`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L394)）。
- **先清空，不显示旧内容；新的打开取消旧的。** `doSetInput` 开始一次长操作：上一次操作被取消，进度条 800 ms 后才出现（启动恢复时 3200 ms）（[`#L452`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L452)、[`progress.ts#L184`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/progress/common/progress.ts#L184)）。随后先 `clearInput()` 再 `setInput()`，慢的输入加载期间不会留着上一个文件（[`#L461`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorPanes.ts#L461)）。
- **只换模型。** 文本编辑器的 `setInput` 解析模型后调用 `control.setModel()`，再恢复该文件的视图状态（光标、滚动）（[`textFileEditor.ts#L102`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/editors/textFileEditor.ts#L102)）。视图状态按编辑器类型保存，最多保留 100 条（[`editorWithViewState.ts#L46`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/browser/parts/editor/editorWithViewState.ts#L46)）。前后各打一个性能标记（`code/willSetInputToTextFileEditor`、`code/didSetInputToTextFileEditor`），产品代码常驻。
- **单击立即以预览打开，双击固定。** 列表的打开控制器在单击时立即以预览方式打开（`pinned` 为假），同一次双击中 `detail === 2` 的第二次单击不再处理；双击事件再以 `pinned: true` 打开同一项（[`listService.ts#L718`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/list/browser/listService.ts#L718)、[`#L737`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/platform/list/browser/listService.ts#L737)）。单击与双击之间没有等待。
- **已有模型立即显示，后台再核对。** 打开文件时以 `reload: {async: true}` 解析（[`fileEditorInput.ts#L364`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts#L364)）：模型已存在时立即返回，后台触发重新加载（[`textFileEditorModelManager.ts#L382`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L382)）。重新加载带上次的 etag，磁盘没变时只取元数据，不读内容（[`textFileEditorModel.ts#L433`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L433)）。
- **模型的生命周期跟随打开的编辑器。** 编辑器输入持有模型引用，直到该编辑器输入被释放（[`fileEditorInput.ts#L469`](https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts#L469)）。在已打开的标签之间切换时模型仍在，按上一条立即返回。

## 与 NeuroBook 的对照

“NeuroBook 当前实现”一列的证据等级为源码（当前 worktree）或实测（注明出处）；“已批准目标”一列摘自 Spec 原文，尚未实施。

| 对照项 | VS Code（源码） | NeuroBook 当前实现 | NeuroBook 已批准目标 |
|---|---|---|---|
| 资源管理器读取的内容 | 只用目录项名字与类型；展开一层调用一次 `readdir` | 打开项目时读取全部文件并解析 frontmatter，索引建好后才进入（源码，见设计稿[当前行为与证据](../../proposals/project-file-foundation.md#当前行为与证据)） | 普通文件夹只列目录；内容文件夹与活页夹展开时读一次清单（[`workspace.folder-kinds`](../../../../../docs/specs/workspace/folder-kinds.md)） |
| 重新打开时的工作量 | 展开状态随视图状态保存，`setInput(input, viewState)` 只重新列出原先展开的目录 | 同首次打开（源码） | 再次打开约 300 ms（[`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md#打开与切换)） |
| 树的刷新来源 | 自己的操作就地改模型；外部事件攒 500 ms，只在涉及可见且已解析的节点时刷新 | 文件索引按监视事件重建（源码，`server/workspace-files/project-file-index.ts`） | 按监视事件增量刷新 |
| 长列表 | 树展平为列表，只为视口内的行建 DOM，行按模板复用 | `WorkspaceFileTree.vue` 的渲染方式本章未核对 | 虚拟化列表 |
| 文件监视 | `@parcel/watcher` 递归监视，独立进程；75 ms 合并，500 条一批节流 | 服务进程内用 chokidar 递归监视项目根，索引激活等 chokidar 报告就绪（源码，`project-file-index.ts` 的 `openProductionWatcher`） | Spec 未规定实现方式 |
| 改名事件 | 监视事件无改名；带新旧地址的移动只来自文件服务自己的操作 | — | 同左（[`workspace.resources`](../../../../../docs/specs/workspace/resources.md)） |
| glob 与 grep 的位置 | 提供者接口没有 glob、grep；搜索是独立服务（搜索服务本章未读） | — | 列为提供者能力，未声明时返回“能力不支持”（`workspace.resources`） |
| 打开文件时的请求 | 读内容与取元数据并行 | 文件树里找不到节点时先 `stat` 再 `read`，两次请求串行（源码，`app/stores/novel-ide.ts` 的 `activateWorkspaceFile`） | Spec 未规定请求形态 |
| 切换时的编辑区 | 标签同步更新；先 `clearInput()`；新的打开取消上一次；进度提示 800 ms 后出现 | 按组的激活序号丢弃过期结果，读请求本身不取消（源码，`acceptsActivation`） | 一帧内切换标签与选中；编辑区保持空白，800 ms 后才显示进度条；不保留旧正文 |
| 单击与双击 | 单击立即以预览打开，双击固定为常驻，无等待 | 单击后等 180 ms 才以预览打开，期间的双击取消预览、改为常驻（源码，`app/components/novel-ide/workspace/WorkspaceFileNode.vue` 的 `scheduleSelectNode`）。t42 实测从文件树点击到激活 p50 180 ms | 单击预览、双击常驻；未规定延迟 |
| 已打开文件再次切换 | 控件复用，只换模型；已有模型立即返回，后台按 etag 核对 | 缓冲直接复用，不发请求，不在后台核对磁盘（源码）。[t24](../../../../../.agents/works/w00017-application-runtime-architecture/tasks/t24-files-switch-performance/README.md) 实测（开发构建、两份 8 KiB 文件）：点击标签切换 p50 33–47 ms。[t42](../../../../../.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/README.md) 实测（生产构建、Linux 无头 Chrome）：点击标签切换 p50 在 300 个文件时 146 ms，3000 个文件时 867–942 ms，切换期间无文件请求 | 已打开过的文件 100 ms 内显示正文 |
| 首次打开一个文件 | 见上两行 | [t16](../../../../../.agents/works/w00017-application-runtime-architecture/tasks/t16-files-baseline/README.md) 实测（开发构建）两次观测：401.5 ms、269.4 ms。t42 实测（生产构建）从文件树点击到正文可编辑 p50：40 个文件的小样本试跑约 300–400 ms，300 个文件 414 ms，3000 个文件 1531–1643 ms | 未打开过的普通章节 200 ms 内显示正文 |

## 源码锚点与检查边界

已读：`platform/files/common/{files,fileService,watcher}.ts`、`platform/files/node/watcher/{watcherClient,parcel/parcelWatcher}.ts`、`workbench/contrib/files/{common/explorerModel,browser/explorerService,browser/workspaceWatcher,browser/files.contribution,browser/views/explorerViewer,browser/views/explorerView,browser/editors/textFileEditor,browser/editors/fileEditorInput}.ts`、`base/browser/ui/list/{listView,rowCache}.ts`、`base/browser/ui/tree/{abstractTree,asyncDataTree}.ts`、`workbench/browser/parts/editor/{editorGroupView,editorPanes,editorWithViewState}.ts`、`workbench/services/textfile/common/{textFileEditorModelManager,textFileEditorModel}.ts`、`platform/progress/common/progress.ts`、`platform/list/browser/listService.ts` 中与上文相关的函数。

未读或未运行：搜索服务与 ripgrep 集成；`DiskFileSystemProvider` 的具体读写实现；`@parcel/watcher` 原生部分；Monaco `TextModel` 的创建成本；文件嵌套（`explorer.fileNesting`）的完整规则。本章没有在 VS Code 上实测耗时，不把上述机制写成具体的性能数字。
