# Round 139 - Initial Mutation Util Test

## Context

继续执行浏览器验收前的代码审查闭环。round-138 已让主 IDE Workbench Edit tab 的初始 mutation 按当前 subject schema 派生，但主要依赖组件内逻辑和静态入口测试保护。

继续审查时认为：初始 mutation 的规则本质上属于 Preview / Workbench 共享的 schema-aware 表单默认值逻辑，应该放在 `world-engine-preview` util 中，并用行为测试覆盖。这样能避免后续只改组件字符串时绕过真实规则，也更方便 Preview 和 Workbench 后续共用。

## Work Done

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `defaultMutationForPreviewSubject(schemaTypes, subjects, subjectId)`。
  - 规则：按 subject 类型找 schema attr；优先 `events`，否则使用该类型首个 attr；schema/subject 不可用时回退到动态 `events/listAppend/世界事件`。
- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 改用 `defaultMutationForPreviewSubject()` 初始化 `sliceForm.mutations` 与 Builder。
  - `defaultSliceMutations()` 直接使用 `props.schema?.subjectTypes`，避免组件初始化阶段引用后面才声明的 computed。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 补行为测试覆盖优先 `events`、无 `events` 时使用首个 attr、空 schema fallback。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言 Mutation Editor 使用共享 util。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
  - 2 files / 19 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 23 tests passed
- `bun run typecheck`
  - passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：本轮把 round-138 的初始 mutation 派生规则收敛为可测试 util，不改变后端 API、DTO 或世界引擎数据契约。
