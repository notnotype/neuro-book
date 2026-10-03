# 2026-06-20 Metadata Draft Visibility

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮 Inspector 已能跨 slice 保留 metadata 草稿，但主画布没有标记；用户切走后难以发现哪个 slice 有未应用元信息。
- 本轮把 Inspector metadata 草稿接入 Slice List / Slice Card 的 draft 可见性：metadata 草稿会显示为 `meta draft`，并纳入 `status: draft` 过滤。

## Changes

- `world-engine-workbench-preview.types.ts`
  - 新增 `WorldWorkbenchPreviewMetadataDraftSummary`，用于描述有未应用 metadata 的 slice。
- `WorldEngineWorkbenchPreviewInspector`
  - 新增 `metadataDraftSummaries` computed。
  - 当前 slice dirty 或 `metadataDrafts` 中有缓存时，通过 `updateMetadataDrafts` 上报父页面。
- `world-engine.workbench-preview.vue`
  - 新增 `metadataDraftSummaries` 顶层状态。
  - 将 metadata draft summary 传给 Slice List。
  - `重置 mock` 同步清空 metadata draft summary。
  - 顶栏视角摘要中 `draft` 状态从 `value drafts` 改为 `drafts`，避免误导。
- `WorldEngineWorkbenchPreviewSliceList`
  - 接收 `metadataDraftSummaries`。
  - 新增 `metadataDraftCountMap` 和 `draftCountForSlice()`。
  - `draftSliceCount` 改为 value draft 与 metadata draft 的 slice 并集。
  - `status: draft` 过滤改为匹配任意未应用草稿。
- `WorldEngineWorkbenchPreviewSliceCard`
  - 新增 `metadataDraftCount` prop。
  - 卡片元信息区显示 `meta draft`，value 草稿继续显示为 `value draft N`。
- `world-engine-workbench-preview-filter.ts`
  - `matchesWorkbenchPreviewSliceFilter()` 新增 `metadataDraftCount` 输入。
  - `draft` 过滤使用 metadata + value 的总 draft count。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 刷新 `http://localhost:3000/world-engine.workbench-preview` 后重置 mock。
  - 修改首个 slice title 为 `meta draft 可见性测试`。
  - Slice Card 显示 `meta draft`，结果统计显示 `1 draft slices`。
  - 点击中间 status `draft 1` 后，列表只剩首个 slice；卡片仍显示 `meta draft`。
  - 顶栏视角摘要显示 `当前视角：status drafts`，不再显示旧文案 `status value drafts`。
  - 点击 Inspector 的 `还原` 后，title 恢复为 `世界初始化：雨城进入持续暴雨`；在 `drafts` 过滤下列表进入空状态，且页面不再显示 `meta draft` 或 `未应用修改`。
  - 浏览器日志无 warning / error。

## UI/UX Notes

- 这次补齐的是“离开 Inspector 后还能找回草稿”的发现路径。metadata 草稿现在与 value 草稿共用 `draft` 状态入口，但卡片 badge 明确区分 `meta draft` 和 `value draft N`，避免用户不知道草稿来源。
- 左侧 subject 的 draft badge 仍只代表 value draft，因为 metadata 草稿属于 slice 级元信息，不天然归属某个 subject；本轮没有把它强行塞进 subject 列表，避免制造错误心智。
- 后续可以考虑在 Inspector 标题或顶栏加一个 “metadata drafts N” 的全局队列入口，但当前主画布 `draft` 过滤已经覆盖主要找回路径。
