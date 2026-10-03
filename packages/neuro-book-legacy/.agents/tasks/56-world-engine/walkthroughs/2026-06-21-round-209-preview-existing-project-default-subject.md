# Round 209: Preview 打开已有 Project 后默认 subject 对齐真实数据

## Summary

上一轮让独立 Preview 的默认 slice mutation 复用 schema-aware 规则，但继续审查“打开已有 Project 后第一条手写 slice”时发现另一处卡点：页面初始化时 `subjectForm.id`、`queryForm.subjectIds` 和 Mutation Builder 都默认是 `world`。`applyWorldDefaults()` 只在这些字段为空时才使用已加载 subjects，因此打开一个没有 `world` subject 的真实 Project 时，默认表单仍会指向不存在的 `world`，第一条写入或查询容易失败。

## Changes

- `app/pages/world-engine.preview.vue`
  - `applyWorldDefaults()` 现在会检查当前 subject id 是否存在于已加载 subjects。
  - 当前 subject / query subject / builder subject 都不匹配真实 subject 时，回落到第一个真实 subject。
  - 增加 `lastAutoSliceMutationDraft` 记录系统自动生成的 mutation 草稿。
  - 只有当前 mutations 仍等于上一份自动草稿、且不在编辑已有 slice 时，才会按真实 subject/schema 刷新默认 mutation，避免覆盖用户手写或 Builder 修改过的草稿。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 Preview 会识别真实 subject id 集合，并只刷新自动生成的默认草稿。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时，应覆盖打开一个没有 `world` subject 的已有 Project，确认默认 Query 和 Slice 草稿会落到第一个真实 subject。
