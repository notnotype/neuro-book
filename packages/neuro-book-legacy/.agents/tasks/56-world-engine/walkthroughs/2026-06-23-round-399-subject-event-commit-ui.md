# Round 399 - Subject Event Commit UI

## Context

Round 398 已落地 `POST /api/projects/world-engine/subject-file-proposals/events/commit`。本轮把这个后端入口接到 Workbench Inspector 的单条 `events.jsonl draft` 上，让作者能从“复制建议”前进一步到“显式追加”。

本轮仍不对真实 `workspace/ming-ding-zhi-shi-2` 执行追加，避免未经确认改写角色六文件。

## Changes

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 在 `events.jsonl draft` 操作区增加 `追加` 按钮。
  - 按钮只 emit `commitSubjectEventProposal`，Inspector 仍不直接写文件。
  - busy 时禁用，并在同步中点击时提示稍候。
- `WorldEngineWorkbenchDialog.vue`
  - 接收 `commitSubjectEventProposal`。
  - 使用应用内 `useDialog().confirm()` 二次确认，确认内容包含目标 path、主体名和 JSONL 行。
  - 调用 `POST /api/projects/world-engine/subject-file-proposals/events/commit`。
  - `appended` 显示已追加并标记 events RAG dirty。
  - `already-exists` 显示已存在相同经历。
  - 成功或幂等返回后刷新 `/api/projects/rag/overview`，让主体系统 events count / dirty 状态回流。
  - 如果写入成功但刷新 overview 失败，会报告“已追加但刷新失败”，不误报追加失败。
- `world-engine.workbench-preview.vue`
  - mock 页面接同一事件，但只显示 `mock 预览不会写入 events.jsonl`，不碰真实文件系统。
- 类型
  - 新增 `SubjectEventCommitResultDto`。

## Verification

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 2 个测试文件通过。
- 9 条测试通过。
- 覆盖按钮 / emit、真实 Workbench API 调用、overview 刷新、mock 不写文件提示。

## Browser Acceptance

轻量浏览器验收使用 mock Workbench，不写真实 Project：

1. 启动临时 dev server：`bunx nuxt dev --port 3001`。
2. 打开 `http://localhost:3001/world-engine.workbench-preview`。
3. 点击第一条带 `files 1` 的 event slice。
4. 确认右侧 `Subject file proposals` 出现，`events.jsonl draft` 内有 1 个 `追加` 按钮。
5. 点击 `追加`。
6. 页面顶部提示：
   - `mock 预览不会写入 events.jsonl：simulation/subjects/erina/events.jsonl ← ...`

验收后已关闭浏览器页，停止临时 dev server，并确认 `http://localhost:3001/...` 不再响应。

## Plan vs Actual

- 计划：把 Round 398 后端 API 接到前端，完成最小验证。
- 实际：已接主 Workbench 与 mock Workbench，并做了静态契约测试 + mock 浏览器烟测。
- 未做：没有在真实 `ming-ding-zhi-shi-2` 上点击确认追加；真实写入分支仍需用户给出具体允许写入的目标行和目标文件。

## Next

- 真实写入验收建议使用临时测试 Project 或由用户明确确认 `ming-ding-zhi-shi-2` 的目标行。
- 后续可在 `already-exists` 返回时把按钮视觉变成“已存在”，但第一版先保留普通反馈，避免引入额外状态缓存。
