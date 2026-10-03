# Round 164: queryState scope guard 下沉到 service

## 背景

本轮继续只推进后端与 API 设计，不做前端。

`queryState` 的定位是 Agent / 常规业务使用的收窄查询；`getWorldState` 才是 UI / 调试 / 导出使用的全量入口。HTTP `POST /state/query` 和 Agent `get_world_state` 已经要求必须提供 `subjectIds` 或 `type`，避免向调用方倾倒全量世界状态。

继续审查时发现，Facade / service 直调 `queryState(projectPath, {})` 仍会全量 reduce。这与“queryState 是收窄查询、getWorldState 是全量入口”的边界不一致，也让内部业务代码有机会绕开 HTTP / Agent 已有的防倾倒规则。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `assertQueryScope(query)`。
  - `queryState()` 在校验 `subjectIds`、`attrs`、`type` 后，要求必须提供 `subjectIds` 或 `type`。
  - 未提供时返回 400：`queryState 必须提供 subjectIds 或 type`。
  - `getWorldState()` 保持不变，继续作为全量世界状态入口。

- `server/world-engine/world-engine.facade.test.ts`
  - 在缺失 subjectIds 查询回归中补 `facade.queryState(projectPath, {})` 拒绝断言。
  - 同一测试确认 `facade.getWorldState(projectPath)` 仍可返回全量 subject，避免误伤 UI / 调试 / 导出路径。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 101 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十四轮状态。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 删除“Facade 内部都省略时可全量 reduce”的旧留口。
  - 明确 `queryState` 必须提供 `subjectIds` 或 `type`，全量世界状态统一走 `getWorldState`。
- `PROJECT-STATUS.md`
  - 增加 round-164 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构，只把既有 HTTP / Agent 防倾倒规则下沉到 service。
- 调研时用 `rg` 检查了生产调用，未发现依赖裸 `queryState({})` 的路径；全量状态需求继续由 `getWorldState()` 承担。
