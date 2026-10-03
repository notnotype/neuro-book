# Round 259: Metadata Save Failure Preserves Draft

## Context

继续检查真实 Workbench 的保存失败路径时发现：

- 右侧 Inspector 的 metadata 表单由 mock preview 和真实 Dialog 共用。
- 旧 `applyPatch()` 在 emit 保存事件前会先 `delete metadataDrafts[props.slice.id]`。
- mock preview 本地应用几乎一定成功，所以这个问题不明显。
- 真实 Dialog 会调用 `editSlice`；如果后端因为时间冲突、非法时间或其它 API 错误拒绝保存，metadata draft 已经被删掉，作者输入会从草稿队列里消失。

## Changes

- `WorldEngineWorkbenchPreviewInspector.vue`
  - `applyPatch()` 不再在发出保存事件前删除 metadata draft。
  - 新增 `metadataPatchMatchesSlice()`。
  - `syncDraft()` 会在外部 slice 成功同步到草稿值后自动清理对应 `metadataDrafts`。
  - 这样真实 API 保存失败时草稿仍留在 Inspector / Drafts；保存成功时则随外部 props 更新自动清理。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言：
    - Inspector 存在“成功同步后清理”的 helper。
    - `applyPatch()` 不再先删除 draft 再 emit。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 在真实 Workbench Inspector 修改 slice time 到冲突时间。
- 点击“保存到世界”触发 API 失败。
- metadata 草稿应仍保留，可继续修改后重试。

## Result

实际结果与计划一致：只修复 metadata 保存失败时草稿丢失的问题，不改后端、不引入持久化草稿、不扩大到浏览器自动验证。
