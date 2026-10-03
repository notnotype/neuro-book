# 2026-06-20 Review Queue Navigation

## Scope

本轮继续推进 `/world-engine.workbench-preview` 的 mock UI/UX，不接真实 API，不改后端 DTO。重点把 review 工作流从“单个 issue 定位”推进到“连续 issue 检查”：用户可以在 Inspector 中看到当前 issue 位于 review queue 的位置，并跳到上 / 下一个 issue。

## Finding

此前页面已经支持：

- Slice List 的 `review` 过滤。
- Inspector 的 `Review Issues`。
- 点击 issue 后定位 Mutation Editor 的 `issue target`。
- Mutation Editor 顶部的 `Review Focus` 状态条。

但 mock 世界只有一个 review issue，用户无法体验连续检查问题的节奏。真实世界切片中，review 往往是一组待确认事项，因此 Inspector 需要一个轻量队列导航，而不是只展示当前 slice 的 issue。

浏览器复测还发现：点击 `重置 mock` 会恢复数据，但 Slice List 的本地 `review` 过滤仍保留，导致 reset 后界面还显示 `2 / 6 slices`。这会让用户误以为 reset 没回到完整时间线。

## Changes

- mock 数据新增第二个 review issue：
  - slice：`slice-old-sword-backstory`
  - code：`masked`
  - subject：`erina`
  - attr：`memory.旧剑状况`
  - message：`旧剑旧伤补充可能遮蔽艾莉娜此前对东塔线索的理解，需要确认人物记忆是否仍连贯。`
- 新增 `WorldWorkbenchPreviewReviewQueueItem` preview 类型，保持在 mock preview 边界内。
- route 页面新增 `reviewQueueItems` computed，从当前 slices 聚合所有 issues。
- route 页面新增 `currentReviewQueueIndex`，优先根据当前 `highlightedMutationFocus` 和 selected slice 判断当前 issue；没有 focus 时回落到当前 slice 的第一个 issue。
- route 页面新增 `focusReviewQueueItem()`，从队列跳转到目标 slice，并设置 subject / attr 级 mutation focus。
- Inspector 新增 `reviewQueueItems` / `currentReviewQueueIndex` props 和 `focusReviewQueueItem` emit。
- Inspector 新增 `Review Queue` 区块：
  - 显示 `当前 / 总数`。
  - 提供 `上一个 issue` / `下一个 issue`。
  - 按钮 title 显示目标 slice 时间和标题。
- 本地 mock 草稿版本从 `v1` 升到 `v2`，避免旧 localStorage 草稿遮蔽新增 mock issue。
- `resetMockData()` 新增 `resetVersion`，传给 Sidebar 和 Slice List。
- Sidebar / Slice List 监听 `resetKey`：
  - Sidebar 清空本地 search 和 type filter。
  - Slice List 清空 search、subject mode、kind filter、health filter。
- 目标测试补充静态契约，覆盖 `WorldWorkbenchPreviewReviewQueueItem`、`reviewQueueItems`、`currentReviewQueueIndex`、`focusReviewQueueItem`、`Review Queue`、`上一个 issue`、`下一个 issue`、`masked` 和 reset key。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 刷新页面并点击 `重置 mock`。
  - Slice List 显示 `review 2`。
  - 点击 `review 2` 后，列表显示 `2 / 6 slices`。
  - Inspector 显示 `REVIEW QUEUE 1 / 2`。
  - 当前 issue 显示 `base-shifted / old-sword / durability`。
  - 点击 `下一个 issue` 后：
    - Inspector 显示 `REVIEW QUEUE 2 / 2`。
    - 当前 slice 跳到 `旧剑旧伤浮现`。
    - 当前 issue 显示 `masked / erina / memory.旧剑状况`。
    - Mutation Editor 显示 `REVIEW FOCUS` 和 `issue target`。
  - 点击 `上一个 issue` 后：
    - 回到 `REVIEW QUEUE 1 / 2`。
    - 重新显示 `base-shifted / durability`。
  - 再次点击 `重置 mock` 后：
    - Slice List 回到 `6 / 6 slices`。
    - `REVIEW FOCUS` 消失。
    - 顶栏显示 `浏览器临时 mock`。
  - 全程无横向溢出。
- dev logs 仍只有 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没发现阻断当前页面挂载、Review Queue 导航或 reset 清过滤的新错误。

## UX Review

- Review Queue 让用户可以连续处理世界一致性问题，不必在 Slice List 和 Inspector 之间来回手动找下一个 issue。
- 队列区块放在 Inspector 中，符合“右侧是当前 slice / review 上下文”的心智；Mutation Editor 仍负责具体 mutation 行检查。
- reset 清空本地过滤后，“重置 mock”更符合用户预期：回到默认 mock 数据和完整时间线。

## Plan Deviation

- 原计划只做 Review Queue；浏览器验证时发现 reset 不清 Slice List 本地过滤，本轮顺手修复并记录。
- 本轮没有实现 issue resolved/ignored 状态，因为当前页面仍是 mock UI/UX，不接真实 issue 处理语义。

## Next Notes

- 后续可以在 Review Queue 中显示 issue level 分布，例如 `A 2 / E 0`。
- 后续如果加入 resolved/ignored，可以让 Review Queue 跳过已处理项，并在本地草稿中保存 issue 处理状态。
