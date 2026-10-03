# Round 169: sliceId 入参形状校验

## 背景

本轮继续只推进后端与 API 设计，不做前端。

前面几轮已经把 subject id、ref id、subject type、attr path 和 slice kind 的稳定形状规则逐步下沉到 service 层。继续巡检 edit/delete 路径时发现，`sliceId` 是后端生成的稳定 id，但 Facade / Agent 如果传入 `" ${sliceId} "` 会落到不存在查询，容易误报 404；HTTP path 入口还会通过 `requireSegment()` 静默 `trim()`，把 `%20...%20` 裁成真实 id。

这会让错误输入在不同入口表现不一致，也会让调用方以为“前后空白没关系”。本轮把 `editSlice` / `deleteSlice` 的 `sliceId` 入参规则收紧为：必须原样传回后端返回值，不能为空，也不能带首尾空白。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `assertSliceId(sliceId)`。
  - `editSlice(sliceId, input)` 和 `deleteSlice(sliceId)` 开头统一校验：
    - 空 id 返回 400：`sliceId 不能为空`。
    - 首尾空白返回 400：`sliceId 不能包含前后空白：...`。

- `server/api/projects/world-engine/[...segments].ts`
  - `requireSegment()` 不再返回 `value.trim()`。
  - path segment 会保留原始字符串；空白或首尾空白直接返回 400。
  - `POST /slices/:id/edit`、`DELETE /slices/:id` 和 `POST /slices/:id/delete` 因此不再静默接受 `%20...%20`。

- `server/world-engine/world-engine.facade.test.ts`
  - 在删除切面测试里补充 `editSlice()` / `deleteSlice()` 带首尾空白 id 的拒绝断言。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP edit/delete path 带 `%20${sliceId}%20` 时返回 400 的契约测试。

- `server/agent/tools/world-engine-tools.test.ts`
  - 补充 `delete_world_slice` 带首尾空白 `sliceId` 的拒绝断言。
  - 补充 `edit_world_slice` 带首尾空白 `sliceId` 的拒绝断言。

## 验证

- 已通过：`bun run test server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 115 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十九轮状态。
  - 增加 `sliceId` 入参关键决策。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 `editSlice` / `deleteSlice` facade 注释，明确 `sliceId` 必须原样传回。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 同步 `edit_world_slice` / `delete_world_slice` 的 `sliceId` 入参约束。
- `PROJECT-STATUS.md`
  - 增加 round-169 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构；只把 edit/delete 的 `sliceId` 边界行为统一为稳定业务错误。
