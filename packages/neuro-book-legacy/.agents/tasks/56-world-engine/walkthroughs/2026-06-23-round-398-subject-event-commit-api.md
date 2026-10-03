# Round 398 - Subject Event Commit API

## Context

Round 397 已把 P1 显式 commit 收敛为最小垂直切片：先只做单个 proposal 的 `events.jsonl` 追加，保持 `{text,time}` 行格式，用 `time + text` 去重，`memory.jsonl` 与 `state.md` 继续 copy / review，不自动 RAG rebuild。

本轮先落后端 / API，不接前端按钮，也不写真实 `workspace/ming-ding-zhi-shi-2` 的六文件。

## Changes

- 在 `/api/projects/world-engine/**` 聚合路由新增：
  - `POST /api/projects/world-engine/subject-file-proposals/events/commit`
- 请求体贴近现有 proposal 字段：
  - `subjectId`
  - `subjectPath`
  - `eventsPath`
  - `sliceId?`
  - `event?`
  - `eventJsonLine?`
- 后端校验：
  - `subjectPath` 必须是 `simulation/subjects/<subject-id>`。
  - `subjectId` 必须匹配 `subjectPath` 末段。
  - `eventsPath` 必须精确匹配 `subjectPath/events.jsonl`。
  - subject 目录和 `events.jsonl` 必须已存在；第一版不自动创建不完整六文件。
  - `eventJsonLine` 会解析为 subject event，并复用现有 `parseSubjectEvent()` 合同。
- 写入行为：
  - 读取现有 `events.jsonl`。
  - 用 `time + text` 判断重复。
  - 已存在时返回 `status: "already-exists"`，不重复写入，不标 dirty。
  - 不存在时追加到末尾，重写 JSONL，并调用 `markSubjectRagDirty(..., "events", nextText)`。
  - 不触发 RAG rebuild。

## Verification

```bash
bunx vitest run server/api/projects/world-engine/[...segments].test.ts
```

结果：

- 1 个测试文件通过。
- 41 条测试通过。
- 新增覆盖：
  - 成功追加单条 subject event。
  - 重复 commit 返回 `already-exists` 且不重复追加。
  - 错误目标文件如 `memory.jsonl` 被拒绝。
  - 写入后 `.nbook/subject-rag-dirty.json` 包含 `events` dirty 标记。

## Scope Notes

- 没有接前端 Inspector 的 `追加到 events.jsonl` 按钮。
- 没有修改 `memory.jsonl` 或 `state.md`。
- 没有自动 rebuild RAG。
- 没有写真实 `ming-ding-zhi-shi-2` 的 `simulation/subjects/player/events.jsonl`。

## Next

- 前端接入时，建议在 Inspector 的单个 `events.jsonl draft` 下增加显式 commit 按钮。
- 点击前应展示应用内确认，列出目标 path 和 JSONL 行。
- 成功后刷新主体系统 overview，让左栏 events dirty / count 状态回流。
