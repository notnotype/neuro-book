# Round 262: Delete Slice Clears Session Drafts

## Context

继续检查真实 Workbench 的删除路径时发现：

- 删除当前 slice 后，`selectedSlice` 会变空，Inspector / Mutation Editor 子组件会卸载。
- 但父层仍保存 `metadataDraftSummaries` / `valueDraftSummaries`。
- 如果被删除 slice 上有未应用草稿，顶部 `Drafts` 入口仍可能显示并尝试定位一个已经不存在的 slice，作者会误以为草稿还可恢复。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `clearSessionStateForDeletedSlice(sliceId)`。
  - 删除成功后清理该 slice 的 metadata draft summary、value draft summary、transient issues、review focus 和 snapshot/full snapshot 缓存。
  - 保持已有 `DELETE /slices/:id` 与删后刷新 timeline 行为不变。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约：删除 slice 成功后必须清理对应会话态草稿与 focus。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：给某 slice 留 metadata/value 草稿，删除该 slice 后顶部 `Drafts` 数量应扣除该 slice，不再定位已删除记录。

## Result

实际结果与当前计划一致：只修复删除后前端会话态残留，不改后端，不增加复杂测试，不做浏览器自动验收。
