# Round 275: Empty State Subject Sync Action

## Context

继续从第一次打开真实 Project 的用户路径审查。当前左栏已有 `主体系统待接入` 面板，可以把 `simulation/subjects` 注册为 World Engine subject；但中间主画布在没有 slice 时只提示“请使用左侧同步主体系统”，没有正中动作。

对于第一次打开 Workbench 的作者来说，中间空画布是最显眼区域。如果 Project 有待接入主体却没有 World Engine slice，主画布应该直接提供同一个同步入口，减少“我下一步点哪里”的停顿。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `EmptySliceAction` 新增 `sync-subject-system`。
  - 当前选中 subject 全部是待接入主体时，如果存在 pending subject system summary，空状态 action 改为 `sync-subject-system`。
  - 当前 Project 没有 slice 但存在待接入主体时，空状态优先显示“同步主体系统”动作，而不是只显示“一键示例世界”。
  - 中间空状态新增 `同步主体系统` 按钮，复用 `syncPendingSubjectSystemSubjects()`，并沿用 `workbenchActionBusy || !subjectSystemSyncTime` 禁用条件。

- `world-engine-ide-entry.test.ts`
  - 补充空状态 `sync-subject-system` action、按钮禁用条件和同步函数接线的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续人工或授权验收可覆盖：打开有 `simulation/subjects` 待接入、但没有 World Engine slice 的 Project 时，中间空状态应直接显示 `同步主体系统`；点击后与左栏按钮走同一同步路径。

## Result

实际结果与本轮计划一致：不改变主体同步策略、不改后端 API，只把已有同步能力补到首次空画布的正门入口。
