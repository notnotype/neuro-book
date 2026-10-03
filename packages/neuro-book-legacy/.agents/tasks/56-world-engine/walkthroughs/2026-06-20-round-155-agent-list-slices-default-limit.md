# Round 155: list_world_slices 默认限制最近 5 个切面

## 背景

本轮继续只推进后端与 API 设计，不做前端。

审查查询 / 列表资源边界时发现：`docs/tasks/56-world-engine/agent-tools.md` 写着 `list_world_slices.limit` 是“最近 N 个切面（默认如 5）”，但真实 Agent 工具实现里没有默认值。Agent 如果调用：

```json
{ "projectPath": "workspace/..." }
```

会把完整 timeline 返回给模型。世界变大后这会快速制造 token 压力，也和工具文档的“最近变更”心智不一致。

HTTP `GET /slices` 暂不改默认行为，因为前端/调试入口可能依赖显式全量读取；本轮只收紧 Agent 工具边界。

## 实现

- `server/agent/tools/world-engine-tools.ts`
  - 新增 `DEFAULT_WORLD_SLICE_LIMIT = 5`。
  - `list_world_slices` 未传 `limit` 时调用 facade 使用 `limit: 5`。
  - 显式 `limit` 仍沿用工具 schema：`1..50`。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增回归测试：创建 init slice + 6 个后续 slice 后，不传 `limit` 调用 `list_world_slices`，只返回最近 5 个切面，并保持时间正序输出。

## 验证

- 已通过：`bunx vitest run server/agent/tools/world-engine-tools.test.ts`
  - 1 file / 12 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 81 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十五轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 把 `list_world_slices.limit` 默认值写实为 5，并注明 Agent 工具上限 50。
- `PROJECT-STATUS.md`
  - 增加 round-155 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 本轮只收紧 Agent 工具默认行为，没有修改 HTTP `GET /slices` 的默认列表语义，避免影响现有前端 / 调试入口可能依赖的全量读取。
