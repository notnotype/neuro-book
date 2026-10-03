# Agent Command Performance

## Relative documents refs

- `docs/tasks/02-pi-agent-harness-migration/README.md`
- `docs/tasks/73-agent-session-list-performance-pagination/README.md`
- `reference/agent/sse.md`

## User Request / Topic

- `POST /api/agent/sessions/237/commands` 执行 `{"command":"plan","active":true}` 约 1.7s。
- 用户要求按系统性性能治理方案实现：轻控制 command 不再生成完整 snapshot，同时治理 relations 全局反扫和 profile catalog 热路径重复签名。

## Goal

- `plan/model/thinking/archive/compact` 这类轻控制 command 返回 live state，不补拉完整 snapshot。
- `retry/tree` 仍返回完整 snapshot；`new/fork` 返回 created session summary。
- relation 查询不再在请求内按 workspace 反扫所有 session。
- profile catalog 热路径命中内存 cache，不重复扫描 inventory 和依赖签名。
- 给 command、relations、snapshot 和 profile catalog reload 增加可追踪 timing。

## Current State

- Command API 已改为 `AgentCommandResult` 判别联合：
  - `live_state`
  - `snapshot`
  - `created_session`
- 前端统一通过 `applyCommandResult()` 应用 command 返回；`live_state` 只调用 `applyLiveState()`，不再 `syncActiveSessionSnapshot()`。
- `SessionWriteExecutor.execute()` 返回本次写入发布过的 live state，同一个 state 同时用于 SSE 和 command response；after-write observer 统一承接写入后派生缓存维护。
- relation index 在 harness 内按全局 `sessionId` 懒加载重建，并通过写入执行器 observer 统一增量维护 `agent.link.*` / `agent.detach.*` custom entries；rebuild 期间的增量会 pending replay。
- profile catalog 使用 generation-safe dirty cache：未 dirty 的 `get/resolveMany/snapshot` 直接返回内存 catalog，`invalidate()` 后旧 pending load 不允许回写 stale cache。
- HTTP runtime 默认开启 profile catalog watcher，外部编辑器、bash 或 Workbench/API 修改 profile source / helper / `.compiled` artifact 后都会标记 dirty；测试和脚本默认不开 watcher。

## Decisions / Discussion

- Breaking change：接受 command API wire shape 改动，不兼容旧第三方客户端。
- relation index 不按 `workspaceKey` 缩窄，兼容旧数据中 parent/child workspaceKey 不一致的关系。
- 完整 snapshot 仍保留 `systemPrompt` 字段。本轮只把它从轻 command 热路径移除，并用 timing 观察其成本。
- Profile catalog watcher 改为显式生命周期：`startWatching()` 只在 HTTP harness 单例中开启，`dispose()` 给测试和临时 catalog 关闭句柄；repo 内 profile 保存、创建、编译、compile-all 仍继续显式 `invalidate()`，保证同进程操作即时刷新。
- `Server-Timing` 由 Nitro `beforeResponse` plugin 统一最终写出，route 只负责收集 marks，避免 dev runtime 在 route `finally` 之后覆盖自定义 header。

## Verification / Test

