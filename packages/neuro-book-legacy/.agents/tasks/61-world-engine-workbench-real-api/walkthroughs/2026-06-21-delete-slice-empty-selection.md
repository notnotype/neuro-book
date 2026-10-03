# 2026-06-21 Delete Slice Empty Selection

## Summary

继续审查主 Workbench 常用操作时发现一个新三栏接线回退：round 128 已经要求“删除当前 slice 后保持无选中 slice”，但真实三栏迁移后有两处逻辑会抵消这个意图。

- `selectedSlice` computed 在 `selectedSliceId` 为空时 fallback 到 `slices[0]`。
- `WorldEngineWorkbenchPreviewSliceList` 在 `selectedSliceId` 为空且 filtered slices 非空时，会自动 emit 第一条可见 slice。

这会让作者删除 slice 后，Inspector / 审查工作台又跳到另一条 slice，容易误以为删除失败或删错对象。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `selectedSlice` 不再在空选中时 fallback 到第一条 slice。
- `WorldEngineWorkbenchPreviewSliceList.vue`
  - filtered slices 变化时，只有已有 `selectedSliceId` 但该 slice 被过滤挡住，才自动选择第一条可见 slice。
  - 当 `selectedSliceId` 为空时保持空选中。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，防止删除后空选中语义再次被 fallback 或 SliceList watcher 覆盖。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动做浏览器验证；后续浏览器实跑时应重点复验删除确认、删除后空选中、State Snapshot 是否清空。
