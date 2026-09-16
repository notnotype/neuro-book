# t30 追加修复：四项核对与门控测试

基线 `0d66064b`；本文件是第二轮（leader-findings 四项）的真实结果记录。

## 四条修正与落点

### 1. V3 HMR 真实形状交接

基线 `0d66064b:server/storage/host.ts` 的 `StorageHostState` 里 `accessContexts` 才是访问上下文 registry，
`registry` 是 `StorageStateRegistry`（**没有** `close()`）；V2 才把访问 registry 存在 `registry` 字段。
上一轮 `createState(previous)` 一律调 `previous.registry.close()`，只在被 fixture 掩盖时“通过”。

- `server/storage/host.ts`：拆成 `PreviousStorageHostV2State` / `PreviousStorageHostV3State` 两个真实形状类型，
  `closePreviousSlot()` 按 `"accessContexts" in slot` 分派，只关访问上下文、`service`、`pool`。
  V3 的 `registry` 不再被调用任何成员。
- 关闭失败不再被 `allSettled` 掩盖：`Promise.all(closes)` 保留拒绝，旧 owner 关闭失败时
  `ready` 拒绝，新 owner 的请求 fail closed；在途身份初始化失败仍按单个请求结果吞掉（不是所有权失败）。
  新 owner 只在有请求/关闭时才观察该 promise，模块加载处另挂一个观察者避免无人处理的拒绝。

### 2. Project 在途副作用的写入目标 guard

上一轮 `performLeasedAction` 的 guard 只有 `accessContexts.assertLive`，而 Storage 锁等待期间 Project
可能已被锁失效/根替换；Module close 要等 `dataOperations` 排空，撤销落在写入之后。

- `project-session-runtime.ts`：`ProjectSessionRecord.targetInvalid`，`closeProjectAt` 在
  `root-replaced` / `lock-compromised` 时置位（早于 abort 与排空）；新增
  `assertProjectOperationTarget(session)` = 精确世代身份 + 该标记 + `occupancy.assertHealthy()`。
  **不看 closing 状态**，因此普通关闭仍允许已接纳操作排空。
- `project-session-service.ts`：entry 增加 `targetInvalid`，`observeWorkspace` 回调**同步**置位后
  才启动 `closeRootReplaced`（根替换的失效不等待控制面排空）；新增 `projectTargetGuard()`
  合并 Service 归属/标记与 Runtime 判定。
- `runReadyProjectOperation` / `startReadyProjectOperation`（facade 与 Service）的 operation callback
  增加第二个参数 `assertTarget`（追加参数，既有调用方不受影响）。
- `host.ts`：project 动作把它作为 guard 的第二段；Project 目标失效对 Storage 调用方就是访问上下文失效，
  在 Storage 边界投影为 `STORAGE_CONTEXT_INVALID / claims-mismatch`，不让 `ProjectNotOpenError`
  被 `writeStorageRecordFile` 包成 `STORAGE_IO_FAILURE`。

### 3. 首次 mkdir 之前的重新核验

`createProjectStorageRoot` 的第三参数从 `assertActive`（只查 Storage host）换成 `revalidate`：
在真实 `mkdir` **之前**再次执行精确 ready + Occupancy + 物理目录复核，创建前的 containment 检查也排在其后。
调用方保留签发前的收口复核。

### 4. data 物理根进 Project claims

- `access-context.ts`：claims 增加 `dataRootIdentity`（project scope 专用，user scope 的 `rootIdentity`
  就是它），`assertSameClaims` 一并比较。
- `host.ts`：`StorageDataIdentity` 携带 data 根的 `StorageRootIdentity`；`resolveDataIdentity` 捕获一次，
  user 路径继续用 `assertStorageRootIdentity` 复核，project 声明写入 `storageRootIdentityDigest(dataRoot)`。
  复制同一份 `identity.json` 到同路径新目录后，身份域字符串相同但物理身份不同，旧 Project 访问失效。

顺带：`releaseStorageUserContext` 先 `peek` 并拒绝非 user scope，与 project 释放对称。

## 门控证据（含负向对照）

新增/改写用例：

| 用例 | 位置 |
| --- | --- |
| 旧 V3 槽按真实形状交接（`registry` = `StorageStateRegistry`） | `storage-host-hmr.test.ts` |
| 旧槽关闭失败不被掩盖：新 owner 不接纳任何操作（HTTP 500） | `storage-host-hmr.test.ts` |
| user 释放不接受 project 上下文，也不静默撤销它 | `project-scope.test.ts` |
| data 物理根被同路径重建后旧 project 上下文在副作用前拒绝 | `project-scope.test.ts` |
| 等 Storage 锁期间 Project 被替换：已接纳保存停在真实副作用前 | `project-scope.test.ts` |
| 初始化在真实 mkdir 之前再次核验：等待期间被关闭的 Project 不重建 Storage 根 | `project-scope.test.ts` |

负向对照（临时移除本轮修复，跑同一批用例后原样还原，`cmp` 确认字节一致）：

- 去掉 `assertTarget` 传递 + mkdir 前的 `revalidate` + `dataRootIdentity` 三项后，
  `bunx vitest run server/storage/project-scope.test.ts` → **3 failed | 6 passed**，
  失败正是上表后三条；还原后 9 passed。
- V3 真实形状用例在上一轮代码下会同步抛 `TypeError: previous.registry.close is not a function`
  （主 Agent 已在独立 Bun 进程复现）；关闭失败用例在上一轮 `allSettled` 下会得到 400（缺凭证）而不是 500。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `bunx vitest run server/storage/project-scope.test.ts` | 9 passed（真实 Node HTTP + H3 路由 + 隔离 Workspace Root；含锁适配器确定性等锁窗口） |
| `bunx vitest run server/storage/storage-host-hmr.test.ts` | 6 passed |
| `bunx vitest run server/storage shared/storage server/api/storage server/workspace-files/project-{module,session,session-service,session-runtime,lifecycle,session-hmr,data-plane-guard,open-guard}.test.ts` | 28 文件，347 passed / 1 skipped |
| `bun run typecheck`（cwd `packages/neuro-book`） | exit 0，无输出 |

## 未运行 / 残余

- 未跑完整 Workspace 业务全集（按 Task 要求只跑 Storage/Project 聚焦）。
- auth-on/off 与 session 撤销仍由既有 `server/storage/host.test.ts` 覆盖同一 `resolveDataIdentity` 路径，
  未为 project 另跑真实 auth-on HTTP。
- 锁失效（`lock-compromised`）的终止标记未单列用例：现有 Runtime/Lock 用例覆盖 Occupancy 不健康，
  本轮新增的 `targetInvalid` 与它在 guard 中同路径判定。
- Windows 下无法在测试内稳定 rename 整个 Project 根，根替换在用例中以 `closeProject(..., "root-replaced")`
  与 `project-lifecycle.test.ts` 的 `PROJECT_ROOT_REPLACED` 合同表达。
- t31/t32 仍在并行；本轮未跨文件编辑它们的 `workspace-storage-boundary.ts` / `workspace-archive.ts`。
  `runReadyProjectOperation` 的 `assertTarget` 是追加参数，既有调用方与 mock 不受影响。
- 未接入：文件/备份路径策略、grid、迁移、UI 与命令系统（属其它 Task）。
