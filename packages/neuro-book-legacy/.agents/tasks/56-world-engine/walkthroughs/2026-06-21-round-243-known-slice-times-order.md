# Round 243: 已知时间窗口避免旧局部切片覆盖最新基准

Round 242 让 Slice Composer 在 subject 过滤视角下参考 `knownSliceTimes`，避免只看局部 timeline。但继续检查后发现一个顺序细节：`suggestNextPreviewTime()` 会从 `usedTimes` 数组末尾往前找基准时间。如果局部 subject timeline 或 Review Queue 懒加载的是更早的切片，而我们把它追加到 `knownSliceTimes` 末尾，默认下一时间就可能从旧时间往后推。

完整 `loadWorld()` 得到的是整体 timeline 窗口，它的末尾更适合作为“推演下一步”的基准。本轮保留这个语义：局部 / 懒加载时间只补到已知窗口前方，用于占用集合，但不抢走末尾的最新基准。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `mergeKnownSliceTimes()` 改为只提取未出现过的新时间，并把它们放到现有 `knownSliceTimes` 前方。
  - 完整 `replaceKnownSliceTimes()` 仍保持完整 timeline 的顺序。
  - Slice Composer 的 `usedTimes` 仍是 `knownSliceTimes + 当前 slices` 去重并集。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认局部合并不会把新发现的旧时间追加到末尾。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是检查 knownSliceTimes 的顺序是否会被局部旧切片影响。实际只调整合并顺序，不改默认时间推导函数、不改 API，也不新增请求。
