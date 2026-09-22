# t28 Project 精确 ready 发布与 presence 配对 — 实施记录

状态：首轮 omp 实现记录，非最终交付证据。运行期校验、HMR 和 presence terminal 缺口在后续复核中发现，
主 Agent 的修复与最终结果见 [统一验证](leader-verification.md) 和 [前端追加修复](frontend-followup.md)。

## 基线（只读观察）

- `ReadyProjectSessionRef = {workspace, generation}`（`server/workspace-files/project-session-types.ts`）已经是运行期精确对象，
  但 `generation` 只在单个 `ProjectSessionRuntime` 内自增，**不能**直接作为跨 HMR/跨运行期可核验的公开标识。
- `server/api/projects/open.post.ts` 只返回 `opened.publication`，把 `opened.ready` 丢掉；浏览器拿不到任何服务端代次信息。
- `server/api/projects/presence.get.ts` 只带 `projectRoot`，服务端 `requireReadyProject(ref)` 再按路径查**当前** generation，
  `presence_ready` 也只回报 `projectRoot`。因此「open 到 presence 之间被 close/reopen」不会被察觉。
- 前端 `useProjectSession.ts` 的 `revision` 是 `++readyRevision` 本地计数，且 `connectPresence` 只比较 `projectRoot`。
- 已有 owner 与不变量（不改）：`project-session-runtime.ts` 独占 generation、presence 计数、latest-wins/取消/断线重连；
  `project-session-service.ts` 用 locator Map 做同 Project open 去重与 terminal gate；facade 走 `globalThis.__nbookProjectSessionV2` 保证 HMR 复用同一 Service。

## 接口选择

1. **标识归属 runtime**：`ReadyProjectSessionRef` 增加 `publicId`，由 `ProjectSessionRuntime` 在发布 ready 时签发，
   形如 `<运行期随机 id>:<generation>`。运行期随机 id 保证「新 runtime 即使 generation 从 1 开始也不认旧标识」，
   同时不公开绝对路径、物理 root identity 或锁信息。HMR 复用同一 Service 因此保留同一 owner，旧标识继续有效。
2. **不做永久 Map**：`runtime.resolveReadyProject(publicId)` 遍历当前 live sessions 精确匹配 `readyRef.publicId`，
   规模上界就是已打开 Project 数；关闭/替换后 record 移除，标识自然失效。
3. **presence 入口强制带标识**：facade 与 service 的 `acquireUserPresence` 直接改成 `(ref, publicId)`，
   不再保留「只给 projectRoot 就取当前代次」的入口。`requireReadyProject(ref)` 仍是服务端内部 strict-open 数据面入口，不在本次范围。
4. **HTTP 合同**：`POST /api/projects/open` 响应追加 `publicId`；`GET /api/projects/presence` 查询追加 `publicId`，
   `presence_ready` 帧回报同一 `publicId`。presence 查询 schema 独立于 `requireProjectRefQuery`，避免影响其它只带 `projectRoot` 的 GET。
5. **前端**：`ProjectSessionReady` 增加 `publicId`（`revision` 注释明确为 UI 发布计数）；`connectPresence` 同时校验 `projectRoot` 与 `publicId`；
   transport `stream` 增加 `publicId` 形参。SSR 分支不再返回伪造的可写 ready，改为显式拒绝。
6. **共享合同**：presence 事件类型移入 `shared/dto/project.dto.ts`，服务端推送与前端解析共用同一 schema 事实。

## 实际改动

服务端：

- `server/workspace-files/project-session-types.ts`：`ReadyProjectSessionRef.publicId`。
- `server/workspace-files/project-session-runtime.ts`：新增 `runtimeId = randomUUID()` 与 `resolveReadyProject(publicId)`；
  `publishWhenReady` 把 `publicId` 一并冻进 ready 对象。
- `server/workspace-files/project-session-service.ts`：新增 `requireReadyProjectByPublicId(ref, publicId)`；
  `acquireUserPresence` 改为按标识取得精确代次（terminal gate、entry 不匹配、未知标识一律 `ProjectNotOpenError`）。
- `server/workspace-files/project-session.ts`：facade `acquireUserPresence(ref, publicId)`。
- `server/api/projects/project-control-plane.ts`：`requireProjectReadyQuery`（`projectRoot` + `publicId`，strict；不合法 400 `INVALID_PROJECT_READY_QUERY`）。
- `server/api/projects/open.post.ts`：响应 `{...publication, publicId}`。
- `server/api/projects/presence.get.ts`：查询按标识取 presence，`presence_ready` 回报同一标识。

共享合同：

- `shared/dto/project.dto.ts`：`ProjectReadyIdDtoSchema`、open 响应 `publicId`、`ProjectPresenceReadyEventDtoSchema` /
  `ProjectPresenceHeartbeatEventDtoSchema` / `ProjectPresenceEventDto`。

前端：

