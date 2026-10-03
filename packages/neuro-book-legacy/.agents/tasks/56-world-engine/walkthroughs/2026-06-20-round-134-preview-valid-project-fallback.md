# Round 134 - Preview Valid Project Fallback

## Context

继续做真实浏览器验收前的独立 `/world-engine.preview` 入口链路审查。round-132 已修复空 query 不 fallback 的问题，round-133 已去重程序化 Project 选择导致的重复 `loadWorld()`。继续审查后发现一个更贴近真实使用的边界：如果 URL 带着已经不存在的 `?projectPath=...`，原逻辑只选择第一个非空字符串，会停在无效 Project path 上并显示加载错误，而不是回退到当前 Project 列表里的可用项目。

这会影响用户从旧链接、删除/重命名后的 Project 链接、或手工编辑 URL 进入 Preview 的体验。

## Work Done

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `selectPreviewProjectPath(projects, ...candidates)`，只接受仍存在于当前 Project 列表里的候选 path。
  - 候选全部为空或无效时，回退到 Project 列表第一项；列表为空时返回空字符串。
- 更新 `app/pages/world-engine.preview.vue`：
  - `loadProjects()` 改用 `selectPreviewProjectPath(projects.value, preferredProjectPath, routeProjectPath, selectedProjectPath.value)`。
  - 保留 round-133 的同步 watcher 抑制逻辑，仍避免程序化选择触发重复 `loadWorld()`。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖无效候选跳过、有效候选 trim 后命中、无有效候选回退第一项、空列表返回空字符串。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言 Preview 页面导入并使用 `selectPreviewProjectPath()`。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
  - 2 files / 19 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 23 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：本轮只修复独立 Preview 入口的无效 Project path fallback，不改变后端 API、DTO 或世界引擎数据契约。
