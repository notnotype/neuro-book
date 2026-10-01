# w00017 t34：产品内置服务迁为插件

## 1. 结论与验证结果

当前结论：生命周期插件迁移、依赖图诊断、日志顺序判定和合同测试已完成；完成标准 1 已通过。完成标准 2 只有两项类型检查有完整通过证据，最后一次 `bun run typecheck` 在内存不足时被终止，不能按最终通过报告。完成标准 3 未通过：生产构建在生命周期检查前被 Product Runtime 闭包登记拒绝，因此 L1–L6 均未执行。

当前 checkout：`refactor/w00017-runtime-foundation`，HEAD `659c938d74c895636ebee0a17d1af727b9519498`；未提交、未 push、未 stash、未切换分支。`packages/neuro-book/docs/research/README.md` 是开发者已有改动，未触碰。

### 完成标准 1：测试

- 通过：`bun run test server/runtime server/features scripts/smoke/product-lifecycle/plugin-order.test.ts`。
- 结果：16 个测试文件、129 个用例通过，退出码 0。最终输出：`evidences/test-targeted.txt`。
- 该命令覆盖 `server/runtime`、`server/features`、插件顺序判定测试；中间一次恢复断言调整曾失败，随后改为按关闭报告验证每轮有进展，最终 24 个 startup 用例和最终聚焦集合均通过。证据文件保留了中间失败与最终通过输出，不能把中间失败隐去。

### 完成标准 2：类型检查

- `bun run typecheck:runtime-foundation`：通过，`tsc --noEmit -p tsconfig.runtime-foundation.json` 退出码 0。
- `bun run scripts:typecheck`：通过，`tsc --noEmit -p scripts/tsconfig.json` 退出码 0。
- `bun run typecheck`：`evidences/typecheck.txt` 中保留了一次此前完整退出码 0 的运行；但最终一次在最后恢复测试断言调整后重新运行时因系统内存不足被终止，没有完整结果。该最后结果按“未完成、未知”处理，不宣称最终全量 Nuxt 类型检查通过。
- 完整保存文件：`evidences/typecheck.txt`。

### 完成标准 3：生产生命周期 smoke

执行命令：

```text
bun run smoke:product-lifecycle -- --only L1,L2,L3,L4,L5,L6 --browser-executable /usr/bin/google-chrome-stable --report <evidence>/lifecycle-report.json
```

结果：生产构建失败，错误为：

```text
Product Runtime 可执行模块闭包不完整：
opaque dynamic import 登记数量不一致 authoring/profile-compile-worker.mjs: expected=3, actual=2
```

所以生产 smoke 没有进入产品进程，L1–L6 的报告结果全部是 `pending`，不是通过：

| 检查 | 生产 smoke 结果 | 子断言状态 |
|---|---|---|
| L1 | pending | 未执行；构建失败 |
| L2 | pending | 未执行；不能据此报告生产 `activation-order` |
| L3 | pending | 未执行；不能据此报告生产 `close-order`、排空、在途下载或退出码 |
| L4 | pending | 未执行；不能据此报告生产 `close-order`、控制停止、排空或退出码 |
| L5 | pending | 未执行 |
| L6 | pending | 未执行 |

生产 smoke 原始输出：`evidences/smoke-product-lifecycle.txt`；报告：`evidences/lifecycle-report.json`；构建细节：`evidences/product-lifecycle-build.log`。

补充的源码级真实 smoke 不替代完成标准 3，但证明了迁移后的核心路径：隔离 State Root 完成 Application State migration，六个插件真实发布，Project owner 关闭，Session Store lease 释放，真实 JSONL 的 `activation-order` 与 `close-order` 均为 `pass`。`source-lifecycle-smoke.txt` 和 `source-lifecycle-plugins.jsonl` 保存该证据。另一次真实 Project 集成 smoke 创建并打开 Project，经原有文件入口读取 `smoke.txt`，创建 Agent Harness 后完成 Project、History、Index、Session Store 关闭；证据为 `source-project-files-smoke.txt` 与 `source-project-files-plugins.jsonl`。

## 2. 最终依赖图与旧关闭清单映射

箭头方向为“提供方服务 -> 依赖者服务”。最终图与任务 A 表一致，没有增加 Storage 与 Session Store 之间的虚构排序边：

