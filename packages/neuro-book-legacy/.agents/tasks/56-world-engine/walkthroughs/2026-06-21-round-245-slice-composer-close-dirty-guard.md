# Round 245: Slice Composer Close Dirty Guard

## Context

继续从作者真实连续推演路径检查主 Workbench。Slice Composer 内部已有 dirty guard：当编辑器里有未保存草稿时，点击“载入所选 Slice”不会直接覆盖当前内容，而是提示用户确认放弃后再载入。

但 Workbench 浮层右上角关闭按钮此前会直接关闭并销毁 `WorldEngineMutationEditor`。如果作者正在写一条新 slice 或编辑已有 slice，误点关闭会无声丢失草稿。这个问题不涉及后端/API 决策，但会直接影响“推演几步切片”的信任感。

## Changes

- `WorldEngineMutationEditor.vue`
  - 新增 `dirtyChange` 事件。
  - 监听内部 `hasDirtyDraft`，实时把 dirty 状态通知父 Workbench。

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `sliceComposerDirty` 会话态。
  - 打开新建 / 编辑 Composer 前重置 dirty 状态。
  - 保存成功、关闭成功、切换 Project / 关闭 Dialog 时清理 dirty 状态。
  - `closeSliceComposer()` 在 dirty 时使用 `window.confirm("当前 Slice Composer 有未保存草稿，确定关闭吗？")` 做最小确认；取消则保持浮层打开。
  - `requestWorkbenchClose()` 拦截 Workbench Dialog 自身的关闭请求；如果 Composer 仍有未保存草稿，关闭整个 Workbench 或按 Esc 也会先确认。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，防止后续移除 `dirtyChange`、父层 dirty 状态、浮层关闭确认和 Workbench 关闭确认。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。建议后续浏览器实跑主 Workbench 时覆盖：

- 打开 Slice Composer，修改 title / mutations 后点右上角关闭，确认会弹出未保存草稿提示。
- 取消关闭后草稿仍在。
- 确认关闭后浮层关闭。
- 修改草稿后关闭整个 Workbench 或按 Esc，也应先确认是否放弃草稿。
- 保存成功后不会再弹 dirty confirm。

## Result

实际结果与计划一致：只补 Composer / Workbench 误关丢稿防护，不改后端、不引入持久草稿、不扩大测试面。
