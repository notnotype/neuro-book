# Round 121 - State Lifecycle Review

## Context

本轮继续做浏览器验收前的代码审查，聚焦“切换 Project / 空世界 / 加载失败”这类真实操作里的状态生命周期。审查发现：

- 独立 Preview 切换 `selectedProjectPath` 时会清掉 `stateIssues` 和 `actionIssues`，但没有清掉 `stateResult`，用户可能短暂或持续看到上一 Project 的 State Query JSON。
- 主 IDE Workbench 重新加载 schema/subjects/slices 后会尽量保留当前 selected subject/slice，但在切换 Project、空世界或加载失败时没有统一清掉上一 Project 的 selected subject/slice、State Query 和 action issues。两个 Project 都有 `world` 时，这个残留尤其容易误导用户。

这类问题不改变数据，但会影响最终“从用户角度新建 Project 跑实际例子”的验收可信度。

## Changes

- `app/pages/world-engine.preview.vue`
  - 切换 Project 时同步清空 `stateResult`，避免旧 Project 的 State Query JSON 留在新 Project 页面上。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 无 Project 或加载失败时清空 schema/subjects/slices 之外，也清空 `stateIssues`、`lastActionIssues`、`selectedSubjectId`、`selectedSliceId`。
  - `applyDefaults()` 在空 subject / 空 slice 时显式清空 selected id；空 subject 时同时清空 State Query 结果与 issues。
  - 新增 `resetWorkbenchSessionState()`，在 `projectPath` 变化时清空上一 Project 的 selection、query、action feedback 和 notice。
- `app/pages/world-engine.workbench-preview.vue`
  - 验证绕道：`typecheck` 暴露 mock preview 更新 mutation value 时数组索引没有被 TypeScript 收窄，改为先取 `mutation` 再判空。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态断言，防止 Preview/Workbench Project 切换状态清理逻辑被误删。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 18 tests。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 71 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后需要重点确认：

- 独立 Preview 在不同 Project 之间切换时不会显示上一 Project 的 State Query JSON。
- 主 IDE Workbench 切换 Project、打开空 Project、删除 slice 后，selected slice / State Query / action issues 不会残留上一上下文。
- 一键示例世界后仍能直接看到该 slice 触及的多 subject 状态。

## Notes

这轮的主线是浏览器验收前的状态生命周期修复；`world-engine.workbench-preview` 的类型修复是测试门禁暴露的小绕道，已记录在本 walkthrough 中。没有改变后端 DTO、数据库 schema 或 Agent 工具契约。
