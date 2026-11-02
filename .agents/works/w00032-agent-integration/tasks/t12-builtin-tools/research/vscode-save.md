# VS Code 保存文件时怎样写盘（调研报告）

调研日期 2026-11-02。代码快照：`microsoft/vscode` master，提交 `58a595f76bdc150460d7e0d279d26cc6fc577b0a`（提交时间 2026-11-02，`package.json` 版本 1.146.0）。
下文 `[F]` 指该提交下的文件，链接均为固定到此提交的永久链接，行号以该提交为准。
标注“推断”的是从代码或 POSIX 语义推出来、没有官方原话的结论；“未查到”表示一手来源里没找到。

基址：`https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/`

## 结论速览

1. 编辑器保存文本文件是整份写回：把整个文档编码成字节后写入，没有“只写改动”的路径。
2. 缺省是就地写：以 `'w'`（截断）打开目标文件再写入，不写临时文件、不改名。没有 `files.saveAtomic` 这类设置项，源码里 `files.*` 配置里也没有任何 atomic 相关项。
3. 原子写（临时文件加改名）在代码里存在，但编辑器保存不会请求它。唯一在产品里被“强制”走原子写的是用户数据文件（settings.json、keybindings.json、tasks.json、extensions.json，按当前 Profile），后缀 `.vsctmp`。
4. “保存时加原子写”是开发者自己登记的未实现功能请求（issue 98063，标签 feature-request、keep，仍开着，最后一条评论 2024-05-03）。
5. 保存时 VS Code 不是按“事件来源”屏蔽自己的文件事件，而是靠 etag（mtime 加 size）比对：保存成功后把新 stat 记为“最后已解析状态”，随后收到的自己的变更事件触发的重新解析会因 etag 相同被判“未修改”而放弃。

## 1. 整份写回还是只写改动；就地还是原子；缺省与开关

### 1.1 整份写回

- 保存入口 `TextFileEditorModel.doSave` 调 `textFileService.write(resource, model.createSnapshot(), {mtime, encoding, etag, unlock, writeElevated})`，传的是整个模型的快照（没有 diff）。
  来源：[F] `src/vs/workbench/services/textfile/common/textFileEditorModel.ts` [L1033](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L1033)。
