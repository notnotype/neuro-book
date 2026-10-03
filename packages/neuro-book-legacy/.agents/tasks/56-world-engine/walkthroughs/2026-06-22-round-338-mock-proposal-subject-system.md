# Round 338: Mock Proposal Subject System

## Context

Round 336/337 已把主体文件建议面接入 Inspector，并增加复制建议入口。真实 Workbench 会传入 `subjectSystemSummaries`，但 mock `/world-engine.workbench-preview` 没有主体系统摘要，所以沙盘里看不到建议面。

本轮补齐 mock 数据与接线，让 UI 沙盘也能验证主体文件建议体验。

## Changes

- `world-engine-workbench-preview-mock.ts`
  - 新增 `mockWorkbenchSubjectSystemSummaries`。
  - 为 `erina` 与 `moran` 提供 `simulation/subjects/*` path、events / memory RAG source、direct state path、计数和 sync status。
- `/world-engine.workbench-preview`
  - 向 Sidebar 传入 `:subject-system-summaries="mockWorkbenchSubjectSystemSummaries"`。
  - 向 Inspector 传入 `:subject-system-summaries="mockWorkbenchSubjectSystemSummaries"`。
- 更新 mock preview 静态契约测试，锁定沙盘数据和 props 接线。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts` 通过。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过。
- `bun run typecheck` 通过。

## Actual Result

- 真实 Workbench 和 mock Workbench 都能通过同一个 Inspector 展示主体文件建议。
- 未自动执行浏览器验证。

