# Round 48 - Preview resettle 提示范围修正

## 背景

Round 45 浏览器实跑中出现一个容易误解的差异：

- `writeSlice` / `editSlice` 返回的 `affectedMutations` 只统计后续 mutation。
- `resettleTimeline({ from })` 实际会从 `from` 当刻开始重算，所以结果数量会包含 from 当刻 slice 的 mutation。

例如实跑时编辑 `00:00:01` 的 slice 返回 `affectedMutations: 2`，但执行 re-settle 后结果是 `13 mutations`。行为本身合理，但旧提示写成“预计影响 2 条后续 mutation”，用户容易把它理解为最终 re-settle 结果也应该是 2。

## 本轮计划

1. 不改 API 和 service 语义。
2. 修正 Preview 的 `needsResettle` 提示，让它明确区分“后续影响数”和“实际重算范围”。
3. 抽成 util 并补单测。

## 实现

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `formatResettleHint(time, subjectIds, affectedMutations)`。
  - 文案说明：当前写入报告的是后续 mutation 数，实际结果会包含 from 当刻的 mutation。
- 更新 `app/pages/world-engine.preview.vue`：
  - `applyWriteResultFeedback()` 改用 `formatResettleHint()`。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 re-settle 提示对范围差异的说明。

## 验证

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 个测试文件通过。
  - 13 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 56 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划只修正 Preview 提示文案，没有改动后端 API、Agent 工具或 World Engine 数据模型。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮改动由 util 单测、相关集成测试和 typecheck 覆盖。

## 后续

- 正式主 IDE UI 设计时，需要把“后续影响数”和“实际重算范围”作为两个不同概念展示。
- 如果后续想让 API 也返回更细的 `currentSliceMutations` / `futureMutations`，再单独设计 DTO。
