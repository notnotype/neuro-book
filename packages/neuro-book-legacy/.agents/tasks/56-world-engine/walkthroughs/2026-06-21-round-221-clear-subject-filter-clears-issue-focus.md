# Round 221 - Clear Subject Filter Clears Issue Focus

## 背景

继续核对 Review Queue 到审查工作台的状态生命周期。Round 219 已经明确：Review Queue 自动切 subject 过滤时要保留本次 issue focus，而普通手动 subject 过滤应清掉旧 issue focus。

但实际 watcher 在 `selectedSubjectIds` 为空时直接 `return`，没有清空 `highlightedMutationFocus`。这意味着作者清空 subject 过滤、回到整体世界视角后，底部审查工作台仍可能残留旧 issue 高亮。

## 本轮调整

- `selectedSubjectIds` watcher 在过滤为空时也会执行 `highlightedMutationFocus.value = null`。
- Review Queue 自动切换到具体 subject 的一次性保护逻辑保持不变。
- 静态契约测试补充 watcher 空过滤分支，避免重新退回早退行为。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

本轮未自动执行浏览器验证。

## 后续

- 浏览器验收时应覆盖：点击 issue 后出现 Review Focus；随后清空 subject 过滤，Review Focus 应消失。
