# 2026-06-20 Slice Stat Filter Shortcuts

## Context

中间 Slice List 是当前 workbench 的主画布。顶部结果摘要已经展示 `open slices / issues`、`review done`、`clean slices`、`draft slices`，但这些卡片此前只是静态统计；用户看到问题数量后，还需要再去下方 `status` 分段控件里找对应过滤。

这让“从整体世界视角快速收窄到某类切片”的路径多了一步，也让 summary cards 有一点“像按钮但不能点”的占位感。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 的四个状态 summary cards 改为按钮：
  - `slice-stat-open-filter`：切到 `status=open`。
  - `slice-stat-done-filter`：切到 `status=done`。
  - `slice-stat-clean-filter`：切到 `status=clean`。
  - `slice-stat-draft-filter`：切到 `status=draft`。
- 保留原有统计文本和颜色系统，只增加 hover 与当前状态 inset highlight。
- 不改变 `visible slices` 和 `subjects touched` 两个上下文统计，它们仍是只读摘要。
- 静态契约测试补充四个 `data-testid` 和 tooltip 文案断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：本轮再次尝试恢复 in-app browser 连接，但 `setupBrowserRuntime -> browser.documentation()` 仍在工具调用上限约 120 秒处超时，无法执行点击卡片后的页面交互验证。

## Detour / Limitation

- 浏览器连接问题与上一轮相同，本轮没有完成真实页面点击验收。
- 已通过 Vue 模板结构确认四个卡片均为 `button type="button"`，并直接复用现有 `updateSliceHealthFilter` emit。
- 后续浏览器恢复后，需要补验：
  - 点击 `open slices / issues` summary card 后，status chip 进入 `open`。
  - 点击 `review done` / `clean slices` / `draft slices` 后分别进入对应 status。
  - 点击后不会造成 Slice List 顶部布局跳动。

## Notes

- 本轮仍是 mock-only UI/UX 优化，不接真实 API，不改后端 DTO。
- 这次优化让“看到统计 -> 收窄列表”变成一步操作，符合主画布浏览世界切片的工作流。
