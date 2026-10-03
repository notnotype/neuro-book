# Round 206: Preview create subject 后刷新查询与下一时间

## Summary

继续沿作者常用操作审查独立 `/world-engine.preview`。手动创建 subject 成功后，页面已经会把 `queryForm.subjectIds` 和 Mutation Builder subject 切到新 subject，但不会立刻查询 state，也不会基于刷新后的 timeline 推进下一条 slice 的默认时间。作者创建完主体后还要手动点“查询状态”，并且下一次写 slice 的默认时间不如示例世界 / 写入路径稳定。

## Changes

- `app/pages/world-engine.preview.vue`
  - `createSubject()` 成功后，在 `loadWorld()` 刷新 timeline 之后调用 `advanceSliceFormTime()`。
  - 如果 State Query 已有 `subjectIds` 或 `type` scope，则自动 `queryState({clearActionIssues: false})`，让新 subject 的 state 立即显示出来。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 create subject 成功分支保留 `loadWorld -> advanceSliceFormTime` 顺序。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时应覆盖 Preview 手动创建 subject 后 State Query 自动刷新。
