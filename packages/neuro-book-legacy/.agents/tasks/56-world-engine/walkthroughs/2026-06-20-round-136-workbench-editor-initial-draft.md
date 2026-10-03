# Round 136 - Workbench Editor Initial Draft

## Context

继续执行浏览器验收前的代码审查闭环。本轮重点看主 IDE Workbench 的 Edit tab 初始状态。

审查发现 `WorldEngineMutationEditor` 只有在 `props.schema` 变化时才会为 `sliceForm.time` 填默认时间。如果用户在 Workbench 已经加载好 schema 后才切到 Edit tab，组件创建时 schema 已经是非空值，但 watcher 不会立即触发，编辑器可能以空 time 开始。同时初始 mutation subject 固定为 `world`，对没有 `world` subject 的 Project 或当前已选中其他 subject 的场景不够友好。

另外 `WorldEngineSubjectCreator` 使用了 `ref`，但文件只显式 import 了 `computed/reactive/watch`；Nuxt 自动导入能兜底运行，但与本文件已有显式 Vue import 风格不一致。

## Work Done

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 新增 `initialSubjectId = props.selectedSubjectId || props.subjects[0]?.id || "world"`。
  - 初始 `sliceForm.time` 直接从 `props.schema?.calendar.examples` 经 `suggestSliceTime()` 派生。
  - 初始 `sliceForm.mutations` 与 `mutationBuilder.subjectId` 改用 `initialSubjectId`，避免 Edit tab 初次打开时总是硬编码到 `world`。
- 更新 `app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue`：
  - 显式从 Vue import `ref`，与文件内其它 Vue API import 风格一致。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言 Mutation Editor 使用 `initialSubjectId` 和 schema calendar 初始化草稿。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 files / 18 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 22 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：本轮只修复主 Workbench Edit tab 初始草稿体验，不改变后端 API、DTO 或世界引擎数据契约。
