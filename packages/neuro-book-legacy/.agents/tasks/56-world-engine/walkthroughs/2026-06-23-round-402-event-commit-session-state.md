# Round 402 - Event Commit Session State

## Context

Round 399-401 已完成单条 `events.jsonl` commit 的后端 API、真实 Workbench 按钮、取消分支验收和主体经历草稿人称修正。继续从作者视角看，追加成功后还有一个轻量卡点：

- 作者确认追加后，右侧 Inspector 中同一条 proposal 的按钮仍显示 `追加`。
- 如果作者没有记住顶部 notice，可能会以为这条经历还没处理，又点一次，才看到 `already-exists`。

这不是后端幂等问题，后端已经用 `time + text` 去重；这是当前 Workbench 会话里的反馈可见性问题。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `worldWorkbenchSubjectEventProposalKey()`，用 `eventsPath + eventJsonLine` 标识同一条目标文件行。
- `WorldEngineWorkbenchDialog.vue`
  - 新增 `committedSubjectEventKeys` 会话态。
  - `commitSubjectEventProposal()` 在 API 返回 `appended` 或 `already-exists` 后记录当前 proposal key。
  - 切换 Project 或关闭 Workbench 时清空该会话态。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `committedSubjectEventKeys` prop。
  - 如果 proposal key 已处理，`追加` 按钮显示为 `已追加`，使用 check icon，并禁用。
  - 函数入口也会拦截已处理 proposal，提示“这条 events.jsonl 经历已在当前会话处理。”

## Verification

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 2 个测试文件通过。
- 9 条测试通过。

## Browser Acceptance

本轮未执行浏览器验收。

原因：要在真实 Workbench 中看到 `已追加` 状态，必须让 commit API 返回 `appended` 或 `already-exists`。对 `ming-ding-zhi-shi-2` 的真实 `simulation/subjects/player/events.jsonl` 写入仍需用户明确授权；mock preview 不调用真实 API，也不会产生这条会话态。

## Plan vs Actual

- 计划：补齐 commit 后的可见反馈，避免作者重复点击同一条 proposal。
- 实际：完成会话态标记、按钮禁用和窄测试；没有触发真实六文件写入。
- 未做：没有验证真实 appended / already-exists 浏览器分支；后续应使用临时测试 Project 或由用户授权真实目标行。

## Next

- 若继续 P1 验收，建议优先使用临时 Project 跑一次 `appended -> 已追加` 和第二次 `already-exists -> 已追加` 的真实 UI 闭环。
- 若用户明确授权，也可以在 `ming-ding-zhi-shi-2` 对当前候选行执行一次确认追加，并记录 hash、events count、dirty 状态变化。
