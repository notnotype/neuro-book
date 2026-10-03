# Round 269: Composer Saving Close Guard

## Context

继续检查 Slice Composer 在连续推演主路径里的关闭入口。

上一轮已经让父层刷新 busy 时不能切换 Composer 编辑上下文，但继续看关闭路径发现：父层只知道 `sliceComposerDirty`，不知道子编辑器当前是否正在提交 `$fetch`。

如果作者在 Slice Composer 正在写入 / 编辑 slice 的请求飞行中关闭 Composer 或整个 Workbench，写入可能继续在后台完成，反馈和上下文都会被藏起来。对作者来说，这会像“我关掉了但它到底有没有写进去”。

## Changes

- `WorldEngineMutationEditor.vue`
  - 新增 `savingChange` 事件。
  - `submitSlice()` 开始请求前 emit `savingChange(true)`，finally 中 emit `savingChange(false)`。

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `sliceComposerSaving`。
  - `workbenchBusy` 纳入 `sliceComposerSaving`，顶部状态会显示同步中。
  - `closeSliceComposer()` 在保存中显示提示并返回，不关闭 Composer。
  - `requestWorkbenchClose()` 在保存中显示提示并返回，不关闭 Workbench。
  - reset 会清空 `sliceComposerSaving`。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约，确保 saving 状态从子编辑器上报到父层，并参与关闭保护。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：点击写入 / 编辑 Slice 后，在保存请求未完成前点击 Composer 关闭或 Workbench 关闭，应提示正在保存并保留当前界面。

## Result

实际结果与本轮计划一致：只阻止保存请求飞行中的关闭入口，不改变保存 API、不改变普通草稿关闭确认。
