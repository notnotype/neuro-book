# Direct edit selected slice

## Summary

继续沿主 IDE Workbench 的常用作者路径检查。此前要编辑一个已有 slice，需要先选中 slice，再点顶部“新建 Slice”打开 Composer，然后在 Composer 内点“载入所选 Slice”。功能可达，但对作者来说像绕路，尤其在“推演几步切片 → 回头修某一步”的流程中会频繁发生。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 顶栏新增“编辑 Slice”按钮，选中 slice 后可直接打开 Slice Composer。
  - `openSelectedSliceComposer()` 会打开 Composer，并在下一次 DOM 更新后递增 `sliceComposerLoadKey`，触发 `WorldEngineMutationEditor` 的 `loadSelectedSlice()` watcher。
  - 将重置编辑器实例的 `sliceComposerEditorKey` 与“载入所选 slice”的 `sliceComposerLoadKey` 分开，避免组件 remount 吃掉 load key 变化。
  - 保存成功或重置 Workbench 时只重置 editor 实例，不再混用 load key。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认真实 Workbench 存在“编辑 Slice”入口、`nextTick()` 触发载入、以及 editor key / load key 分离。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时，应覆盖：选中 timeline 中已有 slice，点击“编辑 Slice”，Composer 直接进入整块编辑模式并显示该 slice 的 mutations。
