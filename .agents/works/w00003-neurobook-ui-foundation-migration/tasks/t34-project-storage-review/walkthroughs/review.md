# t34 Project Storage 宿主与生命周期独立审查

结论：**建议合并**（附 4 项不阻断遗留，见文末）。

基线 `0d66064b`（HEAD 未变，t30 改动均在工作树）。只读审查，未改被审代码、Spec 或 Task。

## 审查范围

- 含：`packages/neuro-book/server/storage/{host,access-context,storage-actions,project-storage-module,project-scope.test,storage-host-hmr.test,README}`、
  `packages/neuro-book/server/api/storage/project/{context.post,context.delete,action.post}`、
  `packages/neuro-book/shared/storage/host.ts`、
  `server/workspace-files/project-{module,lifecycle,session-runtime,session-service(+test),session}`。
- 排除：`workspace-upload.ts`、`workspace-archive.ts`、`project-workspace-path-policy.ts`、`novel-workspace.ts`、
  `project-file-index.ts`、`workspace-storage-boundary.ts`、`backup-*`（t31/t32，由 t33 审）；
  `app/utils/workbench/descriptors{,.test}.ts` 为用户既有 dirty，未读入判断。

## 独立复现的证据（本次实跑，不采信自述）

| 命令（cwd `packages/neuro-book`） | 结果 |
| --- | --- |
| `bunx vitest run server/storage/project-scope.test.ts server/storage/storage-host-hmr.test.ts` | 2 文件 15 通过 |
| `bunx vitest run server/storage shared/storage server/api/storage server/workspace-files/project-{module,session,session-service,session-runtime,lifecycle,session-hmr,data-plane-guard,open-guard}.test.ts` | **28 文件 347 通过 / 1 跳过**，与 followup 自述一致 |
| `bun run typecheck` | **exit 0，无输出** |

V3 旧形状由独立取证确认：`git show 0d66064b:.../server/storage/host.ts` 的 `StorageHostState` 是
`accessContexts: StorageAccessContextRegistry` + `registry: StorageStateRegistry`（无 `close()`），
即 leader-findings 第 1 条成立，本轮 `closePreviousSlot`（`host.ts:128-137`，按 `"accessContexts" in slot` 分派）
与 HMR 测试 fixture 都按真实字段交接。

## 六项核对点

**1. 精确 ready/publicId、身份、scope 与物理根绑定 —— 满足。**
`host.ts:253-296` 按 `publicId` 取 ready 后，`service.requireReadyProjectByPublicId` 还要求请求 `projectRoot` 的
locator 命中同一 entry 且 `entry.ready === ready`（`project-session-service.ts:417-429`），路径与标识必须同时自洽。
claims 绑定 `storageRoot / rootIdentity / project{publicId,projectRoot} / dataRootIdentity / identityDomain /
subject / sessionGeneration / clientId`（`host.ts:374-393`），`assertSameClaims` 全字段比对
（`access-context.ts:283-299`）。Project 不签发身份域：`resolveDataIdentity` 只用
`dataStorageRoot()`（`host.ts:566-568`），`createProjectStorageRoot` 只 `mkdir` 目录。
action/release 都不产生新代次（release 走 `peek` + `release`，不 `issue`）。
user/project 释放互不接受：两个入口都先 `peek` 再按 scope 拒绝（`host.ts:476-491`、`348-370`），
`project-scope.test.ts` 的 "user 释放不接受 project 上下文，也不静默撤销它" 用例断言 403 且被拒上下文仍可用。

**2. lazy module 接入与生命周期 —— 满足，且是真接入而非改个名字。**
`ProjectModuleName` 增加 `"storage"` 并进入 `LAZY_MODULE_ORDER`（`project-module.ts:7,59`），
由 facade 的副作用导入注册（`project-session.ts:50`），即生产 composition root。
`project-storage-module.ts:start` 只算路径、无 I/O；测试断言 `openProject` 后 `.nbook/storage` 仍 ENOENT。
关闭顺序：`closeReadyRecord` 先 `await Promise.all([...dataOperations])`、再逆序关 Module、最后
`occupancy.release()`（`project-session-runtime.ts:809-833`）——排空确实在 Occupancy 之前。
Module `close()` 调 `revokeStorageProjectScope(storageRoot)` 删除本 scope 上下文并释放容量；
宿主级 service/pool 不按 Project 复制（符合"不建脱离生命周期的永久 Map"要求），Project 侧靠
"撤销上下文 + 副作用前 guard + completion 登记在 dataOperations"三点与生命周期咬合：
dataOperations 排空保证占用句柄已 release，因此 occupancy 释放时池内无本 generation 残留。

