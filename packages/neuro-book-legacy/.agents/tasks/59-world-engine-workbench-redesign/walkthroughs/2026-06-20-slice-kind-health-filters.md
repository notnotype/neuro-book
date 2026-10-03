# 2026-06-20 Slice Kind Health Filters

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的主画布浏览体验，不接真实 API，不改后端 DTO。重点补齐中间 Slice List 的整体世界巡检过滤：按 slice `kind` 和 issue 状态筛选。

## Finding

当前页面已经很适合单 subject 视角：

- 左侧 subject 过滤。
- Slice Card subject group 的“聚焦检查 / 只看 subject timeline”入口。
- Mutation Editor subject 视图。

但“整体查看世界”时，用户除了搜索和 subject 过滤，还需要快速回答这些问题：

- 哪些是 `backstory` 切片？
- 哪些切片需要 review？
- 当前列表只看 clean 切片时还剩多少？

这些都不是 subject 维度，因此需要放在 Slice List 的主工具栏里。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 新增 `kindFilter`：
  - `全部`
  - 按 mock slices 自动生成的 `init / event / backstory`
- 新增 `healthFilter`：
  - `全部`
  - `review`，显示 issue slice 数量。
  - `clean`
- `filteredSlices` 同时应用 subject、kind、health 和关键词搜索。
- 空状态与恢复入口更新：
  - `hasActiveFilters` 会识别 kind / health 过滤。
  - `clearAllFilters()` 会同时清空搜索、subject、kind 和 health。
  - 有 kind / health 过滤时显示 `清空状态过滤`。
- 目标测试补充静态契约，覆盖 `SliceHealthFilter`、`matchesKind`、`matchesHealth`、`kindFilter`、`healthFilter` 和 review / clean UI 文案。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 初始页面显示 `6 / 6 slices`，kind 过滤包含 `init / event / backstory`，status 过滤包含 `review 1 / clean`。
  - 点击 `backstory` 后显示 `1 / 6 slices`，只剩 `旧剑旧伤浮现`，不显示 init slice。
  - 点击 `review 1` 后显示 `1 / 6 slices`，只剩 `东塔地下层被打开` issue slice。
  - 点击 `clean` 后显示 `5 / 6 slices`，issue slice 被排除，init / backstory 等 clean slice 可见。
  - 点击 `清空状态过滤` 后恢复 `6 / 6 slices`。
  - 页面没有横向溢出。
- dev logs 仍可读到 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没有发现阻断当前页面挂载和过滤交互的新错误。

## Plan Deviation

- 本轮没有把过滤状态提升到 route query 或父组件；它仍是 Slice List 内部交互状态，符合 preview 验证阶段的低成本迭代。
- `kind` 候选直接从当前 mock slice 数据派生，暂未引入 schema 或后端枚举。

## Next Notes

- 后续可以把 active filters 合并为统一 filter chips，支持一键移除任意过滤条件。
- 如果真实 API 接入时 timeline 很长，`kind / health / subjectIds` 都应考虑进入服务端查询参数，避免前端只过滤当前页导致漏结果。
