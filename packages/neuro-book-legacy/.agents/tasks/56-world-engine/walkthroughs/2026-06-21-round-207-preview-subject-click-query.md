# Round 207: Preview subject 点击直接查询状态

## Summary

继续沿独立 Preview 常用操作审查。Subject 列表点击原本只把 subject 填进 State Query 表单和 Mutation Builder，不会真正查询；如果用户之前按 `type` 查询过，旧 `type` 还会和新的 `subjectIds` 一起发给后端，可能导致“点了 subject 但查不到状态”。

## Changes

- `app/pages/world-engine.preview.vue`
  - `loadSubjectIntoQuery()` 改为 async。
  - 点击 subject 后清空 `queryForm.type`，避免旧 type scope 与新 subjectId 同时过滤。
  - 点击 subject 后自动 `queryState({clearActionIssues: false})`，立即刷新 State Query。
  - 模板事件改为 `@load-subject="void loadSubjectIntoQuery($event)"`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 subject 点击路径会清 type 并刷新 query。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时，应覆盖 Preview 左侧 subject 点击后状态是否立即变化。
