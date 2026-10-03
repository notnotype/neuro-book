# Round 355 - Subject-Aware Event Context

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- Round 354 让 direct subject proposal 能借用同一 slice 的 `events` 叙事值。

## Finding

- 多主体 slice 中可能同时存在多个 subject 的 `events` mutation。
- 如果 event draft 直接扫描整条 slice 的所有 `events`，当前 subject 的 `events.jsonl` 候选可能串入其它角色的经历。
- 真实作者流里，多角色对话 / 互动是常见切片形态，这个串线风险需要收窄。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - 新增 `eventContextMutationsForSubject()`。
  - event draft / JSONL 只优先使用：
    - 当前 subject 自己的 `events` 字符串 mutation。
    - `world.events` 字符串 mutation。
  - 找不到相关 event 时，才回退到原来的 subject context mutations。
  - memory facts 和 `state.md review` 仍按 subject context 生成。
- `world-engine-ide-entry.test.ts`
  - 在 direct proposal 测试 slice 里加入其它角色的 `events` mutation。
  - 断言当前 `player` 的 `eventJsonLine.text` 不包含其它角色事件文本。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，2 个测试文件、9 个用例。

## Result

- 多主体 slice 的主体文件建议更贴近作者预期：当前角色的 `events.jsonl` 候选可以借用 `world.events`，但不会把其它角色自己的事件写进来。
- P0 边界不变：仍只是候选文本，不自动写六文件。
