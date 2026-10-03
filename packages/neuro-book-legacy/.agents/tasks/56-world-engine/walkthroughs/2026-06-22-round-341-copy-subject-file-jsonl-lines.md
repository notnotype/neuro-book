# Round 341 - Copy Subject File JSONL Lines

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 上一轮已经把主体文件建议升级为 JSONL candidate；本轮聚焦打开目标文件后的手动写入效率。

## Finding

- “复制建议”会复制整份 proposal，包含 subject path、jsonl、readable 和 state review。
- 作者打开 `events.jsonl / memory.jsonl` 后，只需要粘贴 JSONL 行；从整段文本里再挑行仍然多一步。

## Implementation Walkthrough

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `copySubjectFileProposalText()`，用于复制 proposal 中的精确文本片段。
  - `events.jsonl draft` 区域新增“复制行”，复制单条 `eventJsonLine`。
  - `memory facts` 区域新增“复制行”，复制所有 `memoryJsonLines`，多行之间用换行连接。
  - 原来的“复制建议”仍保留，用于复制完整审查上下文。

## Boundaries

- 仍不自动写 `simulation/subjects`。
- 仍不调用 Agent 工具。
- `memory.jsonl` 的复制行仍是候选行；memory 的追加 / 改写旧 topic 需要作者确认。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- 本轮未重复执行 `bun run typecheck`；上一轮已确认当前全量 typecheck 被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。

## Result

- 作者现在可以选择：
  - 复制完整 proposal 交给审查 / Agent。
  - 打开目标文件后，只复制 `events.jsonl` 或 `memory.jsonl` 的候选行进行手动落地。
