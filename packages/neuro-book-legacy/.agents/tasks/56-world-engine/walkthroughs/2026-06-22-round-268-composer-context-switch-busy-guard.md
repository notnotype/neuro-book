# Round 268: Composer Context Switch Busy Guard

## Context

回到“作者连续推演几步切片”的主路径检查 Slice Composer。

`写入并继续下一步` 保存成功后，子编辑器会立即准备下一条草稿，父层同时刷新真实 timeline。这个设计允许作者在刷新完成前继续输入下一步，这是有意保留的体验。

但继续检查发现：刷新期间虽然提交按钮会因为 `busy` 禁用，Composer header 里的上下文切换动作还没有接 `busy`：

- `载入所选 Slice`
- `新建模式`
- `放弃草稿并载入`

如果作者在刷新尚未完成时点这些动作，可能把刚准备好的下一步草稿切到旧 selected slice 或其它编辑上下文。

## Changes

- `WorldEngineMutationEditor.vue`
  - `submitSlice()` 增加 `props.busy` 函数层 guard。
  - `loadSelectedSlice()`、`discardDraftAndLoadSelectedSlice()`、`clearEditMode()` 增加 `props.busy || saving` guard。
  - 向 `WorldEngineMutationEditorHeader` 传入 `busy`。

- `WorldEngineMutationEditorHeader.vue`
  - 新增 `busy: boolean` prop。
  - `载入所选 Slice`、`新建模式`、`放弃草稿并载入` 在 `saving || busy` 时禁用。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约，确保提交和上下文切换动作都有 busy guard。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：点击 `写入并继续下一步` 后，在 timeline 刷新期间 Composer 仍可输入下一步内容，但不能载入所选 slice、切新建模式或放弃草稿并载入。

## Result

实际结果与本轮计划一致：只锁住 Composer 的编辑上下文切换动作，不阻止普通草稿输入，不改后端和 API。
