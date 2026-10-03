# Round 208: Preview 默认 mutation 复用 schema-aware 规则

## Summary

继续沿“作者真的拿它写世界，第一处会卡在哪里”审查独立 `/world-engine.preview`。主 IDE Workbench 的新建 slice 草稿已经会通过 `defaultMutationForPreviewSubject()` 按当前 subject type 选择默认 attr / op / value，但独立 Preview 仍硬编码 `events / listAppend / 世界引擎初始化`。如果项目 schema 没有 `events`，或者作者刚创建的 subject 类型第一属性不是 `events`，第一条手写 slice 很容易在提交时被后端拒绝。

## Changes

- `app/pages/world-engine.preview.vue`
  - 引入并复用 `defaultMutationForPreviewSubject()`。
  - `defaultSliceMutations()` 不再手写 `events/listAppend`，而是基于当前 `schema.subjectTypes`、`subjects` 和目标 subjectId 派生。
  - 创建 subject 成功后，先 `loadWorld()` 刷新 subjects，再为新 subject 生成默认 slice mutation，避免 util 看不到新 subject type。
  - 新增 `applyDefaultSliceMutation()`，让 slice JSON 草稿与 Mutation Builder 字段保持一致。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认独立 Preview 使用共享 schema-aware 初始 mutation 规则，且不再保留旧硬编码 `events/listAppend/世界引擎初始化`。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时，应覆盖 Preview 创建 subject 后，默认 slice mutation 是否跟随该 subject schema，而不是固定写 `events`。