| 依赖边 | 代码依据 | 为什么成立 |
|---|---|---|
| `nbook.app-state/ready -> nbook.storage/ready` | `server/features/storage/plugin.ts:9-17` 声明 Storage 依赖 App State；`server/storage/host.ts:625-633` 的真实鉴权路径进入 `server/utils/auth.ts:1-7,122-129` 使用 Prisma；App State 释放在 `server/features/app-state/plugin.ts:27-48` checkpoint 后断开 Prisma | Storage 必须在 App State 已完成目录、完整性和迁移门禁后可用；关闭时 Storage 先于 App State 的 checkpoint/Prisma 释放 |
| `nbook.app-state/ready -> nbook.session-store/runtime` | `server/features/session-store/plugin.ts:28-35`；App State 门禁位于 `server/features/app-state/plugin.ts:55-76`，Session Store 激活在其后 | Session Store 只能在 Application State migration ready 后取得 lease |
| `nbook.session-store/runtime -> nbook.project/owner` | `server/features/project/plugin.ts:22-29` | Project 代次依赖本进程已经取得并保持的 Session Store；Project 失败时必须保留该 lease |
| `nbook.storage/ready -> nbook.project/owner` | `server/features/project/plugin.ts:22-29`；Project Storage module 在 `server/storage/project-storage-module.ts:26-44` 关闭时 revoke Project Storage scope | Project 的数据面可能持有 Storage module；Project 根和索引先收口，Storage host 后释放 |
| `nbook.session-store/runtime -> nbook.agent/ready` | `server/features/agent/plugin.ts:10-18`；`server/agent/http.ts:48-59` 的 `useAgentHarness()` 先 `requireReadyAgentSessionStore()` 后创建 Harness | Agent Harness 只能在 Session Store ready 后创建；Agent 释放先于 Session Store lease |
| `nbook.project/owner -> nbook.agent/ready` | `server/features/agent/plugin.ts:10-18`；`server/agent/harness/neuro-agent-harness.ts:71-78,794-800` 使用 Project 入口并在 dispose 中关闭事件、Job、后台任务和 Profile | Agent 排空期间仍需使用已有 Project owner；Agent 关闭完成后才允许 Project owner 根收口 |
| `nbook.project/owner -> nbook.files/workspace` | `server/features/workspace-files/plugin.ts:9-17`；`server/features/workspace-files/service.ts:38-45,69-75` 要求同代 Project handles 并读取 File Index | Files 只消费同一 Project 代次的 Index/History，不得在 Project owner 之前发布或晚于 Project 资源存活 |

产品清单在 `server/runtime/product-startup.ts:59-91` 创建六个 server 入口，`keys` 包含六个服务键，`requiredPlugins` 覆盖六个插件，`gates: []`。实际源码 smoke 的发布序列为：App State、Storage、Session Store、Project、Files、Agent；Files 与 Agent 都只依赖 Project，二者之间没有人为添加排序边。关闭序列证据为：Files、Agent、Project、Storage、Session Store、App State。

### 旧手写关闭清单的每个先后关系

旧清单是：`agent-harness -> product-runtime -> workspace-file-indexes -> storage-host -> app-sqlite-checkpoint -> app-prisma -> app-logger`。

1. `agent-harness -> product-runtime` 不再作为两个独立 shutdown step：`product-shutdown.ts:11-15` 现在只调用 `stopProductRuntime()`，`product-startup.ts:178-184` 再由同一个 `application.stop()` 发起整棵插件图关闭。Agent Harness 的释放由 `nbook.agent` service release 承担；这是一条生命周期 owner 的 clean cutover，不是新增一条伪造的插件依赖边。
2. `product-runtime -> workspace-file-indexes` 由同一个 `application.stop()` 内的 Project/Files 关闭链承担。Project plugin 的 service release 在 `server/features/project/plugin.ts:37-44` 先关闭 Project root，确认完整关闭后再调用 `closeAllWorkspaceTreeIndexes()`。
3. `workspace-file-indexes -> storage-host` 由 `nbook.storage -> nbook.project` 的反向关闭关系保证：Project 依赖 Storage，所以 Project root、Project 代次和 Index 先收口，Storage provider 后释放。
4. `storage-host -> app-sqlite-checkpoint` 由 `nbook.app-state -> nbook.storage` 的反向关闭关系保证：Storage 先释放，App State 后执行 `closeState()`。
5. `app-sqlite-checkpoint -> app-prisma` 在同一 App State release 中由 `server/features/app-state/plugin.ts:27-48` 明确保证：checkpoint 完成后才设置 `checkpointed`，随后尝试断开 Prisma；checkpoint 失败仍会尝试断开 Prisma，成功项恢复时不重复释放。
6. `app-prisma -> app-logger` 由 `server/runtime/shutdown/product-shutdown.ts:11-22` 保证：`product-runtime` step 完成或报告失败后，shutdown controller 最后执行 `app-logger` flush；shutdown 测试覆盖在途和失败时都要刷写诊断。

