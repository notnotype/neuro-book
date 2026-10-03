# Round 129 - Preview Project Notice Reset

## Context

继续做真实用户链路前的静态代码审查。上一轮修复了主 IDE Workbench 删除 slice 后自动跳选其他 slice 的问题；本轮检查独立 Preview 的 Project 切换、删除、编辑状态残留。

发现独立 Preview 切换 Project 时会清空 `lastWriteResult`、`editingSliceId`、State Query 和 action issues，但没有清空上一 Project 的 `notice` / `error`。因此用户在 Project A 删除或写入成功后切到 Project B，页面顶部可能仍显示 Project A 的成功/失败提示。

## Work Done

- 更新 `app/pages/world-engine.preview.vue`：
  - `watch(selectedProjectPath, ...)` 中同步清空 `notice.value` 和 `error.value`。
  - Project 切换时提示状态现在与 state/action/editing 一起归零。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 断言 Project 切换 watcher 清空 `lastWriteResult`、`editingSliceId`、`stateResult`、`stateIssues`、`actionIssues`、`notice` 和 `error`。
- 更新 `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md` 记录 round-129。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file / 1 test passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 21 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - 第一次出现与本轮无关的 i18n stale/瞬时类型错误：`en-US.ts` 报 `agentProfileDefaults`，但当前源码对应位置已是 `agentProfileModels`。
  - 复跑通过。

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致；额外记录了 typecheck 首次瞬时失败与复跑通过。
