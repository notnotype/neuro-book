# t34 最终增量复核：关停排空、异步 guard 与 V4 槽

结论：**建议合并**（新增两项修复与对应测试成立，t30 原接口自洽；遗留见文末，均不阻断）。

基线 `0d66064b`（HEAD 未变，t30 改动全在工作树）。只读审查，未改被审代码、Spec 或 Task。
首轮报告 `review.md` 保留，本文件只覆盖本次增量与核对点 1–5，不重复旧审查表。

## 独立复现（本次实跑，不采信自述）

| 命令（cwd `packages/neuro-book`） | 结果 |
| --- | --- |
| `bunx vitest run server/storage/project-scope.test.ts server/storage/storage-core-regression.test.ts` | 2 文件 24 通过 |
| `bunx vitest run server/storage/storage-core-regression.test.ts server/storage/project-scope.test.ts server/workspace-files/project-session-hmr.test.ts server/workspace-files/project-session-service.test.ts server/workspace-files/project-lifecycle.test.ts` | 5 文件 **150 通过 / 1 跳过** |

按 Task 要求未跑完整 28 文件集、未跑 typecheck（主 Agent 统一）、未跑浏览器。

## 五项核对

**1. `StorageMutationGuard` 可异步：满足。**
类型为 `() => void | Promise<void>`（`partition-store.ts:134`），核心只有一个漏斗 `assertMutationHealthy`
（`partition-store.ts:707-712`）：`await guard → await assertContained → lock.assertHealthy → await guard →
lock.assertHealthy`。最后一段同步锁检查确实存在，且在**最后一个 await 之后**；
授权同步核验排在异步物理复核之后（见第 2 点）。文件层所有真实副作用点都在 await 的 `beforeWrite` 之后
（`record-file.ts:109,111,114,132,181,206,209,213,236`），无绕过路径。

新增用例 `storage-core-regression.test.ts:243` 用**真实文件 + 真实 `proper-lockfile`**：用可控 guard 在
第 2 次复核时触发 `onCompromised`，断言 `STORAGE_LOCK_UNAVAILABLE / committed:false`、目标文件**字节不变**、
重读仍为旧值 4。该断言具备判别力 [INFERENCE]：去掉末尾同步锁检查则 `replace` 会先落盘，字节断言与
`committed:false` 都会失败（我未改动被审代码做负向对照，此处为从代码路径推断；Tasker 自述的负向对照结论与之吻合）。

**2. project action 每副作用复核 data 与 Project 物理根：满足。**
`host.ts:219-231`：`revalidateTarget`（异步）→ `assertDataRootIdentity`（异步）→ `assertLive`（同步）→
`assertTarget`（同步）。data 物理根按 `captureStorageRootIdentity` 重算摘要比对（`host.ts:267-285`），
不采信 `identity.json` 字符串。守卫不看 closing 状态，普通关闭仍允许已接纳操作排空（核对点 3）。

真实 HTTP + 真实 fs 证据（`project-scope.test.ts`）：
- `:409` 复制同一份 `identity.json` 重建 data 根 → 403 `claims-mismatch`；
- `:429` 等 Storage 锁期间重建 data 根 → 已接纳保存停在副作用前，**原记录字节不变**；
- `:499` 等锁期间 `root-replaced` 终止 → 403，记录文件 `ENOENT`（未写任何分区）；
- `:333` 普通关闭先等已接纳保存 200 收口，再失效上下文（关闭后迟到请求 403）。

**3. Project 整体 shutdown：满足。**
- Service 侧：`projectTargetGuard` 已只走 `assertProjectTargetIdentity`（`project-session-service.ts:642-670`），
  只判 `entries.get(locator) === entry`、`entry.ready === ready`、`entry.targetInvalid` 与
  `runtime.assertProjectOperationTarget`（精确世代 + `targetInvalid` + `occupancy.assertHealthy()`），
  **不再要求 `state === "running"`**；新操作仍由入口 gate（`state !== "running"` 与 `terminalGates`）拒绝。
- Lifecycle 侧：`revalidateWorkspace` 去掉 `assertRunning()`（`project-lifecycle.ts:696-698`）。
  这不是把检查变成空操作：`ProjectRootIdentityModule.revalidate`（`project-root-identity.ts:124-146`）
  仍按 WeakMap fingerprint + 真实 `inspect` 复核，close 不清空该表。
- 证据不是只用 stub：`project-lifecycle.test.ts:3700` 用**真实 Lifecycle + 真实目录**断言 close 之后
  `readProjects()` 仍以 `PROJECT_LIFECYCLE_CLOSED` 拒绝（证明 `lifecycleState !== running`，即旧
  `assertRunning()` 会在这里抛），而 `revalidateWorkspace` 解析成功。Service 侧
  `project-session-service.test.ts:729` 用受控 Lifecycle 断言 shutdown 排空时 `drained` 被调用、
  `lifecycle.revalidateWorkspace` 被通知；`:667` 断言 watcher 未回调时只有 `revalidateTarget` 能停写，
  且普通关闭仍允许收口。两层合起来覆盖「真实 Lifecycle 关闭后仍可只读复核」。
