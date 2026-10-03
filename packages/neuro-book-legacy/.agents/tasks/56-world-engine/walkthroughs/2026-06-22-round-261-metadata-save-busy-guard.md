# Round 261: Metadata Save Busy Guard

## Context

接着检查真实 Workbench 的保存中交互。Round 260 已保护底部 mutation value 草稿，但右侧 Inspector metadata 仍有同类风险：

- 真实 Dialog 调 `editSlice` 保存 metadata 时会进入 `actionBusy`。
- Inspector 没有接收 busy 状态，作者仍可继续改 `time / kind / title / summary`，或重复点击“保存到世界”。
- 如果保存期间继续输入，API 成功回流后 `syncDraft()` 可能把保存中途的新输入覆盖掉。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 给 `WorldEngineWorkbenchPreviewInspector` 传入 `:busy="loading || actionBusy"`。

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `busy?: boolean` prop。
  - busy 时 `applyPatch()` 与 `resetDraft()` 直接返回。
  - busy 时禁用 metadata 的 `time / kind / title / summary` 表单，以及“还原”和“保存到世界”按钮。

- `FormInput.vue` / `FormSelect.vue` / `FormTextarea.vue`
  - 增加 `disabled` prop，供 Inspector 在保存中禁用 metadata 表单。

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 补充静态契约：Inspector 暴露 busy prop，保存中禁用字段与提交按钮。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：在 Inspector 修改 metadata 后点击保存，保存中字段和按钮应禁用，避免重复提交或继续输入被回流覆盖。

## Result

实际结果与当前计划一致：只补 metadata 保存中的前端 busy 护栏，不改后端，不新增复杂测试，不做浏览器自动验收。
