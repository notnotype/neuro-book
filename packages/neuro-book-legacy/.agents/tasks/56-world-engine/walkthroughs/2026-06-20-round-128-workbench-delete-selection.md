# Round 128 - Workbench Delete Selection

## Context

继续按“代码审查 -> 修复 -> 测试 -> 文档记录”的循环推进。浏览器验收仍未获得明确授权，因此本轮先做主 IDE Workbench 的交互边界审查。

审查发现：Workbench 删除当前选中的 slice 后，会先把 `selectedSliceId` 清空，但随后的 `loadWorld()` 会通过 `applyDefaults()` 自动选中最后一条 slice。用户看到“已删除 A”后，右侧 Inspector 会立刻跳到另一条 slice B，容易误解为删除失败或仍在查看刚删除的切面。

## Work Done

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - `loadWorld()` 增加 `{ autoSelectSlice?: boolean }` 选项。
  - `applyDefaults()` 在 `autoSelectSlice === false` 时不自动选择最后一条 slice。
  - `deleteSelectedSlice()` 删除成功后使用 `await loadWorld({autoSelectSlice: false})`，保持无选中 slice。
  - 普通加载、写入 slice、创建 subject、一键示例世界仍使用默认自动选择逻辑。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 断言 Workbench 删除路径包含 `await loadWorld({autoSelectSlice: false})`。
  - 断言默认逻辑中存在 `options.autoSelectSlice === false` 分支。
- 更新 `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md` 记录 round-128。

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

- 本轮没有执行浏览器验收；仍等待用户明确授权后，在 Preview 和主 IDE Workbench 跑新建 Project、示例世界、写入 / 编辑 / 删除 slice、查询 state 和 issues 展示。
- 实际结果与计划一致：修复的是 Workbench 删除 slice 后的 UX 状态跳转，不改变后端 API 或数据契约。