- 替换/锁失效仍拒：`targetInvalid` 由 `root-replaced` / `lock-compromised` 置位（`project-session-runtime.ts`
  `closeProjectAt` 路径），同步 guard 与 Runtime 判定都读它。

**4. 项目 V4 槽（Facade 与 Storage host）：满足。**
`project-session.ts:155-197` `createHandoffState`：先停旧维护定时器、`closeAll()` 旧的 V2/V3 Service
（不原地复用旧实例），**继承 `previousV3.previousClose` 整条链**并纳入新 owner 的 `previousClose` 门
（`withProjectService` 在取得任何 Occupancy 前等待它），探针按对象身份承接而不是让 Facade 重建在场状态。
`project-session-hmr.test.ts` 用**逐字段声明的真实 V3 形状**（含 `previousClose/epoch/closing/...`）；
用例覆盖：真实旧 Service 排空后旧 publicId 在新 owner 不解析且旧实例抛 typed `PROJECT_SESSION_RUNTIME_CLOSED`、继承
`previousClose` 未完成前不取得 Occupancy、V2/V3 关闭失败（同步抛与 reject 两种）都 fail closed 且
`closeAllProjects` 继续以同一失败拒绝、同版重载复用同一 owner 与 ready 对象。
Storage host 侧 V3 槽按真实形状声明（`host.ts:97-115`），`closePreviousSlot` 按 `"accessContexts" in slot`
分派（`:128-137`），V3 的 `registry`（`StorageStateRegistry`，无 `close()`）不再被调用；
`storage-host-hmr.test.ts` 的 fixture 与之一致（真实 `StorageStateRegistry`），关闭失败用例断言新 owner
HTTP 500 而非静默开工，同版重载复用同一 owner。

**5. 测试真实性与「坏行为变预期」：满足。**
新增用例都用真实 I/O 或明确门控（真实 `proper-lockfile`、真实 fs、真实 Lifecycle/Occupancy、真实 Node HTTP），
没有用最小形状 stub 掩盖升级差异（HMR 测试显式声明完整旧槽字段）。对比 `0d66064b` 的测试 diff 只做形状重命名
与新增（`git diff 0d66064b -- <test files> | grep '^-'` 只剩上一轮的 `PreviousStorageHostState`→V2 等改名），
没有把断言放宽或改写成既有行为。`final-validation.md` 第 3 条对 V3 的历史描述已按基线校正：基线 Service
确实已有 `requireReadyProjectByPublicId`（`git show 0d66064b:.../project-session-service.ts:410`），
缺的是 Facade 导出、`revalidateReadyProject`/写入目标核验与 Storage lazy Module 登记——注释现在与基线一致。

## 遗留（不阻断本次合并）

- **W-3 续（证据上限）**：Project **根**的物理替换仍无真实用例（Windows 下 SQLite 句柄占用使整根 rename 不稳定，
  followup 已披露）。现有替代证据为：Project Storage 根真实 `rm + mkdir`（`project-scope.test.ts:303`）、
  data 根真实 `rm + mkdir`（`:409`）、`closeProject(..., "root-replaced")` 合同路径（`:499`）以及
  `project-root-identity.test.ts:25-33` 的真实 rename 替换检测。核对点 3 的口径（不得只靠直接 close 替代**所有**
  物理根证据）已满足，但「Project 根」这一层的实时替换窗口在真实环境下仍未端到端复现。
- **W-1 续（窗口）**：watcher 未置位期间的窗口已由 `revalidateTarget` 的物理复核覆盖到「复核返回为止」；
  复核返回后到真实 `replace` 之间是同步段（无 await），无法进一步缩短。[INFERENCE]
  首轮建议的 Spec/README 明确「停写以观察到的替换为准」仍未写入，属文档补齐，不阻断。
- **W-2 续**：已打开 generation 的 `lazyModules` 是不可变快照，HMR 新增 storage lazy Module 后老 generation
  签发 storage 会以非 typed `Error("Project lazy Module未注册：storage")` 失败并投影 500；仅 dev HMR 可达，
  失败方向安全，但「必须重开 Project」这条边界仍未写进注释/README。
- **性能观察（非本轮引入）**：`assertMutationHealthy` 每次调用执行两轮 guard，而 host 的 guard 每轮含一次
  Lifecycle 根物理 inspect 与一次 data 根 stat；一次记录保存的 `beforeWrite` 最多 4 次，即最多 8 轮物理复核。
  正确性无损，但未来可合并为一轮（先做完异步复核再统一同步收口）。非阻断。
- 未验证项（证据限制）：未跑完整 28 文件集与 `bun run typecheck`（按 Task 交主 Agent 统一）；未跑浏览器；
  未跑 project 路径的真实 auth-on/off 与 session 撤销 HTTP（延续首轮 W-4）。
