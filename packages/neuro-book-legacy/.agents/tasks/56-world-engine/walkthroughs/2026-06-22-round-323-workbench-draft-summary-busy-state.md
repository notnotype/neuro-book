# 2026-06-22 Round 323 - Workbench Draft Summary Busy State

## 背景

上一轮给 `showAllDraftSlices()` 增加了 `blockWorkbenchActionBusy()`，函数层会阻止工作台同步 / timeline 局部刷新期间进入草稿视角。

继续检查顶栏后发现，`Drafts` 按钮本身仍只按 `sliceComposerSaving` 禁用。作者在 timeline 回流中看到按钮可点，点击后才得到“请稍候”的提示，视觉状态和真实行为不一致。

## 变更

- 顶栏 `Drafts` 按钮禁用条件从 `sliceComposerSaving` 改为 `workbenchActionBusy`。
- 保留 `showAllDraftSlices()` 的函数层 guard，避免事件绕过按钮禁用。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
