# Round 131 - Preview Create Project Notice

## Context

Round 129 修复了独立 Preview 切换 Project 后上一 Project 的 `notice` / `error` 提示残留。但复查时发现一个连带问题：`createProject()` 原本先设置 `notice = 已创建 ...`，再调用 `loadProjects(project.projectPath)` 选中新 Project；Project 切换 watcher 会清空 `notice`，导致新建 Project 的成功提示立刻消失。

这会直接影响最终“新建 Project 跑实际例子”的真实试用反馈。

## Work Done

- 更新 `app/pages/world-engine.preview.vue`：
  - `createProject()` 改为先 `await loadProjects(project.projectPath)`，再设置 `notice.value = 已创建 ...`。
  - 这样切换 Project 时会先清空旧提示，随后显示本次新建成功提示。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 断言 `await loadProjects(project.projectPath);` 存在。
  - 断言 `notice.value = \`已创建 ${project.projectPath}\`;` 的位置在 `loadProjects` 之后，防止后续回归。
- 更新 `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md` 记录 round-131。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file / 1 test passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 21 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：修复的是独立 Preview 新建 Project 的成功反馈顺序，不改变后端 API 或数据契约。
