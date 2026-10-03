# Round 354 - Direct Proposal Event Context

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- Round 353 已让 summary 为空时优先使用 `events` mutation 的字符串值生成 `events.jsonl` 候选。

## Finding

- 如果一条 slice 同时包含 `world.events` 和角色自己的状态 mutation，例如：
  - `world.events listAppend = 薇洛丝走向大厅中央。`
  - `player.location set = subject://main-hall`
- 该角色 proposal 会被标记为 `direct-mutation`，并使用角色 mutation 作为上下文。
- 旧逻辑在 summary 为空时会错过同一 slice 的 `world.events` 叙事值，退回到 `player.location set ...` 这种技术摘要。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - 新增 `eventContextMutations`：
    - 如果整条 slice 存在 `events` 字符串 mutation，则 event draft / JSONL 使用整条 slice 的 mutations 提取叙事值。
    - 否则继续使用当前 subject 的 context mutations 作为 fallback。
  - memory facts / state review 仍使用原来的 subject context，不把其它主体状态混进建议。
- `world-engine-ide-entry.test.ts`
  - 增加 direct subject + `world.events` + 空 summary 的断言。
  - 确认 `eventJsonLine.text` 使用 `薇洛丝走向大厅中央。`，且不包含 `player.location` 技术摘要。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，2 个测试文件、9 个用例。

## Result

- 多 mutation slice 中，即使角色 proposal 是 direct mutation 来源，`events.jsonl` 候选也会优先借用同一 slice 的 `world.events` 叙事值。
- P0 边界不变：只改善候选文本，不自动写六文件。
