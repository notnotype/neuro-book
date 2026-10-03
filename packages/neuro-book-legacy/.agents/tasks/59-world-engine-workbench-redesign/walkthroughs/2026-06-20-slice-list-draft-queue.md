# 2026-06-20 Slice List Draft Queue

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮已经把 metadata draft 与 value draft 都纳入中间 Slice List 的 `draft` 状态过滤，但用户仍需要先理解 `status draft` 才能找回草稿。
- 本轮在 Slice List 顶部新增统一 `Draft Queue`，把 slice 级 metadata 草稿和 value 草稿合并成时间线顺序的可点击队列。

## Changes

- `WorldEngineWorkbenchPreviewSliceList`
  - 新增本地展示类型 `WorkbenchPreviewDraftQueueItem`。
  - 新增 `draftQueueItems` computed，按当前 `props.slices` 顺序合并 `metadataDraftSummaries` 与 `valueDraftSummaries`。
  - 新增 `focusDraftQueueItem()`，点击队列项时清空会遮挡目标的 search / kind / subject 过滤，切到 `status=draft` 并选中目标 slice。
  - 在结果摘要和过滤器之间新增紧凑 `Draft Queue` 工具条。
  - 队列项展示 `time / title / kind / meta / value N`，与 Slice Card 的 `meta draft`、`value draft N` 保持语义一致。
- `world-engine-workbench-preview.test.ts`
  - 补充 Draft Queue 的静态契约断言，避免后续 refactor 丢失主画布草稿入口。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview`。
  - `重置 mock` 后修改首个 slice title，制造 metadata 草稿。
  - Slice List 顶部出现 `Draft Queue`，队列项显示 `meta`，status 过滤显示 `draft 1`。
  - 点击队列项后进入 `status drafts`，主画布只显示 1 张草稿 slice，Slice Card 显示 `meta draft`。
  - 展开 Mutation Editor，修改当前 slice 的 value，队列项更新为 `meta value 1`，Editor 进入 dirty 状态。
  - 收起 Mutation Editor 后，Draft Queue 与当前草稿 slice 仍可见。
  - 隐藏 Inspector 后，可见 DOM 不再显示 `Slice Context`，Draft Queue 仍可见。
  - 浏览器日志无 warning / error。

## UI/UX Notes

- `Draft Queue` 放在中间 Slice List，而不是左侧 Subjects，因为 metadata 草稿没有稳定 subject 归属。
- 队列只负责发现与定位草稿，不负责应用或清空；具体提交仍在 Inspector / Mutation Editor 内完成。
- 点击队列项会进入 `draft` 视角并清除可能挡住目标的局部过滤，这是为了保证“点击草稿就能看见草稿”的结果稳定。
- 本轮浏览器验证期间截图捕获出现 CDP timeout，但 DOM 状态、交互结果和控制台日志均已确认；没有把截图作为完成条件。
