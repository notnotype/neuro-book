# Round 351 - Copy All Subject File Proposals

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- P0 主体文件建议面已经支持单个 subject proposal、JSONL 行和 `state.md` review reasons 的复制。

## Finding

- 一条 slice 可能同时触及多个主体，例如多角色对话、互动或群体事件。
- 此前作者需要逐个展开 subject proposal 再分别复制；多主体切片进入人工审查时会多一步机械操作。

## Implementation Walkthrough

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `copyAllSubjectFileProposals()`。
  - 将当前 slice 的全部 `subjectFileProposals` 用 `formatWorldWorkbenchSubjectFileProposal()` 格式化后，以 `---` 分隔拼接。
  - 在 `Subject file proposals` 标题区域增加 `复制全部` 按钮。
  - 仍然只复制文本，不自动写入 `simulation/subjects`。
- `world-engine-workbench-preview.test.ts`
  - 增加静态断言，确认全量复制函数、分隔符、按钮标题和成功提示存在。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，1 个测试文件、6 个用例。

## Result

- 多主体 slice 的主体文件建议现在可以一次性复制，方便作者把整条 slice 的六文件后续维护建议交给人工审查或后续 Agent。
- P0 边界不变：不自动写文件、不调用 Agent 工具、不改变 `simulation/subjects` 的 owner。
