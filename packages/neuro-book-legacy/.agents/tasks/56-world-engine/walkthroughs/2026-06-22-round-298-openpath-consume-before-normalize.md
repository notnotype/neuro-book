# Round 298 - OpenPath Consume Before Normalize

## 背景

继续复查上一轮 Preview Schema / Calendar 深链时，发现主 IDE 的 route 初始化顺序有一个实际断点：

`normalizeNovelRouteQuery()` 会把 URL 规范成只带 `project` 的 query。如果它先于 `consumeWorkspaceOpenPathFromRoute()` 执行，`openPath` 会在文件打开前被清掉，导致作者点击 Preview 里的 `world-engine/schema.yaml` / `world-engine/calendar.yaml` 后只进入 Project，文件不会自动打开。

## 实际变更

- `app/pages/index.vue`
  - 调整 `syncWorkspaceRoute()` 顺序：当前 workspace 已匹配 route 时，先消费 `openPath`，再规范 `project` query。
  - 调整 Project 切换完成后的顺序：先 `initializeWorkspaceFromRoute()`，再消费 `openPath`，最后规范 query。
  - 调整首次初始化顺序：workspace 初始化和默认模型同步后，先消费 `openPath`，再规范 query。
  - 保留 `consumingRouteOpenPath` 防重入锁；打开后仍删除 `openPath` query，避免重复消费。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，锁定 `consumeWorkspaceOpenPathFromRoute()` 必须早于 `normalizeNovelRouteQuery()` 出现在 route 同步关键分支里。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有新增 UI；是对 round 297 深链实现的顺序修正。
- 本轮没有自动浏览器验证，符合当前约定。
