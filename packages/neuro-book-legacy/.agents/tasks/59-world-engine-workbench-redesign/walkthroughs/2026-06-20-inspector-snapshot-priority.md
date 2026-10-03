# 2026-06-20 Inspector Snapshot Priority

## Context

浏览器第一屏检查时发现：右侧 Inspector 默认顺序是 metadata -> 当前 slice health -> 全局 Review Queue -> Touched Subjects -> State Snapshot。对于 clean slice，这会让全局队列占据当前 slice 检查路径的上方空间，`State Snapshot` 掉到更靠下的位置。

这和本任务最初的核心要求不完全吻合：Inspector 应优先帮助用户理解“当前 slice reduce 后的状态”，Review Queue 是全局审阅辅助，不应该抢在当前 slice 状态之前。

## Changes

- `WorldEngineWorkbenchPreviewInspector` 内容容器从 `space-y-3` 改为 `flex flex-col gap-3`。
- 给 Inspector 下半部分增加明确视觉顺序：
  - `Touched Subjects`：`order-4`
  - `State Snapshot`：`order-5`
  - `Review Queue`：`order-6`
  - `Schema excerpt`：`order-7`
- 保留原有模板位置、props、事件和本地状态，不改 mock 数据合同。
- 静态预览契约测试补充 flex/order 结构断言，避免后续改动又把全局队列放回状态快照之前。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview`。
  - 1280x720 默认视口下，右侧视觉顺序为 Metadata -> 当前切片 clean -> Touched Subjects -> State Snapshot -> Review Queue。
  - 第一屏已经能看到 `State Snapshot` 标题和第一条 subject 状态入口。
  - 页面无横向滚动，浏览器 console `warn/error`：无。

## Notes

- 本轮是 UI/UX 信息架构优化，没有接真实 API，也没有改后端 DTO。
- Review Queue 仍保留在 Inspector 内，只是从“当前 slice 状态检查”之后出现，避免 clean slice 被全局队列打断。
