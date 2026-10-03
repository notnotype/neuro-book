# Round 356 - Event Deduplicate Title

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- P0 主体文件建议会把 slice title 和事件叙事值拼成 `events.jsonl` 候选正文。

## Finding

- 真实写作时，作者常把 slice title 写成一句完整事件，例如 `薇洛丝走向大厅`。
- 如果 `world.events` value 也是同一事件，例如 `薇洛丝走向大厅。`，旧候选会生成重复正文：
  - `我经历了这件事：我走向大厅。我走向大厅。`
- 这会让作者手动粘贴前多一步清理。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - `buildSubjectEventText()` 先把 title 和 summary/event value 都转成 subject voice。
  - 新增 `normalizedSubjectEventText()`，去掉常见标点和空白后比较。
  - 如果二者相同，只输出一遍 title 句。
  - `eventMutationNarrative()` 读取字符串 value 时顺手 trim，避免候选带入无意义空白。
- `world-engine-ide-entry.test.ts`
  - 把 direct + `world.events` 场景改为 title 与 event value 重复。
  - 断言最终 `eventJsonLine.text` 只出现一次 `我走向大厅。`，仍不包含其它 subject events 或技术 mutation。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，2 个测试文件、9 个用例。

## Result

- `events.jsonl` 候选在 title 与事件值重复时更干净，不再把同一句经历写两遍。
- P0 边界不变：这只是候选文本整理，不自动写六文件。
