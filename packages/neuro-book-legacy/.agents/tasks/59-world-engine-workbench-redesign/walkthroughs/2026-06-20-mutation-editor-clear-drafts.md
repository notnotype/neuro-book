# 2026-06-20 Mutation Editor Clear Drafts

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上一轮已增加跨 slice draft queue；本轮补齐放弃所有未应用 value 草稿的显式出口。
- `清空草稿` 只丢弃浏览器运行态 value drafts，不写入 mock slice，也不重置整个 mock preview。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `allDirtyValueDraftCount`。
  - `Draft Changes` 条中新增 `清空草稿` 按钮。
  - 按钮复用 `resetAllValueDrafts()`，一次性清掉当前和其他 slice 的未应用 value 草稿与解析错误。
  - 保持 `应用全部 / 还原全部` 只作用当前 slice，避免隐藏跨 slice 提交。
- `world-engine-workbench-preview.test.ts`
  - 补充 `allDirtyValueDraftCount`、`清空草稿` 和 `mutation-editor-clear-all-drafts` 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后展开 Mutation Editor。
  - 将 `slice-world-init` 的第 0 行 value 改为 `准备清空的草稿`。
  - 选择 `艾莉娜抵达王都` slice 后，`Draft Changes` 显示其他切片有 1 个草稿，并出现 `清空草稿`。
  - 点击 `清空草稿` 后，当前 Editor 回到 `已同步`，`Draft Changes` 消失。
  - 回到 `slice-world-init` 后，第 0 行 value 为默认 `雨城纪元`，无 dirty 状态。

## Notes

- 浏览器第一次读取 visible DOM 时短暂拿到空结果；重新读取后页面已经完整挂载，继续验证通过。该绕道没有暴露页面行为问题。
- 后续如果需要更强的草稿管理，可以考虑把 draft queue 抽到父页面并在 Slice List 卡片上显示 draft badge；本轮先保持 Editor 内聚，避免扩大状态合同。
