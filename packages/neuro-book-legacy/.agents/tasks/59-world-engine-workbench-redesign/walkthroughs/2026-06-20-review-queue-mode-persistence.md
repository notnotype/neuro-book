# 2026-06-20 Review Queue Mode Persistence

## Context

Review Queue 已经默认使用 `只看 open` 的连续处理模式，并保留 `全部 issue` 回看。但此前 `reviewQueueMode` 是 Inspector 内部状态，刷新页面或恢复浏览器 mock 草稿后会回到默认值。对真实 review flow 来说，这会打断用户的上下文：如果用户正在回看全部 issue，刷新后不应该被静默带回 open-only。

## Changes

- 新增 `WorldWorkbenchPreviewReviewQueueMode = "open" | "all"` 类型。
- 将 `reviewQueueMode` 从 `WorldEngineWorkbenchPreviewInspector` 内部 `ref` 提升到 `/world-engine.workbench-preview` 页面顶层。
- Inspector 改为通过 `reviewQueueMode` prop 和 `updateReviewQueueMode` 事件切换模式，继续保持“宿主管状态、子组件表达意图”的组件边界。
- 浏览器本地 mock 草稿现在会保存 `reviewQueueMode`。
- 旧版 v3 草稿缺少 `reviewQueueMode` 时仍可恢复，并默认回到 `"open"`，避免无谓清空用户已有 mock slices / triage 状态。
- `重置 mock` 会把 Review Queue mode 一起重置为 `"open"`。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，4 个测试全部通过。
- `bun run typecheck`：未通过，失败点仍在既有 `server/low-code-form/index.ts` 与 `server/low-code-form/resource-preset.ts` 类型错误；本轮修改的 World Engine Workbench Preview 文件未出现在错误列表中。
- 浏览器 smoke：本轮未重新尝试绕过 in-app browser 的 localhost URL policy；上一轮验证时该策略已阻止访问 `http://localhost:3000/world-engine.workbench-preview`。

## Notes

- 本轮没有改变真实 API / DTO，也没有提升 localStorage draft version；`reviewQueueMode` 作为可选字段兼容旧草稿。
- 这个改动让 Review Queue 的检查心智更稳定：`open` 是处理模式，`all` 是回看模式，用户选择会跨刷新保留。
