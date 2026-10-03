# Round 281: Delete Issue Source Slice

## Context

继续从作者真实路径检查：连续写入几步后，作者很可能会删除当前 slice，再看删后返回的 issues。

原实现删除成功后会先清理被删 slice 的会话态、刷新 timeline，再把删除 API 返回的 issues 录入 Review Queue。这里有一个实际使用卡点：如果返回 issue 没有 `sliceId`，或者 issue 指向刚被删除的 slice，录入时可能借刷新后的当前选中 slice 补 time/title，导致 issue 看起来像属于下一条 slice；删除最后一条时也可能缺少稳定来源。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `deleteSelectedSlice()` 现在把被删除的 `slice` 作为 `recordTransientIssues()` 的来源传入。
  - `recordTransientIssues()` 增加可选 `fallbackSlice`，用于保留被删 slice 的 `id/time/title`。
  - 元数据来源只在 slice id 对得上时使用当前选中 slice，避免把删除返回的 issue 错挂到刷新后的其它 slice。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约：删除返回 issues 必须用被删 slice 作为 fallback source。
  - 补充静态契约：`recordTransientIssues()` 不能无条件借用当前 selected slice 的元数据。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：删除一条会返回 issue 的 slice 后，Review Queue 中 issue 的来源仍显示被删除 slice 的时间 / 标题，不会误挂到刷新后的当前选中 slice。

## Result

实际结果与本轮目标一致：没有扩展后端、没有新增复杂删除恢复机制，只修正删除后 issue 的前端归因，降低作者删除后看不懂 issue 来源的概率。
