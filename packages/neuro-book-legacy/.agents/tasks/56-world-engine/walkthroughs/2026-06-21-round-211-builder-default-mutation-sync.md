# Round 211: Builder 默认 mutation subject 同步

## Summary

上一轮把真实角色无 `events` 时的默认手写 slice 回退到 `world.events`，但继续审查主 Workbench Slice Composer 后发现一个拼接缝：textarea 中的默认 JSON 已经是 `world.events`，右侧 Mutation Builder 表单的 subject 下拉仍可能停在原始选中的 `player`。作者如果接着点“替换所选”，就可能把默认事件又改回角色字段，破坏上一轮的入口优化。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`
  - 初始 Builder subject 改为使用 `initialMutation.subjectId`，而不是请求的 `initialSubjectId`。
  - 新增 `applyDefaultSliceMutation()`，统一生成默认 mutation，并同步 textarea、mutation load index、Builder subject / attr / op / value。
  - 选中 subject 变化、退出编辑模式、clean 草稿下 schema 晚加载时，都通过同一个同步入口刷新默认 mutation。
- `app/utils/world-engine-ide-entry.test.ts`
  - 更新静态契约断言，确认 Builder subject 跟随默认 mutation 的实际 subject，并确认默认 mutation 同步入口仍存在。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
  - 2 files passed, 22 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 本轮没有修改真实 Project 数据，也没有自动执行浏览器验证。
- 实际计划与结果的出入：本轮原本继续审查连续推演默认时间；默认时间链路已有 `usedTimes` / `suggestNextPreviewTime()` 支撑，真正新发现的问题是 Builder 表单与默认 JSON 的 subject 不一致，因此优先修这个更容易让作者误操作的点。
