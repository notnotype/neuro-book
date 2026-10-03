# Round 246: Slice Composer Open Preserves Dirty

## Context

Round 245 已经让 Slice Composer 关闭和 Workbench 关闭都检查未保存草稿。但继续审查真实 Workbench 顶部入口时发现：Composer 浮层打开后，顶部栏仍然可点 `新建 Slice` / `编辑 Slice`。此前这两个入口会先把父层 `sliceComposerDirty` 置回 `false`，再保持或打开 Composer。

如果 Composer 里已经有未保存草稿，这会造成父层 dirty 状态被误清；子编辑器的 `hasDirtyDraft` 没有变化，因此不会重新 emit `dirtyChange`。后续关闭 Composer 或 Workbench 时就可能跳过确认。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `openSliceComposer()` 只在 Composer 原本关闭时重置 `sliceComposerDirty`。
  - `openSelectedSliceComposer()` 只在 Composer 原本关闭时重置 `sliceComposerDirty`。
  - Composer 已经打开时再次点击顶部入口，不会清掉父层 dirty guard。

- `world-engine-ide-entry.test.ts`
  - 补静态契约，断言 `sliceComposerDirty.value = false` 被 `if (!sliceComposerVisible.value)` 包住。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 打开 Composer，修改草稿。
- 不关闭浮层，点击顶部 `新建 Slice` 或 `编辑 Slice`。
- 再关闭 Composer / Workbench，仍应出现未保存草稿确认。

## Result

实际结果与计划一致：只修父层 dirty 状态被顶部入口误清的问题，不改后端、不引入持久草稿、不扩大测试面。
