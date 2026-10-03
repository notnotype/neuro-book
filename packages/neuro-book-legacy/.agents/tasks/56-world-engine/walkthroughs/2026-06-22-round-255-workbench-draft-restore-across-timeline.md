# Round 255: Workbench Draft Restore Across Timeline

## Context

Round 251-254 已经补齐 Workbench 会话草稿保护和 Project 切换保护。继续从作者实际使用流程看，剩下一个小但会打断体验的问题：

- metadata / value 草稿可以跨 slice 暂存。
- 顶栏 `Drafts` 会清空阻挡过滤并进入 draft 视角。
- 但真实 Workbench 的 timeline 可能因为 subject 过滤、最近 200 条窗口或 Review Queue 懒加载而不包含草稿所在 slice。
- 旧逻辑的 `draftSliceIds` 只从当前 `slices` 里筛选，因此草稿 summary 已存在时，Drafts 入口也可能找不到目标 slice。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `collectDraftSliceIds()`，从 `metadataDraftSummaries` 和 `valueDraftSummaries` 汇总所有草稿 slice id。
  - 草稿 id 优先按当前 timeline 顺序展示；不在当前 timeline 的草稿 id 仍保留在结果后段。
  - `showAllDraftSlices()` 会先保存本次目标草稿 id，再清空 search / kind / subject 过滤并进入 draft 视角。
  - 重载 timeline 后，如果目标草稿 slice 不在当前 `slices` 中，会复用现有 `loadSliceIntoTimeline(sliceId)` 通过 `GET /slices/:sliceId` 懒加载回来。
  - 成功载入后选中第一个草稿 slice，并按草稿类型打开 Inspector 或底部 Mutation Editor。
  - 如果所有目标草稿 slice 都无法重新载入，会显示提示让用户刷新后再试。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言，覆盖 Drafts 入口保存目标草稿 id、懒加载缺失 slice、选中可用草稿 slice。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 在 subject 过滤视角制造 metadata 或 value 草稿。
- 切换到其它 subject timeline，或让草稿 slice 离开当前结果窗口。
- 点击顶栏 `Drafts`。
- 应清空阻挡过滤、重新载入草稿所在 slice，并打开对应处理面板。

## Result

实际结果与计划一致：只修复 Drafts 入口跨过滤 / 跨 timeline 窗口找回会话草稿的问题，不引入持久化草稿，不改后端 API，不扩大测试范围。