- `bun test server/agent/session/write-plan.test.ts server/agent/profiles/catalog.test.ts app/components/novel-ide/agent/useAgentSessionApi.test.ts server/agent/http.test.ts`：90 pass。
- `bun test server/agent/session/write-plan.test.ts server/agent/profiles/catalog.test.ts`：69 pass，覆盖 after-write observer 失败不阻断写入、watcher 启动期 error 清理并允许重试。
- `bun test server/agent/harness/neuro-agent-harness.test.ts -t "relation index rebuild"`：2 pass，覆盖 rebuild 期间 pending link/detach replay。
- `bun test server/agent/harness/neuro-agent-harness.test.ts -t "live_state|runCommand|retry 返回 snapshot|/new 创建|手动 compact command|command 会写|relation index rebuild"`：7 pass。
- `bun test server/agent/session/write-plan.test.ts server/agent/profiles/catalog.test.ts app/components/novel-ide/agent/useAgentSessionApi.test.ts server/agent/http.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "live state|runCommand|catalog cache|resolveMany|依赖变化|write plan|分页结果|轻量关联|retry 返回 snapshot|/new 创建|手动 compact command|command 会写|关联关系|workspaceKey 不一致"`：25 pass。
- 早期 `bun --silent x tsc --noEmit --pretty false` 曾被既有 `assets/workspace/.nbook/agent/skills/llmlint/src/scanner.ts` TS2532 阻塞；Operation Timing 收尾复测已通过，见下方记录。
- `bun test server/agent/harness/neuro-agent-harness.test.ts -t "relation index rebuild|轻量关联|workspaceKey 不一致|被哪些 agent 绑定|linked agents 状态"`：主路径新增 relation 用例通过；同命令会额外带起 `product/server/...` 旧镜像测试，其中一个旧 faux provider 用例因同进程响应消耗失败，未纳入本轮判断。
- 完整 `server/agent/harness/neuro-agent-harness.test.ts` 曾运行 6 分钟超时，已停止残留测试进程；本轮以聚焦 harness 覆盖 command/relation 契约。
- 2026-06-28 Operation Timing 收尾验证：
  - `bun test server/utils/server-timing.test.ts`：2 pass。
  - `bun test server/agent/session/write-plan.test.ts`：14 pass，覆盖 executor timing seam、after-write observer 和 live state 发布顺序。
  - `bun test server/agent/http.test.ts`：21 pass，覆盖热路径 helper 继续传入 `Server-Timing` sink。
  - `bun test server/agent/harness/neuro-agent-harness.test.ts -t "command timing sink|command no-op timing|retry 返回 snapshot"`：3 pass。
  - 聚焦组合命令 `bun test server/utils/server-timing.test.ts server/agent/session/write-plan.test.ts server/agent/http.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "server timing|按顺序写入 batch|连续 savePoint|moveLeaf op|after-write observer|command timing sink|command no-op timing|retry 返回 snapshot|热路径 helper"`：14 pass。
  - `bun --silent x tsc --noEmit --pretty false`：通过。
  - 单独运行完整 `bun test server/agent/harness/neuro-agent-harness.test.ts` 300 秒超时，未得到失败用例输出；本轮以聚焦 harness 用例锁定新增 timing 契约。

## Smoke Results

- `POST /api/agent/sessions/237/commands`，body `{"command":"plan","active":true}`：
  - curl：35.487ms，HTTP 200。
  - server log：27.37ms。
  - response：`kind="live_state"`，`planModeActive=true`，无 `snapshot`。
- 同 body 再次执行幂等 no-op：
  - curl：19.705ms，HTTP 200。
  - server log：12.75ms。
  - response：`kind="live_state"`，无 `snapshot`。
- `GET /api/agent/sessions/237/relations`：
  - curl：19.824ms，HTTP 200。
  - server log：11.01ms。
- `GET /api/agent/sessions/237`：
  - curl：92.274ms，HTTP 200。
  - server log：83.88ms。
  - 一次冷/重载请求曾记录 `agent.snapshot.slow`：`snapshotSystemPrompt=2264.6ms`、`relations=4.06ms`、`total=2280.19ms`，证明原 relations 热点已移除，冷慢点转移到完整 snapshot 的 system prompt。
- 2026-06-28 后续修复 smoke：
  - 第一次请求命中 dev server 热重载：`POST /commands plan` 9839.09ms、`GET /relations` 1120.71ms，不计入热路径结论。
  - 热路径复测：`POST /commands plan` 102.56ms 后 21.94ms，均返回 `kind="live_state"` 且无 `snapshot`。
  - 热路径复测：`GET /relations` 20.58ms 后 18.16ms。
  - 热路径复测：`GET /sessions/237` 87.08ms。

