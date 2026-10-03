# Round 263: Delete Slice Preserves Remaining Drafts

## Context

Round 262 清理了被删除 slice 的父层 draft summary，但继续检查发现还有一个更隐蔽的风险：

- metadata/value 草稿实际内容分别保存在 Inspector / Mutation Editor 子组件内部。
- 删除当前 slice 后如果 `selectedSlice` 变空，子组件会卸载。
- 如果其它 slice 仍有未应用草稿，父层 summary 可能还在，但子组件内部草稿值会随卸载丢失。

这会导致作者删除一个 slice 后，另一个 slice 的草稿看似还在 `Drafts` 里，实际内容却可能已经丢掉。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `draftDiscardSliceId` / `draftDiscardVersion`，删除 slice 时广播给子组件精确丢弃被删除 slice 的内部草稿。
  - 删除当前 slice 后，如果还有其它草稿 slice，会先进入 `draft` 视角并选中第一个剩余草稿 slice，再刷新 timeline。
  - 这样 Inspector / Mutation Editor 不会因为短暂无选中 slice 而卸载，剩余草稿内容可继续保留。

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `discardDraftSliceId?: string` / `discardDraftVersion?: number`。
  - 收到 discard 信号时删除对应 slice 的内部 metadata draft。

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `discardDraftSliceId?: string` / `discardDraftVersion?: number`。
  - 收到 discard 信号时删除对应 slice 的内部 value draft 与解析错误。

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 补充静态契约：删除后保留剩余草稿 slice、子组件响应 discard 信号。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：在两个不同 slice 上分别留下 metadata/value 草稿，删除其中一个 slice 后，另一个 slice 的草稿仍可从 `Drafts` 打开并保持原值。

## Result

实际结果与当前计划一致：只修复删除当前 slice 时其它草稿可能随子组件卸载丢失的问题，不改后端，不新增复杂测试，不做浏览器自动验收。
