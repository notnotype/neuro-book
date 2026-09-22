# t31 / t32 追加复核（承接首轮 `review.md`，首轮报告保留）

结论：**建议合并**。

条件：提交前由主 Agent 补最终统一 `typecheck`（本轮按 Task 分工未运行，见「未运行」）。
除此以外，首轮的三项残余风险均已闭合，且我独立重跑了本轮新增边界，数字与 Tasker 报告一致。

被审范围：相对 `0d66064b` 的 t31（普通文件消费与资产同步边界）与 t32（归档与备份）。
排除：t30 的 `server/storage/**`、`server/api/storage/**`、`shared/storage/**`、Project lifecycle/session/module；
两个 `app/utils/workbench/descriptors{,.test}.ts`（用户既有 dirty）；`app/utils/storage/**`（浏览器适配器线，非本轮）。
审查方式：只读源码 + 实跑聚焦测试。未改被审代码、Spec、Task 合同或 Work。

## 我实际运行并复现的数字

cwd `packages/neuro-book`，全部 `--maxWorkers 1`，全绿：

| 命令 | 结果 |
|---|---|
| `bun run test server/workspace-files/workspace-storage-boundary.test.ts server/workspace-files/workspace-upload.test.ts server/workspace-files/workspace-archive.test.ts server/api/workspace-files/download.get.test.ts` | 4 文件 28 用例通过（14.18s） |
| `bun run test server/workspace-files/workspace-command.test.ts` | 1 文件 8 用例通过（8.11s） |
| `bun run test server/api/workspace-files server/workspace-history/tracked-workspace-files.test.ts` | 8 文件 29 用例通过（18.22s） |

与 `t31/walkthroughs/final-validation.md` 的 4/28、1/8、8/29 完全一致。未重跑大型 `workspace-files.test.ts`
（其旧改动 13 文件 131 + typecheck 由主 Agent 已跑，Tasker 按分工未复跑，符合 Task 约定）。

## 首轮残余风险的闭合核对

1. **CLI（首轮残余 1）已闭合。** `workspace-command.ts:237,264` 在 `node new`/`node state` 解析出 target 后、
   真实 `createWorkspaceDirectory` / `createWorkspaceContentState` / `statWorkspacePath` 之前调用
   `assertWorkspaceStorageBoundary(workspaceTargetForContentRoot(root), relativePath, "mutation")`。
   新增 `workspaceTargetForContentRoot` 只按调用方 File Scope 投影 target：内容根 ===
   `resolveWorkspaceContainerRoot()` → `workspace-root`；一级 Project 内容根 → `project-workspace`，
   `projectRoot` 取目录名。判据不来自 `basename` 猜类型，也不向低层通用文件能力注入全局状态。
   实测：`.nbook/storage/evil`、`proj/.nbook/storage/evil` 建目录被拒且磁盘无产物、`node state .nbook/storage/records` 被拒，
   `notes/storage/ok` 正常创建（`workspace-command.test.ts` 新增用例）。
2. **workspace-root 单段路径（首轮残余 2）已闭合。** `isMutationReachableStorage` 的 `ambiguous-project-dir`
   分支改为先 `lstat` 确认真实目录，再只探测 `<dir>/.nbook/storage`；缺失/非目录放行，真实 I/O 失败上抛（不退化成 fail-open）。
   实测：普通 `plain` 目录 rename + delete 真实成功、`missing-dir` 放行、带 Storage 的 `proj` 仍拒绝，
   Storage 记录字节不变（`workspace-storage-boundary.test.ts`）。上传单段名与普通目录同名由原先的 403 回到 `skipped:1`，目录仍是目录。
3. **user-assets 打包下载（首轮残余 3）已闭合。** `createWorkspaceZipStream` 由接收 `root` 改为接收
   `WorkspaceFileTarget`，排除判据用 `isWorkspaceStoragePath(target, archivePath)`；`download.get.ts` user-assets 分支传整个 `target`。
   真实解包断言：ZIP 含 `config.json`、`notes/storage/note.md`，不含任何 `storage/**` 条目，源记录字节不变。
   Project ZIP 与完整 data 备份路径未被此项改动（继续 preserve 正式记录）。

## 六个重点逐条

1. **生产入口真调用保护** — 成立（并已补 CLI）。写：`write.put.ts:84`、`tracked-workspace-files.ts` 的
   `writeWorkspaceTextFileTracked:60`、`createWorkspaceFileTracked:80`、`createWorkspaceDirectoryTracked:96`、
   `convertWorkspaceFileToDirectoryTracked:126`、`renameWorkspacePathTracked:151-152`（from/to 双向）、`deleteWorkspacePathTracked:184`；
   上传三入口在 `writeWorkspaceUploads` 写盘前整批校验（`workspace-upload.ts:` 归一化循环之后的 guard 循环）。
   读：`read.get.ts:72`、`stat.get.ts:73`。
   五个 mutation 路由（create-file / create-directory / convert-file-to-directory / rename / delete）均只经 tracked 包装，
   无绕过低层 `createWorkspaceFile` 等函数的路径。祖先（`.nbook`、`proj/.nbook`）、跨入受管位置、workspace-root 上层、
   内部链接别名、缺失目标均有判定；`notes/storage` 不误屏蔽。上传整批前置校验保证不出现半批写入（真实用例断言普通文件未被部分写入）。
