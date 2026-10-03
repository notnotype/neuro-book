# Round 239: 手动切换 subject 模式时清空旧 issue focus

继续检查 subject filter 与 Review Queue 的会话态一致性。Review Queue 点击 issue 后会记录 `highlightedMutationFocus`，用于底部审查工作台定位具体问题；此前切换 subject 选择时已经会清空旧 focus。但手动切换“任一 subject / 全部 subject”只刷新 timeline，不会清掉旧 focus。

这会带来一个细小错位：过滤模式切换后 selected slice 可能已经变化，旧 issue focus 仍然挂在会话态里，审查面板可能继续按旧问题计算当前队列位置或高亮。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `updateSubjectFilterModeForTimeline()` 在手动切换到不同模式时清空 `highlightedMutationFocus`。
  - pending subject 阻止 `all` 模式的提示路径不变。
  - 不改变 `GET /slices` 查询参数，也不改 Review Queue issue 定位逻辑。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 subject filter mode 切换会清空旧 issue focus。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是审查过滤清空、草稿入口和保存后刷新路径的状态一致性。实际发现最明确的问题是 subject mode 手动切换后旧 review focus 残留；本轮只修这个会话态问题，没有扩展测试面，也没有改后端行为。
