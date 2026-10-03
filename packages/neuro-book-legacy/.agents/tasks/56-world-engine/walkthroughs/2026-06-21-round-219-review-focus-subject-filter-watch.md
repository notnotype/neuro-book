# Round 219 - Review Focus Subject Filter Watch

## 背景

Round 217 让 Review Queue 点击 issue 时会清掉阻挡过滤，并切到 issue 对应 subject。继续核对 selected slice / snapshot 联动时发现，这条路径会触发 `selectedSubjectIds` watcher，而 watcher 的既有职责是：用户手动切 subject 过滤后清空旧的 `highlightedMutationFocus`。

结果是：Review Queue 刚设置好的 issue focus 可能在同一轮响应式刷新里被 watcher 清掉，底部审查工作台无法稳定展示刚点击的 issue。

## 本轮调整

- 新增一次性标记 `preserveMutationFocusOnSubjectFilterChange`。
- `focusReviewIssue()` 改为通过 `setSubjectFilterForReviewIssue()` 切换 subject 过滤。
- Review Queue 自动切换 subject 过滤时设置一次性保护，`selectedSubjectIds` watcher 本次只同步 focused subject，不清空 `highlightedMutationFocus`。
- 如果 subject 过滤已经是目标 subject，不设置保护标记，避免后续普通筛选误保留旧 focus。
- 普通用户手动修改 subject 过滤仍保持原行为：清空旧 issue focus。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

本轮未自动执行浏览器验证。

## 后续

- 浏览器验收时应覆盖：在 Review Queue 点击 issue 后，底部审查工作台仍显示该 issue；再手动切换左侧 subject 过滤时，旧 issue focus 应清空。
