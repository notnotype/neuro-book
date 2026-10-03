# Round 172: HTTP query 参数拒绝重复值数组

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 171 已让 World Engine HTTP query 参数不再静默 `trim()`。继续审查同一段 query reader 时发现，`getQuery(event)[key]` 如果是数组（例如重复 query：`?type=character&type=item`），`readOptionalStringQuery()` 会因为它不是 string 而返回 `undefined`。

这会把本应是非法的重复 query 静默解释成“未传参数”：

- `GET /subjects?type=character&type=item` 可能扩大为列出所有 subject。
- `GET /slices?limit=1&limit=2` 可能忽略 limit。
- `GET /state?at=...&at=...` 可能忽略查询时刻。

本轮把 World Engine HTTP query 参数收紧为单值语义：重复 query 形成数组时返回 400。

## 实现

- `server/api/projects/world-engine/[...segments].ts`
  - `readOptionalStringQuery()` 现在先检查 `Array.isArray(value)`。
  - 数组值返回 400：`${key} 只能传一个值`。
  - 正常单字符串和空字符串语义保持 round-171 规则：`""` 视为未传，非空字符串原样进入后续校验。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 `HTTP query 参数拒绝重复值数组` 回归测试，覆盖：
    - `GET /subjects?type=[...]`。
    - `GET /slices?limit=[...]`。
    - `GET /slices?withMutations=[...]`。
    - `GET /state?at=[...]`。

## 验证

- 已通过：`bun run test server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 117 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百七十二轮状态。
  - 在 Decisions 的 HTTP query 参数契约中补充重复 query 数组值返回 400。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 HTTP query 参数单值契约。
- `PROJECT-STATUS.md`
  - 增加 round-172 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 或 Agent 工具 schema；只收紧 HTTP query 参数解析边界，避免重复 query 被静默忽略。
