# Round 328 - Empty Review Issue Busy State

## Context

Round 327 已让底部审查工作台中会切换真实上下文的入口对齐 `workbenchActionBusy`。继续检查主 IDE Workbench 容器时，发现无选中 slice 的空状态也会展示 `待处理 issues` 摘要。

这些 issue 行点击同样会调用 `focusReviewIssue()`，函数层已经会在 busy 中提示等待并返回，但按钮视觉上仍然可点。作者在删除 slice、刷新 timeline 或写入回流中看到空状态 issue 摘要时，可能点到一个看似可用、实际只提示等待的入口。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `empty-slice-review-issues` 内的 issue 行按钮增加 `:disabled="workbenchActionBusy"`。
  - issue 行按钮 class 增加 `disabled:opacity-45`，让同步中不可用状态可见。
- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言，锁住空状态 issue 摘要入口的 busy 对齐。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮没有改变 issue 定位逻辑，只让无选中 slice 时的旁路入口和已有函数层 guard 保持一致。
