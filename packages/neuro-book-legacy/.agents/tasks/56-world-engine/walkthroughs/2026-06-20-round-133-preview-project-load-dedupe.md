# Round 133 - Preview Project Load Dedupe

## Context

继续做浏览器验收前的独立 `/world-engine.preview` 入口链路审查。round-132 修复了无 `?projectPath=` 时的 Project fallback，但 `loadProjects()` 程序化设置 `selectedProjectPath` 时会触发 `watch(selectedProjectPath)`，随后 `loadProjects()` 自己又会 `await loadWorld()`，造成同一次 Project 列表加载里重复读取世界数据。

这不改变数据正确性，但会让 Preview 初始打开、新建 Project 后选中、刷新 Project 列表这些路径出现多余请求，也容易让 notice / error / action issues 的状态清理顺序更难推理。

## Work Done

- 更新 `app/pages/world-engine.preview.vue`：
  - 新增 `suppressProjectSelectionWatcher`，用于区分程序化 Project 选择与用户手动下拉选择。
  - `loadProjects()` 计算 `nextProjectPath` 后，如果需要更新选择，会在同步 watcher 抑制窗口内设置 `selectedProjectPath`，再清理当前 Project 会话态。
  - `watch(selectedProjectPath)` 增加抑制判断，只在用户手动切换 Project 时清理会话态并触发 `loadWorld()`。
  - watcher 使用 `{flush: "sync"}`，保证抑制标记覆盖 `selectedProjectPath.value = nextProjectPath` 触发的同步回调。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言 Preview 页面保留 `nextProjectPath`、watcher 抑制、会话态清理函数和 `{flush: "sync"}` 契约。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 files / 18 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 22 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：本轮只去重独立 Preview 的 Project 选择加载路径，不改变 World Engine 后端 API、DTO 或数据契约。
