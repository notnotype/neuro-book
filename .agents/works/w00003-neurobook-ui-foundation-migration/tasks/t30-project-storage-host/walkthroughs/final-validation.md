# t30 最终补修：关停排空与最后锁检查

基线 `0d66064b`；本文件记录最后一轮（leader-shutdown-findings 两项）的真实事实与结果。

## 已完成（本轮之前，工作树保留，未重做）

- Project Storage lazy module、宿主访问上下文、HTTP 入口与 HMR V4 换代：见 [implementation.md](implementation.md)。
- leader-findings 四项（V3 真实形状交接、写入目标 guard、mkdir 前复核、data 物理根 claims）：见 [followup.md](followup.md)。
- t34 独立实跑 347 passed / 1 skipped、主应用 typecheck exit 0。

## 本轮两项 + 一处注释修正

### 1. Project 整体 shutdown 误拒绝已接纳操作

主 Agent 已用 Vitest pre-load 复现：`service.closeAll()` 后已接纳 operation 调
`revalidateTarget()`／`assertTarget()` 得到 `PROJECT_NOT_OPEN`。根因两层，均已修：

- `ProjectSessionService.projectTargetGuard()`：去掉 `this.state !== "running"` 误判，改为直接
  `assertProjectTargetIdentity`（entry 归属、ready、`targetInvalid`、Runtime 精确世代/锁/根替换标记与
  Occupancy）。普通 close 与整体 shutdown 都不再阻断已接纳操作排空；新操作继续由
  `runReadyProjectOperation`／`startReadyProjectOperation`／`revalidateReadyProject` 的入口 gate 拒绝。
- `ProjectLifecycle.revalidateWorkspace()`：去掉 `assertRunning()`。它不取得锁、不写盘，只调用
  `rootIdentity.revalidate`，因此 Lifecycle `close` 后仍能供已接纳操作在副作用前做只读物理复核，
  同路径替换继续以 `PROJECT_ROOT_REPLACED` 失败。新公开操作仍由 `runOperation` 的 close gate 拒绝。

### 2. 最后一次异步复核之后的锁健康检查

`StoragePartitionStore.assertMutationHealthy()` 原为 `guard → contained → lock.assertHealthy → guard`，
最后一次 guard 含异步物理复核，等它期间锁可能被接管；返回后原代码直接允许副作用。补末尾同步
`context.lock.assertHealthy()`，覆盖「检查通过 → 等待 → 锁接管 → 副作用」窗口。

### 3. `project-session.ts` V3 注释

基线 `0d66064b` 的 Service 已有 `requireReadyProjectByPublicId`（缺的是旧 Facade 未导出它）；
真正缺失的是本轮新增的 `revalidateReadyProject`/写入目标核验与 Project Storage lazy Module 登记。
已修正 `PreviousProjectSessionV3State` 类型注释与 `createHandoffState` 文档。

## 改动文件

- `server/storage/partition-store.ts`：末尾同步锁检查 + 方法文档。
- `server/workspace-files/project-session-service.ts`：`projectTargetGuard` 去掉关停状态误判，
  `projectTargetRevalidator` 复用该 guard。
- `server/workspace-files/project-lifecycle.ts`：`revalidateWorkspace` 去掉 `assertRunning()`。
- `server/workspace-files/project-session.ts`：V3 历史形状注释。
- `server/storage/storage-core-regression.test.ts`：新增「最后一次异步物理复核期间锁被接管」用例 + import。
- `server/workspace-files/project-session-service.test.ts`：新增「整体 shutdown 仍允许已接纳操作收口」用例。
- `server/workspace-files/project-lifecycle.test.ts`：新增「Lifecycle 关闭后仍可只读复核原 root」用例。

## 命令与结果

| 命令（cwd `packages/neuro-book`） | 结果 |
| --- | --- |
| `bunx vitest run server/storage/storage-core-regression.test.ts server/workspace-files/project-session-service.test.ts` | 2 文件，38 passed |
| `bunx vitest run server/workspace-files/project-lifecycle.test.ts` | 1 文件，93 passed / 1 skipped |
| `bunx vitest run server/storage shared/storage server/api/storage server/workspace-files/project-{module,session,session-service,session-runtime,lifecycle}.test.ts server/workspace-files/project-session-hmr.test.ts` | 26 文件，349 passed / 1 skipped |
| `bun run typecheck` | exit 0，无输出 |

新增用例的回归含义（未做负向探针，按 Task 要求不改生产源码验证）：

- shutdown 用例在旧 `projectTargetGuard` 下会以 `PROJECT_NOT_OPEN` 拒绝已接纳操作。
- `revalidateWorkspace` 用例在旧 `assertRunning()` 下会在 Lifecycle `close` 后抛 `PROJECT_LIFECYCLE_CLOSED`。
- 锁用例用可控异步 guard 在「临时文件已写完新值、即将替换」的最后一次复核窗口触发 `onCompromised`；
  旧实现会让替换先落盘并报 `committed: true`，新实现停在副作用前，`committed: false` 且旧值字节不变。

## 未运行 / 残余

- 未跑完整 Workspace 业务全集（按 Task 要求只跑 Storage/Project 聚焦）。
- auth-on/off 与 session 撤销仍由既有 `server/storage/host.test.ts` 覆盖同一 `resolveDataIdentity` 路径。
- 锁用例以「临时文件内容含新值」及第二次复核定位故障注入点，依赖 record-file 的原子替换步骤顺序；
  最终断言为提交前明确失败及旧值字节不变，没有独立的 count 断言。
- 未接入：文件/备份路径策略、grid、迁移、UI 与命令系统（属其它 Task）。
