# Round 349 - State Review Copy

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- P0 主体文件建议面已经支持复制 `events.jsonl` 行、复制 `memory.jsonl` 候选行和打开目标文件。

## Finding

- `state.md review` 只展示审查提示和打开 `state.md` 入口。
- 作者打开 `state.md` 后，常用动作是把审查提示单独带过去；此前只能复制整份 subject proposal，再从里面挑 state review。

## Implementation Walkthrough

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 在 `state.md review` 标题行增加 `复制提示` 按钮。
  - 点击后复制 `proposal.stateReviewReasons.join("\n")`。
  - 仍然只复制文本，不自动写入 `simulation/subjects`。
- `world-engine-workbench-preview.test.ts`
  - 增加静态断言，确认 Inspector 存在 `复制 state.md 审查提示`、复制内容来源和成功提示。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，1 个测试文件、6 个用例。

## Result

- 主 Workbench / mock Workbench 的主体文件建议面现在形成更完整的手动落地闭环：
  - `events.jsonl` 可复制 JSONL 行。
  - `memory.jsonl` 可复制候选行。
  - `state.md` 可复制审查提示。
  - 三类目标文件仍只由作者显式打开和人工确认，不自动改写六文件。
