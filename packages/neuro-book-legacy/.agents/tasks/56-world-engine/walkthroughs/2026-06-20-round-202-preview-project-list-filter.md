# Round 202: Preview Project 列表降噪与轻量加载

## 背景

P0 真实驾驶测试确认核心 World Engine 链路可用，但独立 `/world-engine.preview` 的 Project 下拉会被大量测试 Project 污染；真实环境里 `/api/projects` 返回约 342 个 Project，首屏可用时间明显变慢。用户已要求停止继续抠输入边界，本轮只处理真实作者体验中的 Project 列表卡点。

## 本轮目标

- 不改变 `/api/projects` 默认全量行为。
- 为 Preview 增加轻量 Project 列表请求：限制普通结果数量，排除已知测试 Project 前缀，并补回当前 route / preferred / selected Project。
- 补最小测试覆盖列表裁剪语义和 Preview 静态契约。

## 实际变更

- `server/utils/novel-chapter.ts`
  - `listNovels()` 增加可选 `limit`、`includeProjectPaths`、`excludeProjectPathPrefixes`。
  - 默认无过滤参数时仍走原短 TTL 缓存。
  - 有过滤参数时按 prefix 排除测试 Project，再按 limit 裁剪普通结果，最后补回 include Project；include 不占普通 limit。
- `server/api/projects/index.get.ts`
  - 读取 `limit`、`includeProjectPath`、`excludeProjectPathPrefix` query 并传给 `listNovels()`。
  - 只做轻量解析，不新增复杂校验。
- `app/pages/world-engine.preview.vue`
  - Preview 请求 `/api/projects` 时传 `limit: 80`。
  - 排除 `workspace/world-engine-test-`、`workspace/world-engine-api-test-`、`workspace/world-tools-test-`。
  - include 当前 route、preferred 和 selected Project，保证新建 Project 或 URL 指向 Project 能出现在列表中。
- `server/utils/novel-chapter.test.ts`
  - 覆盖 Preview 裁剪语义：测试 Project 被排除、普通结果受 limit 控制、当前选中 Project 被补回。
- `app/utils/world-engine-ide-entry.test.ts`
  - 钉住 Preview 使用 limit / include / exclude 参数。

## 验证

- `bunx vitest run server/utils/novel-chapter.test.ts`：通过，5 tests。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过，1 test。
- `bun run typecheck`：通过。

## 与计划出入

- 计划中提到如果 `bun run typecheck` 仍被无关 workbench mock preview 阻塞则记录；实际本轮 typecheck 已通过，没有遇到该阻塞。
- 本轮没有自动浏览器验证；仍需用户明确允许后再跑 Preview 的真实浏览器复验。

## 后续

- P1 剩余体验问题：默认 Project 名称 / slug 难读仍未处理。
- P2 append-only 分叉仍是独立大活，实施前必须先提交 Prisma schema、repository 查询与迁移计划。
