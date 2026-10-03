# Round 293 - Review Focus Clears Missing Issue

## 背景

继续检查作者从 Review Queue 处理 issue 的路径时，发现一个审查状态残留问题：

作者点击某条 issue 后，Workbench 会记录 `highlightedMutationFocus`，底部审查区会展示该 issue 的解释、上下文和 triage 操作。随后如果作者通过编辑 slice 修掉这条 issue，刷新后的 Review Queue 已经不再包含原来的 `issueKey`，但焦点仍可能残留。

底部审查区会退化成 `manual-focus`，看起来像仍在处理一个问题，实际只是旧定位状态。

## 实际变更

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `clearMissingReviewIssueFocus()`。
  - 当 `reviewQueueItems` 的 key 集合变化时，如果当前 `highlightedMutationFocus.issueKey` 已不在队列中，自动清空旧焦点。
  - 只清理带 `issueKey` 的真实 issue 焦点；手动 subject/attr 定位不受影响。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，避免后续保存 / 刷新后恢复旧的 issue focus 残留行为。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有自动浏览器验证，符合当前约定。
- 本轮没有改后端/API，也没有改变 issue triage 持久化策略。
- 本轮只处理 Review Queue 中已消失 issue 的前端焦点生命周期。
