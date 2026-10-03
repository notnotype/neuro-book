# Round 135 - Preview Project Helper Cleanup

## Context

继续执行代码审查闭环。round-134 用 `selectPreviewProjectPath(projects, ...candidates)` 取代了原先只挑第一个非空字符串的 Project 选择逻辑，确保独立 Preview 不会停在已经不存在的 `projectPath` 上。

审查发现旧 helper `firstProjectPath()` 已经没有生产代码使用，只剩 util 测试保留 round-132 的旧语义。继续保留这个 helper 容易让后续维护误以为“只要非空就可选”仍是 Preview 入口契约。

## Work Done

- 更新 `app/utils/world-engine-preview.ts`：
  - 删除已无生产引用的 `firstProjectPath()`。
  - 保留 `selectPreviewProjectPath()` 作为 Preview Project 选择的唯一 helper。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 删除 `firstProjectPath()` import 和旧语义测试。
  - 保留 `selectPreviewProjectPath()` 的有效候选 / 无效候选 / 空列表行为覆盖。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
  - 2 files / 18 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 22 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：本轮是代码审查清理，不改变运行时行为，只移除被 round-134 新规则取代的旧 helper 和旧测试信号。
