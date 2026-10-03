# Round 340 - Subject File Proposal JSONL Candidates

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 上一轮已经能从主体文件建议面打开 `events.jsonl / memory.jsonl / state.md`，本轮检查作者打开文件后的下一步是否顺畅。

## Finding

- 旧的 `events.jsonl draft` 是人类可读句子，不是 JSONL。
- 作者打开 `events.jsonl` 后还要猜字段结构，容易卡在“这行到底该怎么写进文件”。
- `memory.jsonl facts` 也只有摘要，没有给出 `topic/view` 候选。

## Implementation Walkthrough

- `WorldWorkbenchSubjectFileProposal`
  - 新增 `eventJsonLine`。
  - 新增 `memoryJsonLines`。
- `buildWorldWorkbenchSubjectFileProposals()`
  - `events.jsonl` 生成可粘贴候选：`{"text":"...","time":"..."}`。
  - `memory.* / relationship.* / relationships.*` mutation 生成可粘贴候选：`{"topic":"...","view":"..."}`。
  - 保留原有 `eventDraft / memoryFacts / stateReviewReasons`，用于人工审查语境。
- `formatWorldWorkbenchSubjectFileProposal()`
  - 复制文本中先给 `jsonl:`，再给 `readable:`。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - UI 中优先展示 JSONL candidate，再展示可读摘要。

## Boundaries

- 仍不自动写 `simulation/subjects`。
- 仍不调用 Agent 工具。
- `memoryJsonLines` 只是候选：memory 是当前认知快照，作者仍需判断追加还是改写旧 topic。
- `state.md` 仍只给 review reasons，不自动 patch。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- `bun run typecheck` 未通过，但阻塞来自无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移：`UserInputFormSpec | Promise<...>` 上直接访问 `form`，以及 `ImageContent | TextContent` 上直接访问 `text`。本轮未顺手修无关 Agent control tools 测试。

## Result

- 作者现在从建议面打开 `events.jsonl` 后，可以直接复制 JSONL candidate 作为手动追加基础。
- 对 `memory.jsonl`，建议也从普通 facts 升级为 `topic/view` 候选，减少从 World Engine mutation 转成主体记忆格式时的手工猜测。
