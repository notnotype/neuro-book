# Round 146: queryState attrs 与 issues 范围对齐

## 背景

本轮继续只推进后端与 API 设计，不做前端。

审查 `queryState({attrs})` 时发现一个查询噪音问题：后端先 reduce 全部状态并收集全部 E issues，再做 attrs 投影。因此 Agent 查询 `hp` 时，也可能收到同一 subject 上 `location` 的 `dangling-ref`。这会让收窄查询结果和 issues 范围不一致。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `queryState({attrs})` 现在会用 `filterIssuesForAttrs()` 过滤 E issues。
  - 无 attrs 查询继续返回该 subject 的全部 E issues。
  - `attrPathContains()` 支持 `inventory[0]` 这类 issue 路径，保证查询父属性 `inventory` 时仍能看到 `inventory[0]` 的问题。

- `server/world-engine/types.ts`
  - `QueryStateResult` 注释补充：传 attrs 时 issues 只返回相关属性问题。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：同一 subject 上 `location` 出现 `dangling-ref` 后，查询 `hp` 不返回该 issue，查询 `location` 和无 attrs 查询仍返回。
  - 既有 collection ref 测试继续覆盖 `inventory` 查询保留 `inventory[0]` issue。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - service 依赖变化后重新编译 `world.engine` profile artifact，避免 catalog 测试加载 stale artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 46 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 64 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百四十六轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 明确 query attrs 会同步收窄 issues 范围。
- `PROJECT-STATUS.md`
  - 增加 round-146 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint，只收紧现有 `{subjects, issues}` 查询契约。
