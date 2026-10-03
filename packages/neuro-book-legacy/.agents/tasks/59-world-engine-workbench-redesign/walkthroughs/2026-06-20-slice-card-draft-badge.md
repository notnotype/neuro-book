# 2026-06-20 Slice Card Draft Badge

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 前几轮已让 Mutation Editor 管理跨 slice value 草稿；本轮把“哪些 slice 有未应用 value”反馈同步到主画布 slice 卡片。
- 目标是让用户扫时间线时直接看到草稿落点，不必只依赖底部 Editor 的队列提示。

## Changes

- `world-engine-workbench-preview.types.ts`
  - 新增 `WorldWorkbenchPreviewValueDraftSummary`。
- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 将内部 `allDirtyValueDrafts` 作为只读 summary 通过 `updateValueDrafts` 上报。
  - 草稿本体仍留在 Editor 内部，不扩大父页面对 value draft 的写入责任。
- `world-engine.workbench-preview.vue`
  - 新增 `valueDraftSummaries` 页面状态。
  - 将 summary 传给 Slice List，并在 `重置 mock` 时清空 summary。
- `WorldEngineWorkbenchPreviewSliceList.vue`
  - 新增 `valueDraftCountMap`，把 draft summary 聚合为 `sliceId -> count`。
  - 将 `valueDraftCount` 传给 Slice Card。
- `WorldEngineWorkbenchPreviewSliceCard.vue`
  - 有未应用 value 草稿的 slice 显示 `draft N` badge。
- `world-engine-workbench-preview.test.ts`
  - 补充 draft summary 类型、父页面状态、Slice List 聚合和 Slice Card badge 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后展开 Mutation Editor。
  - 将 `slice-world-init` 的第 0 行 value 改为 `主画布 badge 草稿`。
  - 主画布 `slice-world-init` 卡片出现 `draft 1`。
  - 切到 `艾莉娜抵达王都` 后，Editor 显示其他 slice 草稿，`slice-world-init` 卡片仍保留 `draft 1`，当前 `slice-erina-arrives` 无 draft badge。
  - 点击 `清空草稿` 后，Editor 回到 `已同步`，`slice-world-init` 的 `draft 1` badge 消失。

## Notes

- 浏览器验证脚本第一次使用正则读取 selected slice 文本时发生 REPL 转义错误；改用普通 DOM 文本包含判断后验证通过。该绕道不影响页面行为。
- 当前 badge 只显示数量，不提供卡片内直接应用 / 还原，避免主画布操作过载；具体处理仍在 Mutation Editor 中完成。
