# Round 147: editSlice 移动 instant 的 A issue 收口

## 背景

本轮继续只推进后端与 API 设计，不做前端。

审查 `editSlice` 的 A issue 时发现两个同源问题：

- 原样保存已有 mutation 时，旧逻辑仍按新输入重新收集 A issue；如果下游有相对 op，会重复返回 `base-shifted`。
- 把一个基准切面从较早 instant 移到较晚 instant 时，旧逻辑只从新 instant 之后查下游，因此会漏掉旧位置和新位置之间已经存在的相对 op。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `editSlice()` 在替换前比较旧 slice 的 instant 与 mutation 序列。
  - 新增 `collectEditIssues()`：原样保存时跳过 A issue；发生语义变化或移动 instant 时，同时从旧位置与新位置观察下游影响。
  - `collectAdvisories()` 增加 `excludeSliceId`，编辑时排除当前 slice 自身，避免移动后“自己覆盖自己”的假 `masked`。
  - 新增 `sameMutationSequence()` / `mutationSignature()`，用稳定 JSON 比较 mutation 语义，避免 object key 顺序造成误判。
  - 新增 `uniqueInstants()` / `dedupeIssues()`，避免旧/新位置观察点返回重复 A issue。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：`editSlice` 原样保存已有 mutation 时不重复返回 A issue。
  - 新增回归测试：把基准切面移到下游相对 op 之后时返回 `base-shifted`。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - service 依赖变化后重新编译 `world.engine` profile artifact，避免 catalog 测试加载 stale artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 48 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 66 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百四十七轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 editSlice A issue 收集规则。
- `server/world-engine/types.ts`
  - 补充 `SliceWriteResult` 注释。
- `PROJECT-STATUS.md`
  - 增加 round-147 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint，只修正现有 `editSlice` 的 `{sliceId, issues}` 返回语义。
