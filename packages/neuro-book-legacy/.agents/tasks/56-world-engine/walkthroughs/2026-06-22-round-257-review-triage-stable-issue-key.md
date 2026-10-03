# Round 257: Review Triage Stable Issue Key

## Context

继续检查真实 Workbench 的 Review Queue / issue triage 路径时发现：

- 作者可以在底部审查工作台把 issue 标记为“确认”或“忽略”。
- 真实 Workbench 的 triage 当前是前端会话态，使用 issue key 关联状态。
- 旧持久 issue key 包含 `issueIndex`，也就是 issue 在 slice `issues[]` 中的数组下标。
- 如果同一 slice 的 issues 在刷新、编辑或后端返回中顺序变化，同一条 issue 的 key 会改变，作者刚标记的确认 / 忽略状态会掉回 open。

## Changes

- `world-engine-workbench-real.ts`
  - `persistedWorldWorkbenchIssueKey()` 不再把原始 issue 数组下标作为稳定身份。
  - 持久 issue key 改为基于 `sliceId + subjectId + attr + code + message + 同身份序号`。
  - `buildWorldWorkbenchReviewQueueItems()` 会对同一 issue identity 计数，只有完全相同身份重复出现时才用 occurrence 区分。
  - 这样普通顺序变化不会影响 issue triage 状态；极少数完全重复 issue 仍能保持不同 key。

- `world-engine-ide-entry.test.ts`
  - 在现有真实 Workbench util 测试中补充行为断言：
    - 先把 `masked` issue 标记为 `confirmed`。
    - 再把同一 slice 的 issue 顺序调换。
    - 重新构造 Review Queue 后，`masked` 仍保持 `confirmed`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 在 Review Queue 标记一个 issue 为确认。
- 触发一次保存或刷新，让同一 slice 的 issue 顺序可能变化。
- 该 issue 应继续保持确认状态。

## Result

实际结果与计划一致：只稳定真实 Workbench 会话态 issue triage 的 key，不改变后端、不持久化 triage、不扩大测试范围。
