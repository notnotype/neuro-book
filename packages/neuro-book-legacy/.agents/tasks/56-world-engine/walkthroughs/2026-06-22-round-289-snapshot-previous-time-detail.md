# Round 289: State Snapshot 前态时间补读

## Context

继续检查“写完几步 slice 后确认世界状态”的作者路径时，发现右侧 Inspector 的 State Snapshot 前态时间仍有一个隐性问题。

`GET /slices` 列表项通常不带 `previousTime`。旧逻辑会在缺少 `previousTime` 时使用当前可见列表里的前一条 slice 作为前态。这个列表可能已经被 subject filter、Review Queue 懒加载或窗口限制改写，并不一定等于全局时间线的真实前一刻。对多 subject slice 来说，before / after 可能因此偏早。

后端已有 `GET /slices/:sliceId` detail，能返回真实全局 `previousTime`。本轮只把 Inspector snapshot 查询接到这个能力上。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `loadSelectedSliceSnapshots()` 在选中 slice 缺少 `previousTime` 或 mutation 详情时，会先调用 `loadSliceDetailForSnapshot()`。
  - `loadSliceDetailForSnapshot()` 读取 `/api/projects/world-engine/slices/:sliceId`，把 detail 合并回当前 timeline，并同步已知时间窗口。
  - 前态查询只使用 detail 返回的 `previousTime`，不再用当前过滤列表的前一项兜底。
- `world-engine-ide-entry.test.ts`
  - 更新静态契约，断言 State Snapshot 会按需读取 slice detail，并移除旧的 `previousSlice?.time` 兜底断言。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划目标是继续推进“推演几步切片后确认状态”的用户流。实际改动只修正 Inspector State Snapshot 的前态时间来源；没有改后端列表 API，没有新增浏览器自动验收。
