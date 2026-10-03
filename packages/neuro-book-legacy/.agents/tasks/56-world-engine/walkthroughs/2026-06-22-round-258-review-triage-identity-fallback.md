# Round 258: Review Triage Identity Fallback

## Context

Round 257 让持久 issue key 不再依赖数组下标，解决了同一 slice 内 issue 顺序变化导致确认 / 忽略状态丢失的问题。继续检查后发现还有一条相邻路径：

- 写入 / 编辑 / 删除返回的 `issues` 会先作为 transient issue 进入当前会话 Review Queue。
- 后续刷新或重新读取 timeline 后，同一 issue 可能出现在 slice `issues[]` 中，变成 persisted issue。
- transient key 和 persisted key 不同；如果作者在 transient 阶段已经标记“确认 / 忽略”，刷新后同一 issue 仍可能掉回 open。

## Changes

- `world-engine-workbench-preview.types.ts`
  - `WorldWorkbenchPreviewIssueTriageState` / `Patch` 增加可选 `identity`。
  - `WorldWorkbenchPreviewReviewQueueItem` 增加可选 `identity`。

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - Review Focus 和 Review Queue 标记 issue 时会把 `identity` 一起上报。

- `WorldEngineWorkbenchDialog.vue`
  - `issueTriageMap` 同时用 `key` 和 `identity` 建索引。
  - 保存 triage state 时保留 patch 的 `identity`。

- `world-engine-workbench-real.ts`
  - 持久 issue 和 transient issue 都带上同一套业务 identity：`sliceId + subjectId + attr + code + message`。
  - 构造 Review Queue status 时先按 key 找状态，再按 identity 兜底。
  - transient issue 变成 persisted issue 后，同一业务 issue 会继承原来的确认 / 忽略状态。

- `world-engine-ide-entry.test.ts`
  - 在现有真实 Workbench util 测试中补充断言：
    - transient `broken-relative` 先被标记为 `ignored`。
    - 后续同一 issue 作为 persisted issue 出现。
    - Review Queue 仍显示 `broken-relative:ignored`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 保存 slice 触发一个 transient issue。
- 在 Review Queue 中将其标记为确认 / 忽略。
- 刷新 timeline，让同一 issue 作为 slice issue 出现。
- 状态应继续保持确认 / 忽略。

## Result

实际结果与计划一致：只增强真实 Workbench 的会话态 issue triage 状态继承，不改后端、不持久化 triage、不扩大测试范围。
