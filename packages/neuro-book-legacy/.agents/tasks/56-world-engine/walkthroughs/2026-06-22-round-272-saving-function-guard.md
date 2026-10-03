# Round 272: Saving Function Guard

## Context

Round 271 已经把 Slice Composer 保存请求飞行中的顶栏、空状态和子组件入口禁用。但 UI disabled 只能挡住正常点击，仍可能有组件事件、快捷入口或后续重构时直接调用父层函数。

本轮继续收口同一个真实作者风险：保存中的 slice 还没回流，用户入口函数不应切换 timeline 上下文、删除 slice、同步主体系统或触发新的写入。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `blockSliceComposerSaving()` helper，用统一 notice 拦截保存请求飞行中的上下文切换和写入类动作。
  - `seedDemoWorld()`、`syncPendingSubjectSystemSubjects()`、`deleteSelectedSlice()` 在保存中直接提示并返回。
  - `selectSlice()`、`focusSubject()`、`focusReviewIssue()`、`viewSubjectTimeline()`、`clearSubjectFilter()`、`removeSubjectFilter()`、`updateSelectedSubjectIdsForTimeline()`、`updateSubjectFilterModeForTimeline()` 在保存中直接提示并返回。
  - `openSliceComposer()`、`openSelectedSliceComposer()`、`showAllDraftSlices()` 改为复用同一个 helper，减少保存中入口语义分叉。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约，要求主 Workbench 存在保存中函数层 guard，并覆盖删除、主体系统同步、选择 slice 和 subject timeline 更新等高风险入口。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续人工或授权验收可覆盖：Slice Composer 保存请求未完成时，尝试 Review Queue 定位、切换 subject 过滤、删除 slice、主体系统同步、Drafts 定位等入口，应只显示保存中提示，不改变当前编辑上下文。

## Result

实际结果与计划一致：本轮只做保存请求飞行中的函数层保护和静态契约，没有改后端 API、没有扩大浏览器验证，也没有新增复杂行为测试。
