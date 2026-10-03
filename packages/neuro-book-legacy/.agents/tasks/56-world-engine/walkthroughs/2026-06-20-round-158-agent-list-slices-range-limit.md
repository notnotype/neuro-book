# Round 158: list_world_slices 区间查询不默认截断

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 155 为 Agent 工具 `list_world_slices` 增加了默认 `limit=5`，解决不传 limit 时把完整 timeline 倾倒给模型的问题。继续审查时发现这个默认值应用得过宽：带 `from` / `to` 的区间查询也会被默认截断。

这会破坏工具文档里的典型用法：

```json
{ "from": "...", "to": "..." }
```

用户 / Agent 问“某段历史里有哪些切面”时，预期是该区间内的切面；如果默认只返回前 5 个，会漏掉后续切面且不明显。

## 实现

- `server/agent/tools/world-engine-tools.ts`
  - 新增 `resolveSliceLimit()`。
  - 显式 `limit` 优先。
  - 未传 `limit` 且未传 `from/to` 时，使用默认最近 5 个。
  - 传了 `from` 或 `to` 时，不默认截断；需要限制数量时调用方显式传 `limit`。

- `server/agent/tools/world-engine-tools.test.ts`
  - 保留 round-155 回归：无 `limit/from/to` 时默认返回最近 5 个。
  - 新增回归测试：带 `from/to` 且不传 `limit` 时，返回完整区间内 6 个切面，且保持时间正序。

## 验证

- 已通过：`bunx vitest run server/agent/tools/world-engine-tools.test.ts`
  - 1 file / 14 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 87 tests passed
  - 备注：重新编译 profile 后第一次目标组重跑时，业务断言无失败但 Vitest worker 退出阶段出现一次测试池错误；立即重跑同一命令通过。
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十八轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 明确默认最近 5 只在未传 `limit/from/to` 时生效；区间查询不默认截断。
- `PROJECT-STATUS.md`
  - 增加 round-158 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 本轮是 round-155 的行为修正：保留“最近 timeline 防倾倒”的默认值，但不让它误伤区间查询。
