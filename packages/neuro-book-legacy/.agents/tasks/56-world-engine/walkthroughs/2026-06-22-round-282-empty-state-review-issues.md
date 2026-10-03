# Round 282: Empty State Review Issues

## Context

继续检查删除后的作者路径。上一轮已修正删除返回 issues 的来源归因，但还有一个实际断点：删除后主 Workbench 可能保持无选中 slice，此时底部 `WorldEngineWorkbenchPreviewMutationEditor` 会因为没有 `selectedSlice` 而卸载，Review Panel 也随之不可见。

这样作者只能看到顶部 notice 里的“返回 N 个 issue”，却看不到具体是哪条 issue、来自哪个 slice、影响哪个 subject / attr。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `emptyReviewQueueItems` 与 `hiddenEmptyReviewItemCount`。
  - 无选中 slice 的空状态中，如果当前 Review Queue 有 issues，会展示前 3 条 issue 摘要。
  - issue 行展示 A/E、code、来源 slice time/id、subject、attr 和 triage 状态。
  - 点击 issue 行继续复用现有 `focusReviewIssue()`，若目标 slice 仍存在会定位；若目标 slice 已删除，会保留现有“无法定位到时间线”的提示语义。
  - 新增的 UI 使用 World Engine 语义 token，不引入硬编码 amber 色。

- `world-engine-ide-entry.test.ts`
  - 补充空状态 review issues 展示与点击定位的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：删除当前 slice 后如果没有选中 slice 且 Review Queue 仍有 issue，底部空状态能看到 issue 摘要，并可点击尝试定位。

## Result

实际结果与本轮目标一致：不改变后端 delete 语义，不自动替用户选择其它 slice，只把已有 Review Queue issues 在无选中 slice 场景里露出来，让删除后的下一步更清楚。
