# t29 Project 精确 ready 与 presence 独立审查

状态：审查完成。
结论：**建议合并**。

审查对象：worktree 相对 `42d65b7c` 的 t28 改动（30 文件，其中 2 个 workbench descriptors 为用户既有 dirty，已排除）。
审查方式：只读核对 diff、源码与测试，并跑聚焦小探针；未改源码、Spec 或 Task。

## 1. diff 与范围一致性

| 项 | 结论 |
|---|---|
| 生产改动文件 | `server/workspace-files/project-session{-types,-runtime,-service,}.ts`、`server/api/projects/{project-control-plane,open.post,presence.get}.ts`、`shared/dto/project.dto.ts`、`app/composables/useProjectSession.ts`、`sqlite-handle-release.ts`、`vitest.config.ts` |
| 非目标 | 未触碰 Storage Project 值动作、lazy module、文件/备份、UI 布局、迁移、标题栏、命令系统；`requireReadyProject(ref)` 仍是 strict-open 数据面入口，未改语义 |
| 两个 descriptors | `app/utils/workbench/descriptors{,test}.ts` 的 diff 是 stateScope/session 域清理，与 t28 无关，按 Task 说明排除 |

## 2. 逐项核对重点

### 2.1 publicId 由 Runtime 签发并绑定精确 ready 对象 —— 通过

- `ProjectSessionRuntime` 新增 `runtimeId = randomUUID()`，`publishWhenReady` 冻结 `publicId = ${runtimeId}:${generation}`（`project-session-runtime.ts:733-737`）。
- `resolveReadyProject(publicId)` 只遍历 `this.sessions` 的 live record 且要求 `state === "ready"`；不新增永久 Map，作用域上界为已打开 Project 数。
- `ProjectSessionService.requireReadyProjectByPublicId` 另做 entry 绑定（`entry.ready !== ready`）与 `terminalGates` 检查，并复跑 `runtime.requireReadyProject`（含 occupancy health）；失败统一 `ProjectNotOpenError`（HTTP 409）。
- 未知标识、跨 Project、跨 Runtime 同 generation 数字、终止代次、同路径目录替换：分别由 `project-session-service.test.ts` 的两个新用例、`project-session.test.ts` 的 close/reopen 用例与真实 H3 合同用例覆盖。

### 2.2 presence 必须在同一标识下配对，端点不按路径重求代次 —— 通过

- `presence.get.ts` 改为 `requireProjectReadyQuery`（`projectRoot` + `publicId`，`.strict()`，非法 400 `INVALID_PROJECT_READY_QUERY`），`presence_ready` 回报同一 `publicId`。
- `open.post.ts` 返回 `{...opened.publication, publicId: opened.ready.publicId}`；`publication` 类型仍是 `ProjectEnsureResult`，未引入类型空转。
- 调用方已完整切换：grep `acquireUserPresence` 覆盖的 facade/service/runtime/路由/测试全部传 `publicId`；facade 与 service 未保留「只给 projectRoot 取当前代次」的兼容入口，无静默降级。

### 2.3 控制器运行期校验与失败路径 —— 通过

- transport 返回值与事件按 `unknown` 接收，在 controller 边界用既有 DTO schema 验证；缺/空/非字符串 `publicId`、open 响应 root 不匹配都会失败且不发起 presence。
- `beginOpen` 先建 owner 再以 `Promise.resolve().then(...)` 启动网络：`transport.open` / `transport.stream` 同步抛错均进入 `failed`，重试可成功。
- ready 首帧与 release 同轮到达时，失败/取消分支先 `abort` 再 `await current.presence.completion`，旧 owner 不提前释放；`release()` 等待 `pending.promise` 与已连流退出。
- `ProjectPresenceEventDto` 从 facade 移到 `shared/dto`，服务端推送与前端解析共用同一 schema 事实；heartbeat 先判、`.strict()` 拒绝多余字段。
- SSR 分支由「伪造 `revision:0` 可写 ready」改为显式拒绝；已确认唯一消费者 `app/pages/index.vue` 的 route sync 受 `initialized`（`onMounted` 内置真）保护，SSR 不会走到 `open`，不产生 SSR 500。

### 2.4 presence 租约属于 Runtime：首帧前、活跃连接、终止窗口 —— 通过

- `acquireUserPresence` 返回 `{signal: record.controller.signal, release}`；`closeProjectAt` 在同步进入 `closing` 时 `controller.abort(...)`，故 close/reopen、root 替换、lock compromised、shutdown 与 Module 数据面共享同一终止边界。
- `presence.get.ts`：首帧前已 abort 则不发布 ready 并直接收流；活跃连接 abort 时 `cleanup()` + `eventStream.close()`，心跳定时器回收；`cleanup` 以 `streamClosed` 守卫幂等。
- 真实 H3 合同用例在 `closeProject` 后 `reader.read()` 解析为 `{value: undefined, done: true}`，可观察 EOF，不依赖下次心跳。

### 2.5 V2→V3 HMR 交接 —— 通过

