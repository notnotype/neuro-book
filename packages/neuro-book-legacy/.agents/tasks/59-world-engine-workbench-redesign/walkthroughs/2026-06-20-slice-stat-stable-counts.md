# 2026-06-20 Slice Stat Stable Counts

## Context

上一轮把 Slice List 顶部的 `open / done / clean / draft` 状态统计卡改成快捷过滤入口。继续检查这个交互时发现一个二次 UX 问题：这些卡片复用了 `filteredResultStats`，而 `filteredResultStats` 会受当前 `status` 过滤影响。

这意味着用户点击 `open` 之后，`done / clean / draft` 的卡片计数会基于 open 结果重新计算，容易显示为 0。作为“切换到其它 status”的入口，这个计数语义不稳定。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 新增 `statusShortcutStats`。
- `statusShortcutStats` 保留当前：
  - search
  - kind
  - subject ids
  - subject any/all mode
- `statusShortcutStats` 忽略当前 `sliceHealthFilter`，固定用 `sliceHealthFilter: "all"` 计算状态分布。
- 四个状态快捷卡现在使用 `statusShortcutStats`：
  - open slices / issues
  - review done
  - clean slices
  - draft slices
- `visible slices` 和 `subjects touched` 继续使用 `filteredResultStats`，仍反映当前完整过滤结果。
- 静态契约测试补充 `statusShortcutStats` 和 `sliceHealthFilter: "all"` 断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：本轮再次尝试恢复 in-app browser，但初始化阶段仍超时，60 秒内没有返回 `browser.documentation()`，因此没有完成真实页面点击验收。

## Detour / Limitation

- 浏览器连接阻塞仍未解除，本轮继续绕道为代码与静态契约验证。
- 后续浏览器恢复后，需要补验：
  - 在 `status=open` 状态下，`review done / clean / draft` 卡片仍显示基于 search/kind/subject 的稳定计数，而不是被 open 过滤清零。
  - 点击 `review done / clean / draft` 仍能切换到对应 status。
  - `visible slices` 仍反映当前完整过滤结果。

## Notes

- 本轮仍是 mock-only UI/UX 优化，不接真实 API，不改后端 DTO。
- 这个调整让状态快捷卡既是过滤入口，也是同一上下文下的状态分布导航，不会被自身过滤状态污染。
