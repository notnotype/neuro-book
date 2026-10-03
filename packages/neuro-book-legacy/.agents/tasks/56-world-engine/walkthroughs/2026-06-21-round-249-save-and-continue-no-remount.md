# Round 249: Save And Continue No Remount

## Context

Round 248 给 Slice Composer 新建模式增加了 `写入并继续下一步`，但继续审查实现细节时发现一个真实使用风险：

- Vue `emit()` 不会等待父层异步 handler 完成。
- 子编辑器保存成功后会很快结束 `saving` 状态。
- 父层仍在刷新 timeline，结束后会通过 `sliceComposerEditorKey` 重挂编辑器。
- 如果作者在这段时间里已经开始写下一步草稿，重挂可能抹掉刚输入的内容。

这不是罕见输入边界，而是“连续写几步 slice”的核心路径。

## Changes

- `WorldEngineMutationEditor.vue`
  - `写入并继续下一步` 成功后，子编辑器立即切回下一条新 slice 草稿。
  - 下一条时间会把刚保存的 `savedTime` 临时并入 `usedTimes`，避免父层刷新回来前又建议同一个 instant。
  - 默认 mutation 优先沿用刚保存 slice 的最后一个 mutation subject，连续推演同一主体时更顺手。

- `WorldEngineWorkbenchDialog.vue`
  - 普通保存 / 编辑仍会关闭 Composer 并重挂编辑器。
  - `continueAfterSave` 为真时不再重挂编辑器，只刷新真实 timeline、定位新 slice、记录 issues。
  - 父层刷新后的 `usedTimes` 更新仍会在草稿保持 clean 时对齐下一时间；如果作者已经开始输入，dirty guard 会保留当前草稿。

- `world-engine-ide-entry.test.ts`
  - 更新静态契约断言，覆盖：
    - 继续模式子编辑器立即准备下一步草稿。
    - `suggestedNewSliceTime(extraUsedTimes)` 合并临时 saved time。
    - 父层仅在非继续模式下重挂编辑器。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 点击 `写入并继续下一步` 后立刻在下一条草稿里输入。
- 等 timeline 刷新完成后，确认刚输入的下一步内容没有被重挂抹掉。

## Result

实际结果与计划一致：只收口 Round 248 继续模式的真实交互风险，不改后端、不新增持久状态、不扩大测试面。
