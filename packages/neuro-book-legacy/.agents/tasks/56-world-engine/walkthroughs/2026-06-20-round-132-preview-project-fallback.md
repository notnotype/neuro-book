# Round 132 - Preview Project Fallback

## Context

继续做真实浏览器验收前的入口链路审查。独立 `/world-engine.preview` 应该支持两种打开方式：

- 带 `?projectPath=workspace/...`，直接选中指定 Project。
- 不带 query，自动回退到当前已选 Project 或 Project 列表第一项，方便用户直接打开调试页试用。

审查发现 `loadProjects()` 使用 nullish coalescing 选择 Project path，但无 query 时 `routeProjectPath` 是空字符串 `""`，不会被 `??` 跳过，导致后续 `selectedProjectPath.value` 和 `projects[0]?.projectPath` 都无法作为 fallback。

## Work Done

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `firstProjectPath(...candidates)`，返回第一个 trim 后非空的 Project path。
- 更新 `app/pages/world-engine.preview.vue`：
  - `loadProjects()` 改用 `firstProjectPath(preferredProjectPath, routeProjectPath, selectedProjectPath.value, projects.value[0]?.projectPath)`。
  - 空 query 不再阻断 fallback。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `firstProjectPath(undefined, "", "   ", "workspace/current", "workspace/first")` 返回 `workspace/current`。
  - 覆盖全空候选返回空字符串。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 断言 Preview 页面导入并使用 `firstProjectPath()`。
- 更新 `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md` 记录 round-132。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
  - 2 files / 18 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 22 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：修复的是独立 Preview 初始 Project 选择 fallback，不改变后端 API 或数据契约。
