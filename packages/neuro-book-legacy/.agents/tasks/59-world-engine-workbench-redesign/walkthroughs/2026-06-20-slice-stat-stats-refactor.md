# 2026-06-20 Slice Stat Stats Refactor

## Context

上一轮为状态快捷卡新增了 `statusShortcutStats`，让 open / done / clean / draft 卡片计数忽略当前 status 过滤。但实现后 `filteredResultStats` 和 `statusShortcutStats` 内部出现了两段几乎相同的统计循环。

这类重复会让后续增加状态维度、改 issue 语义或调整 draft 计数时更容易漏改其中一处。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 新增 `collectResultStats(targetSlices)`。
- `filteredResultStats` 改为 `collectResultStats(filteredSlices.value)`。
- 新增 `statusShortcutSlices`：
  - 保留 search / kind / subject 条件。
  - 固定 `sliceHealthFilter: "all"`。
- `statusShortcutStats` 改为 `collectResultStats(statusShortcutSlices.value)`。
- 删除重复的状态统计循环，保留一份状态分布计算逻辑。
- 静态契约测试补充：
  - `collectResultStats`
  - `statusShortcutSlices`
  - `statusShortcutStats`
  - `sliceHealthFilter: "all"`

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：本轮再次尝试恢复 in-app browser，但初始化阶段仍超时，60 秒内没有返回 `browser.documentation()`，因此没有完成真实页面点击验收。

## Detour / Limitation

- 浏览器连接问题仍与前几轮一致，本轮继续用代码结构、静态契约测试和 typecheck 验证。
- 后续浏览器恢复后，仍需要补验状态快捷卡：
  - 点击各状态卡能切换 status。
  - 当前 status 下其它状态卡仍显示稳定计数。
  - 顶部 summary 布局不跳动。

## Notes

- 本轮是代码质量和可维护性收束，不接真实 API，不改后端 DTO。
- 这次重构让后续扩展真实 API 时更容易复用同一份状态分布逻辑。
