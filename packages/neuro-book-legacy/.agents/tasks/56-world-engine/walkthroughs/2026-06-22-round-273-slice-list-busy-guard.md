# Round 273: Slice List Busy Guard

## Context

Round 272 已把主 Workbench 的多数用户入口函数纳入 `sliceComposerSaving` 保护。继续从作者真实使用路径审查时，发现中间 Slice List 仍有一条会带跑上下文的路径：

- search / kind / status 过滤直接 emit 到父层赋值。
- Draft Queue、可见切片 stepper、维护切片开关等仍可在保存请求飞行中触发。
- `filteredSlices` watcher 会在当前选中 slice 被过滤挡住时自动选中第一条可见 slice。

如果作者在 Slice Composer 保存尚未回流时操作这些入口，当前编辑上下文可能被列表过滤或自动选中带到其它 slice，保存完成后的反馈会更难理解。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `updateSliceSearchForTimeline()`、`updateSliceKindFilterForTimeline()`、`updateSliceHealthFilterForTimeline()`。
  - 这三个过滤更新入口统一走 `blockSliceComposerSaving()`，不再在模板中直接写 `sliceSearch / sliceKindFilter / sliceHealthFilter`。
  - `WorldEngineWorkbenchPreviewSliceList` 接收 `:busy="workbenchActionBusy"`。

- `WorldEngineWorkbenchPreviewSliceList.vue`
  - 新增 `busy?: boolean` prop。
  - search 输入、kind/status/subject mode segmented、可见切片 stepper、Draft Queue、filter chips、清空筛选、维护切片开关在 busy 时禁用。
  - `clearSearch()`、`clearAllFilters()`、`clearKindAndHealthFilters()`、`handleFilterChipAction()`、`updateSubjectFilterMode()`、`updateSliceKindFilter()`、`updateSliceHealthFilter()`、`navigateVisibleSlice()`、`focusDraftQueueItem()`、`showDraftSlices()`、`toggleMaintenanceSlices()` 在 busy 时直接返回。
  - `filteredSlices` watcher 在 busy 时不再自动 emit `selectSlice`，避免保存回流期间把当前 slice 带跑。

- `world-engine-ide-entry.test.ts`
  - 补充真实 Workbench 必须使用过滤 wrapper 的静态契约。

- `world-engine-workbench-preview.test.ts`
  - 补充 Slice List `busy` prop、禁用选项、过滤短路和 watcher guard 的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续人工或授权验收可覆盖：Slice Composer 保存请求飞行中，Slice List 的搜索、kind/status、Draft Queue、可见切片 stepper、维护切片开关应不可触发；保存完成后恢复。

## Result

本轮原计划是审查保存中入口是否还有遗漏。实际发现 Slice List 的过滤与自动选中仍可能改变当前上下文，因此做了一个小范围前端修复；没有改后端 API，没有扩展到浏览器验证。