2. **file-index / watch / History 不消费 Storage** — 成立。plain 侧 `project-file-index.ts` 的
   `buildProductionSnapshot` pathPredicate 与 `isIgnoredFileIndexWatchPath` 都追加 `isWorkspaceStoragePath(input.target, …)`；
   project 侧继续走 `projectWorkspacePathPolicy`（file-index/history = ignore）。`tree.get.ts` 走同一索引快照，无独立枚举。
3. **资产同步不碰 Storage** — 成立。5 处提前 `continue`（`novel-workspace.ts:547,710,748,795` 与 `isManagedAssetBlacklisted:1202`）
   覆盖源枚举 + 三个清理函数。新增真实 fixture：旧 sync state 声称 `storage/records/shelf.json` 受管，
   断言记录字节不变、上游 `storage/records/installed.json` 未安装、普通受管资产（`reference/kept.md`）照常同步、
   `assetWarnings` 为空。足以支撑结论（该用例未在本轮重跑，随大型 `workspace-files.test.ts` 归主 Agent）。
4. **Project path policy** — 成立。新增 `storage` / `storage-runtime` 两类；正式记录、墓碑、原件、身份域元数据 archive=preserve、
   file-index/history=ignore；`STORAGE_LOCK_DIRECTORY_NAME`（`.locks`）与 `isStorageTempFileName`（`record-codec.ts:62`）在三消费者都 ignore。
   Windows 大小写经 `process.platform === "win32"` 归一，与 `.nbook` 穿透比较同口径；手工 `.tmp` 仍算 Storage 内容；
   `notes/storage` 仍为 `content/consume`。
5. **归档 preserve 快照** — 成立。`stagingRoot` 由 `mkdtemp(os.tmpdir())` 建立，不在归档根内；
   preserve 文件先 `copyFile` 到 `stagingRoot/preserved/<archivePath>` 再 `addFile`，规避 yazl 先 stat 后开流；
   异常路径 `removeArchiveStaging` + rethrow，流结束 `attachStagingCleanup`。
   真实用例：归档准备后把记录原子替换为不同大小的新值，ZIP 仍是完整旧快照、源文件为新值、原件字节（含二进制）与墓碑 JSON 均有断言。
   未发现对原数据的写入。
6. **完整 data 备份** — 成立。`backup-archive-rules.ts` 只对两个正式 Storage 根排除 `.locks` 首段与模块临时名，
   其余（含 `quarantine/*.tmp` 这类未知原件、`identity.json`、墓碑）一律保留；判据只被打包侧 `collectFiles` 消费，不改恢复侧语义。
   `collectFiles` 从「吞掉全部枚举错误」改为「仅 ENOENT 可跳过」，`config.yaml`/`.env` 同样只在 ENOENT 时跳过，
   拒绝 EACCES 的用例通过。证据是真实「加密 envelope → 解密 → 解包」并逐条断言内容（`backup-archive-service.test.ts`），非 mock 回显。

## 新增残余风险（不阻断本次合并，请 Leader / 开发者知悉）

1. **`workspace node validate --fix-missing`（含 `--recursive`）与 `node parse` 仍未接 guard。** 触发场景：
   本机 CLI 对含 `index.md` 的目录执行 `--fix-missing`。实际影响低——Storage 目录内不存在标准内容节点形态
   （记录为 `<key>.json`、原件在 `quarantine/`），`validate` 在写入前即因非内容节点失败；但该保证来自内容节点合同而非本 guard。
   建议后续为这两个命令补同源判定，或在 Task 收口登记为已知缺口。
2. **显式 `<任意一级目录>/.nbook` 两段路径在 workspace-root mutation 下仍无条件判为 Storage 祖先。** 单段 `<dir>` 已改为文件系统探测，
   但 `other/.nbook` 这类写法仍保守拦截。`.nbook` 是保留控制目录，影响面小；仅错误文案（“Storage 服务独占”）对非 Project 目录略不准。
3. **`collectFiles` 收紧为仅 ENOENT 可跳过** 是合同要求的行为变化：备份期间若有悬空符号链接目录或瞬时权限问题，
   将中止整次备份（此前静默跳过）。属有意收紧，但建议在发布说明中体现。
4. **`workspaceTargetForContentRoot` 通过 `projectWorkspaceRef(path.basename(root))` 复用 Project 命名校验。**
   若某个一级目录含 `project.yaml` 但目录名不合法（含 `< > : " | ? *`、Windows 保留设备名、`.nbook`），
   该 CLI 会抛 `INVALID_PROJECT_ROOT` 而非按 project 处理。这类目录本不能成为受管 Project，风险低。
5. **user-assets `read` 无法列出 `storage` 目录本身**（`storage` 单段即判 inside）。这是「普通接口不暴露 Storage」的保守选择，
   当前无消费者需要列举该目录。

## 未运行 / 未核

- 未运行主应用 `typecheck`（Task 明示由主 Agent 在提交前统一执行；`ResolvedWorkspaceTarget.root` 收紧为 `AbsoluteFsPath`
  与 `createWorkspaceZipStream(target)` 签名变化是其中需覆盖的点）。
- 未运行大型 `workspace-files.test.ts` 全量（Task 明确不要求）。
- 未复现、未归因 `project-identity.test.ts` 的 `ELOCKED` vs `PROJECT_IN_USE`；接受 `t31/walkthroughs/leader-baseline.md`
  的 git-show 提交前对照结论，未扩大锁修复。
- 未审查 t30 文件、`app/utils/storage/**` 与两个 workbench descriptors。