- `app/composables/useProjectSession.ts`：`ProjectSessionReady.publicId`；`transport.stream(projectRoot, publicId, ...)`；
  `connectPresence` 同时校验根与标识；ready 只带 open 发布的标识；
  `beginOpen` 去掉预先伪造的 ready 占位 Promise；SSR 分支 `open` 显式拒绝而不是伪造可写就绪；
  实际请求 URL 由 `new URLSearchParams({projectRoot, publicId})` 生成。

测试：

- 新增 `server/api/projects/project-ready-publication.contract.test.ts`：真实 H3 `createApp` + `toNodeListener` 跑
  **真实 open/presence handler**（非 `doMock` 桩）、真实 SSE 与真实 Facade，覆盖标识一致、缺标识 400、未命中 409、
  close/reopen 之间旧标识 409、同路径目录替换后旧标识 409。
- `open.post.test.ts` / `presence.get.test.ts`：断言响应与 presence 推送携带标识，且 presence 按标识调用 `acquireUserPresence`。
- `project-session.test.ts`：新增「close/reopen 后旧标识不能取得新 generation 的 presence」；
  既有 presence 用例改为传 ready 标识。
- `project-session-service.test.ts`：新增「ready 标识只在签发它的运行期与 Project 上解析」（跨 Project + 跨 Runtime 同 generation 数字）
  与「根替换与 terminal gate 后旧 ready 标识不再解析，重新 open 得到新标识」。
- `project.dto.test.ts`：open 响应强制 `publicId`、presence 事件强制回报同一标识且拒绝多余字段。
- `useProjectSession.test.ts`：新增「presence_ready 携带不同 ready 标识时不发布 ready」；既有 ready 断言补 `publicId`；
  transport 桩按新签名回传标识。
- 受影响 fixture 补 `publicId`：`app/utils/project-route-progress.test.ts`、
  `server/agent/profiles/test/runtime-session.ts`、`server/agent/context-access/profile-context-access.test.ts`、
  `server/agent/tools/workflow-tools.test.ts`、`server/agent/variables/profile-registry.test.ts`、
  `server/agent/variables/variables.test.ts`、`server/agent/workflow/workflow-job.test.ts`。

## 命令与结果

| 命令 | 结果 |
|---|---|
| `bun run typecheck`（packages/neuro-book） | 退出 0，零错误（首次运行暴露 6 个测试 fixture 缺 `publicId`，补齐后复跑仍为零错误） |
| `bun run test server/api/projects server/plugins/project-session-close.test.ts server/workspace-files/project-session.test.ts server/workspace-files/project-session-service.test.ts` | 18 files / 101 tests 通过 |
| `bun run test server/workspace-files/project-session-runtime.test.ts server/workspace-files/project-session-hmr.test.ts shared/dto/project.dto.test.ts app/composables/useProjectSession.test.ts app/utils/project-route-progress.test.ts` | 通过（含真实 H3 合同 4 项） |
| `bun run test server/agent/context-access/profile-context-access.test.ts server/agent/tools/workflow-tools.test.ts server/agent/variables/profile-registry.test.ts server/agent/variables/variables.test.ts server/agent/workflow/workflow-job.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/project-route-transition.contract.test.ts` | 40 tests 通过 |
| `git diff --check` | 无空白错误（仅既有 CRLF 提示） |

未运行：`server/agent/harness/neuro-agent-harness.test.ts` 等 Agent 业务全集（本 Task 未改变其消费的 `requireReadyProject` 语义，
新增 `publicId` 为必填字段，受影响 fixture 已补齐）；浏览器人工验收（本 Task 不涉及 UI 表面）；`scripts:typecheck`（已知 `scripts/deploy/product-agent-state-root-smoke.ts:318` 存量错误，不扩大修复）。

一个观察：`server/api/projects/open.post.test.ts` 在全量并行下曾超 5s 的默认超时（单独运行 4.5s 内通过），是既有的冷启动开销，与本轮改动无关。

## 与约束的对照

- **旧 open 到新 presence 之间的 close/reopen 必须拒绝**：真实 H3 合同用例在 `closeProject` 后请求旧标识得到 409。
- **取消/最新-win/断线重连/send-before-push/release 只释放本标签 presence**：未改动这些拥有者；presence route 的 push 顺序与 release 语义原样保留，聚焦测试继续通过。
- **不新增无界的全局当前项目**：标识解析只遍历 runtime 的 live sessions，没有第二张永久 Map。
- **SSR 不伪造可写就绪**：SSR 分支 `open` 改为拒绝。
- **不留静默降级到路径的兼容入口**：facade/service 的 `acquireUserPresence` 签名已强制要求标识。

## 留给下一增量

`ProjectSessionService.requireReadyProjectByPublicId(ref, publicId)` 已经能把浏览器持有的标识解析成精确 `ReadyProjectSessionRef`，
但 facade（`server/workspace-files/project-session.ts`）还没有对外的同名入口，因为本轮没有消费者。
下一增量接线 Project Storage 时，需要在该 facade 加一个薄入口，并在 `server/api/projects/*` 增加携带标识的请求入口，
再以该精确 ready 调用 `activateReadyProjectModule` 与 `runReadyProjectOperation`；本轮刻意不提前激活 Storage module、不提高 required ready 门禁。
