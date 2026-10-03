# 2026-06-21 Review Panel Body Transition

## Context

用户指出底部“审查工作台”收起 / 展开还需要动画。此前面板根节点已有 height transition，但正文区域使用 `v-if` 直接挂载 / 卸载，视觉上仍会显得突兀。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 给审查工作台正文区域增加 `Transition name="world-review-panel-body"`。
  - 新增 opacity + translateY 过渡，配合外层 height transition，让收起 / 展开更连贯。
  - 该组件被 preview 和真实 Workbench 共用，因此两处底部审查工作台都会获得同一动画。
- `app/utils/world-engine-workbench-preview.test.ts`
  - 补静态断言，防止正文 transition 被误删。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts`：通过。
- `bun run typecheck`：通过。

## Notes

- 本轮只补交互动效，不改变审查工作台的收起状态、面板高度持久化或业务数据流。
