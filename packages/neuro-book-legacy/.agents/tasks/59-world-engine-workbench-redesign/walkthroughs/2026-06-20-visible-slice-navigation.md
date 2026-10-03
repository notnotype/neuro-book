# 2026-06-20 Visible Slice Navigation

## Context

上一轮已经把 Slice List 的 `search / kind / status` 过滤提升到页面顶层，但 Mutation Editor subject 视图里的 `过滤组合` 导航仍只复用 subject `any / all` 语义。用户在主画布筛出 `open + backstory + keyword` 后，底部继续点“下一个”仍可能跳到当前列表看不到的 slice。

本轮把 `过滤组合` 的含义收紧为“当前 Slice List 可见结果中的相关 slice”。

## Changes

- 新增 `app/utils/world-engine-workbench-preview-filter.ts`。
- 抽出共享过滤函数：
  - `matchesWorkbenchPreviewSliceFilter`
  - `matchesWorkbenchPreviewSubjectFilter`
  - `matchesWorkbenchPreviewKindFilter`
  - `matchesWorkbenchPreviewHealthFilter`
  - `matchesWorkbenchPreviewKeywordFilter`
- `WorldEngineWorkbenchPreviewSliceList` 改用共享过滤 util 计算可见 slices。
- `WorldEngineWorkbenchPreviewMutationEditor` 的 `过滤组合` 导航也改用同一个过滤 util。
- Mutation Editor 新增接收：
  - `sliceSearch`
  - `sliceKindFilter`
  - `sliceHealthFilter`
  - `sliceReviewSummaries`
- `过滤组合` 的 tooltip 会展示当前 subject mode、kind、status 和 search 关键词。
- 目标测试新增共享过滤器行为测试，覆盖 subject any/all、kind、open/done/clean 和 keyword。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器 smoke：本轮未重新尝试；此前 in-app browser 访问 localhost preview 被 URL policy 拦截，未继续绕过。

## Notes

- 本轮选择抽 util，而不是在 Editor 中复制 Slice List 的过滤逻辑。这样主画布可见结果和底部 subject 导航不会因为后续修改而漂移。
- 真实 API 接入时，如果 server 端支持同类过滤参数，这个 util 可以继续作为前端 mock / optimistic filtering 的一致性层。
