# Round 260: Value Save Busy Guard

## Context

继续从作者真实使用 Workbench 的路径检查时发现：

- 底部 Mutation Editor 的 value 草稿保存失败不会提前删除草稿。
- 但真实 Dialog 调 `editSlice` 期间没有把 `actionBusy` 传给共享 Mutation Editor。
- 作者在慢请求期间可以连续点击“应用 value / 应用全部 / 还原 / 清空草稿”，触发并发保存或在即将刷新前手动清掉草稿，容易造成当前保存版本不清晰。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 给 `WorldEngineWorkbenchPreviewMutationEditor` 传入 `:busy="loading || actionBusy"`。

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `busy?: boolean` prop。
  - `applyValueDraft()`、`applyDirtyValueDrafts()`、`resetValueDraft()`、`resetDirtyValueDrafts()` 和用户手动清空入口在 busy 时直接返回。
  - `resetKey` 触发的系统级 `resetAllValueDrafts()` 仍可清空草稿，避免外部重置被 busy 状态挡住。
  - 行级 apply/reset、toolbar apply/reset/clear、banner apply/reset/clear 按钮在 busy 时禁用。

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 补充静态契约：真实 Dialog 传 busy，共享 Mutation Editor 有 busy prop 与按钮禁用 / guard。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮不自动执行浏览器验证。后续如要实跑，可在真实 Workbench 中制造慢保存或观察 Network，确认保存中 value 草稿按钮不可重复点击。

## Result

实际结果与当前计划一致：只补保存中防重复提交 / 防误清草稿的前端护栏，不改后端，不新增复杂测试，不做浏览器自动验收。
