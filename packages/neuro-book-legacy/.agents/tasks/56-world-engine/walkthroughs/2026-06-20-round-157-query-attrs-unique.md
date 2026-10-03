# Round 157: queryState attrs 唯一性契约

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 154 已经收紧了 `queryState({subjectIds})`：重复 subject id 会返回 400，避免数据库 `in` 查询静默去重导致调用方误判返回数量。

继续审查查询投影数组时发现同构问题：`attrs` 允许重复路径。虽然 `projectAttrs()` 最终会把重复路径写成同一个对象属性，结果看起来“没坏”，但调用方请求 `["hp", "hp"]` 时只会得到一个 `hp` 字段；这同样是调用方输入错误，不应该静默覆盖。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `queryState()` 复用 `assertUniqueStrings()`，新增 `assertUniqueStrings(query.attrs, "attrs")`。
  - 重复属性路径返回 400：`attrs 不能重复：<attr>`。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 facade 回归测试：重复 `attrs` 被拒绝。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP `POST /state/query` 契约测试：重复 `attrs` 返回 400。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 Agent `get_world_state` 契约测试：重复 `attrs` 返回错误。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 56 tests passed
- 已通过：`bunx vitest run "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts`
  - 2 files / 28 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 86 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十七轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 `queryState(attrs)` 必须唯一。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 补充 `get_world_state.attrs` 重复属性路径会返回 400。
- `PROJECT-STATUS.md`
  - 增加 round-157 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint 或 DTO，只收紧现有查询入口的输入契约。