## Implementation Walkthrough

- 2026-06-28：`AgentCommandResult` 改为判别联合，并同步后端 harness、HTTP API 类型和前端 composable。
- 2026-06-28：轻控制 command 返回 `live_state`；`plan` 幂等短路不追加 entry；`model` 增加等值 no-op；`thinking` no-op 返回 live state。
- 2026-06-28：`SessionWriteExecutor` 返回已发布 live states，避免 command response 再算一次。
- 2026-06-28：前端 `useAgentSession` 导出 `applyLiveState()`，`AgentChatSurface` 增加 `applyCommandResult()`。
- 2026-06-28：新增 session relation index，覆盖正向 linkedAgents、反向 linkedByAgents、detach 和重启恢复。
- 2026-06-28：profile catalog dirty cache 落地，profile source save/create/compile/compile-all 后显式 invalidate。
- 2026-06-28：新增 command/snapshot/relations/profile catalog timing 日志和慢请求阈值。
- 2026-06-28：补 tests 覆盖 live_state/snapshot/created_session、plan no-op、write executor live state 复用、relation index、profile cache 和前端 API result shape。
- 2026-06-28：`SessionWriteExecutor` 增加 after-write observer，relation index 增量维护收敛到统一写入 seam。
- 2026-06-28：relation index rebuild 期间缓存 pending relation entries，并在提交新 index 前 replay，修复首次懒加载窗口的 link/detach 漏账。
- 2026-06-28：profile catalog 增加 `catalogGeneration`，禁止旧 `loadAll()` promise 在 `invalidate()` 后回写 stale cache。
- 2026-06-28：profile catalog 增加显式 watcher 生命周期，HTTP harness 单例默认开启，测试和脚本默认不开启。
- 2026-06-28：after-write observer 改为 best-effort，派生缓存失败只写 warn，不再阻断已落盘写入和 live state 发布。
- 2026-06-28：profile watcher 启动期/运行期 error 会清理失败 watcher；启动期 error reject，后续可重新 `startWatching()`。
- 2026-06-28：`createServerTiming()` 改为把 marks 挂到 `event.context`，新增 `server/plugins/server-timing.ts` 在 Nitro `beforeResponse` 统一 flush，并保留已有 `Server-Timing` header。
- 2026-06-28：`SessionWriteExecutor.execute()` 增加可选 timing sink，`writePlan` 只包 durable append、`session_entry` publish 和 after-write observer，`liveState` 只包 live state projection 与 `session_state_changed` publish。
- 2026-06-28：command 内部 snapshot 分支改用 `buildSessionSnapshot()` 复用同一个 operation timing，`retry/tree/fallback` 的 `relations/profileRuntime/snapshotSystemPrompt` 会归入 command `total`。

## TODO / Follow-ups

- 完整 snapshot 冷路径的 `snapshotSystemPrompt` 仍可能达到 2s 级；当前它已不在轻 command 热路径，但后续若 snapshot 首屏仍慢，应单独治理 profile prompt/catalog/skills snapshot 组合成本。

## Task 106 后续演进（2026-07-15）

本任务保留 2026-06-28 的性能治理历史，但当前公开合同已继续收口：

- `retry/tree` 不再返回完整 snapshot，和其他 active-path mutation 一样返回 live state；revision 变化后由前端进入统一 recovery。
- `AgentCommandResult` 当前只保留 `live_state` 与 `created_session` 分支，不再保留 `snapshot` 分支。
- recovery 已拆除默认 System Prompt 构建，System Prompt 改为显式按需查询；前文 2 秒级 `snapshotSystemPrompt` 是旧全量 snapshot 的诊断数据。
- 当前 command/tree/invoke/abort 公开 result DTO 由 shared seam 所有，Harness 不再作为前端 wire type 来源。

前文“retry/tree 返回完整 snapshot”及相关测试名、timing 记录应按历史结果理解，不应继续作为新实现依据。
