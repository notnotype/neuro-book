# Round 137 - Workbench Editor Schema Clean

## Context

继续执行浏览器验收前的代码审查闭环。round-136 已让主 IDE Workbench 的 `WorldEngineMutationEditor` 在创建时直接从已加载 schema 和当前 subject 派生初始草稿。

继续审查异步加载边界时发现：如果 Edit tab 先渲染，随后 schema 才到达，`watch(props.schema)` 会自动补 `sliceForm.time`。这属于系统默认值填充，不是用户编辑；但原逻辑补完 time 后没有重新 `markCleanSliceForm()`，会让 `hasDirtyDraft` 变成 true。之后 selected subject 到达或变化时，dirty guard 会误以为用户已有未保存草稿，从而拒绝把初始 mutation subject 同步到当前 subject。

## Work Done

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - `watch(props.schema)` 在自动补默认 time 前记录 `wasClean = !hasDirtyDraft.value`。
  - 如果补默认 time 前草稿是 clean，补完后调用 `markCleanSliceForm()`，保持“系统自动默认值不算用户 dirty”的语义。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言 schema watcher 保留 `wasClean` 与 `markCleanSliceForm()` 契约。

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
- 实际结果与计划一致：本轮只修复主 Workbench Edit tab 异步 schema 默认值与 dirty guard 的交互，不改变后端 API、DTO 或世界引擎数据契约。
