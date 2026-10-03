# 2026-06-20 Slice List Draft Filter

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上一轮 Slice Card 已能显示 `draft N`；本轮补齐主画布过滤能力，让用户可以快速只看有未应用 value 草稿的 slice。
- 仍不接真实 API，draft 来源是 Mutation Editor 上报给父页面的浏览器运行态 summary。

## Changes

- `world-engine-workbench-preview.types.ts`
  - `WorldWorkbenchPreviewSliceHealthFilter` 增加 `draft`。
- `world-engine-workbench-preview-filter.ts`
  - `WorkbenchPreviewSliceFilterInput` 增加可选 `valueDraftCount`。
  - `matchesWorkbenchPreviewHealthFilter()` 支持 `draft`，仅 `valueDraftCount > 0` 命中。
- `world-engine.workbench-preview.vue`
  - `isSliceHealthFilter()` 和 `sliceHealthFilterLabel()` 支持 `draft / value drafts`。
  - 浏览器 localStorage 中恢复 draft status 过滤时不再回退为 `all`。
- `WorldEngineWorkbenchPreviewSliceList.vue`
  - 将 draft summary 聚合为 `valueDraftCountMap` 后参与 `matchesWorkbenchPreviewSliceFilter()`。
  - 结果摘要新增 `draft slices`。
  - status 过滤按钮新增 `draft N`。
  - active filter chip 显示 `value drafts`。
- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - `过滤组合` 导航复用同一套 draft 过滤语义，draft 过滤下不会跳出当前主画布可见结果。
- `world-engine-workbench-preview.test.ts`
  - 补充 `draft` 过滤静态契约和行为测试。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后展开 Mutation Editor。
  - 修改 `slice-world-init` 第 0 行 value，主画布出现 `draft 1`。
  - 点击 status 过滤里的 `draft 1` 后，列表只剩 `slice-world-init`，且该卡片含 `draft 1`。
  - 点击 `清空草稿` 后，draft badge 消失；因为仍处于 `value drafts` 过滤，列表进入“没有匹配当前条件的切片 / 当前筛选组合过窄”的空状态。

## Notes

- 清空草稿后不自动清除 `draft` 过滤，是刻意保留筛选上下文；用户可通过已有空状态入口或 active filter chip 恢复完整时间线。
- `draft` 被放入现有 status 过滤组，而不是新增独立工具栏，避免主画布控制区继续膨胀。
