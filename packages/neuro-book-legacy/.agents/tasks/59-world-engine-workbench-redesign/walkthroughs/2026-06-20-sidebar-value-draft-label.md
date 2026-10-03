# 2026-06-20 Sidebar Value Draft Label

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮把 Inspector metadata 草稿接入中间 Slice List 的 `draft` 状态后，左侧 Subjects 顶部仍显示 `draft 0`。
- 这会和中间的 `draft 1` 产生语义冲突：左侧统计的是 subject/value 草稿，中间统计的是 slice 级任意草稿。
- 本轮把左侧快捷项明确改为 value 草稿语义，避免用户误以为两个 draft 计数矛盾。

## Changes

- `WorldEngineWorkbenchPreviewSidebar`
  - 左侧快捷过滤按钮从 `draft` 改为 `value`。
  - subject 行内未应用 value 草稿 badge 从 `N draft` 改为 `N value`。
  - 左栏筛选状态文案从 `value drafts` 改为 `value draft subjects`。
  - value 快捷按钮增加 title：`只看有未应用 value 草稿的 subjects；slice metadata 草稿请使用中间 timeline 的 draft 过滤`。
- `world-engine-workbench-preview.test.ts`
  - 更新 Sidebar 相关静态契约，明确 left sidebar 只承载 subject/value draft 心智。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 刷新 `http://localhost:3000/world-engine.workbench-preview`。
  - `重置 mock` 后修改首个 slice title，制造 metadata 草稿。
  - 中间 Slice Card 显示 `meta draft`，中间 status 显示 `draft 1`。
  - 左侧 Subjects 快捷项显示 `value 0`，不再显示左侧 `draft 0`。
  - 左侧 value 快捷项 title 明确说明 metadata 草稿请使用中间 timeline 的 draft 过滤。
  - 浏览器日志无 warning / error。

## UI/UX Notes

- 这次没有把 metadata draft 强塞进左侧 subject 统计，因为 metadata 草稿属于 slice 级元信息，没有稳定 subject 归属。
- 当前语义分工：
  - 中间 Slice List 的 `draft`：任意 slice 草稿，包括 metadata 和 value。
  - 左侧 Subjects 的 `value`：只看有未应用 value 草稿的 subjects。
- 后续如果需要全局草稿队列，建议单独做 `Draft Queue`，而不是继续扩展左侧 subject stats。
