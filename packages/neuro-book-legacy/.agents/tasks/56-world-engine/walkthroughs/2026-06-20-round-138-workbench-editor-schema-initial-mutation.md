# Round 138 - Workbench Editor Schema Initial Mutation

## Context

继续执行浏览器验收前的代码审查闭环。round-136/137 已修复主 IDE Workbench Edit tab 的初始 time、subject 派生，以及异步 schema 默认值与 dirty guard 的交互。

继续审查初始草稿时发现：虽然初始 subject 已经改为当前 subject / 首个 subject，但初始 Builder 仍硬编码为 `events/listAppend/世界事件`。如果当前 Project 的首个 subject 类型没有 `events` attr，用户进入 Edit tab 第一眼看到的 mutation 就不贴 schema，也会削弱 schema-aware Builder 的价值。

## Work Done

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 新增 `defaultMutationForSubject(subjectId)`。
  - 默认 mutation 会按当前 subject 的 schema 类型选择 attr：优先 `events`，否则使用该类型第一个 attr。
  - 初始 `sliceForm.mutations`、`mutationBuilder.attr`、`mutationBuilder.op`、`mutationBuilder.value` 都从该默认 mutation 派生。
  - 如果 schema/subject 都不可用，仍回退到旧的动态 `events/listAppend/世界事件`，保持空 Project 初始可编辑。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言初始 mutation 使用 `defaultMutationForSubject()`，并优先选择 `events` / fallback 到首个 attr。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 files / 18 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 22 tests passed
- `bun run typecheck`
  - passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：本轮只优化主 Workbench Edit tab 初始 mutation 的 schema-aware 体验，不改变后端 API、DTO 或世界引擎数据契约。
