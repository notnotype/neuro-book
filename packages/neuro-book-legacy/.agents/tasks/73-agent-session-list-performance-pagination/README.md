# Agent Session List Performance Pagination

## User Request / Topic

- `/api/agent/sessions?profileGroup=leader&status=active&relation=all&limit=50&workspaceKey=workspace%2Fming-ding-zhi-shi-2` 稳定慢到 8s 左右。
- 需要系统性修复，而不是只对单个调用点做 hack。
- 同时给 session 列表接口增加分页，并让 `AgentSessionDialog.vue` 适配服务端查询。

## Diagnosis

- 原接口慢点不在 HTTP 传输或响应体大小，而在 `NeuroAgentHarness.listSessions()` 对每条候选 session 调完整 `resolveSessionRuntimeProjection()`。
- `resolveSessionRuntimeProjection()` 每条都会 `resolveProfileRuntime()`，而 `AgentProfileCatalog.loadAll()` 命中缓存前仍会扫描 profile inventory 并计算 dependency signature。
- 当前 system/user profile manifest dependency 数量较大，单次 catalog 缓存命中仍约 180-220ms；乘以几十条 session 后变成 8-15s。
- 直接计时显示：repo 摘要读取约 150-180ms，harness 旧列表约 14s；预热 catalog 后对 profile runtime 做 profileKey 级缓存可降到 500ms 左右。

## Design

- 新增 `AgentSessionListPageDto`：`{items,total,offset,limit,hasMore,nextOffset?}`。
- `AgentSessionListQueryDto` 增加 `offset` 和 `search`。
- HTTP `GET /api/agent/sessions` 返回 Page 对象。
- `JsonlSessionRepository.listSessions()` 支持摘要字段搜索和 offset。
- `NeuroAgentHarness.listSessionPage()` 使用轻量列表投影：
  - repo 先做 workspace/profile/relation/search 粗筛。
  - profile 可用性按唯一 profileKey 批量解析。
  - running/waiting 只做必要状态恢复，不解析完整 snapshot/system prompt/relations/settings。
  - 运行态状态过滤后再计算 `total` 并分页。
- `AgentSessionDialog.vue` 改为服务端搜索和“加载更多”分页。

## Implementation Walkthrough

- 2026-06-28：新增 `AgentSessionListPageDto`、`offset`、`search`。
- 2026-06-28：`AgentProfileCatalog.resolveMany()` 支持批量返回 loaded/missing/unloadable，避免列表按 session 重复跨 catalog seam。
- 2026-06-28：`NeuroAgentHarness.listSessionPage()` 落地，`listSessions()` 保留数组形态供内部调用。
- 2026-06-28：`useAgentSessionApi.listSessions()` 返回 Page；`AgentChatSurface` 负责分页状态和追加列表；`AgentSessionDialog` 发出服务端搜索和 load-more query。
- 2026-06-28：补 focused tests 覆盖 repo 搜索、catalog 批量解析、harness page、waiting 恢复、profile missing/unloadable 和前端 API Page 形态。
- 2026-06-28：审查后补上前端并发保护：`AgentSessionListRequestGuard` 按查询签名拒绝旧搜索、旧筛选和旧 load-more 响应，Dialog 搜索刷新增加短 debounce，避免过期响应覆盖当前列表；二次审查后追加 `signature + offset` pageKey，防止同一 load-more 页在途或已应用时重复追加。

## Verification

已执行：

- `bun test server/agent/http.test.ts server/agent/session/session-repo.test.ts server/agent/profiles/catalog.test.ts -t "listAgentSessions|session 列表支持摘要搜索|resolveMany"`：源码相关 4 pass。
- `bun test app/components/novel-ide/agent/useAgentSessionApi.test.ts`：2 pass。
- `bun test app/components/novel-ide/agent/session-list-request-guard.test.ts app/components/novel-ide/agent/useAgentSessionApi.test.ts`：5 pass。
- 源码路径 focused harness：
  - `bun test <abs>/server/agent/harness/neuro-agent-harness.test.ts -t "新 harness 能从 session active path 恢复 waiting"`：1 pass。
  - `bun test <abs>/server/agent/harness/neuro-agent-harness.test.ts -t "listSessionPage 返回分页|listSessionPage 标记缺失|缺失 profile 的历史 session|不可运行 profile 的历史 session"`：4 pass。
- `bun run typecheck`：通过。
- 真实 URL smoke：
  - 原查询增加 `offset=0` 后，dev server 热身后连续请求稳定约 `0.62-0.94s`；直接 harness 热路径约 `333-374ms`。
  - `status=waiting`：`0.90s`。
  - `status=archived`：`0.62s`。
  - `profileGroup=all&status=active`：`0.68s`。
  - `search=leader`：`0.58s`。
  - `limit=2` 响应形态确认：`total=57`、`offset=0`、`limit=2`、`hasMore=true`、`nextOffset=2`、`items.length=2`。
