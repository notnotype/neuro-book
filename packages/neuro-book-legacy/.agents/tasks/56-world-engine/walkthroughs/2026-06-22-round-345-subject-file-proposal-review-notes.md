# Round 345 - Subject File Proposal Review Notes

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 主体文件建议已经能复制 JSONL 行，但候选行仍然是半自动草稿，需要作者确认口吻与认知边界。

## Finding

- `events.jsonl` 候选行已经改成主体经历口吻，但仍不是最终文学润色。
- `memory.jsonl` 是当前认知快照，不能总是盲目追加；有时应改写已有 topic。
- 旧 UI / 复制文本只说“不自动写入”，没有在候选行附近提示这些人工判断点。

## Implementation Walkthrough

- `formatWorldWorkbenchSubjectFileProposal()`
  - 在 `events.jsonl draft` 的 `jsonl:` 后增加 review note：写入前确认第一人称口吻、角色当时知道什么、是否应追加到 `events.jsonl`。
  - 在 `memory.jsonl candidates` 的候选行后增加 review note：确认是追加新 topic，还是改写已有 topic。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - 在 event JSONL candidate 下方显示同样的人工确认提示。
  - 在 memory JSONL candidate 列表中显示 memory 快照语义提示。

## Boundaries

- 仍不自动写 `simulation/subjects`。
- 仍不替作者裁决第一人称文风、角色认知边界或 memory topic 合并策略。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- 本轮未重复执行 `bun run typecheck`；当前全量 typecheck 已知被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。

## Result

- 作者复制候选行或完整 proposal 时，都能看到最关键的人工确认点。
