# 2026-06-20 Slice List Filter Persistence

## Context

Slice List 已经支持搜索、`kind` 过滤、`open / done / clean` 状态过滤和 subject `any / all` 模式，但此前其中一部分状态仍留在列表组件内部。用户调好巡检条件后刷新页面，会恢复 slices / triage / Review Queue mode，却丢失时间线过滤上下文。

本轮把 Slice List 的过滤状态继续提升到页面顶层，保持 Workbench 的状态真相源集中在 route 宿主中。

## Changes

- 新增共享类型 `WorldWorkbenchPreviewSliceHealthFilter = "all" | "open" | "done" | "clean"`。
- `/world-engine.workbench-preview` 页面顶层新增：
  - `sliceSearch`
  - `sliceKindFilter`
  - `sliceHealthFilter`
- 浏览器 mock 草稿现在会保存和恢复 Slice List 的搜索、kind、status 过滤。
- 旧 v3 草稿缺少这些字段时仍可恢复：
  - search 默认 `""`
  - kind 默认 `"all"`
  - health 默认 `"all"`
- `重置 mock` 会同步清空 Slice List 过滤。
- `WorldEngineWorkbenchPreviewSliceList` 改为受控组件：
  - 通过 props 接收过滤状态。
  - 通过 `updateSliceSearch / updateSliceKindFilter / updateSliceHealthFilter` 事件上抛变更。
  - 组件内部仍负责过滤计算、空状态和滚动选中 slice。
- 静态契约测试更新为检查新的受控状态和事件。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，4 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器 smoke：本轮未重新尝试；此前 in-app browser 访问 localhost preview 被 URL policy 拦截，未继续绕过。

## Notes

- 这轮只提升和持久化 Slice List 过滤状态；Mutation Editor 的 `过滤组合` 导航仍只复用 subject `any / all` 语义。
- 后续可以进一步让 Mutation Editor subject 视图的 `过滤组合` 导航完全按 Slice List 当前可见结果跳转，现在所需状态已经在页面顶层可用了。
