# t31 最终补修与验证

状态：三项收口已实现并有真实聚焦验证；主应用统一 `typecheck` 按 Task 分工留给主 Agent。
基线：`0d66064b`。cwd：`packages/neuro-book`（除特别说明）。
本轮由 omp Tasker 接管最后三项补修；t30 独占 `server/storage`、`server/api/storage`、`shared/storage` 与 Project lifecycle/session/module，未触碰。

## 本增量改动

### 1. `workspace-command.ts`：node new/state 接入同一 Storage guard

- 新增 `workspaceTargetForContentRoot(root)`：把 `resolveWorkspaceContentRoot()` 已解析的物理根投影成 `WorkspaceFileTarget`。
  从 Workspace Root 调用得到 `workspace-root`，从一级 Project Workspace 调用得到 `project-workspace`（`projectRoot` 用单段目录名）。
  不改低层通用文件能力，也不引入运行期全局路径；目标种类只来自调用方 File Scope。
- `ResolvedWorkspaceTarget.root` 由 `string` 收紧为 `AbsoluteFsPath`。
- `node new` 与 `node state` 在拥有 target 的边界、实际 `createWorkspaceDirectory` / `statWorkspacePath` / `createWorkspaceContentState` 之前调用
  `assertWorkspaceStorageBoundary(target, relativePath, "mutation")`。`mutation` 是 read 的超集，读、改都不会绕过。
- 去掉了首轮报告里「CLI 走低层能力、未纳入守卫」的缺口。

### 2. `workspace-storage-boundary.ts`：workspace-root 单段路径只拦真实承载 Storage 的目录

- `isMutationReachableStorage` 的 `ambiguous-project-dir` 分支不再「是真实目录就拦」。
  现在先 `lstat` 确认是真实目录（不是目录、缺失都放行），再探测 Storage 根的准确地址 `<dir>/.nbook/storage`；
  只有该地址真实存在才作为 Storage 祖先拦截。
- 缺失之外的真实 I/O 失败（权限、链接解析等）继续上抛，不把任意失败当「没有 Storage」。
- 结果：普通一级目录的 rename/delete 不再被误判为 Storage 独占；带 Storage 的一级 Project 目录仍被拦。
  `.nbook`、`proj/.nbook` 等确定祖先仍按种类同步命中，不需要文件系统探测。

### 3. 用户资产 ZIP 按显式目标策略排除 Storage

- `createWorkspaceZipStream` 由接收 `root` 改为接收 `WorkspaceFileTarget`；排除判据用 `isWorkspaceStoragePath(target, archivePath)`，
  user-assets 下载因此排除整个 `storage/**` 子树（记录、`identity.json`、`quarantine`、`.locks` 与在途临时名），普通 `notes/storage` 保留。
- `addWorkspaceEntries` 的 `excludedPaths: ReadonlySet<string>` 换成 `isExcluded: (archivePath) => boolean`：
  Project 归档仍用原有的精确 live 路径集合，普通下载用 Storage 判定，两者都在递归前剪掉子树。
- `download.get.ts` user-assets 分支改为传整个 `target`；对应 mock 断言同步更新。
- 未改 Project ZIP 与完整 data 备份路径：正式 Storage 记录继续按 preserve 保留。

## 已运行命令与结果

全部为真实执行、`--maxWorkers 1`。

| 命令（cwd `packages/neuro-book`） | 结果 |
|---|---|
| `bun run test server/workspace-files/workspace-storage-boundary.test.ts server/workspace-files/workspace-upload.test.ts server/workspace-files/workspace-archive.test.ts server/api/workspace-files/download.get.test.ts --maxWorkers 1` | 4 文件 28 用例通过 |
| `bun run test server/workspace-files/workspace-command.test.ts --maxWorkers 1` | 1 文件 8 用例通过 |
| `bun run test server/api/workspace-files server/workspace-history/tracked-workspace-files.test.ts --maxWorkers 1` | 8 文件 29 用例通过 |

按要求未重跑耗时的大型 `workspace-files.test.ts`。本轮新增/改动的测试都落在 `server/**` 通配内，已被上面命令实际执行，无需登记 `vitest.config.ts`。

### 新增/调整的回归

- `workspace-storage-boundary.test.ts`：新增「workspace-root 只拦住真实承载 Storage 的一级目录」——
  普通目录 `plain` 的 rename/delete 真实成功、`missing-dir` 放行、带 Storage 的 `proj` 仍拒绝，且 Storage 记录字节不变。
- `workspace-upload.test.ts`：新增「上传单段名与普通目录同名时跳过」——`written:0 / skipped:1`，目录仍是目录，不再返回 Storage 403。
- `workspace-command.test.ts`：新增「node new/state 在拥有 target 的边界拒绝 Storage 路径」——
  `.nbook/storage/evil` 与 `proj/.nbook/storage/evil` 建目录被拒且磁盘无产物、`node state .nbook/storage/records` 被拒；`notes/storage/ok` 正常创建。
- `workspace-archive.test.ts`：新增 user-assets 真实解包断言——ZIP 含 `config.json`、`notes/storage/note.md`，不含任何 `storage` 条目，源记录字节不变。

## 剩余项与未验证

- **未运行主应用 `typecheck`**：按 Task 分工，`vitest.config.ts`、`server/storage/**`、Project lifecycle/session 由 t30 在改，统一 typecheck 由主 Agent 执行。
  本轮改动涉及 `ResolvedWorkspaceTarget.root` 的类型收紧与 `createWorkspaceZipStream` 签名变化，`AbsoluteFsPath` 已确认是 `resolveRuntimeWorkspaceRoot` 的既有返回类型。
- `workspace-archive.ts` 当前工作树同时包含 t32 owner 未提交的 preserve 快照改动与本轮的排除谓词改动（t32 owner 已停编辑）。
- `node new .`（目标解析为内容根本身）会命中 guard 的根 mutation 拒绝并给出 Storage 文案；这与 HTTP 普通写入口对 `.` 的既有合同一致，未为本轮新增行为。
- `project-identity.test.ts` 旧 alias 锁失败不在本 Task 范围，未复现、未扩修，由主 Agent 单列归因。
- 未触碰 t30 文件、两个 workbench descriptors（用户既有 dirty）、Work/Spec 与他人 Task 文档；未提交、未 push/PR/部署。
