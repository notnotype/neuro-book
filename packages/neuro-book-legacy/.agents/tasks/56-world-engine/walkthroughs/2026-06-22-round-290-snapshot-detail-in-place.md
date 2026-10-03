# Round 290: Snapshot Detail 原位替换

## Context

Round 289 让 State Snapshot 在缺少 `previousTime` 时按需读取 slice detail，用真实全局前一刻查询 before 状态。继续审查这条链路时发现一个 UI 细节：detail 读取后复用了通用 timeline merge。

通用 merge 是给“当前列表里没有这个 slice”的 Review Queue 懒加载定位用的，会尝试按 `previousTime` 插入。如果当前是 subject-filtered timeline，detail 里的全局 `previousTime` 可能不在当前过滤列表里；这会让已经存在的 selected slice 被移动到列表末尾，作者刚选中的位置发生跳动。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `loadSliceDetailForSnapshot()` 读取到 detail 后先检查当前 `slices` 是否已有同 id slice。
  - 已存在时原 index 替换为 detail，保留当前可见列表位置。
  - 只有当前列表没有该 slice 时，才继续使用 `mergeWorldWorkbenchTimelineSlice()` 做懒加载合并。
- `world-engine-ide-entry.test.ts`
  - 补静态契约，钉住 snapshot detail 原位替换行为。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续收敛写后检查链路。实际没有再改 API，也没有扩展 Snapshot UI；只修正 detail 补读后的 timeline 位置稳定性。
