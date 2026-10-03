# 2026-06-22 Round 322 - Workbench Timeline Filter Action Guard

## 背景

上一轮让 `workbenchActionBusy` 纳入 `timelineLoading`，顶栏与组件 `busy` prop 会禁用许多入口。

继续检查函数入口后发现，timeline 视角相关函数仍主要只挡 `sliceComposerSaving`。如果组件事件绕过 disabled，或未来复用这些函数，仍可在 subject timeline 局部刷新中继续改选中 slice、search / kind / health / subject 过滤、Review Queue 定位或草稿视角。

## 变更

以下 timeline / filter / selection 入口增加 `blockWorkbenchActionBusy()`：

- `selectSlice()`
- `focusReviewIssue()`
- `viewSubjectTimeline()`
- `clearSubjectFilter()`
- `updateSliceSearchForTimeline()`
- `updateSliceKindFilterForTimeline()`
- `updateSliceHealthFilterForTimeline()`
- `removeSubjectFilter()`
- `updateSelectedSubjectIdsForTimeline()`
- `updateSubjectFilterModeForTimeline()`
- `showAllDraftSlices()`

`focusSubject()` 仍保持只挡 `sliceComposerSaving`，因为它主要切右侧检查视角，不会触发 timeline 查询。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
