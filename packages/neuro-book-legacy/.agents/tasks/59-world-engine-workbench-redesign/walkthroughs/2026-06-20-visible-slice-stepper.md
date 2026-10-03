# 2026-06-20 Visible Slice Stepper

## Context

Slice List 已经支持 subject / kind / status / search 过滤，也能在底部 Mutation Editor 里按 subject 跳转相关 slice。但用户从“整体查看世界”的角度浏览当前可见时间线时，仍需要逐张点击卡片，缺少一个轻量的上 / 下一个切片导航。

本轮为 Slice List 增加基于当前过滤结果的可见切片 stepper。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 新增：
  - `currentVisibleSliceIndex`
  - `previousVisibleSlice`
  - `nextVisibleSlice`
  - `visibleSlicePositionLabel`
  - `navigateVisibleSlice`
- Slice List 标题行右侧新增紧凑 stepper：
  - 上箭头：跳到当前可见列表里的上一个 slice。
  - 中间位置：显示 `current / visible total`。
  - 下箭头：跳到当前可见列表里的下一个 slice。
- stepper 严格使用 `filteredSlices`，因此 subject / kind / status / search 过滤后不会跳出当前主画布可见结果。
- 目标契约测试补充可见切片导航的关键字符串。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：
  - `GET http://localhost:3000/world-engine.workbench-preview` 返回 200。
  - Chrome DevTools Protocol 1366x900 交互验证通过：默认位置显示 `1 / 6`，点击下一个可见切片后变为 `2 / 6`，选中 `艾莉娜抵达王都` 并同步 Inspector / Mutation Editor。
  - 切换 `open` 状态过滤后，位置显示 `1 / 2`，选中 `东塔地下层被打开`，证明 stepper 跟随当前过滤结果。

## Notes

- 本轮没有新增 mock API 字段，导航完全由当前已过滤的前端 slices 派生。
- stepper 放在标题行右侧，而不是放入过滤 chip 区，避免把“导航动作”和“筛选条件”混在一起。