`application.stop()` 是关闭的发起边界，不等价于 Project owner 根已经释放。Project plugin 激活时在 `server/features/project/plugin.ts:30-35` 创建独立 `createRuntimeInstance()` 根，不挂到 entry-work 子作用域；service release 才在 `server/features/project/plugin.ts:37-44` 调用该根的 `close()`/显式恢复，并在完整关闭后关闭索引。`productProjectOwner()` 在 `server/runtime/product-startup.ts:43-56` 只返回当前 Project 代次已有 owner；Agent 排空期间允许返回已有 owner，但 Project 根开始关闭或关闭后拒绝新 owner。

### 内核显式恢复顺序问题

现象：Project child release 第一次失败后，Application root 保持 `stopping`，一次 `application.recover()` 可能只关闭 Project 代次，或只继续关闭其上游服务，返回 `incomplete(reason: "blocked")`；上游提供方需要后续显式恢复才可关闭。内核 `Scope` 的父作用域只在一次尝试中级联一次子作用域恢复，依据为 `runtime/lifecycle/scope.ts:808-815`；关闭计划对失败/受阻节点等待后续显式恢复，依据为 `runtime/lifecycle/close-plan.ts:1-6,24-26,62-117`。本任务不改内核。

复现路径：真实隔离进程先创建 Project owner 和一个会抛错的 Project child release，调用 `stopProductRuntime()`，解除故障后连续调用 `application.recover()`。`evidences/source-recovery-proof.txt` 记录：第一次恢复仍 `blocked`、Project 已 closed、Session Store/Storage/App State 仍 stopping；第二次恢复关闭 Session Store/Storage 但 App State 仍 stopping；第三次恢复才得到 `{status:"closed"}`。同一证据还记录了 8、4、2 个未关闭子作用域逐轮下降。

原测试曾要求一次 `application.recover()` 得到 `closed`。现改为 `server/runtime/product-startup.test.ts:289-340`：首次 stop 必须返回不完整，Project child 与 owner 处于 stopping，且 `stopAgentSessionStoreRuntime` 未在首次失败时调用；解除故障后每次显式恢复必须是 `blocked` 或最终 `closed`，且 `unclosedChildren` 严格减少；最终必须精确 `{status:"closed"}`，Project release 恰好重试一次、Session lease 和 Prisma 各只释放一次，重复 `stopProductRuntime()` 不产生第二次副作用。这样保留了原意“Project 根未完整关闭时不释放 Session Store lease”，同时不把内核当前的单轮级联调度误写成产品顺序合同。

## 3. 公开行为变化

### 插件清单与访问入口

- 新增六个产品 server 插件：`nbook.app-state`、`nbook.storage`、`nbook.session-store`、`nbook.project`、`nbook.agent`、既有 `nbook.files`。
- 新服务键为：`nbook.app-state/ready`、`nbook.storage/ready`、`nbook.session-store/runtime`、`nbook.project/owner`、`nbook.agent/ready`、`nbook.files/workspace`。
- 旧的本地 `agent-session-store` capability、`product-prerequisites` gate 和仅用于排序的 resolve gate 已删除；产品清单改由 `requiredPlugins` 与服务依赖图控制。
- `productRuntimeReady()`、`productProjectOwner()`、`withProductWorkspaceFiles()` 签名和现有消费者访问入口保留；消费者没有改成直接按服务键取得服务。
- `product-shutdown.ts` 的手写步骤只剩 `product-runtime` 和最后的 `app-logger`。

### 启动、租约与日志

