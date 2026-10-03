# Round 154: queryState subjectIds 唯一性契约

## 背景

本轮继续只推进后端与 API 设计，不做前端。

审查查询边界时发现：`queryState({subjectIds})` 允许传入重复 subject id。底层 `listSubjects({ids})` 会通过数据库 `in` 查询自然去重，`orderSubjects()` 也只会返回每个 subject 一次。这样调用方请求 `["erina", "erina"]` 时会得到 1 个 subject，容易误判为漏数据或顺序问题。

对 API/Agent 边界来说，重复 `subjectIds` 更像调用方错误，应该显式拒绝，而不是静默去重。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `queryState()` 新增 `assertUniqueStrings(query.subjectIds, "subjectIds")`。
  - 重复 id 返回 400：`subjectIds 不能重复：<id>`。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 facade 回归测试：重复 `subjectIds` 被拒绝。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP `POST /state/query` 契约测试：重复 `subjectIds` 返回 400。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 Agent `get_world_state` 契约测试：重复 `subjectIds` 返回错误。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - 重新编译 `world.engine` system profile artifact，避免 catalog 测试加载 stale artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 54 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 80 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十四轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 `queryState(subjectIds)` 必须唯一。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 补充 `get_world_state.subjectIds` 重复 id 会返回 400。
- `PROJECT-STATUS.md`
  - 增加 round-154 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint 或 DTO，只收紧现有查询入口的输入契约。
