# Round 149: HTTP editSlice 删除旧 mutation 的 issue 契约测试

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 148 已在 facade 层修复 `editSlice` 删除旧绝对 mutation 时的 A issue 漏报，但 HTTP API 只覆盖了“编辑 `hp set` 值变化返回 `base-shifted`”，尚未覆盖通过项目日历字符串边界删除旧 mutation 后返回同样 issue 的契约。

## 实现

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 回归测试：
    - 创建 `erina`。
    - 10 秒切面写 `hp set 80` 和一条 `events listAppend`。
    - 20 秒切面写 `hp add -10`。
    - 通过 `POST /slices/:id/edit` 删除旧 `hp set 80`，保留 `events`。
    - 断言 HTTP 返回 `{sliceId, issues}` 中包含下游 `base-shifted`，并确认查询 `hp` 后最终值为 90。

- `server/world-engine/world-engine.facade.test.ts`
  - facade 测试数量增长后，`afterAll` 清理临时 Project 偶发超过 Vitest 默认 10s hook timeout。
  - 将该 hook timeout 放宽到 30s，避免业务断言全绿但清理阶段假红。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - 目标测试提示 `world.engine` artifact stale；已重新编译 `world.engine` profile artifact。

## 验证

- 已通过：`bunx vitest run "server/api/projects/world-engine/[...segments].test.ts"`
  - 1 file / 10 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 68 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百四十九轮状态与 walkthrough 索引。
- `PROJECT-STATUS.md`
  - 增加 round-149 后端/API 补充。

## 与计划出入

- 本轮未改业务实现，只补 HTTP API 契约测试与测试清理稳定性。
- 首次跑完整目标测试时 facade 业务断言全过，但 `afterAll` 清理 hook 超时；已把该绕道和修复记录在本 walkthrough。
