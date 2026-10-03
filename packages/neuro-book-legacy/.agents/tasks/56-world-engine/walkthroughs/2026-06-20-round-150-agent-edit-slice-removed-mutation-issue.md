# Round 150: Agent edit_world_slice 删除旧 mutation 的 issue 契约测试

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 148 修复了 `editSlice` 删除旧绝对 mutation 时的 A issue 漏报，Round 149 补了 HTTP API 契约测试。继续审查对外边界时发现，Agent 工具层还没有测试覆盖同一语义。World Engine 第一版很依赖 Agent 工具使用 `{sliceId, issues}` 做语义确认，因此需要把这条契约也钉在 `edit_world_slice` 上。

## 实现

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `edit_world_slice` 回归测试：
    - 创建 `erina`。
    - 10 秒切面写 `hp set 80` 和 `events listAppend`。
    - 20 秒切面写 `hp add -10`。
    - 通过 `edit_world_slice` 删除旧 `hp set 80`，保留 `events`。
    - 断言工具返回 `{sliceId, issues}` 中包含下游 `base-shifted`。
    - 再用 `get_world_state` 查询 `hp`，确认最终值为 90。
  - 增加测试辅助 `readSliceId()`，避免重复内联解析 tool details。

- `docs/tasks/56-world-engine/agent-tools.md`
  - 同步说明 `get_world_state(attrs)` 返回的 issues 会随属性投影范围收窄。

## 验证

- 已通过：`bunx vitest run server/agent/tools/world-engine-tools.test.ts`
  - 1 file / 8 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 69 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十轮状态与 walkthrough 索引。
- `PROJECT-STATUS.md`
  - 增加 round-150 后端/API 补充。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 同步 `get_world_state(attrs)` issue 范围说明。

## 与计划出入

- 本轮未改业务实现，只补 Agent 工具契约测试和工具文档。
- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
