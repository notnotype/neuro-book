# Topbar delete selected slice

## Summary

继续补齐主 IDE Workbench 的常用操作闭环。真实 Dialog 里已经有 `deleteSelectedSlice()`，会二次确认、调用 `DELETE /api/projects/world-engine/slices/:id`、刷新 timeline，并清理被删 slice 的 transient issues；但顶栏没有删除入口，作者在真实 Workbench 里很难发现“删错切片”的最小回退能力。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 顶栏新增“删除 Slice”按钮。
  - 按钮复用已有 `deleteSelectedSlice()`，因此继续保留 `window.confirm` 二次确认和删除后刷新 / issues 展示逻辑。
  - 未选中 slice、加载中或后台动作进行中时禁用。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认真实 Workbench 顶栏存在删除入口，并连接到 `deleteSelectedSlice()` 与 trash icon。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时，应覆盖：选中已有 slice，点击“删除 Slice”，确认后二次刷新 timeline，且当前选择保持空选中。
