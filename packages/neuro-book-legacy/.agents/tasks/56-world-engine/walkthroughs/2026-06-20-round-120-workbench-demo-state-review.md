# Round 120 - Workbench Demo State Review

## Context

本轮继续按“代码审查 -> 修复 -> 测试”的路径推进，仍不自动做浏览器验收。审查主 IDE Workbench 一键示例世界链路时发现一个用户视角问题：

- 独立 Preview 创建示例世界后会查询 `erina, old-sword, world`，用户能直接看到角色、物品与世界状态。
- 主 IDE Workbench 创建示例世界后只调用 `querySelectedState()` 查询 `erina`，但同时把查询 attrs 改成 `hp,location,inventory,events,durability,era`。其中 `durability` 属于 `old-sword`，`era` 属于 `world`，因此首屏 State Query 只能看到单个角色状态，示例世界全貌不明显。

这不影响后端正确性，但会影响最终浏览器验收时的第一眼体验。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 一键示例世界写入成功后，把 `selectedSliceId` 设置为新 slice id。
  - 选中 `erina` 后改为调用 `querySelectedSliceSubjects()`，直接查询该 slice 触及的所有 subject。
  - 保留本次写入返回的 `issues`，避免查询动作清掉 action issues。
- `app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue`
  - 注释对齐当前契约：创建 subject 时只有 schema default 非空才会写入初始化切面。
- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态断言，防止 Workbench 示例世界回退成只查询单 subject。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 18 tests。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts server/workspace-files/workspace-files.test.ts -t "创建 Project Workspace 时会写入 manifest|World Engine|world engine|create|delete|query|slice|profile|tool"`：通过，5 files / 33 tests / 96 skipped。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 71 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后需要重点确认：

- 主 IDE Workbench 一键示例世界后 State tab 是否显示该 slice 触及的 world/location/character/item 状态。
- 写 / 编辑 / 删除 slice 后 action issues 是否仍保持在顶部可见。
- Timeline badge、Selected Slice 检查器、State Query issues 是否与 Preview 一致。

## Notes

这轮没有改变后端 DTO、数据库或 Agent 工具，只修正 Workbench 示例世界的默认观察视角。它更接近最终用户验收时的真实需求：点“一键示例世界”之后应立即看到一个完整世界切面，而不是只看到其中一个角色。