- global 槽由 `__nbookProjectSessionV2` 换为 V3；`createHandoffState(previous)` 清旧维护定时器并 `closeAll()` 旧 Service，旧 owner 的 close 结果作为 `previousClose` 保留。
- `withProjectService` 在取得任何 Occupancy 前 await `previousClose`，并在 await 后复检 `closing`/`epoch`：排空未完成时新 owner 不启动；同步抛错与异步拒绝都被保留并阻断（`旧 owner 关闭失败后阻止新 owner，同步抛错=%s` 两例）。
- `closeAllProjects` 建立同步 gate、递增 epoch、`Promise.all([service?.closeAll(), previousClose])`，交接中的 shutdown 不会提前完成；待交接 open 因 epoch 变化被拒，不会在关闭后复活。
- 同版 V3 reload 复用同一 `globalState`：`同版 HMR 保留 ready 对象与 presence owner` 断言 `secondReady === firstReady`、owner 对象不变、旧 presence release 后 `userConnections === 1`。
- `换代保留 Agent 在场探针` 覆盖 probe 承接，避免运行中 invocation 被 grace 误回收。

### 2.6 SQLite GC helper 重载 —— 通过

- `sqlite-handle-release.ts`：`--expose_gc` 只在进程标记未置时设置，但 `vm.runInNewContext("gc")` 每次都重新取得 collector（进程标记不再短路模块缓存）。
- `sqlite-handle-release.test.ts` 断言重载后 `collect` 调用两次、`expose` 只调用一次——修复前该用例会失败，是有效回归。
- 未发现残留 DEBUG / `console.log`。

## 3. 实际运行的聚焦探针（本审查执行）

| 命令（cwd：`packages/neuro-book`） | 结果 |
|---|---|
| `bun run test server/api/projects/project-ready-publication.contract.test.ts server/workspace-files/sqlite-handle-release.test.ts` | 2 文件 / 6 用例通过 |
| `bun run test server/workspace-files/project-session-hmr.test.ts` | 1 文件 / 7 用例通过 |
| `bun run test app/composables/useProjectSession.test.ts server/api/projects/presence.get.test.ts server/workspace-files/project-session.test.ts server/workspace-files/project-session-service.test.ts shared/dto/project.dto.test.ts` | 5 文件 / 65 用例通过 |
| `bun run test app/utils/project-route-progress.test.ts app/utils/project-route-transition.contract.test.ts` | 2 文件 / 12 用例通过 |
| `bun run test app/utils/world-engine-ide-entry.test.ts server/api/projects/presence.get.test.ts server/api/projects/open.post.test.ts` | 3 文件 / 6 用例通过 |

`vitest.config.ts` 已补登 `app/utils/project-route-progress.test.ts` 与 `app/utils/project-route-transition.contract.test.ts`；这两份文件此前 tracked 但未进 include，属真实被静默跳过，已核实登记后可通过。

## 4. 未运行 / 未覆盖项（如实披露）

- 未重跑主应用完整 30 文件 215 用例与 `bun run typecheck`（Task 指定不再重复；依赖 `leader-verification.md` 的 exit 0 记录，本轮未独立复现）。
- 未做浏览器人工验收（本增量不改 UI 表面、Project Storage 未接入）。
- 未跑 `scripts:typecheck`（既有 `scripts/deploy/product-agent-state-root-smoke.ts:318` 存量错误，按 Task 不扩大修复）。
- 被改写的 `project-session-hmr.test.ts` 不再断言 `createProjectHttpError` 对 `PROJECT_NOT_OPEN` / `PROJECT_NOT_FOUND` / `PROJECT_IN_USE` 的旧 typed error 映射；已确认这些映射由 `server/api/projects/project-http-error.test.ts` 独立覆盖，不构成覆盖缺口。

## 5. 非阻断观察（不影响合并）

1. **交接失败后不可原地恢复。** `previousClose` 一旦拒绝，`withProjectService` 会持续拒绝，直到 `resetProjectSessionsForTest`（仅测试）或进程重启；新 owner 没有可重试旧 owner `closeAll()` 的入口。这是 Task 明确要求的「排空失败必须阻断新 owner」的 fail-closed 结果，且用例已固化，但 dev HMR 下若旧 owner 关闭出现瞬时失败，Project 打开会一直 409/503 直至重启 dev server。建议在后续增量评估是否保留旧 service 引用以便有限重试，不在本轮修。
2. **publicId 尚未绑定主体与客户端。** 这是 t28 明确声明的非目标（下一步 Project Storage 才做身份签发与 lazy module）。当前 publicId 只作代次定位，且不越过硬 open 数据面鉴权，未发现由此产生的权限提升；后续增量接入 Storage 时须按计划把有效性与主体/客户端核验纳入访问上下文。
3. `next` 增量入口仍是 `ProjectSessionService.requireReadyProjectByPublicId`；facade 尚无对外同名薄入口（本轮无消费者，刻意为之下沉），与 implementation.md「留给下一增量」一致。