- `TextFileService.write` 先把快照按文件编码编成可读流（`getEncodedReadable`），再交 `fileService.writeFile`，选项里没有 `atomic`、没有 `append`；如果选了“以管理员身份保存”则走 `writeFileElevated`。
  来源：[F] `src/vs/workbench/services/textfile/browser/textFileService.ts` [L266-L273](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/textfile/browser/textFileService.ts#L266-L273)。
- 开发者在 issue 98063 里的原话：“All our writes in VSCode today operate on the target file: truncate the file to 0 bytes; write the contents into the file”（2020-05-18 创建，作者为维护者 bpasero 的口径，该 issue 的 prior art 指向 #56361）。
  来源：https://github.com/microsoft/vscode/issues/98063

### 1.2 就地写（缺省）

- `FileService.writeFile`（common 层）：先 `validateWriteFile`（含脏写检测，见第 4 节），再按数据形态选“非缓冲写”或“缓冲写”：
  - 数据已是完整 buffer，或快照在最多 3 块内读完（`peekBufferForWriting` 先预读 3 块）时走 `doWriteUnbuffered`，最终调 `provider.writeFile`（整份一次写）。
  - 数据更大、3 块读不完时走 `doWriteBuffered`：`provider.open` 拿句柄后按块写入，最后关闭。
  来源：[F] `src/vs/platform/files/common/fileService.ts` [L383-L430](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L383-L430)、[L1270](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L1270)、[L1388-L1401](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L1388-L1401)。
  bpasero 2022-02-24 在 issue 98063 里说“files up to the size of ~300kb get written to in one go via `provider.writeFile` and not via writes in chunks”（与上面“预读 3 块”一致，每块大小我没在源码里核实）。
- `DiskFileSystemProvider.writeFile`：只有当 `opts.atomic` 带了 `postfix` 且目标不是符号链接时才走原子写，否则走 `doWriteFile`。
  来源：[F] `src/vs/platform/files/node/diskFileSystemProvider.ts` [L264-L270](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L264-L270)。
- `doWriteFile`：`open(...)` 后 `write(handle, 0, content, 0, length)` 一次写入整份内容，最后 `close`。
  来源：同文件 [L327-L360](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L327-L360)。
- `open` 的写分支：`fs.open(path, 'w')`（追加时 `'a'`）。代码注释：“use 'w' to truncate an existing or create the file otherwise”。`'w'` 即 `O_WRONLY|O_CREAT|O_TRUNC`。
  来源：同文件 [L458-L462](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L458-L462)。
- 推断：因为是对已有文件 open 加截断，不新建 inode，所以 inode、硬链接、属主、权限位都保留；目标是符号链接时 open 会跟随链接，写到链接指向的文件。这是 POSIX 对 `O_TRUNC` 的标准语义，VS Code 代码里没有额外处理。
- Windows 特例：非追加写先试 `'r+'` 打开再 `ftruncate(fd, 0)`，目的是避免保存隐藏文件时丢属性、保留备用数据流（NTFS ADS）；失败再退回 `'w'`。代码注释链接 issue #931 与 #6363。
  来源：同文件 [L423-L455](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L423-L455)。
- 写失败重试：`write` 对单次写重试最多 3 次、间隔 100 ms，注释写明“the file to write to is truncated and thus empty; if the write now fails, the file remains empty”。
  来源：同文件 [L633-L638](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L633-L638)。
- 关闭句柄时对写过的句柄 `fdatasync`（issue #9589 “Save: Flush to disk after writing to file”）；同步失败会全局关闭刷盘并记日志。
  来源：同文件 [L531-L545](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L531-L545)（`fdatasync` 在 L535）；issue：https://github.com/microsoft/vscode/issues/9589

### 1.3 原子写在代码里是什么样、什么时候走

- 选项定义：`IFileAtomicOptions { postfix }`，说明为“在同目录下建临时文件，名字是原名加 `postfix`”，`IWriteFileOptions.atomic?: IFileAtomicOptions | false`，文档注释：“updates the target file atomically by first writing to a temporary file in the same folder and then renaming it over the target”。
  来源：[F] `src/vs/platform/files/common/files.ts` [L311-L323](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/files.ts#L311-L323)、[L1388-L1418](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/files.ts#L1388-L1418)。
- 实现 `doWriteFileAtomic`：给目标与临时文件都加资源锁，先 `doWriteFile` 写临时文件，再 `rename(temp, target, {overwrite:true})`；改名失败则尽力删除临时文件并抛原错误。
  来源：[F] `src/vs/platform/files/node/diskFileSystemProvider.ts` [L291-L325](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L291-L325)。
- 不走原子写的情形：
  - 目标是符号链接：`canWriteFileAtomic` 直接返回 false，注释“we need to ensure that the `rename` operation is atomic and that only works if the link is on the same disk. Since we do not know where the symbolic link points to we refuse to write atomically”（[L272-L289](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L272-L289)）。
  - 与 `unlock` 互斥：`validateWriteFile` 里 atomic 加 unlock 直接抛错；原子写还要求提供方支持“非缓冲写”（[F] `fileService.ts` [L470-L484](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L470-L484)）。
  - 原子写强制整份写入内存后一次写（“atomic write forces unbuffered write”，[L417](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L417)）。
- 谁会请求原子写（本快照里搜 `atomic` 的非测试调用）：
  - 用户数据提供方 `FileUserDataProvider.enforceAtomicWriteFile`：对当前 Profile 的 settings、keybindings、tasks、extensions 资源返回 `{ postfix: '.vsctmp' }`，`FileService.writeFile` 发现调用方没传 atomic 时调用它强制开启（[F] `src/vs/platform/userData/common/fileUserDataProvider.ts` [L61-L67](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/userData/common/fileUserDataProvider.ts#L61-L67)、[L128-L134](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/userData/common/fileUserDataProvider.ts#L128-L134)；[F] `fileService.ts` [L387-L392](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L387-L392)）。也就是说在编辑器里改并保存这几个用户数据文件走原子写（推断：它们以 `vscode-userdata` 方案打开，经此提供方写盘）。
  - 另有 agent host 的两处（`copilotAgentSession.ts`、`copilotGeneratedImages.ts`）在提供方有 `FileAtomicWrite` 能力时请求原子写，与用户编辑保存无关。
  - 编辑器保存路径（上文 1.1）不传 atomic，因此对普通工作区文件不走原子写。
- 能力位：`DiskFileSystemProvider` 声明了 `FileAtomicWrite`、`FileWriteUnlock`、`FileAppend` 等能力（[F] `diskFileSystemProvider.ts` [L60-L70](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L60-L70)；`FileAtomicWrite = 1 << 15` 见 [F] `files.ts` [L655](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/files.ts#L655)）。

### 1.4 设置项

- 本快照的 `files.*` 配置（[F] `src/vs/workbench/contrib/files/browser/files.contribution.ts`）和 `filesConfigurationService` 里没有任何 atomic 相关设置；没有 `files.saveAtomic`，也没有按平台、按文件系统区分的开关。（对这两个文件 grep `atomic`，零结果。）
- 与保存行为有关的设置只有：`files.saveConflictResolution`（`askUser` 缺省 / `overwriteFileOnDisk`，后者关闭脏写检测，见第 4 节）、`files.encoding`、`files.eol`、`files.insertFinalNewline`、`files.trimTrailingWhitespace`、`files.autoSave*`、`files.participants.timeout` 等，均不改变写盘方式。
- 官方在 2018-08 的 #56361 “Add a setting to save atomically”（用户参照 Sublime 的 `atomic_save` 提议）以“近期不处理”关闭；2020-05 维护者自己开 #98063 记录同一诉求，现状仍开着。
  来源：https://github.com/microsoft/vscode/issues/56361 、https://github.com/microsoft/vscode/issues/98063
- #98063 里维护者列出的权衡：好处是崩溃或磁盘满时不会留下被截断的空文件；代价是“some external file watchers might be confused about a file constantly being replaced and not just written to”。2022-02 的评论提出两个方向：只对大文件做条件原子写；或用 `pipe` 把临时文件内容写回目标以接近现状（该评论的作者 Luflosi 指出这样并不原子）。截至 2024-05-03 的最后一条评论，没有落地。issue 里有用户补充：就地写会让正在读脚本的进程看到新旧混合内容，而 vim 式原子保存换 inode 就没有这个问题。

### 1.5 管理员身份保存（补充）

保存遇到权限错误且支持时，可选“以管理员保存”：先把内容写到 `userDataPath/code-elevated*` 随机临时文件，再用 `@vscode/sudo-prompt` 调 CLI（`--file-write`，可带 `--file-chmod`）复制到目标。
来源：[F] `src/vs/workbench/services/files/electron-browser/elevatedFileService.ts` [L39-L60](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/files/electron-browser/elevatedFileService.ts#L39-L60)；[F] `src/vs/platform/native/electron-main/nativeHostMainService.ts` [L862-L890](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/native/electron-main/nativeHostMainService.ts#L862-L890)。具体复制方式（是否改名替换）我没往下读 CLI 实现，未查到。

### 1.6 `unlock`（只读文件）

`IFileWriteOptions.unlock`：开启时在 `open` 前若文件没有属主写位（`0o200`）就 `chmod(mode | 0o200)`；上层只在用户点“Overwrite”（`writeUnlock: true`）重试时才传。
来源：[F] `diskFileSystemProvider.ts` [L409-L421](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/diskFileSystemProvider.ts#L409-L421)；[F] `src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts` [L1161-L1185](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts#L1161-L1185)；选项文档 [F] `files.ts` [L280-L289](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/files.ts#L280-L289)。

## 2. 相关代码地图（均为上述固定提交）

| 作用 | 位置 |
|---|---|
| 保存流程（保存参与者、冲突/etag、写入、成功后更新 stat） | `src/vs/workbench/services/textfile/common/textFileEditorModel.ts`（`doSave` 在 L1033 附近调用 `write`；`handleSaveSuccess` L1049） |
| 文本写入与编码、管理员写 | `src/vs/workbench/services/textfile/browser/textFileService.ts` L266 |
| 通用保存（自定义编辑器等） | `src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts` L1033-L1080 |
| 文件服务：校验、缓冲/非缓冲选择、写队列、强制原子 | `src/vs/platform/files/common/fileService.ts` L383-L520、L1270-L1401 |
| 磁盘提供方：就地写、原子写、open/close/fdatasync | `src/vs/platform/files/node/diskFileSystemProvider.ts` L264-L360、L395-L545 |
| 选项类型 `IFileWriteOptions`（`atomic`、`unlock`、`append`） | `src/vs/platform/files/common/files.ts` L1388-L1418 |
| 用户数据强制原子写 | `src/vs/platform/userData/common/fileUserDataProvider.ts` L128 |
| 脏写检测 etag | `files.ts` L1568（`etag`），`fileService.ts` L502-L538 |

什么时候走原子写：只有调用方传 `atomic: {postfix}`，或提供方的 `enforceAtomicWriteFile` 对该资源返回选项（目前仅用户数据文件）；并且目标不是符号链接、不带 `unlock`、提供方具备非缓冲写能力。其余全部是就地截断写。

## 3. 大文件与只追加

- 保存路径没有按文件大小切换策略：大文件仍是就地写，只是数据超过预读的 3 块时走缓冲写（按块 `write` 到同一个句柄，[F] `fileService.ts` [L1270-L1300](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L1270-L1300)）。写入期间文件已被截断，崩溃会留下半截或空文件（#98063 里的同一担忧；另有用户报告 #116600 “Latest update deleted 12 MB from my big text file”）。
- 打开大文件的限制与保存无关：本地文件的“大文件确认阈值”是 1024 MB（`getLargeFileConfirmationLimit`，[F] `files.ts` [L1630-L1650](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/files.ts#L1630-L1650)；远程 10 MB），超出时 `FILE_TOO_LARGE`，提示“not displayed in the text editor because it is very large”；编辑器模型另有 20 MB / 30 万行的“大文件优化”阈值（关闭部分功能，[F] `src/vs/editor/common/model/textModel.ts` [L188-L191](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/editor/common/model/textModel.ts#L188-L191)），模型超过 50 MB 不再同步给 worker（`_MODEL_SYNC_LIMIT`）。
- 只追加：文件服务层有 `IWriteFileOptions.append`（open 用 `'a'`），提供方声明 `FileAppend` 能力，产品里内部用于 JSONL 日志、语音转写记录等（如 `ahpJsonlLogger.ts`、`voiceTranscriptStore.ts`）。编辑器保存不使用 `append`，也没有“日志文件只追加”的特殊保存逻辑；用户在编辑器里保存日志文件与其它文本一样整份截断重写（推断：从保存路径不传 `append` 得出）。该 `append` 选项是何时加入的，未查到（浅克隆无历史）。
- 外部进程只追加、VS Code 里打开着该文件时：未修改的模型会因文件变更事件被重新解析（见第 4 节），已修改的模型保存时会触发脏写检测。没有 tail 式增量加载（未查到相关功能；从 `resolveFromFile` 整份读取推断）。

## 4. 保存时怎样不把自己的保存当外部改动

没有按来源屏蔽事件的机制（未查到；`File-Watcher-Internals` 维基没有此类描述）。实际是下面几层：

1. 保存成功后立刻更新“最后已解析 stat”：`handleSaveSuccess` 调 `updateLastResolvedFileStat(stat)`，`stat` 来自写完后 `fileService.resolve(resource, {resolveMetadata:true})`（[F] `textFileEditorModel.ts` [L1049-L1062](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L1049-L1062)；`fileService.ts` L433）。
2. 文件变更事件到来时，`TextFileEditorModelManager.onDidFilesChange` 对“未脏”的模型，只要事件含 UPDATED 或 ADDED 就排队重新解析（脏模型永不重载）（[F] `textFileEditorModelManager.ts` [L134-L148](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L134-L148)）。
3. 重新解析时 `resolveFromFile` 带上 `etag`（`mtime` 的 29 进制加 `size` 的 31 进制拼接，`etag()` 在 [F] `files.ts` [L1568-L1576](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/files.ts#L1568-L1576)）；磁盘 etag 没变就抛 `NotModifiedSinceFileOperationError`，模型只更新 stat 并返回（[F] `textFileEditorModel.ts` [L527-L585](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L527-L585)）。所以自己保存产生的事件，会因 etag 与刚更新的 stat 一致而不重新加载。
4. 反向保护（别人改了你正在改的文件）：`validateWriteFile` 的脏写检测。当 `options.mtime < stat.mtime` 且 `options.etag` 与按磁盘 size 算出的 etag 不同，先尝试比较“将写内容”和磁盘内容，完全相同则放行，否则抛 `FILE_MODIFIED_SINCE`，界面提示冲突并让用户比较或覆盖（[F] `fileService.ts` [L502-L538](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/fileService.ts#L502-L538)）。`files.saveConflictResolution = overwriteFileOnDisk` 时 `etag` 被设为 `ETAG_DISABLED`，不再检测（[F] `textFileEditorModel.ts` L1036；设置定义 [F] `files.contribution.ts` [L361-L373](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/files/browser/files.contribution.ts#L361-L373)）。
5. 写队列与资源锁：同一资源的写入走 `ResourceQueue` 串行，磁盘提供方对目标加锁，避免自己的并发写互相读到半截（[F] `fileService.ts` L1268、`diskFileSystemProvider.ts` `createResourceLock`）。
6. 监视器对“删除再创建”的容错：文件监视对 DELETE 后紧跟 CREATE 的事件合并为 UPDATED（[F] `src/vs/platform/files/common/watcher.ts` [L407-L421](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/common/watcher.ts#L407-L421)）；Node 非递归监视器删除后延迟 100 ms 再确认，注释点名“to support atomic save operations where a tool may choose to delete a file before creating it again”（[F] `src/vs/platform/files/node/watcher/nodejs/nodejsWatcherLib.ts` [L24-L28](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/watcher/nodejs/nodejsWatcherLib.ts#L24-L28)、[L420-L431](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/files/node/watcher/nodejs/nodejsWatcherLib.ts#L420-L431)）。同类历史 issue：#15111（别的编辑器原子保存使 VS Code 监视失效，已修复，https://github.com/microsoft/vscode/issues/15111）；#4727（VS Code 就地截断写会让外部监视者先读到空文件，Linux 上因为截断与写入产生两次变更事件，https://github.com/microsoft/vscode/issues/4727）。
7. 监视器文档：https://github.com/microsoft/vscode/wiki/File-Watcher-Internals 只讲请求去重、关联事件与 `files.watcherExclude`，未涉及自写事件过滤。

## 5. 其它编辑器的缺省做法

- **Vim**：选项 `backupcopy`（`bkc`），值 `yes`（拷贝备份后覆盖原文件）、`no`（原文件改名为备份，再写新文件）、`auto`（能无副作用地改名就改名，是链接或属性带不过去就拷贝）；Vim 缺省 `auto`（Unix 的 Vi 兼容缺省为 `yes`）。文档说明拷贝并覆盖会保留硬链接/符号链接/属性，改名则新文件不是链接且属主可能变；还可加 `breaksymlink`、`breakhardlink`。`writebackup` 缺省开（写前做备份，成功后删除），`backup` 缺省关。文档还指出 inotify 类文件监视进程可能被 `no`/`auto` 的改名搞糊涂。
  来源：https://vimhelp.org/options.txt.html#'backupcopy' （vimhelp.org 的 options.txt 渲染页，2026-11-02 抓取；非特定版本号）。
- **Emacs**：缺省“改名做备份再写新文件”：`backup-by-copying` 缺省 nil（即改名），`backup-by-copying-when-linked` 缺省 nil，`backup-by-copying-when-mismatch` 缺省 t（改名会改变属主/组时改用拷贝）；注意备份只在“该缓冲区第一次保存”时做，之后各次保存直接写同一文件。`file-precious-flag` 非 nil 时先写临时名再改名（原子，同时会断开硬链接）。缺省为 nil，所以缺省不是原子写。
  来源：https://www.gnu.org/software/emacs/manual/html_node/emacs/Backup-Copying.html 、https://www.gnu.org/software/emacs/manual/html_node/elisp/Rename-or-Copy.html 、https://www.gnu.org/software/emacs/manual/html_node/elisp/Saving-Buffers.html 、https://www.gnu.org/software/emacs/manual/html_node/emacs/Backup.html （GNU Emacs 手册当前在线版，未标具体版本号）。
- **Sublime Text**：设置项 `atomic_save`。官方设置文档页（https://www.sublimetext.com/docs/settings.html ）没有列这一项，我没找到官方文档对缺省值的明文。官方论坛（开发者 jps 的 3013 版发布说明）：“3013 has atomic saves, where the file is first saved to a new file, and then renamed over the top of the existing file. Atomic saves are disabled by default, but can be enabled via the atomic_save setting”（https://forum.sublimetext.com/t/dev-build-3013/9005 ，2013-02-21）；同年 7 月有用户称它缺省为 true（https://forum.sublimetext.com/t/sublime-3-overwriting-permissions/10861 ），2017 年论坛回复又说缺省关（https://forum.sublimetext.com/t/why-cant-i-save-my-files-i-paid-for-this/28448 ）。缺省值：**未查到权威定论**（本机未安装 Sublime，无法读随包的 `Preferences.sublime-settings`）。开发者 jps 在 https://forum.sublimetext.com/t/atomic-saves/9291 说明代价：会丢扩展属性和资源分支，网络盘上可能失效，目录权限特殊时会出问题；用户补充会丢符号链接。
- **JetBrains IDE**：设置 Settings | Appearance & Behavior | System Settings | Files 中的“Back up files before saving”，官方描述：保存前先建备份，保存成功后删除，失败则从备份恢复，“This behavior is known as ‘safe write’”（IntelliJ IDEA 2026.2 帮助页，2026-09-21 更新：https://www.jetbrains.com/help/idea/system-settings.html ）。源码里 `GeneralSettings` 的 `isUseSafeWrite` 缺省 `true`（https://github.com/JetBrains/intellij-community/blob/master/platform/ide-core/src/com/intellij/ide/GeneralSettings.kt ，master 提交 `5935c1f838a2e19dcd6a46fbf5ab00e8615ddf66` 时的内容），`SafeWriteRequestor` 接口注释为“if the operation fails for whatever reason (like not enough disk space left), the prior content shall not be overwritten”（https://github.com/JetBrains/intellij-community/blob/master/platform/ide-core/src/com/intellij/openapi/vfs/SafeWriteRequestor.java ）。是否改 inode、是否保留硬链接：官方文档未写，未查到。

## 附：没有核实或可能过时的地方

- 本报告基于 master 快照 1.146.0；没逐个 release 版本核对。若需要“某稳定版是否一致”，应在对应 tag 上重读 `diskFileSystemProvider.ts` 的 `writeFile` 与 `open`。
- “编辑 settings.json 走原子写”对应的 URI 方案与 Profile 细节是推断，没在运行时验证。
- 没有实际在磁盘上用 `strace` 或 `inotifywait` 观测保存时的系统调用与 inode 变化；以上均为源码阅读与 issue 原文。
- 本地副本：`/tmp/research-vscode-save/src/vscode`（浅克隆，只读）；网页抓取物在 `/tmp/research-vscode-save/web/`。
