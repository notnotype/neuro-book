# Round 144: 嵌套 attr 的 A issue 父子路径检测

## 背景

本轮继续按用户调整，只推进后端与 API 设计，不做前端。

审查 `base-shifted` / `masked` 时发现一个嵌套属性漏报：World Engine 已支持 `equipment.weapon`、`memory.师门`、`stats.hp` 这类 dotted attr，但 A issue 的下游检测只比较完全相同的 attr。这样编辑过去的整体 object（如 `stats`）时，下游子路径相对 op（如 `stats.hp add`）不会返回 `base-shifted`，Agent / API 调用方可能漏掉需要确认的语义变化。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `attrPathsOverlap()`，判断两个 attr 是否相同或存在父子路径关系。
  - `collectAdvisories()` 从 `row.attr === mutation.attr` 改为父子路径相关检测。
  - A issue 的 `attr` 改为实际下游问题路径，例如 `stats.hp`，便于 API / Agent / UI 聚焦需要确认的 mutation。
  - `masked` 文案改为“不会完整传播到最新状态”，避免父路径被子路径部分覆盖时表达过满。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：编辑过去整体 `stats` object 时，下游 `stats.hp add` 返回 `base-shifted`，且 issue attr 指向 `stats.hp`。

- `assets/workspace/.nbook/agent/profiles/.compiled/*`
  - 本轮 service 依赖变化后，`world.engine` profile artifact stale；已执行全量 system profile 编译恢复 artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 44 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 62 tests passed
- 已执行：`bun scripts/build/profile.ts compile --all --system`
  - wrote 14 system profile artifacts
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百四十四轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 明确 A issue 的 `attr` 指向下游实际受影响路径，支持父子路径相关。
- `PROJECT-STATUS.md`
  - 增加 round-144 后端/API 补充。

## 与计划出入

- 本轮没有做前端，也没有做浏览器验收，符合用户“本次不用做前端，专注后端与 API 设计”的调整。
- 这不是新 API endpoint，而是现有 `{sliceId, issues}` 契约中 A issue 准确性的收口。
