# Round 240: 清空 subject 过滤时复位隐藏 mode

继续检查清空过滤、草稿入口和下一次 subject 选择之间的状态一致性。前几轮已把“任一 subject / 全部 subject”的显示和待接入主体边界收口；接着看清空过滤路径时发现一个隐藏状态残留：当用户在 `all` 模式下清空 subject 过滤，顶部已经回到整体世界视角，模式控件也不显示，但内部 `subjectFilterMode` 仍可能保留 `all`。

这会在作者下一次选择多个 subject 时突然重新生效，造成“我明明刚回到整体世界，为什么又是全部 subject 匹配”的感觉。草稿入口也有类似问题：它会清空 subject ids，但此前没有显式把 subject mode 复位。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `updateSelectedSubjectIdsForTimeline([])` 会把 `subjectFilterMode` 复位为 `any`。
  - 顶栏 Drafts 汇总入口 `showAllDraftSlices()` 清空 subject ids 时也显式复位为 `any`。
- `world-engine.workbench-preview.vue`
  - mock preview 的 `clearSubjectFilter()` 同步复位 `subjectFilterMode` 为 `any`，保持与真实 Workbench 一致。
- `world-engine-ide-entry.test.ts`
  - 补真实 Workbench 静态契约断言。
- `world-engine-workbench-preview.test.ts`
  - 补 mock preview 静态契约断言。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续检查清空过滤、草稿入口、保存后刷新路径的会话态残留。实际没有改写保存流程，也没有改后端查询；只把回到整体世界 / 草稿视角时的隐藏 subject mode 收回到默认“任一 subject”。
