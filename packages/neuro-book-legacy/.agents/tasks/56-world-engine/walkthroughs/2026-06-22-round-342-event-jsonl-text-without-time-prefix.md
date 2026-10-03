# Round 342 - Event JSONL Text Without Time Prefix

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 上一轮已支持复制 `events.jsonl` / `memory.jsonl` 候选行；本轮检查候选行本身是否贴合六文件契约。

## Finding

- `events.jsonl` 的 schema 已有独立 `time` 字段。
- 旧 `eventJsonLine` 把 readable draft 直接塞进 `text`，导致 `text` 里也带 `复兴纪元...｜` 时间前缀。
- 作者把这行粘到 `events.jsonl` 后，会出现时间重复：一份在 `time` 字段，一份混在事件正文里。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - 新增 `buildSubjectEventText()`，只生成事件正文：`{subjectName}相关：{title}。{summary}`。
  - `eventJsonLine` 改用 `buildSubjectEventText()`，输出 `{"text":"...","time":"..."}`。
  - `eventDraft` 继续保留 `time｜...`，作为 UI / 复制文本里的 readable 摘要。

## Boundaries

- 仍不自动写 `events.jsonl`。
- 不尝试自动改成第一人称；当前只是去掉重复时间，避免候选行结构明显不贴合文件契约。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- 本轮未重复执行 `bun run typecheck`；此前已确认当前全量 typecheck 被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。

## Result

- `events.jsonl` 候选行的 `text` 不再重复包含时间前缀。
- readable 摘要仍保留时间，方便作者在 Inspector 中快速判断该建议来自哪个 slice。
