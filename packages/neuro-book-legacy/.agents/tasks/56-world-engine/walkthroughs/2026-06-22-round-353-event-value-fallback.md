# Round 353 - Event Value Fallback

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- P0 主体文件建议面会生成可粘贴 `events.jsonl` 候选。

## Finding

- `events.jsonl` 候选正文优先使用 slice summary。
- 如果作者只写了 title 和 `world.events listAppend`，但 summary 为空，旧逻辑会退回到技术 mutation 摘要，例如 `world.events listAppend = ...`。
- 这类文本不适合直接作为主体经历草稿，尤其是 `ming-ding-zhi-shi-2` 里角色事件常回退到 `world.events` 的路径。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - `buildSubjectEventText()` 的 summary fallback 改为：
    1. slice summary。
    2. `events` mutation 的字符串 value。
    3. 技术 mutation summary。
    4. 默认兜底文案。
  - 新增 `eventMutationNarrative()`，只提取 `attrRoot(events)` 且 value 为非空 string 的 mutation。
- `world-engine-ide-entry.test.ts`
  - 把 focused subject + `world.events` 的测试 slice 改成空 summary。
  - 断言生成的 `eventJsonLine.text` 使用 `大厅塔钟响起。`，且不包含 `world.events` 技术摘要。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，2 个测试文件、9 个用例。

## Result

- 作者未填写 summary 时，`events.jsonl` 候选仍会尽量使用世界事件本身的叙事值，而不是把技术 mutation 字符串塞进主体经历。
- P0 边界不变：这只是候选文本质量改善，写入前仍需作者确认第一人称口吻、角色认知边界和是否应追加。
