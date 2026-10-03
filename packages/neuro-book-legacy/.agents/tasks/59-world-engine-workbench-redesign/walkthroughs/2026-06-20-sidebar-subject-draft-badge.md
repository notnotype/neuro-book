# 2026-06-20 Sidebar Subject Draft Badge

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上一轮主画布 Slice Card 已显示 `draft N`；本轮把同一份 value draft summary 投射到左侧 subject 视角。
- 目标是让按 subject 浏览 / 筛选的用户，也能看到哪个 subject 有未应用 value 草稿。

## Changes

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 新增 `valueDraftSummaries` prop。
  - 新增 `subjectDraftCountMap`、`draftSubjectCount`、`subjectDraftCount()`。
  - 左侧快捷统计从 `active / open / done` 扩展为 `active / open / done / draft`。
  - `SubjectReviewFilter` 增加 `draft`，可只看有未应用 value 草稿的 subject。
  - subject 行显示 `N draft` badge。
- `world-engine.workbench-preview.vue`
  - 将页面层 `valueDraftSummaries` 传给 Sidebar。
- `world-engine-workbench-preview.test.ts`
  - 补充 Sidebar draft 统计、过滤和 badge 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后展开 Mutation Editor。
  - 修改 `slice-world-init` 第 0 行 value，左侧 `雨城` subject 行出现 `1 draft`。
  - 点击左侧快捷统计 `draft 1` 后，左栏显示 `左栏筛选：value drafts`，subject 列表只剩 `雨城`。
  - 点击 `清空草稿` 后，左侧 draft 计数为 0，仍保持 `value drafts` 过滤并进入“没有匹配的 subject”空状态。

## Notes

- 左侧只消费 draft summary，不拥有草稿本体，也不提供应用 / 还原；具体编辑仍集中在 Mutation Editor。
- 清空草稿后保留左栏 `value drafts` 过滤，与 Slice List draft 过滤行为一致，用户可用已有“清空过滤”恢复完整 subject 列表。