- App State 插件负责 Workspace mkdir、State Root 完整性警告、迁移门禁，以及 checkpoint/Prisma disconnect。缺少 SQLite 文件时跳过 checkpoint，不创建空库；checkpoint 失败仍尝试断开 Prisma。
- Session Store 迁移/恢复/损坏错误按错误类型识别，保留原错误作为 `cause`，并追加 `非 Manager 启动请先执行：bun run migrate:application-state -- --apply`。启动失败优先抛出记录到的原错误；迁移门禁失败不激活 Session Store、不取得 lease，但会清理门禁前可能创建的 Prisma 资源。
- lease 失效事件和通道保持：`runtime.agentSessionStore.leaseCompromised`、`runtime.agentSessionStore.leaseObserverFailed`，仍通过 `productShutdownController.requestProcessExit(75)` 请求退出。启动门禁 fatal 事件仍为 `runtime.startup.failed`，请求退出码 1。
- 新增 JSONL 事件 `runtime.plugins.catalog`。`data` 为 `{entries: [{plugin, entry, dependencies, provides}]}`，目录记录每个 server 入口和服务键字符串。
- 新增 JSONL 事件 `runtime.plugins.diagnostic`。`data` 只写：`sequence`、`plugin`、`entry`、`generation`、`stage`、`reason`、`capability`、`contribution`、`error`。`stage` 使用 `register | activate | publish | revoke | recover | close`；日志中可观察 `activation-started`、`published`、`close-started`、`closed`。
- 日志观察者写入失败不改变生命周期状态；日志写入使用既有 `appLogger`，内核观察者异常隔离。日志解析器从目录记录推导边，不硬编码整张产品图，并在目录缺失、边集为空、代次不匹配或顺序错误时返回 `fail`。

### Worker 构建闭包取证

本任务没有修改 `scripts/build/product-runtime-islands.ts`。`evidences/worker-closure-proof.json` 对当前 Worker bundle 与“只替换回旧 `product-shutdown.ts`”的对照显示：

- 当前 bundle 有两处不透明导入：`import(A)`（运行时 artifact loader）和 `import(Xjo(A))`（相对路径扩展名重写后的 loader）。
- 旧 shutdown 对照多出一处 `import(o)`，上下文为 `app-sqlite-migrations.ts` 的 `openSqlite()`：按运行时选择 `bun:sqlite` 或 `node:sqlite`。
- 旧 Worker 到达该导入的链为：`profile-compile-worker-entry.ts:2` -> `profile-compile-worker-runtime.ts` -> `completeProfileCompilePreview()` 中动态导入 `profile-http-service`（`profile-compile-worker-runtime.ts:342-345`）-> `profile-http-service.ts:32` 导入 `product-project` -> `product-project.ts:4` 导入 `product-startup` -> 旧 `product-startup` 导入旧 `product-shutdown` -> 旧 shutdown 静态导入 `checkpointAppSqliteDatabase` -> `app-sqlite-migrations.ts:148-152` 的 `import(specifier)`。
- 因此消失的是旧手写 shutdown 直接带入的 SQLite loader opaque import，不是把闭包检查改成放宽。构建登记由主 Agent 处理；本报告不把该修复计入本任务当前改动。

## 4. 已有测试改写及原因

- `server/runtime/product-startup.test.ts`：从旧单一 capability/gate 断言改为六插件目录、服务依赖、发布顺序、逆序关闭、每代次一次 close 诊断和独立插件失败隔离；原因是生命周期 owner 已迁入插件。
- 同文件：补充 owner 在 Project 插件可用前、迁移门禁期间、停止期间和关闭后四种状态；原因是 Project 根从 Application root 改为 Project plugin generation root，且 Agent 排空需要读取已有 owner、禁止新建 owner。
- 同文件：迁移失败用例改为检查原错误对象身份、Session Store 零激活/零 lease、Prisma rollback；Session Store 特定迁移错误用例检查 `cause` 和命令提示；原因是保留旧错误合同而不按文案分支。
- 同文件：新增日志目录/诊断字段/观察者抛错隔离、Session lease 退出码 75、并发启动及重复停止用例；原因是新增公开日志行为和插件释放入口。
- 同文件：Project child release failure 测试改为显式恢复进展合同，详见第 2 节；没有放宽“不完整关闭”和 lease 保留断言。
- `server/features/app-state/plugin.test.ts`：补充缺库跳过 checkpoint 仍 disconnect，以及 checkpoint 失败仍 disconnect、显式恢复只重试失败项；原因是原 shutdown 清单中的 App State 清理合同迁移到了插件。
- `server/runtime/shutdown/product-shutdown.test.ts`：移除对已迁移资源的手写顺序 mock，改测 runtime 在途时不提前 flush、runtime 失败时仍 flush 且保留 `product-runtime` 失败身份；原因是资源顺序已经由 Application/plugin 图负责。
- `scripts/smoke/product-lifecycle/plugin-order.test.ts`：新增有效图、乱序日志、缺边、未发布、重复 close、代次错配、损坏日志等判定用例；原因是 L2/L3/L4 从固定 `pending` 改为可判定的日志合同。

