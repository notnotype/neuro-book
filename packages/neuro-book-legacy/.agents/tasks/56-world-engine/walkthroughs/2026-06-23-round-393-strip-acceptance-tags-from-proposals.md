# Round 393 - Strip Acceptance Tags From Proposals

## Context

Round 380 真实浏览器验收留下了三条 `[验收]` 主线 slice，作为可回查证据继续保留在 `ming-ding-zhi-shi-2` 的 Project SQLite 中。Round 391 后这些 event slice 仍能在 `薇洛丝` 主体语境下生成主体文件建议。

新的作者流卡点是：proposal 会把 `[验收]` 内部标记原样写入 `events.jsonl` 草稿，例如：

```json
{"text":"我经历了这件事：[验收] 我观察召唤大厅余波。...","time":"复兴纪元488年 1月15日 14:00:06"}
```

真实 `simulation/subjects/player/events.jsonl` 中的正文没有这种验收标签；`[验收]` 只是本轮开发留下的内部测试标记，不应该被作者复制进角色经历。

## Scope

- 主体文件建议生成时，清理标题 / world.events 文本开头的 `[验收]` 或 `[验收-...]` 前缀。
- 只影响 proposal 文本，不改 slice title，不改 Project SQLite，不改 `simulation/subjects` 六文件。
- 不做通用标题清洗，避免误删作者自己的正常标签。

## Implementation

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `stripAcceptanceEventPrefix()`。
  - `buildSubjectEventText()` 对 title / summary 走该清理。
  - `eventMutationNarrative()` 对 `events` mutation value 走该清理。
- `app/utils/world-engine-ide-entry.test.ts`
  - 增加 `[验收]` title + `[验收]` `world.events` value 的 proposal 断言。
  - 确认 JSONL 文本为干净主体经历，且不包含 `[验收]`。

## Verification

### Static Tests

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts
```

结果：1 个测试文件，3 条测试通过。

### Browser Acceptance

Project：`workspace/ming-ding-zhi-shi-2`

浏览器步骤：

1. 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
2. 打开顶部 `World`。
3. 点击 `薇洛丝` 的 `语境`。
4. 点击第一条 `[验收]` event slice 的 `files 1`。
5. 读取右侧 `Subject file proposals` 的 `events.jsonl draft`。

实际结果：

- `薇洛丝` 语境下三条 event slice 仍显示 `files 1`。
- 第一条 event 的 JSONL 为：

```json
{"text":"我经历了这件事：我观察召唤大厅余波。我在召唤大厅中保持沉默，继续观察符文光、法师和其他被召唤者的反应。","time":"复兴纪元488年 1月15日 14:00:06"}
```

- proposal section 不再包含 `[验收]`。
- 本轮没有保存、删除或写 Project SQLite，也没有修改 `simulation/subjects` 六文件。
- 临时 `bunx nuxt dev --port 3001` 已关闭，确认 `port 3001 free`。

## Actual vs Plan

- 计划：清掉内部验收标记，让作者复制的 `events.jsonl` 候选更像真实角色经历。
- 实际：静态测试和真实浏览器都确认 `[验收]` 不再进入 proposal 文本。
- 与计划出入：无。

## Follow-up

- Round 380 的三条 `[验收]` slice 仍保留为验收证据；本轮只是避免它们污染主体文件建议输出。
- 继续观察 proposal 文本质量，但不要把主体文件建议做成自动文学润色器；它仍是“可复制、需作者确认”的人工落地辅助。
