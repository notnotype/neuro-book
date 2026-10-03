# Round 344 - Event JSONL Subject Voice Draft

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 上一轮修正了 `events.jsonl` 候选行的时间重复问题；本轮继续检查候选正文是否适合写入 subject 经历流。

## Finding

- `events.jsonl` 是 subject 的第一人称经历流。
- 旧候选正文是外部标签式：`薇洛丝相关：...`。
- 这类文本适合 Inspector 摘要，但不适合直接追加到角色的 `events.jsonl`。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - `buildSubjectEventText()` 改为生成 `我经历了这件事：...`。
  - 新增 `subjectVoiceText()`，对标题 / 摘要中的当前 subject name 做保守替换，例如 `薇洛丝` -> `我`。
  - `eventDraft` 与 `eventJsonLine.text` 都使用这份更贴近 subject voice 的草稿。

## Boundaries

- 这不是自动文学润色，也不会保证完美第一人称。
- 它只减少明显的外部标签口吻；作者仍需人工确认是否符合角色口吻和认知边界。
- 仍不自动写 `events.jsonl`。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- 本轮未重复执行 `bun run typecheck`；当前全量 typecheck 已知被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。

## Result

- `events.jsonl` 候选行不再以 `某某相关` 开头，而是更接近 subject 自己的经历记录。