## 5. 改动文件列表

### 产品代码与测试

- `packages/neuro-book/server/features/app-state/plugin.ts`
- `packages/neuro-book/server/features/app-state/plugin.test.ts`
- `packages/neuro-book/server/features/storage/plugin.ts`
- `packages/neuro-book/server/features/session-store/plugin.ts`
- `packages/neuro-book/server/features/project/plugin.ts`
- `packages/neuro-book/server/features/agent/plugin.ts`
- `packages/neuro-book/server/features/workspace-files/plugin.ts`
- `packages/neuro-book/server/runtime/product-startup.ts`
- `packages/neuro-book/server/runtime/product-startup.test.ts`
- `packages/neuro-book/server/runtime/shutdown/product-shutdown.ts`
- `packages/neuro-book/server/runtime/shutdown/product-shutdown.test.ts`
- `packages/neuro-book/scripts/smoke/product-lifecycle.ts`
- `packages/neuro-book/scripts/smoke/product-lifecycle/plugin-order.ts`
- `packages/neuro-book/scripts/smoke/product-lifecycle/plugin-order.test.ts`

### 证据

- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/test-targeted.txt`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/typecheck.txt`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/smoke-product-lifecycle.txt`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/lifecycle-report.json`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/product-lifecycle-build.log`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/source-lifecycle-smoke.txt`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/source-lifecycle-plugins.jsonl`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/source-project-files-smoke.txt`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/source-project-files-plugins.jsonl`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/source-recovery-proof.txt`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/worker-closure-proof.json`
- `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/worker-closure-proof.txt`
- 本文件：`.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/delivery.md`

未修改但在 `git status` 中作为开发者既有改动出现的文件：`packages/neuro-book/docs/research/README.md`。

## 6. 禁止清单自查

1. 不按错误文案分支：通过。App State/Session Store 使用已有错误类型和错误码；迁移提示只附加到识别出的迁移类错误。没有新增静默产品 `catch`；失败路径保留诊断或原错误。
2. 不掩盖测试/检查失败：通过。没有 `.skip`、`.only`、测试专用产品分支或放宽生产断言；生产构建闭包失败被如实报告为阻塞，L1–L6 没有伪报通过。
3. 不改任务外代码：通过。本次产品代码改动限于插件、startup/shutdown、workspace-files 依赖、生命周期 smoke 和对应测试；未触碰内核、agent/storage/database/workspace-files 实现、middleware、plugins、routes、docs 或 package 配置。`docs/research/README.md` 的已有改动保留原样。
4. 保留清理与收口：通过。App State 激活失败 rollback、checkpoint 失败后的 Prisma disconnect、Project 根未完整关闭时保留 lease、Session Store 释放失败重试和 shutdown 最后 flush 均保留；没有并列第二条生命周期路径。
5. 不跨包深导入：通过。新增导入使用已有 `nbook/...` 公开模块入口或同一应用包内部既有入口；没有跨包导入其他包源码文件。
6. 不确定时先查自然做法：通过。依赖依据、内核恢复调度、日志写入器和 Worker 闭包均先以现有实现与构建取证核对；生产构建未通过处明确交给主 Agent 处理，没有用跳过或放宽登记掩盖。

## 7. 下一个 Task：自有入口与 `nbook.http` 注意事项

1. 自有服务端入口必须接管当前 `productRuntimeReady()` 创建的同一个 Application 实例，不能并行创建第二条 Product 生命周期路径。
2. 入口与 `nbook.http` 接入时保持 `productShutdownController` 的现有停止汇合边界，先处理 signal、控制路由、Nitro close hook 和 runtime stop 的单一请求语义。
3. 关闭中的 HTTP admission/drain 与现有 `productProjectOwner()` 行为要保持一致：已有 owner 可供 Agent 排空使用，新 owner 必须拒绝；Project 根关闭完成前不得释放 Session Store lease。
4. 生产构建应使用主 Agent 已更新的 `product-runtime-islands.ts` opaque import 登记后重新执行闭包检查，再执行完整 L1–L6 smoke；不能把本次源码级 smoke 当成生产 smoke 替代。
5. 继续保留插件 JSONL 目录和诊断字段，入口层只增加停止来源与进程结果诊断，不要重新引入资源手写关闭清单。
