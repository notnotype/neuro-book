# Task 83 Project List Performance

> 当前合同已由 Task 118 的轻量 Project Lifecycle snapshot 取代。本文件保留历史性能诊断与当时的统计缓存方案，不能作为当前 `/api/projects` 行为的说明。

## Summary

- 目标：治理 `/api/projects?includeProjectPath=...` 首慢与热路径慢问题，不改变 HTTP DTO。
- 根因：`includeProjectPath` 被当成列表过滤参数，导致 Novel IDE 主入口绕过 `/api/projects` 默认 5s 短缓存；接口内部还会全量读 Project manifest、Agent sessions，并计算每个返回 Project 的 workspace tree / plot 统计。
- 决策：项目列表统计允许沿用 5s 短暂陈旧语义；需要实时树数据的编辑器继续走 workspace tree 专用 API。

## Diagnosis

- 无参数 `/api/projects` 首次约 1035ms，热请求约 12-17ms。
- `includeProjectPath=workspace/shi-jie-yin-qing-shou-dong-ce-shi` 首次约 774ms，热请求仍约 500ms。
- `limit=20` 热请求约 550-630ms。
- 拆段观察：
  - `listProjectWorkspaces()` 约 10-20ms。
  - `JsonlSessionRepository.listSessions(active)` 约 150ms，当前 active sessions 约 236。
  - 单个目标 Project `readProjectWorkspaceTreeSnapshot()` 冷路径约 314ms，热路径约 0ms。
  - 12 个 Project 的 workspace tree cold 总计约 7792ms，其中几个大项目占主要成本。
  - Plot SQLite 统计较轻，12 个 Project 总计约 16ms。

## Implementation

- `includeProjectPath` only 不再视为特殊列表查询；在没有 `limit/excludeProjectPathPrefix` 时等价于完整 `/api/projects`，直接共享默认完整列表缓存。
- `listNovels()` 拆成三层 5s 短缓存：
  - Project manifest list cache。
  - Agent session count map cache。
  - projectPath 级 workspace/plot statistics cache，并带 in-flight promise 去重。
- Preview 类查询仍保留 `limit + includeProjectPath + excludeProjectPathPrefix` 语义：先过滤/补回可见 Project，再只计算可见 Project 的统计。
- `invalidateNovelListCache()` 统一清空完整列表、manifest、session count、per-project stats 和 pending promise。
- `/api/projects` 接入 `Server-Timing`：`projects.manifests`、`projects.sessions`、`projects.filter`、`projects.stats.workspace`、`projects.stats.plot`、`projects.total`。
- `Server-Timing` 的 `dur` 统一按 wall-clock 理解；并发 Project stats 不再把每个 Project 的耗时相加。
- 等待 in-flight cache 的请求会显式记录 pending mark，例如 `projects.pending.fullList`、`projects.stats.pending`，避免慢请求只剩 `projects.total`。
- `Server-Timing` flush 会合并 Nuxt dev runtime 在 `res.end` 前晚写入的内置 timing，避免自定义 `projects.*` marks 被覆盖。
- 慢请求阈值为 500ms，写 `projects.list.slow`，记录 query shape、Project 数量、visible 数量和缓存命中摘要。
- 新增 Nitro 启动预热插件，启动后后台渐进预热 manifest、session count 与 per-project stats 子缓存；不占用默认完整列表 pending promise，避免首个真实请求被后台全量预热捆住。失败只 warn，不影响服务启动。
- Novel IDE 主入口和新建 Project 后刷新不再发送 include-only query；World Engine preview 继续保留有限列表 + 当前选择补回的查询形态。

## Verification

- 已跑：
  - `bunx vitest run server/api/projects/index.get.test.ts server/utils/server-timing.test.ts server/utils/novel-chapter.test.ts app/stores/novel-ide.test.ts app/utils/world-engine-ide-entry.test.ts --testTimeout=120000`
  - `bun run typecheck`
- 结果：5 files / 19 tests passed；typecheck passed。
- 直接调用 smoke：
  - cold default：约 14.5s，`projects.stats.workspace` 约 14.3s，真实 workspace 冷 tree index 仍重但分段不再误报为 100s 级累计工作量。
  - hot default：约 0ms。
  - hot include-only：约 0ms。
  - hot limit=20：约 0ms。
  - concurrent pending join：第二个默认列表请求约 339ms，包含 `projects.pending.fullList` 与标准 0ms 分段。
- HTTP smoke 记录：原 `localhost:3000` dev server 在本轮热重载后整体不响应，未强杀用户进程；临时 3100 dev server 冷启动期间前两次请求撞到构建窗口返回 500，后续 route 可进入但冷 stats 仍受真实 workspace tree index 影响。稳定 HTTP 复测建议在用户重启 dev server 后执行。

## Follow-ups

- 若 Project 数增长到上百且 5s 短缓存仍不足，再考虑持久化 Project stats 索引。
- 本轮不做持久化索引，避免为当前规模引入过重复杂度。
