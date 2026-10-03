# Round 291 - Value Draft Mutation Identity

## 背景

继续从作者真实使用 Workbench 的路径检查后，发现底部 Mutation Editor 的 value 草稿只按 `sliceId:index` 绑定。

如果作者先在某个 mutation 行留下 value 草稿，又通过 Slice Composer 或其它整块保存入口改了同一个 slice 的 mutations（增删、重排、替换），旧草稿可能贴到“同 index 但已经不是同一条 mutation”的新行上。这个问题不会表现为 API 报错，但会让作者误以为正在编辑当前行，实际应用的是旧行草稿。

## 实际变更

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 为每条 value 草稿新增 `valueDraftIdentities`，记录草稿创建时对应 mutation 的 `subjectId / attr / op / value` 身份。
  - `syncValueDrafts()` 在当前 slice mutations 变化时核对身份；身份不一致时丢弃旧草稿并回到当前 mutation value。
  - 当前 slice mutations 缩短后，会清理已经不存在的 index 草稿、错误和身份记录。
  - `allDirtyValueDrafts`、`isValueDraftDirty` 只统计身份仍匹配当前 mutation 的草稿。
  - watcher 从只监听 value 串改为监听 mutation identity 串，确保 subject / attr / op / value 任一变化都会触发同步。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，避免后续退回只按 `sliceId:index` 认领 value 草稿。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有自动浏览器验证，符合当前约定。
- 本轮没有改后端/API，也没有扩大为完整草稿系统重构。
- 这轮只处理“作者在审查区留下草稿后，slice mutations 被整块改动”的串线风险。