**3. `assertTarget` 收口语义 —— 满足；依赖 watcher 的窗口见遗留 W-1。**
新 guard 经 `acquire.guard` 进入核心真实副作用点：`createHandle` 在建根/规范化前后（`storage-service.ts:178,189`）、
`assertMutationHealthy` 在每次 `beforeWrite`（`partition-store.ts:707-711`）。
`assertProjectOperationTarget` 只判精确世代 + `targetInvalid` + `occupancy.assertHealthy()`
（`project-session-runtime.ts:375-384`），**不看 closing**，因此用户关闭/宽限/删除/关停仍可排空；
`lock-compromised` 由真实的 `occupancy.compromised` 信号触发并在 `closeProjectAt` 里**先置标记再 abort**
（`project-session-runtime.ts:305-311, 604-609`）。
Service 侧 `projectTargetGuard` 另判 Facade 归属与 `entry.targetInvalid`（`project-session-service.ts:629-644`），
后者由 watcher 回调**同步**置位后才启动 `closeRootReplaced`（`:213-219`）。
物理证据存在但不完全等价于"Project 根替换"：真实 `rm + mkdir` 替换 Project Storage 根后写入在副作用前 403
且新根保持为空；真实 `rm + mkdir` 重建 data 根（复制同一份 `identity.json`）后旧上下文在副作用前 403。
`closeProject(..., "root-replaced")` 用例覆盖的是 Facade/Runtime 标记路径，不是 watcher 触发路径。

**4. 首次 mkdir 前的复核 —— 满足。**
`createProjectStorageRoot`（`host.ts:407-428`）顺序为 revalidate → containment → revalidate → `mkdir` → containment，
`revalidate` 是 `revalidateReadyProject`（精确 ready + Occupancy + `rootIdentity.revalidate` 的真实物理目录复核）。
用例"初始化在真实 mkdir 之前再次核验"证明等待期间被终止的 Project 不重建目录（409 + 目录仍 ENOENT）。
在途 data 根更换：`dataRootIdentity` 进 claims，每次请求重算并比对；上下文 guard（`assertLive` + `assertTarget`）
与核心根 guard（`expectedRootIdentity` + `assertLeaseRootIdentity` + `assertStorageRootIdentity`）组合完整。

**5. V2/V3→V4 HMR —— 满足（真实形状已按基线校正）。**
两代旧槽拆成各自形状类型，V3 只关 `accessContexts/service/pool`，不再触碰 `registry`；
关闭失败用 `Promise.all` 保留拒绝（`allSettled` 只用于 `pending`），新 owner 的请求 fail closed（HTTP 500）而非静默开工；
同版重载复用同一 owner。旧 Project Service 的 registry 快照边界见遗留 W-2。

**6. 接口、依赖、错误语义、body 校验 —— 满足。**
`StorageProjectContextRequestSchema` 为 `strict()` + 长度上限，经共享 DTO 导出，请求不能自报 scope/主体/路径；
project context body 单独 4 KiB 上限，action 复用 `readStorageActionRequest`。
定义与访问 scope 不一致在核心被拒绝（`storage-service.ts:540-545`），user scope 定义不能借 project 访问读写。
错误仍走既有 typed 投影；project 目标失效在 Storage 边界规范化为 `STORAGE_CONTEXT_INVALID / claims-mismatch`，
不会把 `ProjectNotOpenError` 包成 `STORAGE_IO_FAILURE`。依赖无静态环：
`project-session → project-storage-module → storage/host`，反向只有动态 `import(".../project-session")`（`host.ts:258,313`）。

## 遗留（不阻断本次合并）

- **W-1 watcher 窗口**：已接纳操作在"请求起点物理复核"与"真实写入"之间只靠内存标记停写。
  触发：外部在途替换 Project 根，且 watcher（debounce + `rootIdentity.revalidate`）尚未置位；
  影响：该次写入可能落到同路径的新目录；位置：`project-session-service.ts:217` → `project-session-runtime.ts:380`。
  该窗口是同步 guard（`StorageMutationGuard = () => void`）的固有限制，标记本身由真实物理复核驱动，
  且比 user 路径（无 watcher）更严；建议补一个直接调用 watcher 回调、断言在途操作在下一个副作用前失败的用例，
  并在 Spec/README 明确"停写以观察到的替换为准"。
- **W-2 HMR 加入新 lazy module 的升级边界未写明**：已打开 generation 的 `lazyModules` 是打开时捕获的不可变快照
  （`project-module.ts:78-83`、`project-session-runtime.ts:293-294`），Service 又跨 HMR 复用。
  对已打开 Project 签发 storage 会以非 typed `Error("Project lazy Module未注册：storage")` 失败并投影为 500
  （`project-session-runtime.ts:488-491`）。仅 dev HMR 可达（生产在开 Project 前完成注册），失败方向安全，
  但"必须重开 Project"这条边界既未在代码注释也未在 README 说明。
- **W-3 Project 根物理替换无真实用例**：followup 已披露原因（Windows 下 SQLite 句柄占用导致整根 rename 不稳定），
  本次以"Storage 根物理替换 + data 根物理替换 + `root-replaced` 合同路径"替代，接受为当前证据上限。
- **W-4** project 路径未跑真实 auth-on/off 与 session 撤销 HTTP（用例走 `resolveSubject` 注入）；
  共享函数由 `server/storage/host.test.ts` 的 user 用例直接覆盖同一 `resolveDataIdentity` 代码路径。
- 附带观察（非 t30 引入）：HMR 链 V2→V3→V4 时，V2 的关闭失败仍会被旧 V3 模块的 `allSettled` 吞掉；
  该段代码属于基线，不在本轮可改范围。
