# Round 361 - Slice Card Proposal Badge

## 背景

前几轮已经把保存提示、Inspector 顶栏和隐藏 Inspector 恢复入口串起来。但作者推演几步后，经常会回看 timeline 中的历史 slice；如果主体文件建议只在选中 slice 后的右栏出现，作者需要逐条点开才知道哪条 slice 还有六文件后续建议。

## 本轮目标

- 在主画布 slice card 上显示主体文件建议数量。
- 复用现有 `buildWorldWorkbenchSubjectFileProposals()`，不另造一套判断规则。
- 不改变后端 / API / Agent 工具，不自动写 `simulation/subjects`。

## 实现

- `WorldEngineWorkbenchPreviewSliceCard.vue`
  - 新增 `subjectSystemSummaries` prop。
  - 根据当前 slice、focused subject、subject name map 和 subject system summaries 计算 `subjectFileProposalCount`。
  - 当前 slice 有建议时，在卡片顶部状态徽标区显示 `files N`。

- `WorldEngineWorkbenchPreviewSliceList.vue`
  - 新增 `subjectSystemSummaries` prop，并透传给每个 SliceCard。

- `WorldEngineWorkbenchDialog.vue`
  - 真实 Workbench 的 SliceList 传入 `subjectSystemSummaries`。

- `world-engine.workbench-preview.vue`
  - mock Workbench 的 SliceList 传入 `mockWorkbenchSubjectSystemSummaries`。

- 测试
  - `world-engine-workbench-preview.test.ts` 覆盖 SliceCard 徽标和 SliceList 透传。
  - `world-engine-ide-entry.test.ts` 覆盖真实 Dialog 透传和 SliceCard test id。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 这不是 issue / draft 状态的一部分；它只是 P0 主体文件建议的发现入口。
- 对 `world.events` 且依赖 focused subject 的建议，卡片徽标会随当前 focused subject 语境变化；这是当前 P0 设计的保守语义，没有把 world event 自动归属到所有主体。
